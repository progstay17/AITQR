/** Generate a shared encrypted-only MQ1 test vector for AITQR and ZYBTool. */
import { readFileSync, writeFileSync } from "node:fs";
import { buildPayload, derivedValues } from "../dist/app/payload.js";
import { fieldsOf } from "../dist/app/profile.js";
import { encode, generateKeyPair } from "../vendor/metaqr/src/index.js";
import type { Bundle, Profile } from "../dist/app/types.js";

const sourcePath = process.argv[2] ?? "bundles/source.bundle.json";
const outputPath = process.argv[3] ?? "vectors/aitqr-mq1-vectors.json";
const parsed = JSON.parse(readFileSync(sourcePath, "utf8")) as { bundle?: Bundle } & Partial<Bundle>;
const bundle = (parsed.bundle ?? parsed) as Bundle;
const decoder = await generateKeyPair();
const profile = (bundle.profiles ?? [])[0];
if (!profile) throw new Error("No profile found in source bundle");

function sampleValues(item: Profile): Record<string, string | number | boolean> {
  const values: Record<string, string | number | boolean> = {};
  for (const field of fieldsOf(item)) {
    if (field.type === "computed" || field.type === "constant") continue;
    if (field.sample !== undefined) values[field.key] = field.sample;
    else if (field.type === "select") {
      const options = field.list ? bundle.lists[field.list] ?? [] : [];
      if (options[0] !== undefined) values[field.key] = options[0];
    } else if (field.type === "checkbox") values[field.key] = false;
  }
  return values;
}

const sessionId = "7QF3K9M2T8WX4R6B";
const values = sampleValues(profile);
const derived = derivedValues(profile, { sessionId, deviceKid: "AITQR", now: Date.UTC(2026, 10, 25, 8, 0, 0) });
const payload = buildPayload(profile, bundle, values, derived, sessionId);
const token = await encode(payload, decoder.publicHex, { maxChars: profile.limits?.max_token_chars ?? 800 });
const vector = { format: "aitqr-zybtool-mq1-v1", test_only: true, decoder_public_hex: decoder.publicHex, decoder_private_hex: decoder.privateHex, payload, token };
writeFileSync(outputPath, JSON.stringify(vector, null, 2) + "\n", "utf8");
console.log(`Wrote ${outputPath} (${token.length} token chars; MQ1 encrypted-only).`);
