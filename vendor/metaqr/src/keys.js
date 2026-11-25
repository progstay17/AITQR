import { InvalidKeyError } from "./errors.js";

/** Accept a 32-byte Uint8Array or a 64-char hex string (whitespace ignored). */
export function asKeyBytes(key, name = "key") {
  let raw;
  if (key instanceof Uint8Array) raw = key;
  else if (key instanceof ArrayBuffer) raw = new Uint8Array(key);
  else if (typeof key === "string") {
    const h = key.replace(/\s+/g, "");
    if (!/^(?:[0-9a-fA-F]{2})*$/.test(h)) throw new InvalidKeyError(`${name} is not valid hex`);
    raw = hexToBytes(h);
  } else throw new InvalidKeyError(`${name} must be a Uint8Array or hex string`);
  if (raw.length !== 32) throw new InvalidKeyError(`${name} must be 32 bytes, got ${raw.length}`);
  return raw;
}

export function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Short ID of a public key (first 16 hex chars of SHA-256); same as Python `fingerprint`. */
export async function fingerprint(publicKey) {
  const d = await globalThis.crypto.subtle.digest("SHA-256", asKeyBytes(publicKey, "public key"));
  return bytesToHex(new Uint8Array(d)).slice(0, 16);
}
