/**
 * Sign the source bundle with the admin Ed25519 key and write the deployable bundle.
 *
 *   node tools/sign-bundle.ts [--key keys/admin/private.hex] [--in bundles/source.bundle.json] [--out bundles/default.bundle.json]
 *
 * The private key path defaults to AITQR_ADMIN_KEY or keys/admin/private.hex (git-ignored). It is read
 * here and never copied into the bundle or the build output (AGENTS §4).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { canonicalize } from "../dist/app/config/canonical.js";
import { signerFromSeed, kidOf, bytesToHex } from "../vendor/metaqr/src/index.js";
import type { Bundle, SignedBundle } from "../dist/app/types.js";

interface Arguments {
  key: string;
  input: string;
  output: string;
}

function parseArgs(argv: string[]): Arguments {
  const args: Arguments = {
    key: process.env.AITQR_ADMIN_KEY ?? "keys/admin/private.hex",
    input: "bundles/source.bundle.json",
    output: "bundles/default.bundle.json",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--key" && value) args.key = value;
    if (flag === "--in" && value) args.input = value;
    if (flag === "--out" && value) args.output = value;
    if (value === undefined) continue;
    i += flag?.startsWith("--") ? 1 : 0;
  }
  return args;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const args = parseArgs(process.argv.slice(2));
const seed = readFileSync(args.key, "utf8").trim();
const source = JSON.parse(readFileSync(args.input, "utf8")) as { bundle: Bundle };
const bundle = source.bundle;

if (bundle.schema !== "aitqr.bundle/1") throw new Error("source bundle must use schema aitqr.bundle/1");
if (!Number.isInteger(bundle.seq) || bundle.seq < 0) throw new Error("bundle.seq must be a non-negative integer");

const signer = await signerFromSeed(seed);
const kid = bytesToHex(await kidOf(signer.publicKey));
const canonical = new TextEncoder().encode(canonicalize(bundle));
const signature = await signer.sign(canonical);

const signed: SignedBundle = {
  bundle,
  sig: { alg: "Ed25519", kid, value: base64Url(signature) },
};

writeFileSync(args.output, JSON.stringify(signed, null, 2) + "\n");
console.log(`signed seq=${bundle.seq} kid=${kid} -> ${args.output} (${canonical.length} canonical bytes)`);
