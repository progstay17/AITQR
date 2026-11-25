/**
 * Produce deterministic cross-repo test vectors for a profile.
 *
 *   node tools/make-vectors.ts [bundles/source.bundle.json] > vectors/aitqr-vectors.json
 *
 * Clock, RNG and the ephemeral key are fixed so the ZYB Tool repo can re-encode the same payload
 * byte for byte and decode the token with the Python Metaqr decoder.
 */
import { readFileSync } from "node:fs";
import { canonicalize } from "../dist/app/config/canonical.js";
import { buildPayload, derivedValues } from "../dist/app/payload.js";
import { fieldsOf } from "../dist/app/profile.js";
import { encode, signerFromSeed, bytesToHex, kidOf } from "../vendor/metaqr/src/index.js";
import type { Bundle, Profile } from "../dist/app/types.js";

const path = process.argv[2] ?? "bundles/source.bundle.json";
const parsed = JSON.parse(readFileSync(path, "utf8")) as { bundle?: Bundle } & Partial<Bundle>;
const bundle = (parsed.bundle ?? parsed) as Bundle;

const DEVICE_SEED = "1111111111111111111111111111111111111111111111111111111111111111";
const EPHEMERAL_PRIVATE = "2222222222222222222222222222222222222222222222222222222222222222";
const IAT = 1_795_593_600; // 2026-11-25T08:00:00Z
const NONCE = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);

const signer = await signerFromSeed(DEVICE_SEED);
const deviceKid = bytesToHex(await kidOf(signer.publicKey));

function sampleValues(profile: Profile): Record<string, string | number | boolean> {
  const values: Record<string, string | number | boolean> = {};
  for (const field of fieldsOf(profile)) {
    if (field.type === "computed" || field.type === "constant") continue;
    if (field.sample !== undefined) values[field.key] = field.sample;
    else if (field.type === "select") {
      const options = field.list ? bundle.lists[field.list] ?? [] : [];
      const first = options[0];
      if (first !== undefined) values[field.key] = first;
    } else if (field.type === "checkbox") values[field.key] = false;
  }
  return values;
}

const vectors = [];
for (const profile of bundle.profiles ?? []) {
  const sessionId = "7QF3K9M2T8WX4R6B";
  const values = sampleValues(profile);
  const derived = derivedValues(profile, {
    sessionId,
    deviceKid,
    now: IAT * 1000,
  });
  const payload = buildPayload(profile, bundle, values, derived, sessionId);
  const token = await encode(payload, profile.recipient.public, {
    signer,
    compress: false,
    maxChars: 800,
    _iat: IAT,
    _nonce: NONCE,
    _ephemeralPrivate: EPHEMERAL_PRIVATE,
  });
  vectors.push({
    profile: profile.id,
    profileVersion: profile.version,
    schemaId: profile.schema_id,
    consumer: profile.consumer,
    recipientKid: profile.recipient.kid,
    recipientPublic: profile.recipient.public,
    deviceSeed: DEVICE_SEED,
    devicePublic: bytesToHex(signer.publicKey),
    deviceKid,
    sessionId,
    iat: IAT,
    nonceHex: bytesToHex(NONCE),
    values,
    payload,
    payloadCanonical: canonicalize(payload),
    token,
  });
}

console.log(JSON.stringify({ format: "aitqr/vectors/1", generatedFor: "zyb-recording", vectors }, null, 2));
