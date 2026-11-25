/**
 * AITQR backend on Cloudflare Workers (Freebuff Sites).
 *
 * Accounts are created by an administrator: username, password and the account's **public** signing key.
 * AITQR never generates account keys and never holds a private key; the staff member imports their own
 * key in the browser (non-extractable) and signs the QR there. The server handles login, configuration,
 * account management and token verification only.
 */
import { signBundle as signWithKey } from "../src/config/sign.js";
import { assertBundleShape } from "../src/config/verify.js";
import { validateProfile } from "../src/profile.js";
import { openToken, verifySignature } from "../src/verify-token.js";
import { bytesToHex, hexToBytes, kidOf } from "../vendor/metaqr/src/index.js";
import {
  createSessionToken,
  hashPassword,
  isHex64,
  isSessionSecret,
  isValidUsername,
  normaliseUsername,
  pbkdf2Iterations,
  readCookie,
  readSessionToken,
  storedIterations,
  timingSafeEqual,
  verifyPassword,
} from "../src/auth.js";
import defaultSigned from "../bundles/default.bundle.json";
import type { Bundle, SignedBundle } from "../src/types.js";

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean; meta: { last_row_id?: number; changes?: number } }>;
}

interface D1Database {
  prepare(sql: string): D1PreparedStatement;
}

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DB: D1Database;
  APP_ORIGIN: string;
  /** Ed25519 seed that signs configuration bundles. Site secret. */
  AITQR_ADMIN_KEY?: string;
  /** HMAC secret for login session cookies. Site secret. */
  AITQR_SESSION_KEY?: string;
  /** One-time code required to create the first administrator. Site secret. */
  AITQR_SETUP_CODE?: string;
  /** Optional PBKDF2-SHA256 rounds; raise it where hosting allows more CPU. */
  AITQR_PBKDF2_ITERATIONS?: string;
}

