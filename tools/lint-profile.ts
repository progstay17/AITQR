/**
 * Lint every profile in a bundle: structure, list references, duplicate short keys, token budget.
 *
 *   node tools/lint-profile.ts [bundles/source.bundle.json]
 *
 * Exit code 1 on any problem, so CI can gate the bundle.
 */
import { readFileSync } from "node:fs";
import { validateProfile } from "../dist/app/profile.js";
import type { Bundle } from "../dist/app/types.js";

const path = process.argv[2] ?? "bundles/source.bundle.json";
const parsed = JSON.parse(readFileSync(path, "utf8")) as { bundle?: Bundle } & Partial<Bundle>;
const bundle = (parsed.bundle ?? parsed) as Bundle;

const problems: string[] = [];
if (bundle.schema !== "aitqr.bundle/1") problems.push(`bundle.schema must be aitqr.bundle/1, got ${bundle.schema}`);
if (!Number.isInteger(bundle.seq)) problems.push("bundle.seq must be an integer");
if (Number.isNaN(Date.parse(bundle.issued))) problems.push("bundle.issued must be an ISO timestamp");
if (!bundle.global || typeof bundle.global !== "object") problems.push("bundle.global is required");
if (!bundle.lists || typeof bundle.lists !== "object") problems.push("bundle.lists is required");

const ids = new Set<string>();
for (const profile of bundle.profiles ?? []) {
  if (ids.has(profile.id)) problems.push(`duplicate profile id ${profile.id}`);
  ids.add(profile.id);
  problems.push(...validateProfile(profile, bundle.lists ?? {}));
}

const allowed = bundle.global?.allowed_profiles;
if (allowed) {
  for (const id of allowed) {
    if (!ids.has(id)) problems.push(`allowed_profiles lists unknown profile ${id}`);
  }
}

if (problems.length > 0) {
  console.error(`✗ ${path}: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`✓ ${path}: ${bundle.profiles?.length ?? 0} profile(s), seq ${bundle.seq}`);
