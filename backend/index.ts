/**
 * AITQR HTTP application handler. It uses the Fetch API request/response model and is hosted by the
 * Node.js server in scripts/serve.mjs, with persistent SQLite storage.
 *
 * Accounts use username/password only. QR payloads are encrypted to the decoder public key (MQ1);
 * no per-user signing keys, decoder secrets, or allow-list are stored by AITQR.
 */
import { signBundle as signWithKey } from "../src/config/sign.js";
import { assertBundleShape } from "../src/config/verify.js";
import { validateProfile } from "../src/profile.js";
import { bytesToHex, kidOf, decode, fingerprint, webCryptoX25519 } from "../vendor/metaqr/src/index.js";
import { openDecoderKey, sealDecoderKey } from "../src/decoder-vault.js";
import {
  createSessionToken,
  hashPassword,
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

interface SqlitePreparedStatement {
  bind(...values: unknown[]): SqlitePreparedStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean; meta: { last_row_id?: number; changes?: number } }>;
}

interface SqliteDatabase {
  prepare(sql: string): SqlitePreparedStatement;
}

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DB: SqliteDatabase;
  APP_ORIGIN: string;
  /** Ed25519 seed that signs configuration bundles. Protected server environment variable. */
  AITQR_ADMIN_KEY?: string;
  /** HMAC secret for login session cookies. Protected server environment variable. */
  AITQR_SESSION_KEY?: string;
  /** One-time code required to create the first administrator. Protected server environment variable. */
  AITQR_SETUP_CODE?: string;
  /** Optional PBKDF2-SHA256 rounds; raise it where hosting allows more CPU. */
  AITQR_PBKDF2_ITERATIONS?: string;
  /** 32-byte AES-256-GCM master key (64 hex chars), stored outside SQLite and backups. */
  AITQR_VAULT_MASTER_KEY?: string;
}

