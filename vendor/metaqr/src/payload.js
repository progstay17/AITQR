// Metadata object <-> text token. See SPEC.md.
//   token = "MQ1:" + base45( ephPub[32] || AES-GCM( flag[1] || body ) )
//   flag 0: body = UTF-8 JSON      flag 1: body = raw DEFLATE of UTF-8 JSON
import * as base45 from "./base45.js";
import { PREFIXES, openSealed, seal } from "./crypto.js";
import { FormatError, PayloadTooLargeError, SignedTokenError, UnsupportedPlatformError } from "./errors.js";
import { asKeyBytes } from "./keys.js";
import * as sg from "./signing.js";

export const DEFAULT_MAX_TOKEN_CHARS = 800;
export const RECOMMENDED_TOKEN_CHARS = 400;
export const MAX_DECODE_TOKEN_CHARS = 4400;
export const MAX_PLAINTEXT_BYTES = 4096;
const MAX_DEPTH = 64;

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });

// ---- canonical JSON: sorted keys (by code point), no whitespace, non-ASCII kept as-is ----
function cmpCodePoints(a, b) {
  const x = Array.from(a, (c) => c.codePointAt(0));
  const y = Array.from(b, (c) => c.codePointAt(0));
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}

function checkString(s) {
  // lone surrogates cannot be encoded as UTF-8 (and Python would refuse them too)
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = s.charCodeAt(i + 1);
      if (!(n >= 0xdc00 && n <= 0xdfff)) throw new FormatError("metadata contains an invalid Unicode string");
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) throw new FormatError("metadata contains an invalid Unicode string");
  }
  return s;
}

function canonical(v, depth = 0) {
  if (depth > MAX_DEPTH) throw new FormatError("metadata is nested too deeply");
  if (v === null || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "string") return JSON.stringify(checkString(v));
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new FormatError("metadata contains NaN or Infinity");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return "[" + v.map((x) => canonical(x, depth + 1)).join(",") + "]";
  if (typeof v === "object") {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) throw new FormatError("metadata must contain plain objects only");
    const keys = Object.keys(v).sort(cmpCodePoints);
    return "{" + keys.map((k) => JSON.stringify(checkString(k)) + ":" + canonical(v[k], depth + 1)).join(",") + "}";
  }
  throw new FormatError(`metadata is not JSON-serialisable (${typeof v})`);
}

// ---- raw DEFLATE via the platform streams (browsers >= 2023, Node >= 20.12) ----
export function compressionAvailable() {
  try { new CompressionStream("deflate-raw"); new DecompressionStream("deflate-raw"); return true; }
  catch { return false; }
}

async function deflateRaw(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

async function inflateRaw(bytes, max) {
  if (!compressionAvailable()) throw new UnsupportedPlatformError("DecompressionStream('deflate-raw') is unavailable");
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > max) { await reader.cancel().catch(() => {}); throw new FormatError("compressed metadata too large"); }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof FormatError) throw e;
    throw new FormatError("corrupt compressed metadata");
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// ---- public API ----
const PREFIX_LIST = Object.entries(PREFIXES).map(([v, p]) => [Number(v), p]);

export function isToken(text) {
  return typeof text === "string" && PREFIX_LIST.some(([, p]) => text.trim().startsWith(p));
}

/** 1 = unsigned (MQ1), 2 = signed (MQ2). Throws FormatError for anything else. */
export function tokenVersion(token) {
  if (typeof token !== "string") throw new FormatError("token must be a string");
  const t = token.trim();
  for (const [v, p] of PREFIX_LIST) if (t.startsWith(p)) return v;
  throw new FormatError("not a metaqr token (missing 'MQ1:' / 'MQ2:' prefix)");
}

/**
 * Encrypt `metadata` (plain JSON-able object) to the recipient's public key.
 * With `options.signer` the token is also signed by this device (MQ2): the decoder can then prove which
 * allow-listed device made it. Without it the token is unsigned (MQ1).
 * @param {object} metadata
 * @param {Uint8Array|string} publicKey 32 bytes or 64-char hex
 * @param {{compress?: boolean|null, maxChars?: number, x25519?: object, signer?: object}} [options]
 * @returns {Promise<string>} token "MQ1:..." or "MQ2:..."
 */
