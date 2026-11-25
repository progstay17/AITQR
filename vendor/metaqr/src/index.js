import { webCryptoX25519 } from "./crypto.js";
import { bytesToHex } from "./keys.js";

export { encode, decode, parse, isToken, tokenVersion, compressionAvailable,
  DEFAULT_MAX_TOKEN_CHARS, RECOMMENDED_TOKEN_CHARS } from "./payload.js";
export { fingerprint, hexToBytes, bytesToHex } from "./keys.js";
export { webCryptoX25519 } from "./crypto.js";
export { createDeviceSigner, generateDeviceKey, signerFromKeyPair, signerFromSeed, kidOf } from "./signing.js";
export { loadOrCreateDeviceSigner, forgetDeviceKey } from "./device.js";
export * from "./errors.js";
export const VERSION = "0.4.0";

/**
 * Generate a recipient key pair. Convenience for tests/demos: create the real decoder key pair
 * offline with the Python CLI (`metaqr keygen`) and ship only the public key in the web tool.
 */
export async function generateKeyPair({ x25519 = webCryptoX25519 } = {}) {
  const privateKey = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const publicKey = await x25519.publicFromPrivate(privateKey);
  return { privateKey, publicKey, privateHex: bytesToHex(privateKey), publicHex: bytesToHex(publicKey) };
}
