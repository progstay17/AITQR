import { canonicalize } from "./canonical.js";
import { bytesToHex, kidOf, signerFromSeed } from "../../vendor/metaqr/src/index.js";
import type { Bundle, SignedBundle } from "../types.js";

/**
 * Sign a configuration bundle with the admin Ed25519 key.
 *
 * Used by the Worker (key from a Site secret) and by the offline CLI (key file), so both paths
 * produce exactly the same bytes. The private key is never returned, logged or embedded.
 */
export async function signBundle(bundle: Bundle, seedHex: string): Promise<SignedBundle> {
  if (!/^[0-9a-fA-F]{64}$/.test(seedHex)) {
    throw new Error("admin key must be a 64-hex-character Ed25519 seed");
  }
  const signer = await signerFromSeed(seedHex);
  const signature = await signer.sign(new TextEncoder().encode(canonicalize(bundle)));
  let binary = "";
  for (const byte of signature) binary += String.fromCharCode(byte);
  const value = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { bundle, sig: { alg: "Ed25519", kid: bytesToHex(await kidOf(signer.publicKey)), value } };
}
