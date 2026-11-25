// Sealed-box envelope (ECIES): X25519 + HKDF-SHA256 + AES-256-GCM. See SPEC.md section 2.
import { DecryptError, FormatError, InvalidKeyError, UnsupportedPlatformError } from "./errors.js";
import { asKeyBytes } from "./keys.js";

export const PREFIXES = { 1: "MQ1:", 2: "MQ2:" };   // token version -> text prefix (also the AAD prefix)
export const PREFIX = PREFIXES[1];
const te = new TextEncoder();
const EPH_LEN = 32;
const MIN_ENVELOPE = EPH_LEN + 1 + 16;
// PKCS#8 wrapper of a raw X25519 private key (WebCrypto cannot import raw private keys).
const PKCS8_X25519 = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20]);

const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new UnsupportedPlatformError(
    "WebCrypto (crypto.subtle) is unavailable: serve the page over HTTPS or http://localhost (secure context)");
  return s;
};

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

function b64urlToBytes(s) {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

/**
 * Default X25519 backend: WebCrypto. A custom backend (for browsers without WebCrypto X25519,
 * e.g. built on @noble/curves) must implement the same two async methods:
 *   publicFromPrivate(priv: Uint8Array): Promise<Uint8Array>   (32 bytes)
 *   exchange(priv: Uint8Array, pub: Uint8Array): Promise<Uint8Array>   (32 bytes; must throw on an all-zero result)
 */
async function importPrivate(priv, extractable) {
  try {
    return await subtle().importKey("pkcs8", concat(PKCS8_X25519, priv),
      { name: "X25519" }, extractable, ["deriveBits"]);
  } catch (e) {
    if (e instanceof UnsupportedPlatformError) throw e;
    throw new UnsupportedPlatformError(
      "this runtime has no WebCrypto X25519: pass a backend via the `x25519` option (e.g. built on @noble/curves)");
  }
}

export const webCryptoX25519 = {
  async publicFromPrivate(priv) {
    const jwk = await subtle().exportKey("jwk", await importPrivate(priv, true));
    return b64urlToBytes(jwk.x);
  },
  async exchange(priv, pub) {
    const sk = await importPrivate(priv, false);
    const pk = await subtle().importKey("raw", pub, { name: "X25519" }, false, []);
    return new Uint8Array(await subtle().deriveBits({ name: "X25519", public: pk }, sk, 256));
  },
};

async function deriveKeyAndNonce(shared, ephPub, recipPub, version) {
  const s = subtle();
  const base = await s.importKey("raw", shared, "HKDF", false, ["deriveBits"]);
  const okm = new Uint8Array(await s.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: concat(ephPub, recipPub), info: te.encode(`metaqr/v${version}`) }, base, 44 * 8));
  return { key: okm.slice(0, 32), nonce: okm.slice(32, 44) };
}

/**
 * Encrypt `plaintext` to `recipientPublic`. Returns ephPub(32) || ciphertext || tag(16).
 * `_ephemeralPrivate` is for deterministic test vectors only: never pass it in production.
 */
export async function seal(plaintext, recipientPublic, { x25519 = webCryptoX25519, version = 1, _ephemeralPrivate } = {}) {
  subtle(); // fail early with a clear message if WebCrypto is missing
  const recip = asKeyBytes(recipientPublic, "public key");
  const ephPriv = _ephemeralPrivate ? asKeyBytes(_ephemeralPrivate, "ephemeral key")
    : globalThis.crypto.getRandomValues(new Uint8Array(32));
  const ephPub = await x25519.publicFromPrivate(ephPriv);
  let shared;
  try { shared = await x25519.exchange(ephPriv, recip); }
  catch (e) {
    if (e instanceof UnsupportedPlatformError) throw e;
    throw new InvalidKeyError("unusable public key");
  }
  const { key, nonce } = await deriveKeyAndNonce(shared, ephPub, recip, version);
  const aesKey = await subtle().importKey("raw", key, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await subtle().encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: concat(te.encode(PREFIXES[version]), ephPub), tagLength: 128 }, aesKey, plaintext));
  return concat(ephPub, ct);
}

export async function openSealed(envelope, recipientPrivate, { x25519 = webCryptoX25519, version = 1 } = {}) {
  subtle();
  if (envelope.length < MIN_ENVELOPE) throw new FormatError("token too short");
  const priv = asKeyBytes(recipientPrivate, "private key");
  const ephPub = envelope.slice(0, EPH_LEN);
  const ct = envelope.slice(EPH_LEN);
  try {
    const recipPub = await x25519.publicFromPrivate(priv);
    const shared = await x25519.exchange(priv, ephPub);
    const { key, nonce } = await deriveKeyAndNonce(shared, ephPub, recipPub, version);
    const aesKey = await subtle().importKey("raw", key, "AES-GCM", false, ["decrypt"]);
    return new Uint8Array(await subtle().decrypt(
      { name: "AES-GCM", iv: nonce, additionalData: concat(te.encode(PREFIXES[version]), ephPub), tagLength: 128 }, aesKey, ct));
  } catch (e) {
    if (e instanceof UnsupportedPlatformError) throw e;
    throw new DecryptError("decryption failed: wrong private key or token was altered");
  }
}