interface UserRow {
  id: string;
  username: string;
  display_name: string | null;
  role: string;
  password_hash: string;
  public_key: string | null;
  kid: string | null;
  status: string;
  failed: number;
  locked_until: number | null;
  created_at: number;
  last_seen_at: number | null;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id TEXT PRIMARY KEY,
     username TEXT NOT NULL UNIQUE,
     display_name TEXT,
     role TEXT NOT NULL,
     password_hash TEXT NOT NULL,
     public_key TEXT,
     kid TEXT,
     status TEXT NOT NULL,
     failed INTEGER NOT NULL DEFAULT 0,
     locked_until INTEGER,
     created_at INTEGER NOT NULL,
     last_seen_at INTEGER
   )`,
  `CREATE TABLE IF NOT EXISTS bundle_versions (
     seq INTEGER PRIMARY KEY,
     signed TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     created_by TEXT,
     note TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS bundle_draft (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     source TEXT NOT NULL,
     updated_at INTEGER NOT NULL,
     updated_by TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL,
     updated_at INTEGER NOT NULL,
     updated_by TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS audit (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at INTEGER NOT NULL,
     actor TEXT,
     action TEXT NOT NULL,
     detail TEXT
   )`,
];

let schemaReady: Promise<void> | undefined;

async function ensureSchema(env: Env): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const statement of SCHEMA) await env.DB.prepare(statement).run();
      const draft = await env.DB.prepare("SELECT id FROM bundle_draft WHERE id = 1").first();
      if (!draft) {
        const seed = defaultSigned as unknown as SignedBundle;
        await env.DB.prepare("INSERT INTO bundle_draft (id, source, updated_at, updated_by) VALUES (1, ?, ?, ?)")
          .bind(JSON.stringify(seed.bundle, null, 2), Date.now(), "seed")
          .run();
        await env.DB.prepare(
          "INSERT OR IGNORE INTO bundle_versions (seq, signed, created_at, created_by, note) VALUES (?, ?, ?, ?, ?)",
        )
          .bind(seed.bundle.seq, JSON.stringify(seed), Date.now(), "seed", "bundled default")
          .run();
      }
    })().catch((error) => {
      schemaReady = undefined;
      throw error;
    });
  }
  return schemaReady;
}

async function log(env: Env, actor: string, action: string, detail: string): Promise<void> {
  await env.DB.prepare("INSERT INTO audit (at, actor, action, detail) VALUES (?, ?, ?, ?)")
    .bind(Date.now(), actor, action, detail)
    .run();
}

// ---------------------------------------------------------------- sessions

const SESSION_COOKIE = "aitqr_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const MAX_FAILED = 5;
const LOCK_MS = 60_000;

function cookieHeader(env: Env, value: string, maxAge: number): string {
  const secure = env.APP_ORIGIN.startsWith("https://") ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

async function createSessionCookie(env: Env, username: string): Promise<string> {
  const secret = env.AITQR_SESSION_KEY?.trim() ?? "";
  if (!isSessionSecret(secret)) throw new Error("AITQR_SESSION_KEY is not configured");
  const token = await createSessionToken(secret, username, SESSION_TTL_SECONDS, Date.now());
  return cookieHeader(env, token, SESSION_TTL_SECONDS);
}

async function sessionUsername(req: Request, env: Env): Promise<string | null> {
  const secret = env.AITQR_SESSION_KEY?.trim() ?? "";
  if (!isSessionSecret(secret)) return null;
  return readSessionToken(secret, readCookie(req.headers.get("Cookie"), SESSION_COOKIE), Date.now());
}

async function findUser(env: Env, username: string): Promise<UserRow | null> {
  return env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first<UserRow>();
}

async function currentUser(req: Request, env: Env): Promise<UserRow | null> {
  const username = await sessionUsername(req, env);
  if (!username) return null;
  const user = await findUser(env, username);
  if (!user || user.status !== "active") return null;
  return user;
}

// ---------------------------------------------------------------- helpers

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...(init.headers ?? {}),
    },
  });
}

function fail(message: string, status = 400): Response {
  return json({ error: message }, { status });
}

/**
 * CSRF guard: the Origin must be this same site. Compared against the request's own Host so it also
 * works behind the preview proxy, where the public host differs from the Worker's internal URL.
 */
function isSameOrigin(req: Request, env: Env): boolean {
  const origin = req.headers.get("Origin");
  if (!origin) {
    const site = req.headers.get("Sec-Fetch-Site");
    return site === "same-origin" || site === "none";
  }
  try {
    const originUrl = new URL(origin);
    const host = req.headers.get("Host") ?? new URL(req.url).host;
    if (originUrl.host === host) return true;
    return originUrl.origin === new URL(env.APP_ORIGIN).origin;
  } catch {
    return false;
  }
}

function securityHeaders(env: Env): Record<string, string> {
  const preview = new URL(env.APP_ORIGIN).hostname.includes("-preview.");
  const ancestors = preview
    ? "'self' https://*.freebuff.com https://*.freebuff.site https://*.style.dev"
    : "'none'";
  return {
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      `frame-ancestors ${ancestors}`,
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
}

export function validateSource(source: unknown): { bundle: Bundle } | { problems: string[] } {
  if (typeof source !== "object" || source === null) return { problems: ["bundle must be a JSON object"] };
  const bundle = source as Bundle;
  const problems = assertBundleShape(bundle);
  const ids = new Set<string>();
  for (const profile of Array.isArray(bundle.profiles) ? bundle.profiles : []) {
    if (ids.has(profile.id)) problems.push(`duplicate profile id ${profile.id}`);
    ids.add(profile.id);
    problems.push(...validateProfile(profile, bundle.lists ?? {}));
  }
  for (const id of bundle.global?.allowed_profiles ?? []) {
    if (!ids.has(id)) problems.push(`allowed_profiles lists unknown profile ${id}`);
  }
  if (problems.length > 0) return { problems };
  return { bundle };
}



async function kidFor(publicHex: string): Promise<string> {
  return bytesToHex(await kidOf(new Uint8Array(hexToBytes(publicHex))));
}

function publicUser(user: UserRow): Record<string, unknown> {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    publicKey: user.public_key,
    kid: user.kid,
    status: user.status,
    createdAt: user.created_at,
    lastSeenAt: user.last_seen_at,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const handler = async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      const path = url.pathname;

      // ---- public ------------------------------------------------------------------------
      if (path === "/bundles/latest.bundle.json") {
        await ensureSchema(env);
        const row = await env.DB.prepare("SELECT signed FROM bundle_versions ORDER BY seq DESC LIMIT 1").first<{
          signed: string;
        }>();
        if (!row) return new Response("not found", { status: 404 });
        return new Response(row.signed, {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=30",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }

      if (path === "/api/health") {
        await ensureSchema(env);
        const published = await env.DB.prepare("SELECT seq FROM bundle_versions ORDER BY seq DESC LIMIT 1").first<{
          seq: number;
        }>();
        const decoder = await env.DB.prepare("SELECT value FROM settings WHERE key = 'decoder_secret'").first<{
          value: string;
        }>();
        const counts = await env.DB.prepare(
          "SELECT (SELECT COUNT(*) FROM users WHERE role = 'admin') AS admins, (SELECT COUNT(*) FROM users) AS users",
        ).first<{ admins: number; users: number }>();
        const adminSeed = env.AITQR_ADMIN_KEY?.trim() ?? "";
        let adminKid: string | null = null;
        if (/^[0-9a-fA-F]{64}$/.test(adminSeed)) {
          try {
            const { signerFromSeed } = await import("../vendor/metaqr/src/index.js");
            adminKid = bytesToHex(await kidOf((await signerFromSeed(adminSeed)).publicKey));
          } catch {
            adminKid = null;
          }
        }
        return json({
          ok: true,
          configured: {
            adminKey: /^[0-9a-fA-F]{64}$/.test(adminSeed),
            sessionKey: /^[0-9a-fA-F]{64}$/.test(env.AITQR_SESSION_KEY?.trim() ?? ""),
            decoderSecret: Boolean(decoder?.value),
          },
          adminKid,
          admins: Number(counts?.admins ?? 0),
          users: Number(counts?.users ?? 0),
          publishedSeq: published?.seq ?? null,
        });
      }

      if (path === "/api/session") {
        await ensureSchema(env);
        const user = await currentUser(req, env);
        return json({ signedIn: user !== null, user: user ? publicUser(user) : null });
      }

      if (path === "/api/bootstrap") {
        await ensureSchema(env);
        if (req.method !== "POST") return fail("Method not allowed", 405);
        if (!isSameOrigin(req, env)) return new Response(null, { status: 403 });
        const body = (await req.json().catch(() => null)) as { username?: string; password?: string; code?: string } | null;
        const username = normaliseUsername(body?.username ?? "");
        const password = body?.password ?? "";
        const setupCode = env.AITQR_SETUP_CODE?.trim() ?? "";
        if (!/^[0-9a-fA-F]{16,128}$/.test(setupCode)) return fail("Kode setup belum dikonfigurasi di server.", 503);
        if (!timingSafeEqual((body?.code ?? "").trim().toLowerCase(), setupCode.toLowerCase())) {
          return fail("Kode setup salah.", 403);
        }
        if (!isValidUsername(username)) return fail("Username 3-32 karakter: huruf kecil, angka, titik, garis bawah, strip.");
        if (password.length < 8) return fail("Kata sandi minimal 8 karakter.");
        const admins = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first<{ n: number }>();
        if (Number(admins?.n ?? 0) > 0) return fail("Administrator sudah ada; masuk dengan akun Anda.", 409);
        const id = crypto.randomUUID();
        await env.DB.prepare(
          "INSERT INTO users (id, username, display_name, role, password_hash, status, created_at) VALUES (?, ?, ?, 'admin', ?, 'active', ?)",
        )
          .bind(id, username, username, await hashPassword(password, pbkdf2Iterations(env.AITQR_PBKDF2_ITERATIONS)), Date.now())
          .run();
        await log(env, username, "admin.bootstrap", "first administrator");
        const cookie = await createSessionCookie(env, username);
        return json({ ok: true, user: { username, role: "admin" } }, { headers: { "Set-Cookie": cookie } });
      }

      if (path === "/api/login") {
        await ensureSchema(env);
        if (req.method !== "POST") return fail("Method not allowed", 405);
        if (!isSameOrigin(req, env)) return new Response(null, { status: 403 });
        const body = (await req.json().catch(() => null)) as { username?: string; password?: string } | null;
        const username = normaliseUsername(body?.username ?? "");
        const password = body?.password ?? "";
        if (!username || !password) return fail("Username dan kata sandi wajib diisi.");
        const user = await findUser(env, username);
        // Same message for unknown user and wrong password.
        if (!user) return fail("Username atau kata sandi salah.", 401);
        if (user.status !== "active") return fail("Akun ini dinonaktifkan. Hubungi administrator.", 403);
        if (user.locked_until && user.locked_until > Date.now()) {
          return fail("Terlalu banyak percobaan. Coba lagi sebentar.", 429);
        }
        if (!(await verifyPassword(password, user.password_hash))) {
          const failed = user.failed + 1;
          const lockedUntil = failed >= MAX_FAILED ? Date.now() + LOCK_MS : null;
          await env.DB.prepare("UPDATE users SET failed = ?, locked_until = ? WHERE id = ?")
            .bind(lockedUntil ? 0 : failed, lockedUntil, user.id)
            .run();
          return fail("Username atau kata sandi salah.", 401);
        }
        // Hashes written by an older cost are upgraded to the configured cost on login.
        const targetRounds = pbkdf2Iterations(env.AITQR_PBKDF2_ITERATIONS);
        if (storedIterations(user.password_hash) !== targetRounds) {
          await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
            .bind(await hashPassword(password, targetRounds), user.id)
            .run();
        }
        await env.DB.prepare("UPDATE users SET failed = 0, locked_until = NULL, last_seen_at = ? WHERE id = ?")
          .bind(Date.now(), user.id)
          .run();
        const cookie = await createSessionCookie(env, user.username);
        return json(
          { ok: true, user: publicUser({ ...user, last_seen_at: Date.now() }) },
          { headers: { "Set-Cookie": cookie } },
        );
      }

      if (path === "/api/logout") {
        if (req.method !== "POST") return fail("Method not allowed", 405);
        return json({ ok: true }, { headers: { "Set-Cookie": cookieHeader(env, "", 0) } });
      }

      if (!path.startsWith("/api/")) return env.ASSETS.fetch(req);

      // ---- authenticated ---------------------------------------------------------------
      await ensureSchema(env);
      const user = await currentUser(req, env);
      if (!user) return fail("Masuk terlebih dahulu.", 401);
      if (req.method !== "GET" && !isSameOrigin(req, env)) return new Response(null, { status: 403 });

      if (path === "/api/password") {
        if (req.method !== "POST") return fail("Method not allowed", 405);
        const body = (await req.json().catch(() => null)) as { current?: string; next?: string } | null;
        if (!(await verifyPassword(body?.current ?? "", user.password_hash))) return fail("Kata sandi lama salah.", 403);
        if ((body?.next ?? "").length < 8) return fail("Kata sandi baru minimal 8 karakter.");
        await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
          .bind(await hashPassword(body?.next ?? "", pbkdf2Iterations(env.AITQR_PBKDF2_ITERATIONS)), user.id)
          .run();
        await log(env, user.username, "password.change", "self");
        return json({ ok: true });
      }

      if (!path.startsWith("/api/admin/")) return fail("Not found", 404);
      if (user.role !== "admin") return fail("Peran administrator diperlukan.", 403);

      if (path === "/api/admin/state") {
        const draft = await env.DB.prepare("SELECT source, updated_at, updated_by FROM bundle_draft WHERE id = 1").first<{
          source: string;
          updated_at: number;
          updated_by: string | null;
        }>();
        const published = await env.DB.prepare(
          "SELECT seq, created_at, created_by, note FROM bundle_versions ORDER BY seq DESC LIMIT 1",
        ).first<{ seq: number; created_at: number; created_by: string | null; note: string | null }>();
        const users = await env.DB.prepare(
          "SELECT id, username, display_name, role, public_key, kid, status, created_at, last_seen_at FROM users ORDER BY created_at",
        ).all<Omit<UserRow, "password_hash" | "failed" | "locked_until">>();
        const audit = await env.DB.prepare("SELECT at, actor, action, detail FROM audit ORDER BY id DESC LIMIT 40").all<{
          at: number;
          actor: string | null;
          action: string;
          detail: string | null;
        }>();
        const decoder = await env.DB.prepare("SELECT value FROM settings WHERE key = 'decoder_secret'").first<{
          value: string;
        }>();
        return json({
          user: publicUser(user),
          draft: draft ? { source: draft.source, updatedAt: draft.updated_at, updatedBy: draft.updated_by } : null,
          published: published ?? null,
          users: users.results.map((row) => ({
            id: row.id,
            username: row.username,
            displayName: row.display_name,
            role: row.role,
            publicKey: row.public_key,
            kid: row.kid,
            status: row.status,
            createdAt: row.created_at,
            lastSeenAt: row.last_seen_at,
          })),
          audit: audit.results,
          keys: {
            adminKeyConfigured: /^[0-9a-fA-F]{64}$/.test(env.AITQR_ADMIN_KEY?.trim() ?? ""),
            decoderSecretConfigured: Boolean(decoder?.value),
          },
        });
      }

      if (path === "/api/admin/users") {
        if (req.method !== "POST") return fail("Method not allowed", 405);
        const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
        const action = String(body?.action ?? "");
        const now = Date.now();

        if (action === "create") {
          const username = normaliseUsername(String(body?.username ?? ""));
          const password = String(body?.password ?? "");
          const role = body?.role === "admin" ? "admin" : "staff";
          const publicKey = String(body?.publicKey ?? "").trim().toLowerCase();
          const displayName = String(body?.displayName ?? "").trim() || username;
          if (!isValidUsername(username)) return fail("Username 3-32 karakter: huruf kecil, angka, titik, garis bawah, strip.");
          if (password.length < 8) return fail("Kata sandi minimal 8 karakter.");
          if (publicKey !== "" && !isHex64(publicKey)) return fail("Public key harus 64 karakter hex (Ed25519).");
          if (await findUser(env, username)) return fail("Username sudah dipakai.", 409);
          const id = crypto.randomUUID();
          await env.DB.prepare(
            "INSERT INTO users (id, username, display_name, role, password_hash, public_key, kid, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)",
          )
            .bind(
              id,
              username,
              displayName,
              role,
              await hashPassword(password, pbkdf2Iterations(env.AITQR_PBKDF2_ITERATIONS)),
              publicKey || null,
              publicKey ? await kidFor(publicKey) : null,
              now,
            )
            .run();
          await log(env, user.username, "user.create", `${username} role=${role}`);
          return json({ ok: true, id });
        }

        const target = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(String(body?.id ?? "")).first<UserRow>();
        if (!target) return fail("Akun tidak ditemukan.", 404);

        if (action === "update") {
          const publicKeyRaw = body?.publicKey;
          const role = body?.role === "admin" ? "admin" : body?.role === "staff" ? "staff" : target.role;
          const status = body?.status === "active" || body?.status === "disabled" ? body.status : target.status;
          const displayName = String(body?.displayName ?? target.display_name ?? "").trim() || target.username;
          let publicKey = target.public_key;
          let kid = target.kid;
          if (typeof publicKeyRaw === "string") {
            const candidate = publicKeyRaw.trim().toLowerCase();
            if (candidate !== "" && !isHex64(candidate)) return fail("Public key harus 64 karakter hex (Ed25519).");
            publicKey = candidate || null;
            kid = candidate ? await kidFor(candidate) : null;
          }
          if (target.role === "admin" && role === "staff" && (await adminCount(env)) <= 1) {
            return fail("Minimal satu administrator harus tersisa.", 409);
          }
          if (target.role === "admin" && status === "disabled" && (await adminCount(env)) <= 1) {
            return fail("Minimal satu administrator aktif harus tersisa.", 409);
          }
          await env.DB.prepare(
            "UPDATE users SET display_name = ?, role = ?, status = ?, public_key = ?, kid = ? WHERE id = ?",
          )
            .bind(displayName, role, status, publicKey, kid, target.id)
            .run();
          await log(env, user.username, "user.update", `${target.username} role=${role} status=${status}`);
          return json({ ok: true });
        }

        if (action === "password") {
          const password = String(body?.password ?? "");
          if (password.length < 8) return fail("Kata sandi minimal 8 karakter.");
          await env.DB.prepare("UPDATE users SET password_hash = ?, failed = 0, locked_until = NULL WHERE id = ?")
            .bind(await hashPassword(password, pbkdf2Iterations(env.AITQR_PBKDF2_ITERATIONS)), target.id)
            .run();
          await log(env, user.username, "user.password", target.username);
          return json({ ok: true });
        }

        if (action === "delete") {
          if (target.id === user.id) return fail("Tidak dapat menghapus akun sendiri.", 409);
          if (target.role === "admin" && (await adminCount(env)) <= 1) {
            return fail("Minimal satu administrator harus tersisa.", 409);
          }
          await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(target.id).run();
          await log(env, user.username, "user.delete", target.username);
          return json({ ok: true });
        }

        return fail("action harus create, update, password, atau delete.");
      }

      if (path === "/api/admin/bundle") {
        if (req.method !== "PUT") return fail("Method not allowed", 405);
        const body = (await req.json().catch(() => null)) as { source?: unknown } | null;
        if (!body || body.source === undefined) return fail("Body must be { source }");
        const sourceText = typeof body.source === "string" ? body.source : JSON.stringify(body.source, null, 2);
        let parsed: unknown;
        try {
          parsed = JSON.parse(sourceText);
        } catch {
          return fail("Source is not valid JSON", 422);
        }
        const checked = validateSource(parsed);
        if ("problems" in checked) return json({ problems: checked.problems }, { status: 422 });
        await env.DB.prepare("UPDATE bundle_draft SET source = ?, updated_at = ?, updated_by = ? WHERE id = 1")
          .bind(JSON.stringify(checked.bundle, null, 2), Date.now(), user.username)
          .run();
        await log(env, user.username, "bundle.draft", `profiles=${checked.bundle.profiles.length}`);
        return json({ ok: true, problems: [] });
      }

      if (path === "/api/admin/publish") {
        if (req.method !== "POST") return fail("Method not allowed", 405);
        const draft = await env.DB.prepare("SELECT source FROM bundle_draft WHERE id = 1").first<{ source: string }>();
        if (!draft) return fail("No draft to publish", 409);
        let parsed: unknown;
        try {
          parsed = JSON.parse(draft.source);
        } catch {
          return fail("The saved draft is not valid JSON", 422);
        }
        const checked = validateSource(parsed);
        if ("problems" in checked) return json({ problems: checked.problems }, { status: 422 });
        const latest = await env.DB.prepare("SELECT seq FROM bundle_versions ORDER BY seq DESC LIMIT 1").first<{
          seq: number;
        }>();
        const nextSeq = Number(latest?.seq ?? 0) + 1;
        const bundle: Bundle = { ...checked.bundle, seq: nextSeq, issued: new Date().toISOString() };
        const note = ((await req.json().catch(() => ({}))) as { note?: string }).note ?? null;
        let signed: SignedBundle;
        try {
          const seed = env.AITQR_ADMIN_KEY?.trim();
          if (!seed) throw new Error("AITQR_ADMIN_KEY is not configured");
          signed = await signWithKey(bundle, seed);
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : "signing failed" }, { status: 503 });
        }
        await env.DB.prepare("INSERT INTO bundle_versions (seq, signed, created_at, created_by, note) VALUES (?, ?, ?, ?, ?)")
          .bind(nextSeq, JSON.stringify(signed), Date.now(), user.username, note)
          .run();
        await log(env, user.username, "bundle.publish", `seq=${nextSeq} kid=${signed.sig.kid}`);
        return json({ ok: true, seq: nextSeq, kid: signed.sig.kid });
      }

      if (path === "/api/admin/keys") {
        if (req.method === "GET") {
          const decoder = await env.DB.prepare("SELECT value FROM settings WHERE key = 'decoder_secret'").first<{
            value: string;
          }>();
          return json({ decoderSecretConfigured: Boolean(decoder?.value) });
        }
        if (req.method !== "POST") return fail("Method not allowed", 405);
        const body = (await req.json().catch(() => null)) as { decoderSecret?: string } | null;
        const secret = (body?.decoderSecret ?? "").trim().toLowerCase();
        if (secret !== "" && !/^[0-9a-f]{64}$/.test(secret)) {
          return fail("Kunci rahasia decoder harus 64 karakter hex (X25519).");
        }
        if (secret === "") {
          await env.DB.prepare("DELETE FROM settings WHERE key = 'decoder_secret'").run();
          await log(env, user.username, "keys.decoder.clear", "");
          return json({ ok: true, decoderSecretConfigured: false });
        }
        await env.DB.prepare(
          "INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('decoder_secret', ?, ?, ?) " +
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
        )
          .bind(secret, Date.now(), user.username)
          .run();
        await log(env, user.username, "keys.decoder.set", "decoder secret stored");
        return json({ ok: true, decoderSecretConfigured: true });
      }

      if (path === "/api/admin/verify") {
        if (req.method !== "POST") return fail("Method not allowed", 405);
        const body = (await req.json().catch(() => null)) as { token?: string } | null;
        const token = (body?.token ?? "").trim();
        if (!token) return fail("Body must be { token }");
        const decoder = await env.DB.prepare("SELECT value FROM settings WHERE key = 'decoder_secret'").first<{
          value: string;
        }>();
        if (!decoder?.value) return fail("Atur kunci rahasia decoder terlebih dahulu.", 409);
        try {
          const opened = await openToken(token, decoder.value);
          const account = await env.DB.prepare("SELECT username, public_key, display_name, status FROM users WHERE kid = ?")
            .bind(opened.kid)
            .first<{ username: string; public_key: string | null; display_name: string | null; status: string }>();
          if (!account?.public_key) return json({ ok: false, code: "unknown-account", kid: opened.kid });
          const valid = await verifySignature(opened, account.public_key);
          return json({
            ok: valid,
            code: valid ? null : "bad-signature",
            kid: opened.kid,
            account: { username: account.username, label: account.display_name, status: account.status },
            issuedAt: opened.issuedAt,
            compressed: opened.compressed,
            metadata: opened.metadata,
          });
        } catch (error) {
          return json({ ok: false, code: "unreadable", error: error instanceof Error ? error.message : "failed" });
        }
      }

      if (path === "/api/admin/allowlist") {
        const users = await env.DB.prepare(
          "SELECT username, public_key, display_name, status FROM users WHERE public_key IS NOT NULL ORDER BY created_at",
        ).all<{ username: string; public_key: string; display_name: string | null; status: string }>();
        const allowlist = {
          format: "metaqr-allowlist",
          version: 1,
          devices: users.results.map((row) => ({
            id: row.username,
            public_key: row.public_key,
            ...(row.display_name ? { label: row.display_name } : {}),
            status: row.status === "active" ? "active" : "revoked",
          })),
        };
        await log(env, user.username, "allowlist.export", `users=${users.results.length}`);
        return new Response(JSON.stringify(allowlist, null, 2), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": 'attachment; filename="allowlist.json"',
            "Cache-Control": "private, no-store",
          },
        });
      }

      return fail("Not found", 404);
    };

    const response = await handler(request);
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(securityHeaders(env))) {
      if (!headers.has(name)) headers.set(name, value);
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};

async function adminCount(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'").first<{
    n: number;
  }>();
  return Number(row?.n ?? 0);
}
