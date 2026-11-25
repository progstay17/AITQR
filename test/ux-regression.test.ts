import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const admin = readFileSync("src/admin.ts", "utf8");
const app = readFileSync("src/app.ts", "utf8");
const css = readFileSync("styles.css", "utf8");
const i18n = readFileSync("src/i18n.ts", "utf8");

test("admin feedback is viewport-anchored and accessible", () => {
  assert.ok(admin.includes("admin-toast admin-toast-${state.noticeKind}"));
  assert.ok(admin.includes('"aria-live": state.noticeKind === "error"'));
  assert.ok(css.includes(".admin-toast {"));
  assert.ok(css.includes("position: fixed"));
});

test("field editor exposes distinct panels, variable types and ordering", () => {
  assert.ok(admin.includes('class: "field-editor"'));
  assert.ok(admin.includes("renderDerivedEditors(profile)"));
  assert.ok(admin.includes("Sumber variabel otomatis"));
  assert.ok(admin.includes("Nilai tetap"));
  assert.ok(admin.includes('button("Naik"'));
  assert.ok(admin.includes('button("Turun"'));
  assert.ok(css.includes(".field-editor {"));
  assert.ok(css.includes("border-left: 4px solid"));
});

test("review budget uses the same payload builder and field pickers support search", () => {
  assert.ok(app.includes("previewPayload = buildPayload"));
  assert.ok(app.includes('list: listId'));
  assert.ok(app.includes("name: \"session-unavailable\""));
  assert.ok(app.includes("ensureQrWakeLock"));
  assert.ok(i18n.includes("review.recipient"));
  assert.ok(i18n.includes("form.search"));
  assert.ok(!i18n.includes("Paste the account's private key once"));
});

test("admin save and publish use operation locks", () => {
  assert.ok(admin.includes('state.busy = "save"'));
  assert.ok(admin.includes('state.busy = "publish"'));
  assert.ok(admin.includes("const snapshot = JSON.parse(JSON.stringify(state.doc))"));
});

test("staff login reuses the authenticated user instead of requesting session twice", () => {
  assert.ok(app.includes("async function boot(initialSession?: Session)"));
  assert.ok(app.includes('api<{ user: SessionUser }>("/api/login"'));
  assert.ok(app.includes("boot({ signedIn: true, user: result.user })"));
});

test("browser entry points are bundled and the install precache stays lean", () => {
  const build = readFileSync("scripts/build.mjs", "utf8");
  const sw = readFileSync("sw.js", "utf8");
  assert.ok(build.includes('for (const entry of ["main", "admin"])'));
  assert.ok(build.includes('platform: "browser"'));
  assert.ok(build.includes("minify: true"));
  assert.ok(sw.includes('"/app/main.js"'));
  assert.ok(sw.includes('"/app/admin.js"'));
  assert.ok(!sw.includes('"/app/mq2.js"'));
  assert.ok(!sw.includes('"/vendor/metaqr/'));
  assert.ok(!sw.includes('"/bundles/default.bundle.json"'));
});
