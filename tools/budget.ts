/**
 * Measure the real MQ1 encrypted token length for a profile using its `sample` values.
 *
 *   node tools/budget.ts [bundles/source.bundle.json]
 *
 * Encodes without a signer, matching the encrypted-only MQ1 phone flow
 * (compression is automatic, exactly like the browser).
 */
import { readFileSync } from "node:fs";
import { buildPayload, derivedValues, estimateTokenChars, budgetReport } from "../dist/app/payload.js";
import { fieldsOf } from "../dist/app/profile.js";
import { encode } from "../vendor/metaqr/src/index.js";
import type { Bundle, Profile } from "../dist/app/types.js";

const path = process.argv[2] ?? "bundles/source.bundle.json";
const parsed = JSON.parse(readFileSync(path, "utf8")) as { bundle?: Bundle } & Partial<Bundle>;
const bundle = (parsed.bundle ?? parsed) as Bundle;


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
    else if (field.required) console.warn(`  ! ${field.key} has no sample value`);
  }
  return values;
}

let failed = false;
for (const profile of bundle.profiles ?? []) {
  const values = sampleValues(profile);
  const sessionId = "7QF3K9M2T8WX4R6B";
  const derived = derivedValues(profile, { sessionId, deviceKid: "AITQR", now: Date.UTC(2026, 10, 25, 8, 0, 0) });
  const payload = buildPayload(profile, bundle, values, derived, sessionId);
  const report = budgetReport(payload, profile);
  const token = await encode(payload, profile.recipient.public, { maxChars: report.limit });
  const verdict = token.length <= report.target ? "ok" : token.length <= report.limit ? "dense" : "OVER";
  console.log(
    `${verdict.padEnd(5)} ${profile.id} v${profile.version}: ${token.length} chars ` +
      `(estimate ${estimateTokenChars(payload)}, target ${report.target}, cap ${report.limit})`,
  );
  console.log(`      payload: ${JSON.stringify(payload)}`);
  if (token.length > report.limit) failed = true;
}

process.exit(failed ? 1 : 0);
