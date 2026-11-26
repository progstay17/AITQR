import test from "node:test";
import assert from "node:assert/strict";
import { openDecoderKey, sealDecoderKey } from "../dist/app/decoder-vault.js";

const master = "a".repeat(64);
const privateKey = "0123456789abcdef".repeat(4);

test("decoder keys are sealed and opened with AES-256-GCM", async () => {
  const sealed = await sealDecoderKey(privateKey, master, "account-a", "0123456789abcdef");
  assert.notEqual(sealed.ciphertext, privateKey);
  assert.deepEqual(await openDecoderKey(sealed.iv, sealed.ciphertext, master, "account-a", "0123456789abcdef"), Uint8Array.from(privateKey.match(/../g)!, (part) => Number.parseInt(part, 16)));
});

test("decoder key vault rejects a wrong master key", async () => {
  const sealed = await sealDecoderKey(privateKey, master, "account-a", "0123456789abcdef");
  await assert.rejects(() => openDecoderKey(sealed.iv, sealed.ciphertext, "b".repeat(64), "account-a", "0123456789abcdef"));
});

test("decoder key vault rejects malformed master keys", async () => {
  await assert.rejects(() => sealDecoderKey(privateKey, "short", "account-a", "0123456789abcdef"), /AITQR_VAULT_MASTER_KEY/);
});

test("decoder key ciphertext is bound to its account and fingerprint", async () => {
  const sealed = await sealDecoderKey(privateKey, master, "account-a", "0123456789abcdef");
  await assert.rejects(() => openDecoderKey(sealed.iv, sealed.ciphertext, master, "account-b", "0123456789abcdef"));
  await assert.rejects(() => openDecoderKey(sealed.iv, sealed.ciphertext, master, "account-a", "fedcba9876543210"));
});
