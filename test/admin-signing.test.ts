import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { signBundle } from "../dist/app/config/sign.js";
import { verifySignedBundle } from "../dist/app/config/verify.js";
import { bytesToHex, kidOf } from "../vendor/metaqr/src/index.js";
import type { Bundle, TrustedAdminKey } from "../dist/app/types.js";

const source = JSON.parse(readFileSync("bundles/source.bundle.json", "utf8")) as { bundle: Bundle };

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Trusted admin key generated per run, so the test needs no checked-in key material. */
const admin = await (async () => {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  const base64 = jwk.d!.replace(/-/g, "+").replace(/_/g, "/");
  const seed = Uint8Array.from(atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)), (c) => c.charCodeAt(0));
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return {
    seedHex: hex(seed),
    key: { kid: bytesToHex(await kidOf(publicKey)), public: hex(publicKey), label: "test admin" } as TrustedAdminKey,
  };
})();

test("the backend signing path produces a bundle the app trusts", async () => {
  const bundle: Bundle = { ...source.bundle, seq: 2, issued: new Date().toISOString() };
  const signed = await signBundle(bundle, admin.seedHex);

  assert.equal(signed.sig.alg, "Ed25519");
  assert.equal(signed.sig.kid, admin.key.kid);

  const result = await verifySignedBundle(signed, [admin.key]);
  assert.equal(result.ok, true, result.ok === false ? result.reason : "");
  assert.equal(result.ok === true && result.bundle.seq, 2);
});

test("a bundle signed with a foreign key is rejected by the app", async () => {
  const signed = await signBundle(source.bundle, "5555555555555555555555555555555555555555555555555555555555555555");
  const result = await verifySignedBundle(signed, [admin.key]);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.code, "unknown-kid");
});

test("editing a signed bundle invalidates the signature", async () => {
  const signed = await signBundle(source.bundle, admin.seedHex);
  const tampered = { ...signed, bundle: { ...signed.bundle, seq: signed.bundle.seq + 1 } };
  const result = await verifySignedBundle(tampered, [admin.key]);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.code, "bad-signature");
});

test("a bad seed is refused instead of signing anything", async () => {
  await assert.rejects(() => signBundle(source.bundle, "not-a-seed"), /64-hex/);
});
