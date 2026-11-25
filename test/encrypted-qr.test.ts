import test from "node:test";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { decode, generateKeyPair, tokenVersion } from "../vendor/metaqr/src/index.js";
import { issueEncryptedToken } from "../dist/app/mq1.js";
import { renderQr } from "../dist/app/qr.js";

const payload = {
  p: "zyb-recording",
  pv: 1,
  s: "7QF3K9M2T8WX4R6B",
  r: "P-0427",
  sh: 2,
  b: "MM3201",
  l: "Ruang A",
  a: "Pemeriksaan",
  dn: "ZY005",
  di: "box-20260819-81e2",
};

const decoder = await generateKeyPair();

test("AITQR creates an encrypted MQ1 token that ZYBTool can decrypt without allow-list", async () => {
  const token = await issueEncryptedToken(payload, decoder.publicHex, 800);
  assert.equal(tokenVersion(token.token), 1);
  assert.ok(token.token.startsWith("MQ1:"));
  assert.ok(token.chars <= 800);
  assert.deepEqual(await decode(token.token, decoder.privateHex), payload);
});

test("the generated encrypted token renders as a QR SVG", async () => {
  const token = await issueEncryptedToken(payload, decoder.publicHex, 800);
  const qr = renderQr(token.token, { ecc: "Q", quietModules: 4, sizePx: 480 });
  assert.match(qr.markup, /^<svg /);
  assert.match(qr.markup, /fill="#000000"/);
  assert.ok(qr.modules >= 21);
  assert.ok(qr.version >= 1);
});

test("the encoder enforces the configured QR character budget", async () => {
  await assert.rejects(() => issueEncryptedToken(payload, decoder.publicHex, 60), /chars|too large/i);
});

test("a malformed recipient public key is rejected", async () => {
  await assert.rejects(() => issueEncryptedToken(payload, "not-a-key", 800));
});



test("shared ZYBTool MQ1 vector decrypts in the AITQR Metaqr implementation", async () => {
  const vector = JSON.parse(await readFile(new URL("../vectors/aitqr-mq1-vectors.json", import.meta.url), "utf8")) as {
    test_only: boolean;
    decoder_private_hex: string;
    payload: Record<string, unknown>;
    token: string;
  };
  assert.equal(vector.test_only, true);
  assert.equal(tokenVersion(vector.token), 1);
  assert.deepEqual(await decode(vector.token, vector.decoder_private_hex), vector.payload);
});