interface UserRow {
  id: string;
  username: string;
  display_name: string | null;
  role: string;
  password_hash: string;
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
  `CREATE TABLE IF NOT EXISTS account_configs (
     user_id TEXT PRIMARY KEY,
     draft_source TEXT NOT NULL,
     published_source TEXT NOT NULL,
     draft_updated_at INTEGER NOT NULL,
     draft_updated_by TEXT,
     published_at INTEGER NOT NULL,
     published_seq INTEGER NOT NULL DEFAULT 1
   )`,
  `CREATE TABLE IF NOT EXISTS settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL,
     updated_at INTEGER NOT NULL,
     updated_by TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS decoder_keys (
     account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     kid TEXT NOT NULL,
     public_key TEXT NOT NULL,
     iv TEXT NOT NULL,
     ciphertext TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     created_by TEXT NOT NULL,
     PRIMARY KEY (account_id, kid)
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
      // Retire legacy MQ2 settings and per-staff signing keys; AITQR now issues encrypted-only MQ1.
      await env.DB.prepare("DELETE FROM settings WHERE key = 'decoder_secret'").run();
      await env.DB.prepare("UPDATE users SET public_key = NULL, kid = NULL WHERE public_key IS NOT NULL OR kid IS NOT NULL").run();
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
      const users = await env.DB.prepare("SELECT id FROM users").all<{ id: string }>();
      for (const account of users.results) await ensureAccountConfig(env, account.id, "migration", true);
    })().catch((error) => {
      schemaReady = undefined;
      throw error;
    });
  }
  return schemaReady;
}

async function accountBundleTemplate(env: Env, preserveLegacyTemplate: boolean): Promise<Bundle> {
  // Preserve legacy settings for migrated accounts; new accounts start with an empty profile collection.
  const legacyDraft = await env.DB.prepare("SELECT source FROM bundle_draft WHERE id = 1").first<{ source: string }>();
  const latest = await env.DB.prepare("SELECT signed FROM bundle_versions ORDER BY seq DESC LIMIT 1").first<{
    signed: string;
  }>();
  const source = legacyDraft
    ? (JSON.parse(legacyDraft.source) as Bundle)
    : latest
      ? (JSON.parse(latest.signed) as SignedBundle).bundle
      : (defaultSigned as unknown as SignedBundle).bundle;
  const bundle = JSON.parse(JSON.stringify(source)) as Bundle;
  // Existing accounts keep their migrated configuration. New accounts start with no profile
  // presets, so the administrator explicitly defines the payload contract for that account.
  if (!preserveLegacyTemplate) {
    bundle.profiles = [];
    bundle.lists = {};
    delete bundle.global.allowed_profiles;
  }
  bundle.seq = 1;
  bundle.issued = new Date().toISOString();
  return bundle;
}

async function ensureAccountConfig(
  env: Env,
  userId: string,
  actor: string,
  preserveLegacyTemplate = false,
): Promise<void> {
  const existing = await env.DB.prepare("SELECT user_id FROM account_configs WHERE user_id = ?")
    .bind(userId)
    .first<{ user_id: string }>();
  if (existing) return;
  const bundle = await accountBundleTemplate(env, preserveLegacyTemplate);
  const now = Date.now();
  const source = JSON.stringify(bundle);
  await env.DB.prepare(
    "INSERT OR IGNORE INTO account_configs (user_id, draft_source, published_source, draft_updated_at, draft_updated_by, published_at, published_seq) VALUES (?, ?, ?, ?, ?, ?, 1)",
  )
    .bind(userId, source, source, now, actor, now)
    .run();
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

/** CSRF guard: mutating requests must originate from the configured application origin. */
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

function securityHeaders(_env: Env): Record<string, string> {
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
      "frame-ancestors 'none'",
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




function publicUser(user: UserRow): Record<string, unknown> {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
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
        await ensureAccountConfig(env, id, username);
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

      if (path === "/api/account/config") {
        if (req.method !== "GET") return fail("Method not allowed", 405);
        const row = await env.DB.prepare(
          "SELECT published_source, published_at, published_seq FROM account_configs WHERE user_id = ?",
        )
          .bind(user.id)
          .first<{ published_source: string; published_at: number; published_seq: number }>();
        if (!row) return fail("Konfigurasi akun belum tersedia. Hubungi administrator.", 409);
        let source: unknown;
        try {
          source = JSON.parse(row.published_source);
        } catch {
          return fail("Konfigurasi akun tersimpan rusak. Hubungi administrator.", 503);
        }
        const checked = validateSource(source);
        if ("problems" in checked) return json({ error: "Konfigurasi akun tidak valid.", problems: checked.problems }, { status: 503 });
        const seed = env.AITQR_ADMIN_KEY?.trim() ?? "";
        if (!/^[0-9a-fA-F]{64}$/.test(seed)) return fail("Kunci penandatangan konfigurasi belum tersedia.", 503);
        const bundle: Bundle = {
          ...checked.bundle,
          seq: Number(row.published_seq),
          issued: new Date(Number(row.published_at)).toISOString(),
        };
        try {
          const signed = await signWithKey(bundle, seed);
          return json(signed, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
        } catch (error) {
          return fail(error instanceof Error ? error.message : "Gagal menandatangani konfigurasi akun.", 503);
        }
      }

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

      // ---- decoder key vault + QR inspector --------------------------------------------
      if (path === "/api/admin/decoder-keys") {
        if (req.method === "GET") {
          const rows = await env.DB.prepare(
            "SELECT k.account_id, k.kid, k.created_at, k.created_by, u.username " +
              "FROM decoder_keys k INNER JOIN users u ON u.id = k.account_id ORDER BY u.created_at, k.created_at",
          ).all<{ account_id: string; kid: string; created_at: number; created_by: string; username: string }>();
          return json({ keys: rows.results.map((row) => ({
            accountId: row.account_id, username: row.username, kid: row.kid,
            createdAt: row.created_at, createdBy: row.created_by,
          })) });
        }
        if (req.method === "POST") {
          const masterKey = env.AITQR_VAULT_MASTER_KEY?.trim() ?? "";
          if (!/^[0-9a-fA-F]{64}$/.test(masterKey)) return fail("Key Vault belum dikonfigurasi. Atur AITQR_VAULT_MASTER_KEY di environment server.", 503);
          const body = (await req.json().catch(() => null)) as { accountId?: string; privateKeyHex?: string } | null;
          const accountId = String(body?.accountId ?? "");
          const privateKeyHex = String(body?.privateKeyHex ?? "").replace(/\s+/g, "");
          if (!accountId || !/^[0-9a-fA-F]{64}$/.test(privateKeyHex)) return fail("Pilih akun dan masukkan private key X25519 64 karakter hex.");
          const target = await env.DB.prepare("SELECT id, username FROM users WHERE id = ?").bind(accountId)
            .first<{ id: string; username: string }>();
          if (!target) return fail("Akun tidak ditemukan.", 404);
          const config = await env.DB.prepare("SELECT draft_source, published_source FROM account_configs WHERE user_id = ?")
            .bind(accountId).first<{ draft_source: string; published_source: string }>();
          if (!config) return fail("Konfigurasi akun tidak ditemukan.", 404);
          let publicKey: Uint8Array;
          const privateBytes = Uint8Array.from(privateKeyHex.match(/.{2}/g)!, (part) => Number.parseInt(part, 16));
          try { publicKey = await webCryptoX25519.publicFromPrivate(privateBytes); }
          catch { return fail("Private key tidak valid atau runtime tidak mendukung X25519.", 422); }
          finally { privateBytes.fill(0); }
          const publicHex = bytesToHex(publicKey);
          const accepted = new Set<string>();
          for (const source of [config.published_source, config.draft_source]) {
            try {
              const bundle = JSON.parse(source) as Bundle;
              for (const profile of bundle.profiles ?? []) {
                const candidate = profile.recipient?.public?.replace(/\s+/g, "").toLowerCase();
                if (candidate && /^[0-9a-f]{64}$/.test(candidate)) accepted.add(candidate);
              }
            } catch { /* malformed drafts are not trusted */ }
          }
          if (!accepted.has(publicHex)) return fail("Private key tidak cocok dengan public key decoder pada profil akun ini. Periksa akun dan key yang dipilih.", 422);
          const kid = await fingerprint(publicKey);
          let sealed: { iv: string; ciphertext: string };
          try { sealed = await sealDecoderKey(privateKeyHex, masterKey, accountId, kid); }
          catch { return fail("Gagal menyimpan key ke Vault. Periksa konfigurasi master key.", 503); }
          await env.DB.prepare(
            "INSERT INTO decoder_keys (account_id, kid, public_key, iv, ciphertext, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?) " +
              "ON CONFLICT(account_id, kid) DO UPDATE SET public_key = excluded.public_key, iv = excluded.iv, ciphertext = excluded.ciphertext, created_at = excluded.created_at, created_by = excluded.created_by",
          ).bind(accountId, kid, publicHex, sealed.iv, sealed.ciphertext, Date.now(), user.username).run();
          await log(env, user.username, "decoder-key.register", target.username + " kid=" + kid);
          return json({ ok: true, accountId, username: target.username, kid });
        }
        if (req.method === "DELETE") {
          const body = (await req.json().catch(() => null)) as { accountId?: string; kid?: string } | null;
          const accountId = String(body?.accountId ?? "");
          const kid = String(body?.kid ?? "");
          if (!accountId || !/^[0-9a-f]{16}$/.test(kid)) return fail("accountId dan kid tidak valid.");
          const result = await env.DB.prepare("DELETE FROM decoder_keys WHERE account_id = ? AND kid = ?").bind(accountId, kid).run();
          if (result.meta.changes !== 1) return fail("Key tidak ditemukan.", 404);
          const target = await env.DB.prepare("SELECT username FROM users WHERE id = ?").bind(accountId).first<{ username: string }>();
          await log(env, user.username, "decoder-key.delete", (target?.username ?? accountId) + " kid=" + kid);
          return json({ ok: true });
        }
        return fail("Method not allowed", 405);
      }

      if (path === "/api/admin/qr-decrypt") {
        if (req.method !== "POST") return fail("Method not allowed", 405);
        const masterKey = env.AITQR_VAULT_MASTER_KEY?.trim() ?? "";
        if (!/^[0-9a-fA-F]{64}$/.test(masterKey)) return fail("Key Vault belum dikonfigurasi di server.", 503);
        const body = (await req.json().catch(() => null)) as { accountId?: string; token?: string } | null;
        const accountId = String(body?.accountId ?? "");
        const token = String(body?.token ?? "").trim();
        if (!accountId || !token || token.length > 4400 || !token.startsWith("MQ1:")) return fail("Pilih akun dan masukkan QR token MQ1 yang valid.");
        const target = await env.DB.prepare("SELECT username FROM users WHERE id = ?").bind(accountId).first<{ username: string }>();
        if (!target) return fail("Akun tidak ditemukan.", 404);
        const rows = await env.DB.prepare("SELECT kid, iv, ciphertext FROM decoder_keys WHERE account_id = ? ORDER BY created_at DESC")
          .bind(accountId).all<{ kid: string; iv: string; ciphertext: string }>();
        if (!rows.results.length) return fail("Belum ada private key terdaftar untuk akun ini.", 409);
        for (const row of rows.results) {
          let privateKey: Uint8Array | null = null;
          try {
            privateKey = await openDecoderKey(row.iv, row.ciphertext, masterKey, accountId, row.kid);
            const payload = await decode(token, privateKey);
            await log(env, user.username, "qr.decrypt", target.username + " kid=" + row.kid);
            return json({ ok: true, accountId, username: target.username, kid: row.kid, payload });
          } catch { /* Try another registered key for this account; do not reveal key-specific failures. */ }
          finally { privateKey?.fill(0); }
        }
        await log(env, user.username, "qr.decrypt.failed", target.username + " keys=" + rows.results.length);
        return fail("QR tidak dapat didekripsi dengan key akun ini. Pastikan QR berasal dari akun yang dipilih dan key-nya sudah terdaftar.", 422);
      }

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
          "SELECT id, username, display_name, role, status, created_at, last_seen_at FROM users ORDER BY created_at",
        ).all<Omit<UserRow, "password_hash" | "failed" | "locked_until">>();
        const accountConfigs = await env.DB.prepare(
          "SELECT c.user_id, c.draft_source, c.draft_updated_at, c.draft_updated_by, c.published_at, c.published_seq " +
            "FROM account_configs c INNER JOIN users u ON u.id = c.user_id ORDER BY u.created_at",
        ).all<{
          user_id: string;
          draft_source: string;
          draft_updated_at: number;
          draft_updated_by: string | null;
          published_at: number;
          published_seq: number;
        }>();
        const audit = await env.DB.prepare("SELECT at, actor, action, detail FROM audit ORDER BY id DESC LIMIT 40").all<{
          at: number;
          actor: string | null;
          action: string;
          detail: string | null;
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
            status: row.status,
            createdAt: row.created_at,
            lastSeenAt: row.last_seen_at,
          })),
          accountConfigs: accountConfigs.results.map((row) => ({
            userId: row.user_id,
            draftSource: row.draft_source,
            updatedAt: row.draft_updated_at,
            updatedBy: row.draft_updated_by,
            publishedAt: row.published_at,
            publishedSeq: row.published_seq,
          })),
          audit: audit.results,
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
          const displayName = String(body?.displayName ?? "").trim() || username;
          if (!isValidUsername(username)) return fail("Username 3-32 karakter: huruf kecil, angka, titik, garis bawah, strip.");
          if (password.length < 8) return fail("Kata sandi minimal 8 karakter.");
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
              null,
              null,
              now,
            )
            .run();
          await ensureAccountConfig(env, id, user.username);
          await log(env, user.username, "user.create", username + " role=" + role);
          return json({ ok: true, id });
        }

        const target = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(String(body?.id ?? "")).first<UserRow>();
        if (!target) return fail("Akun tidak ditemukan.", 404);

        if (action === "update") {
          const role = body?.role === "admin" ? "admin" : body?.role === "staff" ? "staff" : target.role;
          const status = body?.status === "active" || body?.status === "disabled" ? body.status : target.status;
          const displayName = String(body?.displayName ?? target.display_name ?? "").trim() || target.username;
          if (target.role === "admin" && role === "staff" && (await adminCount(env)) <= 1) {
            return fail("Minimal satu administrator harus tersisa.", 409);
          }
          if (target.role === "admin" && status === "disabled" && (await adminCount(env)) <= 1) {
            return fail("Minimal satu administrator aktif harus tersisa.", 409);
          }
          await env.DB.prepare(
            "UPDATE users SET display_name = ?, role = ?, status = ? WHERE id = ?",
          )
            .bind(displayName, role, status, target.id)
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
          await env.DB.prepare("DELETE FROM decoder_keys WHERE account_id = ?").bind(target.id).run();
          await env.DB.prepare("DELETE FROM account_configs WHERE user_id = ?").bind(target.id).run();
          await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(target.id).run();
          await log(env, user.username, "user.delete", target.username);
          return json({ ok: true });
        }

        return fail("action harus create, update, password, atau delete.");
      }

      if (path === "/api/admin/account-config") {
        if (req.method !== "PUT") return fail("Method not allowed", 405);
        const body = (await req.json().catch(() => null)) as { accountId?: string; source?: unknown } | null;
        const accountId = String(body?.accountId ?? "");
        if (!accountId || body?.source === undefined) return fail("Body harus berisi accountId dan source.");
        const target = await env.DB.prepare("SELECT id, username FROM users WHERE id = ?")
          .bind(accountId)
          .first<{ id: string; username: string }>();
        if (!target) return fail("Akun tidak ditemukan.", 404);
        const accountConfig = await env.DB.prepare("SELECT user_id FROM account_configs WHERE user_id = ?")
          .bind(accountId)
          .first<{ user_id: string }>();
        if (!accountConfig) return fail("Konfigurasi akun belum tersedia. Muat ulang konsol admin.", 409);
        let parsed: unknown = body.source;
        if (typeof parsed === "string") {
          try {
            parsed = JSON.parse(parsed);
          } catch {
            return fail("Draf akun bukan JSON yang valid.", 422);
          }
        }
        const checked = validateSource(parsed);
        if ("problems" in checked) return json({ problems: checked.problems }, { status: 422 });
        const now = Date.now();
        await env.DB.prepare(
          "UPDATE account_configs SET draft_source = ?, draft_updated_at = ?, draft_updated_by = ? WHERE user_id = ?",
        )
          .bind(JSON.stringify(checked.bundle, null, 2), now, user.username, accountId)
          .run();
        await log(env, user.username, "account.config.draft", target.username + " profiles=" + checked.bundle.profiles.length);
        return json({ ok: true, accountId });
      }

      if (path === "/api/admin/account-config/publish") {
        if (req.method !== "POST") return fail("Method not allowed", 405);
        const body = (await req.json().catch(() => null)) as { accountId?: string } | null;
        const accountId = String(body?.accountId ?? "");
        if (!accountId) return fail("accountId wajib diisi.");
        const row = await env.DB.prepare(
          "SELECT c.draft_source, c.published_seq, u.username FROM account_configs c " +
            "INNER JOIN users u ON u.id = c.user_id WHERE c.user_id = ?",
        )
          .bind(accountId)
          .first<{ draft_source: string; published_seq: number; username: string }>();
        if (!row) return fail("Konfigurasi akun tidak ditemukan.", 404);
        let parsed: unknown;
        try {
          parsed = JSON.parse(row.draft_source);
        } catch {
          return fail("Draf akun tersimpan rusak.", 422);
        }
        const checked = validateSource(parsed);
        if ("problems" in checked) return json({ problems: checked.problems }, { status: 422 });
        const seed = env.AITQR_ADMIN_KEY?.trim() ?? "";
        if (!/^[0-9a-fA-F]{64}$/.test(seed)) return fail("AITQR_ADMIN_KEY belum dikonfigurasi.", 503);
        const nextSeq = Number(row.published_seq) + 1;
        const publishedAt = Date.now();
        const bundle: Bundle = { ...checked.bundle, seq: nextSeq, issued: new Date(publishedAt).toISOString() };
        let signed: SignedBundle;
        try {
          signed = await signWithKey(bundle, seed);
        } catch (error) {
          return fail(error instanceof Error ? error.message : "Gagal menandatangani konfigurasi akun.", 503);
        }
        const update = await env.DB.prepare(
          "UPDATE account_configs SET published_source = ?, published_at = ?, published_seq = ? WHERE user_id = ? AND published_seq = ?",
        )
          .bind(JSON.stringify(bundle, null, 2), publishedAt, nextSeq, accountId, row.published_seq)
          .run();
        if (update.meta.changes !== 1) {
          return fail("Konfigurasi akun berubah saat publikasi. Muat ulang draf lalu coba lagi.", 409);
        }
        await log(env, user.username, "account.config.publish", row.username + " seq=" + nextSeq + " kid=" + signed.sig.kid);
        return json({ ok: true, accountId, seq: nextSeq, kid: signed.sig.kid });
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
