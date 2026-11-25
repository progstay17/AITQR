// Ed25519 device signing for signed tokens (MQ2). See SPEC.md section 8.
// The signed message is  "metaqr/v2/sig\0" || recipientX25519Pub[32] || kid[8] || iat[4, BE] || nonce[8] || rawJson
import { FormatError, InvalidKeyError, UnsupportedPlatformError } from "./errors.js";
import { asKeyBytes, bytesToHex } from "./keys.js";

export const KID_LEN = 8, IAT_LEN = 4, NONCE_LEN = 8, SIG_LEN = 64;
export const FLAG_COMPRESSED = 0x01;
const CONTEXT = new TextEncoder().encode("metaqr/v2/sig\0");
// PKCS#8 wrapper of a raw 32-byte Ed25519 seed (WebCrypto cannot import raw private keys).
const PKCS8_ED25519 = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);

const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new UnsupportedPlatformError("WebCrypto (crypto.subtle) is unavailable: serve over HTTPS or http://localhost");
  return s;
};
const ed25519Unsupported = () => new UnsupportedPlatformError(
  "this runtime has no WebCrypto Ed25519 (needs a current Chrome/Edge, Firefox or Safari 17+); " +
  "pass your own signer: { publicKey: Uint8Array(32), sign: async (message) => Uint8Array(64) }");

export function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function b64urlToBytes(s) {
  return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}

/** Key id of a device public key: first 8 bytes of SHA-256. Same as Python `fingerprint` (hex). */
export async function kidOf(publicKey) {
  return new Uint8Array(await subtle().digest("SHA-256", asKeyBytes(publicKey, "device public key"))).slice(0, KID_LEN);
}

export function signingMessage(recipientPublic, kid, iat, nonce, rawJson) {
  const iatBytes = new Uint8Array(IAT_LEN);
  new DataView(iatBytes.buffer).setUint32(0, iat, false);
  return concat(CONTEXT, recipientPublic, kid, iatBytes, nonce, rawJson);
}

/**
 * A signer is `{ publicKey: Uint8Array(32), sign(message): Promise<Uint8Array(64)> }`.
 * Build one from a WebCrypto Ed25519 key pair (private key may be NON-extractable: the page's JavaScript
 * can then use it to sign but can never read it out).
 */
export async function signerFromKeyPair({ privateKey, publicKey }) {
  let pub;
  try { pub = new Uint8Array(await subtle().exportKey("raw", publicKey)); }
  catch (e) { if (e instanceof UnsupportedPlatformError) throw e; throw ed25519Unsupported(); }
  return {
    publicKey: pub,
    async sign(message) { return new Uint8Array(await subtle().sign("Ed25519", privateKey, message)); },
  };
}

/** New device key pair; the private key is non-extractable. Returns the CryptoKey pair. */
export async function generateDeviceKey() {
  try { return await subtle().generateKey({ name: "Ed25519" }, false, ["sign", "verify"]); }
  catch (e) { if (e instanceof UnsupportedPlatformError) throw e; throw ed25519Unsupported(); }
}

/** Generate a device key pair and wrap it as a signer. `keyPair` can be stored (e.g. IndexedDB). */
export async function createDeviceSigner() {
  const keyPair = await generateDeviceKey();
  const signer = await signerFromKeyPair(keyPair);
  return { signer, keyPair, publicKey: signer.publicKey, publicHex: bytesToHex(signer.publicKey),
    kidHex: bytesToHex(await kidOf(signer.publicKey)) };
}

/** Signer from a raw 32-byte seed (hex or bytes). For tests / Node scripts: a seed is extractable by nature. */
export async function signerFromSeed(seed) {
  const s = asKeyBytes(seed, "signing key");
  let key;
  try {
    key = await subtle().importKey("pkcs8", concat(PKCS8_ED25519, s), { name: "Ed25519" }, true, ["sign"]);
  } catch (e) { if (e instanceof UnsupportedPlatformError) throw e; throw ed25519Unsupported(); }
  const publicKey = b64urlToBytes((await subtle().exportKey("jwk", key)).x);
  return {
    publicKey,
    async sign(message) { return new Uint8Array(await subtle().sign("Ed25519", key, message)); },
  };
}

/** Validate a signer object early so mistakes give clear errors. */
export function checkSigner(signer) {
  if (!signer || typeof signer.sign !== "function") throw new InvalidKeyError("signer must have a sign(message) function");
  if (!(signer.publicKey instanceof Uint8Array) || signer.publicKey.length !== 32) {
    throw new InvalidKeyError("signer.publicKey must be a 32-byte Uint8Array");
  }
}

export function checkSignature(sig) {
  if (!(sig instanceof Uint8Array) || sig.length !== SIG_LEN) {
    throw new FormatError(`signer returned ${sig?.length ?? "no"} bytes, expected ${SIG_LEN}`);
  }
}
