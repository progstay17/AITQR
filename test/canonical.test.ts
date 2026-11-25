import test from "node:test";
import assert from "node:assert/strict";
import { CanonicalError, canonicalize } from "../dist/app/config/canonical.js";

test("JCS sorts object keys by UTF-16 code units", () => {
  assert.equal(canonicalize({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(canonicalize({ z: 1, "ä": 2 }), '{"z":1,"ä":2}');
});

test("JCS keeps arrays ordered and renders primitives", () => {
  assert.equal(canonicalize({ a: [1, true, null, "x"] }), '{"a":[1,true,null,"x"]}');
  assert.equal(canonicalize([]), "[]");
  assert.equal(canonicalize({}), "{}");
});

test("JCS number rendering matches ECMAScript", () => {
  assert.equal(canonicalize({ n: 1.0 }), '{"n":1}');
  assert.equal(canonicalize({ n: -0 }), '{"n":0}');
  assert.equal(canonicalize({ n: 1e21 }), `{"n":${JSON.stringify(1e21)}}`);
  assert.equal(canonicalize({ n: 0.000001 }), '{"n":0.000001}');
});

test("JCS escapes control characters and keeps non-ASCII literal", () => {
  assert.equal(canonicalize({ s: "\u0001" }), '{"s":"\\u0001"}');
  assert.equal(canonicalize({ s: "é" }), '{"s":"é"}');
});

test("JCS rejects values JSON cannot carry", () => {
  assert.throws(() => canonicalize({ n: Number.NaN }), CanonicalError);
  assert.throws(() => canonicalize({ n: Number.POSITIVE_INFINITY }), CanonicalError);
  assert.throws(() => canonicalize({ d: new Date() }), CanonicalError);
  assert.throws(() => canonicalize({ u: undefined as unknown as string }), /not JSON/);
});

test("JCS output is byte-stable across key insertion order", () => {
  const a = canonicalize({ b: { d: 1, c: 2 }, a: 3 });
  const b = canonicalize({ a: 3, b: { c: 2, d: 1 } });
  assert.equal(a, b);
});
