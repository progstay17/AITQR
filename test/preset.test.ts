import test from "node:test";
import assert from "node:assert/strict";
import {
  exportAllProfilePresets,
  exportProfilePreset,
  importProfilePresets,
  PROFILE_PRESET_FORMAT,
  PROFILE_PRESETS_FORMAT,
} from "../dist/app/preset.js";
import type { Bundle, Profile } from "../dist/app/types.js";

const profile: Profile = {
  id: "example-preset",
  version: 3,
  title: { id: "Contoh", en: "Example" },
  consumer: "example-consumer",
  recipient: { public: "11".repeat(32) },
  schema_id: "example-consumer/v3",
  fields: [
    {
      key: "operator",
      type: "text",
      label: { id: "Operator", en: "Operator" },
      short: "op",
      required: true,
      max: 40,
    },
    {
      key: "location",
      type: "select",
      label: { id: "Lokasi", en: "Location" },
      short: "loc",
      list: "locations",
      required: true,
    },
  ],
};

const bundle: Bundle = {
  schema: "aitqr.bundle/1",
  seq: 1,
  issued: "2026-11-26T00:00:00.000Z",
  max_age_days: null,
  global: { default_locale: "id", qr: { ecc: "Q", quiet_modules: 4 } },
  lists: { locations: ["Ruang A", "Ruang B"] },
  profiles: [profile],
};

test("single preset export/import preserves profile fields and only its referenced lists", () => {
  const exported = exportProfilePreset(profile, bundle);
  assert.equal(exported.format, PROFILE_PRESET_FORMAT);
  assert.deepEqual(exported.lists, { locations: ["Ruang A", "Ruang B"] });
  const [imported] = importProfilePresets(exported);
  assert.deepEqual(imported?.profile, profile);
  assert.deepEqual(imported?.lists, exported.lists);
});

test("collection export/import preserves multiple presets and their lists", () => {
  const second: Profile = {
    id: "other-preset",
    version: 1,
    title: "Other",
    consumer: "other-consumer",
    recipient: { public: "22".repeat(32) },
    schema_id: "other/v1",
    fields: [{ key: "name", type: "text", label: "Name", short: "n" }],
  };
  const collection = exportAllProfilePresets([profile, second], {
    ...bundle,
    profiles: [profile, second],
  });
  assert.equal(collection.format, PROFILE_PRESETS_FORMAT);
  const imported = importProfilePresets(collection);
  assert.deepEqual(imported.map((item) => item.profile.id), [profile.id, second.id]);
  assert.deepEqual(imported[0]?.lists, { locations: ["Ruang A", "Ruang B"] });
  assert.deepEqual(imported[1]?.lists, {});
});

test("full signed bundle files can be imported as portable preset collections", () => {
  const imported = importProfilePresets({ bundle, sig: { alg: "Ed25519", kid: "test", value: "test" } });
  assert.equal(imported.length, 1);
  assert.deepEqual(imported[0]?.profile, profile);
  assert.deepEqual(imported[0]?.lists, { locations: ["Ruang A", "Ruang B"] });
});

test("raw profile JSON can be imported when it does not require external lists", () => {
  const raw: Profile = {
    id: "raw-preset",
    version: 1,
    title: "Raw",
    consumer: "raw-consumer",
    recipient: { public: "33".repeat(32) },
    schema_id: "raw/v1",
    fields: [{ key: "code", type: "text", label: "Code", short: "c" }],
  };
  const imported = importProfilePresets(raw);
  assert.deepEqual(imported[0]?.profile, raw);
  assert.deepEqual(imported[0]?.lists, {});
});

test("invalid profile schemas and malformed option lists are rejected", () => {
  const invalid = structuredClone(profile);
  invalid.id = "Bad ID";
  assert.throws(() => importProfilePresets({ format: PROFILE_PRESET_FORMAT, profile: invalid, lists: bundle.lists }));
  assert.throws(() => importProfilePresets({
    format: PROFILE_PRESET_FORMAT,
    profile,
    lists: { locations: "not-an-array" },
  }));
});
