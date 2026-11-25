import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fieldsOf, findProfile, optionsFor, validateProfile } from "../dist/app/profile.js";
import type { Bundle } from "../dist/app/types.js";

const source = JSON.parse(readFileSync("bundles/source.bundle.json", "utf8")) as { bundle: Bundle };
const bundle = source.bundle;
const profile = bundle.profiles[0]!;

test("the shipped profile validates", () => {
  assert.deepEqual(validateProfile(profile, bundle.lists), []);
});

test("derived values are part of the field set", () => {
  const fields = fieldsOf(profile);
  const sid = fields.find((field) => field.key === "sid");
  assert.ok(sid);
  assert.equal(sid?.type, "computed");
  assert.equal(sid?.short, "s");
});

test("a select pointing at a missing list is rejected", () => {
  const broken = structuredClone(profile);
  broken.fields[1]!.list = "does-not-exist";
  assert.ok(validateProfile(broken, bundle.lists).some((problem) => problem.includes("does-not-exist")));
});

test("a bad recipient key is rejected", () => {
  const broken = structuredClone(profile);
  broken.recipient.public = "<hex 64 karakter>";
  assert.ok(validateProfile(broken, bundle.lists).some((problem) => problem.includes("recipient.public")));
});

test("duplicate short keys are rejected", () => {
  const broken = structuredClone(profile);
  broken.fields[2]!.short = "r";
  assert.ok(validateProfile(broken, bundle.lists).some((problem) => problem.includes("duplicate short key")));
});

test("unknown profiles are not selectable", () => {
  assert.equal(findProfile(bundle, "not-a-profile"), undefined);
  assert.equal(findProfile(bundle, "zyb-recording")?.version, 1);
});

test("list options come from the bundle, including numeric shifts", () => {
  const shift = profile.fields.find((field) => field.key === "shift")!;
  assert.deepEqual(optionsFor(shift, bundle), [1, 2, 3]);
});
