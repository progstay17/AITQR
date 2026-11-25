import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { hashPassword } from "../dist/app/auth.js";
import { ConfigUnavailableError, loadConfig } from "../dist/app/config/load.js";
import { signBundle } from "../dist/app/config/sign.js";
import worker from "../server/worker.js";
import { verifySignedBundle } from "../dist/app/config/verify.js";
import { bytesToHex, kidOf, signerFromSeed } from "../vendor/metaqr/src/index.js";

class Statement {
  values: unknown[] = [];
  private db: DatabaseSync;
  private sql: string;
  constructor(db: DatabaseSync, sql: string) {
    this.db = db;
    this.sql = sql;
  }
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.db.prepare(this.sql).all(...this.values) as T[] };
  }
  async run() {
    const result = this.db.prepare(this.sql).run(...this.values);
    return { success: true, meta: { last_row_id: Number(result.lastInsertRowid), changes: result.changes } };
  }
}
class LocalD1 {
  private db: DatabaseSync;
  constructor(db: DatabaseSync) { this.db = db; }
  prepare(sql: string) { return new Statement(this.db, sql); }
}

const adminSeed = "44".repeat(32);
const sessionSecret = "55".repeat(32);
const setupCode = "66".repeat(24);

test("admin field settings are isolated and published per account", async () => {
  const db = new DatabaseSync(":memory:");
  const env = {
    ASSETS: { fetch: async () => new Response("not found", { status: 404 }) },
    DB: new LocalD1(db),
    APP_ORIGIN: "http://localhost",
    AITQR_ADMIN_KEY: adminSeed,
    AITQR_SESSION_KEY: sessionSecret,
    AITQR_SETUP_CODE: setupCode,
  };

  // Simulate an existing D1 installation before account_configs existed.
  const legacyTemplate = JSON.parse(readFileSync(new URL("../bundles/default.bundle.json", import.meta.url), "utf8"));
  legacyTemplate.bundle.profiles[0].fields[0].label = { id: "Legacy Template Field", en: "Legacy Template Field" };
  legacyTemplate.bundle.lists.locations = ["Legacy Room"];
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT, role TEXT NOT NULL,
      password_hash TEXT NOT NULL, public_key TEXT, kid TEXT, status TEXT NOT NULL,
      failed INTEGER NOT NULL DEFAULT 0, locked_until INTEGER, created_at INTEGER NOT NULL, last_seen_at INTEGER
    );
    CREATE TABLE bundle_draft (
      id INTEGER PRIMARY KEY CHECK (id = 1), source TEXT NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT
    );
  `);
  const legacyPassword = "LegacyPass-123";
  db.prepare("INSERT INTO users (id, username, display_name, role, password_hash, status, created_at) VALUES (?, ?, ?, 'staff', ?, 'active', ?)")
    .run("legacy-user", "legacyuser", "Legacy User", await hashPassword(legacyPassword, 12000), Date.now());
  db.prepare("INSERT INTO bundle_draft (id, source, updated_at, updated_by) VALUES (1, ?, ?, ?)")
    .run(JSON.stringify(legacyTemplate.bundle), Date.now(), "legacy-admin");

  async function call(path: string, method = "GET", body?: unknown, cookie?: string) {
    const headers = new Headers({ Origin: "http://localhost" });
    if (body !== undefined) headers.set("Content-Type", "application/json");
    if (cookie) headers.set("Cookie", cookie);
    const response = await worker.fetch(new Request("http://localhost" + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    }), env);
    const text = await response.text();
    return { response, data: text ? JSON.parse(text) : null };
  }
  async function expect(path: string, method = "GET", body?: unknown, cookie?: string, status = 200) {
    const result = await call(path, method, body, cookie);
    assert.equal(result.response.status, status, method + " " + path + ": " + JSON.stringify(result.data));
    return result.data;
  }
  function cookieOf(response: Response): string {
    const value = response.headers.get("Set-Cookie");
    assert.ok(value);
    return value.split(";")[0]!;
  }
  try {
    const health = await expect("/api/health");
    assert.equal(health.configured.adminKey, true);
    const boot = await call("/api/bootstrap", "POST", {
      username: "admin01", password: "AdminPass-123", code: setupCode,
    });
    assert.equal(boot.response.status, 200, JSON.stringify(boot.data));
    const admin = cookieOf(boot.response);
    let state = await expect("/api/admin/state", "GET", undefined, admin);
    assert.equal(state.users.length, 2);
    assert.equal(state.accountConfigs.length, 2);

    const legacyLogin = await call("/api/login", "POST", {
      username: "legacyuser", password: legacyPassword,
    });
    assert.equal(legacyLogin.response.status, 200, JSON.stringify(legacyLogin.data));
    const legacyCookie = cookieOf(legacyLogin.response);
    const migrated = await call("/api/account/config", "GET", undefined, legacyCookie);
    assert.equal(migrated.response.status, 200);
    assert.equal(migrated.data.bundle.profiles[0].fields[0].label.id, "Legacy Template Field");
    assert.deepEqual(migrated.data.bundle.lists.locations, ["Legacy Room"]);

    async function createStaff(username: string, publicKey: string): Promise<string> {
      const result = await expect("/api/admin/users", "POST", {
        action: "create", username, displayName: username, password: "StaffPass-123",
        publicKey, role: "staff",
      }, admin);
      return result.id;
    }
    const alphaId = await createStaff("staffalpha", "11".repeat(32));
    const betaId = await createStaff("staffbeta", "22".repeat(32));

    async function draftFor(accountId: string): Promise<any> {
      const current = await expect("/api/admin/state", "GET", undefined, admin);
      const row = current.accountConfigs.find((entry: { userId: string }) => entry.userId === accountId);
      assert.ok(row);
      return JSON.parse(row.draftSource);
    }
    async function setAndPublish(accountId: string, label: string, location: string) {
      const bundle = await draftFor(accountId);
      bundle.profiles[0].fields[0].label = { id: label, en: label };
      bundle.lists.locations = [location];
      await expect("/api/admin/account-config", "PUT", { accountId, source: bundle }, admin);
      const result = await expect("/api/admin/account-config/publish", "POST", { accountId }, admin);
      assert.equal(result.seq, 2);
    }
    await setAndPublish(alphaId, "Field Alpha", "Ruang Alpha");
    await setAndPublish(betaId, "Field Beta", "Ruang Beta");

    async function login(username: string, password = "StaffPass-123"): Promise<string> {
      const result = await call("/api/login", "POST", { username, password });
      assert.equal(result.response.status, 200, JSON.stringify(result.data));
      return cookieOf(result.response);
    }
    const alpha = await login("staffalpha");
    let beta = await login("staffbeta");
    const a = await call("/api/account/config", "GET", undefined, alpha);
    const b = await call("/api/account/config", "GET", undefined, beta);
    assert.equal(a.response.status, 200);
    assert.equal(b.response.status, 200);
    assert.equal(a.data.bundle.profiles[0].fields[0].label.id, "Field Alpha");
    assert.equal(b.data.bundle.profiles[0].fields[0].label.id, "Field Beta");
    assert.deepEqual(a.data.bundle.lists.locations, ["Ruang Alpha"]);
    assert.deepEqual(b.data.bundle.lists.locations, ["Ruang Beta"]);
    assert.equal(a.response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(a.response.headers.get("Vary"), "Cookie");

    const signer = await signerFromSeed(adminSeed);
    const trusted = [{
      kid: bytesToHex(await kidOf(signer.publicKey)),
      public: bytesToHex(signer.publicKey),
    }];
    assert.equal((await verifySignedBundle(a.data, trusted)).ok, true);
    assert.equal((await verifySignedBundle(b.data, trusted)).ok, true);

    const alphaDraft = await draftFor(alphaId);
    alphaDraft.profiles[0].fields[0].label = { id: "Alpha Draft Only", en: "Alpha Draft Only" };
    await expect("/api/admin/account-config", "PUT", { accountId: alphaId, source: alphaDraft }, admin);
    const betaAgain = await call("/api/account/config", "GET", undefined, beta);
    assert.equal(betaAgain.data.bundle.profiles[0].fields[0].label.id, "Field Beta");

    await expect("/api/admin/state", "GET", undefined, alpha, 403);
    await expect("/api/admin/account-config", "PUT", {
      accountId: betaId, source: a.data.bundle,
    }, alpha, 403);

    await expect("/api/admin/users", "POST", {
      action: "password", id: betaId, password: "StaffPass-456",
    }, admin);
    await expect("/api/login", "POST", {
      username: "staffbeta", password: "StaffPass-123",
    }, undefined, 401);
    beta = await login("staffbeta", "StaffPass-456");
    await expect("/api/admin/users", "POST", {
      action: "update", id: betaId, status: "disabled",
    }, admin);
    await expect("/api/login", "POST", {
      username: "staffbeta", password: "StaffPass-456",
    }, undefined, 403);
    await expect("/api/admin/users", "POST", {
      action: "update", id: betaId, status: "active",
    }, admin);
    beta = await login("staffbeta", "StaffPass-456");

    await expect("/api/admin/keys", "POST", { decoderSecret: "33".repeat(32) }, admin);
    assert.equal((await expect("/api/health")).configured.decoderSecret, true);
    const allowlist = await expect("/api/admin/allowlist", "GET", undefined, admin);
    assert.deepEqual(allowlist.devices.map((device: { id: string }) => device.id).sort(),
      ["staffalpha", "staffbeta"]);
    const invalidToken = await expect("/api/admin/verify", "POST", { token: "MQ2:invalid" }, admin);
    assert.equal(invalidToken.ok, false);

    await expect("/api/admin/users", "POST", { action: "delete", id: betaId }, admin);
    state = await expect("/api/admin/state", "GET", undefined, admin);
    assert.equal(state.accountConfigs.some((entry: { userId: string }) => entry.userId === betaId), false);
    await expect("/api/admin/keys", "POST", { decoderSecret: "" }, admin);
    assert.equal((await expect("/api/health")).configured.decoderSecret, false);

    console.log("Account-scoped config, account CRUD, decoder secret, verification and allow-list passed.");
  } finally {
    db.close();
  }
});

test("service worker never caches authenticated API responses", () => {
  const source = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  assert.match(
    source,
    /url\.pathname\.startsWith\("\/api\/"\)[\s\S]*?event\.respondWith\(fetch\(new Request\(request, \{ cache: "no-store" \}\)\)\);[\s\S]*?return;/,
  );
});

test("account cache is namespaced and an unauthorised response never falls back to it", async () => {
  const originalFetch = globalThis.fetch;
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
  };
  const seed = "77".repeat(32);
  const signer = await signerFromSeed(seed);
  const trusted = [{ kid: bytesToHex(await kidOf(signer.publicKey)), public: bytesToHex(signer.publicKey) }];
  const template = JSON.parse(readFileSync(new URL("../bundles/default.bundle.json", import.meta.url), "utf8")).bundle;

  async function signedFor(label: string) {
    const bundle = JSON.parse(JSON.stringify(template));
    bundle.seq = 10;
    bundle.issued = new Date().toISOString();
    bundle.profiles[0].fields[0].label = { id: label, en: label };
    bundle.lists.locations = [label + " Room"];
    return signBundle(bundle, seed);
  }

  let current = await signedFor("Account Alpha");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
  globalThis.fetch = async () => new Response(JSON.stringify(current), {
    status: 200, headers: { "Content-Type": "application/json" },
  });

  try {
    const alphaOnline = await loadConfig({ trusted, account: "account-alpha" });
    current = await signedFor("Account Beta");
    const betaOnline = await loadConfig({ trusted, account: "account-beta" });
    assert.equal(alphaOnline.bundle.profiles[0].fields[0].label.id, "Account Alpha");
    assert.equal(betaOnline.bundle.profiles[0].fields[0].label.id, "Account Beta");
    assert.ok(values.has("aitqr.bundle.v1.account.account-alpha"));
    assert.ok(values.has("aitqr.bundle.v1.account.account-beta"));

    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
    const alphaOffline = await loadConfig({ trusted, account: "account-alpha" });
    const betaOffline = await loadConfig({ trusted, account: "account-beta" });
    assert.equal(alphaOffline.bundle.profiles[0].fields[0].label.id, "Account Alpha");
    assert.equal(betaOffline.bundle.profiles[0].fields[0].label.id, "Account Beta");
    assert.equal(alphaOffline.offline, true);
    assert.equal(betaOffline.offline, true);

    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
    globalThis.fetch = async () => new Response("unauthorised", { status: 401 });
    await assert.rejects(
      () => loadConfig({ trusted, account: "account-alpha" }),
      (error: unknown) => error instanceof ConfigUnavailableError && error.code === "authentication-required",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (storageDescriptor) Object.defineProperty(globalThis, "localStorage", storageDescriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});
