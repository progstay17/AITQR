import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalBytes } from "../dist/app/config/canonical.js";
import { verifySignedBundle } from "../dist/app/config/verify.js";
import { bytesToHex, kidOf, signerFromSeed } from "../vendor/metaqr/src/index.js";
import type { Bundle, SignedBundle, TrustedAdminKey } from "../dist/app/types.js";

const SEED = "3333333333333333333333333333333333333333333333333333333333333333";
const signer = await signerFromSeed(SEED);
const trusted: TrustedAdminKey[] = [
  { kid: bytesToHex(await kidOf(signer.publicKey)), public: bytesToHex(signer.publicKey) },
];

const source = JSON.parse(readFileSync("bundles/source.bundle.json", "utf8")) as { bundle: Bundle };

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signed(bundle: Bundle): Promise<SignedBundle> {
  const signature = await signer.sign(canonicalBytes(bundle));
  return { bundle, sig: { alg: "Ed25519", kid: trusted[0]!.kid, value: base64Url(signature) } };
}

test("a correctly signed bundle verifies", async () => {
  const candidate = await signed(source.bundle);
  const result = await verifySignedBundle(candidate, trusted);
  assert.equal(result.ok, true);
});

test("editing the bundle after signing is rejected", async () => {
  const candidate = await signed(source.bundle);
  candidate.bundle.seq += 1;
  const result = await verifySignedBundle(candidate, trusted);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.code, "bad-signature");
});

test("an untrusted signing key is rejected", async () => {
  const candidate = await signed(source.bundle);
  const result = await verifySignedBundle(candidate, [{ kid: "ffffffffffffffff", public: trusted[0]!.public }]);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.code, "unknown-kid");
});

test("an unsupported algorithm is rejected", async () => {
  const candidate = await signed(source.bundle);
  candidate.sig.alg = "RS256" as never;
  const result = await verifySignedBundle(candidate, trusted);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.code, "unsupported-alg");
});

test("a malformed bundle is rejected before any crypto", async () => {
  const result = await verifySignedBundle({ bundle: {}, sig: { alg: "Ed25519", kid: trusted[0]!.kid, value: "" } }, trusted);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.code, "malformed");
});