export async function encode(metadata, publicKey, options = {}) {
  const { compress = null, maxChars = DEFAULT_MAX_TOKEN_CHARS, signer = null, _iat, _nonce, ...cryptoOpts } = options;
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new FormatError("metadata must be an object");
  }
  const raw = enc.encode(canonical(metadata));
  if (raw.length > MAX_PLAINTEXT_BYTES) {
    throw new PayloadTooLargeError(`metadata is ${raw.length} bytes (max ${MAX_PLAINTEXT_BYTES})`);
  }
  let useZ = false;
  let body = raw;
  if (compress === true || (compress === null && compressionAvailable())) {
    if (!compressionAvailable()) throw new UnsupportedPlatformError("CompressionStream('deflate-raw') is unavailable");
    const packed = await deflateRaw(raw);
    useZ = compress === true ? true : packed.length < raw.length;
    if (useZ) body = packed;
  }
  let plain;
  let version = 1;
  if (signer === null) {
    plain = new Uint8Array(1 + body.length);
    plain[0] = useZ ? 1 : 0;
    plain.set(body, 1);
  } else {
    version = 2;
    sg.checkSigner(signer);
    const recipient = asKeyBytes(publicKey, "public key");
    const kid = await sg.kidOf(signer.publicKey);
    const iat = _iat ?? Math.floor(Date.now() / 1000);
    if (!Number.isInteger(iat) || iat < 0 || iat >= 2 ** 32) throw new FormatError("issue time out of range");
    const nonce = _nonce ?? globalThis.crypto.getRandomValues(new Uint8Array(sg.NONCE_LEN));
    if (!(nonce instanceof Uint8Array) || nonce.length !== sg.NONCE_LEN) throw new FormatError(`nonce must be ${sg.NONCE_LEN} bytes`);
    const sig = await signer.sign(sg.signingMessage(recipient, kid, iat, nonce, raw));
    sg.checkSignature(sig);
    const iatBytes = new Uint8Array(sg.IAT_LEN);
    new DataView(iatBytes.buffer).setUint32(0, iat, false);
    plain = sg.concat(Uint8Array.of(useZ ? sg.FLAG_COMPRESSED : 0), kid, iatBytes, nonce, sig, body);
  }
  const token = PREFIXES[version] + base45.encode(await seal(plain, publicKey, { ...cryptoOpts, version }));
  if (token.length > maxChars) {
    throw new PayloadTooLargeError(
      `token is ${token.length} chars (limit ${maxChars}); shorten the metadata ` +
      `(use short IDs instead of names; aim for <= ${RECOMMENDED_TOKEN_CHARS})`);
  }
  return token;
}

/** Validate token syntax and return its binary envelope (no key needed). */
export function parse(token) {
  const version = tokenVersion(token);
  const t = token.trim();
  if (t.length > MAX_DECODE_TOKEN_CHARS) throw new FormatError("token too long");
  return base45.decode(t.slice(PREFIXES[version].length));
}

/**
 * Decrypt an UNSIGNED token. Intended for verification/tests: in the field the private key lives on the decoder PC.
 * @returns {Promise<object>}
 */
export async function decode(token, privateKey, options = {}) {
  if (tokenVersion(token) !== 1) {
    throw new SignedTokenError("this token is signed (MQ2): verify it on the decoder (Python metaqr.verify); " +
      "the JavaScript package only decodes unsigned tokens");
  }
  const plain = await openSealed(parse(token), privateKey, { ...options, version: 1 });
  const flag = plain[0];
  let body = plain.slice(1);
  if (flag === 1) body = await inflateRaw(body, MAX_PLAINTEXT_BYTES);
  else if (flag !== 0) throw new FormatError(`unknown payload flag ${flag}`);
  let obj;
  try { obj = JSON.parse(dec.decode(body)); }
  catch { throw new FormatError("metadata is not valid JSON"); }
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) throw new FormatError("metadata must be a JSON object");
  return obj;
}
