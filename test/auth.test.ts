import test from "node:test";
import assert from "node:assert/strict";
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
} from "../dist/app/auth.js";

const secret = "ab".repeat(32);
const now = 1_790_000_000_000;

test("passwords are stored as salted PBKDF2 hashes, never as plaintext", async () => {
  const stored = await hashPassword("rahasia123");
  assert.match(stored, /^pbkdf2\$120000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.equal(stored.includes("rahasia123"), false);
  assert.equal(await verifyPassword("rahasia123", stored), true);
  assert.equal(await verifyPassword("rahasia124", stored), false);
});

test("two hashes of the same password differ (random salt) and both verify", async () => {
  const first = await hashPassword("rahasia123");
  const second = await hashPassword("rahasia123");
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("rahasia123", first), true);
  assert.equal(await verifyPassword("rahasia123", second), true);
});

test("malformed or tampered stored hashes are rejected instead of throwing", async () => {
  for (const stored of ["", "plain", "pbkdf2$12000$abcd", "pbkdf2$0$00$00", "md5$1$00$00"]) {
    assert.equal(await verifyPassword("rahasia123", stored), false);
  }
  const stored = await hashPassword("rahasia123");
  const tampered = stored.slice(0, -1) + (stored.endsWith("0") ? "1" : "0");
  assert.equal(await verifyPassword("rahasia123", tampered), false);
});

test("the VPS password cost is configurable and stays inside the supported range", async () => {
  assert.equal(pbkdf2Iterations(undefined), 120_000);
  assert.equal(pbkdf2Iterations(""), 120_000);
  assert.equal(pbkdf2Iterations("bukan-angka"), 120_000);
  assert.equal(pbkdf2Iterations("10"), 120_000);
  assert.equal(pbkdf2Iterations("99999999"), 120_000);
  assert.equal(pbkdf2Iterations(" 60000 "), 60_000);
  assert.equal(storedIterations("pbkdf2$60000$00$00"), 60_000);
  assert.equal(storedIterations("plain"), null);
  const stored = await hashPassword("rahasia123", 2_000);
  assert.match(stored, /^pbkdf2\$2000\$/);
  assert.equal(storedIterations(stored), 2_000);
  assert.equal(await verifyPassword("rahasia123", stored), true);
});

test("hashes written with an older cost still verify", async () => {
  const legacy = await hashPassword("rahasia123", 12_000);
  assert.match(legacy, /^pbkdf2\$12000\$/);
  assert.equal(await verifyPassword("rahasia123", legacy), true);
  assert.equal(await verifyPassword("rahasia124", legacy), false);
});

test("a session token round-trips to its username and expires", async () => {
  const token = await createSessionToken(secret, "petugas01", 3600, now);
  assert.equal(await readSessionToken(secret, token, now), "petugas01");
  assert.equal(await readSessionToken(secret, token, now + 3_500_000), "petugas01");
  assert.equal(await readSessionToken(secret, token, now + 3_700_000), null);
});

test("a session token is bound to the secret and cannot be forged or edited", async () => {
  const token = await createSessionToken(secret, "petugas01", 3600, now);
  assert.equal(await readSessionToken("cd".repeat(32), token, now), null);

  const [body, signature] = token.split(".");
  const forgedPayload = Buffer.from(JSON.stringify({ u: "admin", e: Math.floor(now / 1000) + 3600 })).toString("base64url");
  assert.equal(await readSessionToken(secret, `${forgedPayload}.${signature}`, now), null);
  assert.equal(await readSessionToken(secret, `${body}.${"A".repeat(signature!.length)}`, now), null);
  assert.equal(await readSessionToken(secret, body, now), null);
  assert.equal(await readSessionToken(secret, "garbage", now), null);
  assert.equal(await readSessionToken(secret, null, now), null);
});

test("a missing or malformed session secret never yields a session", async () => {
  const token = await createSessionToken(secret, "petugas01", 3600, now);
  assert.equal(await readSessionToken("", token, now), null);
  assert.equal(await readSessionToken("short", token, now), null);
  assert.equal(isSessionSecret(secret), true);
  assert.equal(isSessionSecret("xyz"), false);
});

test("usernames are normalised and validated", () => {
  assert.equal(normaliseUsername("  Petugas01 "), "petugas01");
  assert.equal(isValidUsername("petugas01"), true);
  assert.equal(isValidUsername("admin.02"), true);
  assert.equal(isValidUsername("ab"), false);
  assert.equal(isValidUsername("petugas 01"), false);
  assert.equal(isValidUsername("Petugas01"), false);
  assert.equal(isValidUsername("x".repeat(33)), false);
});

test("public keys must be 64 lowercase hex characters", () => {
  assert.equal(isHex64("d7".repeat(32)), true);
  assert.equal(isHex64("D7".repeat(32)), false);
  assert.equal(isHex64("d7".repeat(31)), false);
  assert.equal(isHex64("zz".repeat(32)), false);
});

test("comparison and cookie helpers behave", () => {
  assert.equal(timingSafeEqual("abc", "abc"), true);
  assert.equal(timingSafeEqual("abc", "abd"), false);
  assert.equal(timingSafeEqual("abc", "ab"), false);
  assert.equal(readCookie("a=1; aitqr_session=xyz.abc; b=2", "aitqr_session"), "xyz.abc");
  assert.equal(readCookie("a=1", "aitqr_session"), null);
  assert.equal(readCookie(null, "aitqr_session"), null);
});
