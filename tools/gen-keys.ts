/**
 * Create the two key pairs this project needs, once, outside the repository history.
 *
 *   node tools/gen-keys.ts [--force]
 *
 * - keys/decoder-test/  X25519 pair for a TEST decoder (public key goes into the profile;
 *   the private half only ever decodes during testing, and is labelled TEST-ONLY).
 * - keys/admin/         Ed25519 pair that signs configuration bundles. The private key stays on this
 *   machine (git-ignored) and never enters the app, the bundle or the build output.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { webcrypto as crypto } from "node:crypto";
import { generateKeyPair } from "../vendor/metaqr/src/index.js";

const force = process.argv.includes("--force");
const decoderDir = "keys/decoder-test";
const adminDir = "keys/admin";

if (!force && (existsSync(`${adminDir}/private.hex`) || existsSync(`${decoderDir}/private.hex`))) {
  console.error("keys already exist; pass --force to replace them (all devices must re-register)");
  process.exit(1);
}

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const decoder = await generateKeyPair();
mkdirSync(decoderDir, { recursive: true });
writeFileSync(`${decoderDir}/private.hex`, `# TEST-ONLY decoder key. Never ship this.\n${decoder.privateHex}\n`);
writeFileSync(`${decoderDir}/public.hex`, `${decoder.publicHex}\n`);

const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
const seed = pkcs8.slice(pkcs8.length - 32);
const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", publicKey));

mkdirSync(adminDir, { recursive: true });
writeFileSync(`${adminDir}/private.hex`, `${hex(seed)}\n`);
writeFileSync(`${adminDir}/public.hex`, `${hex(publicKey)}\n`);

console.log(
  JSON.stringify(
    {
      decoderPublic: decoder.publicHex,
      adminPublic: hex(publicKey),
      adminKid: hex(digest.slice(0, 8)),
      next: [
        "Put decoderPublic in the profile's recipient.public (TEST key).",
        "Put adminPublic/adminKid in src/config/trustedAdminKeys.ts.",
        "Run: npm run build && npm run bundle:sign",
      ],
    },
    null,
    2,
  ),
);
