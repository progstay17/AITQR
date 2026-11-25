import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  budgetReport,
  buildPayload,
  derivedValues,
  estimateTokenChars,
  payloadKeyLabels,
  validateValues,
} from "../dist/app/payload.js";
import { newSessionId } from "../dist/app/session.js";
import type { Bundle, FormValues } from "../dist/app/types.js";

const source = JSON.parse(readFileSync("bundles/source.bundle.json", "utf8")) as { bundle: Bundle };
const bundle = source.bundle;
const profile = bundle.profiles[0]!;

const values: FormValues = {
  recorder: "P-0427",
  shift: "2",
  batch: "MM3201",
  location: "Ruang A",
  activity: "Pemeriksaan",
  device_no: "ZY005",
  device_id: "box-20260819-81e2",
};

const sessionId = "7QF3K9M2T8WX4R6B";
const derived = derivedValues(profile, { sessionId, deviceKid: "0000000000000000", now: 1_795_593_600_000 });

test("payload uses the compact short keys and coerces list values", () => {
  const payload = buildPayload(profile, bundle, values, derived, sessionId);
  assert.deepEqual(payload, {
    p: "zyb-recording",
    pv: 1,
    s: sessionId,
    r: "P-0427",
    sh: 2,
    b: "MM3201",
    l: "Ruang A",
    a: "Pemeriksaan",
    dn: "ZY005",
    di: "box-20260819-81e2",
  });
});

test("validation reports required, pattern, option and length problems", () => {
  const issues = validateValues(profile, bundle, {
    ...values,
    recorder: "",
    batch: "XX1",
    shift: "9",
    device_id: "",
  });
  const codes = issues.map((issue) => `${issue.key}:${issue.code}`).sort();
  assert.deepEqual(codes, ["batch:pattern", "device_id:required", "recorder:required", "shift:option"]);
});

test("validation rejects a recorder longer than max", () => {
  const issues = validateValues(profile, bundle, { ...values, recorder: "x".repeat(41) });
  assert.deepEqual(issues.map((issue) => issue.code), ["max"]);
});

test("session ids are 16 base32 characters and do not repeat", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i += 1) {
    const id = newSessionId((length) => crypto.getRandomValues(new Uint8Array(length)));
    assert.match(id, /^[0-9A-HJKMNP-TV-Z]{16}$/);
    assert.equal(seen.has(id), false);
    seen.add(id);
  }
});

test("session ids are deterministic with an injected RNG", () => {
  assert.equal(newSessionId(() => new Uint8Array(10)), "0000000000000000");
  assert.equal(newSessionId(() => new Uint8Array(10).fill(0xff)), "ZZZZZZZZZZZZZZZZ");
});

test("the budget estimate grows with payload size and stays under the cap for the sample", () => {
  const small = estimateTokenChars({ p: "x", s: "1" });
  const large = estimateTokenChars({ p: "x", s: "1", r: "y".repeat(60) });
  assert.ok(large > small);
  const payload = buildPayload(profile, bundle, values, derived, sessionId);
  const report = budgetReport(payload, profile);
  assert.ok(report.chars > 0 && report.chars <= report.limit, `estimate ${report.chars}`);
  const costs = report.fieldCosts.map((entry) => entry.chars);
  assert.deepEqual(costs, [...costs].sort((a, b) => b - a), "field costs are sorted, largest first");
  assert.ok(report.fieldCosts.some((entry) => entry.key === "di"), "the camera id is measured");
});

test("budget messages can name the field behind a short key", () => {
  const labels = payloadKeyLabels(profile);
  assert.equal(labels["di"], "device_id");
  assert.equal(labels["s"], "session id");
});

test("derived values come from the injected clock and device key", () => {
  assert.equal(derived["sid"], sessionId);
  assert.equal(derived["issued"], new Date(1_795_593_600_000).toISOString());
});
