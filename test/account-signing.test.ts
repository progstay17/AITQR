import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tokenVersion } from "../vendor/metaqr/src/index.js";
import { prepareAccountKey } from "../dist/app/keys.js";
import { issueToken } from "../dist/app/mq2.js";
import { openToken, verifySignature } from "../dist/app/verify-token.js";
import type { Bundle } from "../dist/app/types.js";

// The decoder key pair is generated per run, so the tests need no checked-in key material.
const decoder = await (async () => {
  const pair = (await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const base64 = jwk.d!.replace(/-/g, "+").replace(/_/g, "/");
  const privateRaw = Uint8Array.from(atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)), (c) => c.charCodeAt(0));
  const hex = (bytes: Uint8Array): string => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return { privateHex: hex(privateRaw), publicHex: hex(publicRaw) };
})();

const bundle = (JSON.parse(readFileSync("bundles/source.bundle.json", "utf8")) as { bundle: Bundle }).bundle;
const seed = "22".repeat(32);

const payload = {
  p: "zyb-recording",
  pv: 1,
  s: "7QF3K9M2T8WX4R6B",
  r: "P-0427",
  sh: 2,
  b: "MM3201",
  l: "Ruang A",
  a: "Pemeriksaan",
  dn: "ZY005",
  di: "box-20260819-81e2",
};

test("a pasted account key signs a token the decoder can open and verify", async () => {
  const key = await prepareAccountKey(seed);
  const token = await issueToken(payload, decoder.publicHex, { ...key, username: "petugas01" }, 800);

  assert.equal(tokenVersion(token.token), 2);
  assert.ok(token.chars <= 800, `token was ${token.chars}`);

  const opened = await openToken(token.token, decoder.privateHex);
  assert.deepEqual(opened.metadata, payload);
  assert.equal(opened.kid, key.kid);
  assert.equal(await verifySignature(opened, key.publicHex), true);
});

test("the public key of the imported key is stable and 32 bytes of hex", async () => {
  const first = await prepareAccountKey(seed);
  const second = await prepareAccountKey(`0x${seed.toUpperCase()}`);
  assert.equal(first.publicHex, second.publicHex);
  assert.match(first.publicHex, /^[0-9a-f]{64}$/);
  assert.equal(first.kid.length, 16);
});

test("a token signed by another account fails verification", async () => {
  const other = await prepareAccountKey("33".repeat(32));
  const token = await issueToken(payload, decoder.publicHex, { ...other, username: "lain" }, 800);
  const opened = await openToken(token.token, decoder.privateHex);
  const mine = await prepareAccountKey(seed);
  assert.notEqual(opened.kid, mine.kid);
  assert.equal(await verifySignature(opened, mine.publicHex), false);
});

test("invalid pasted keys are refused with a clear error", async () => {
  await assert.rejects(() => prepareAccountKey("not-a-key"), /64 karakter|64 hex/i);
  await assert.rejects(() => prepareAccountKey(""), /64 karakter|64 hex/i);
});

test("the shipped profile's recipient key length matches the bundle", () => {
  assert.equal(bundle.profiles[0]!.recipient.public.length, 64);
});

test("the hard character cap is enforced by the encoder", async () => {
  const key = await prepareAccountKey(seed);
  await assert.rejects(() => issueToken(payload, decoder.publicHex, { ...key, username: "petugas01" }, 60));
});

test("a bad recipient key fails instead of producing an unsigned token", async () => {
  const key = await prepareAccountKey(seed);
  await assert.rejects(() => issueToken(payload, "not-a-key", { ...key, username: "petugas01" }, 800));
});
