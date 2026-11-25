/**
 * Decrypt and verify an MQ2 token with the decoder's private key.
 *
 * Used by the admin "verify" tool and by tests. Decryption uses the vendored Metaqr crypto module
 * (never re-implemented here); this file only splits the plaintext envelope and checks the signature.
 */
import { bytesToHex, hexToBytes } from "../vendor/metaqr/src/keys.js";
import { openSealed } from "../vendor/metaqr/src/crypto.js";
import { signingMessage } from "../vendor/metaqr/src/signing.js";
import { parse, tokenVersion } from "../vendor/metaqr/src/payload.js";

type Bytes = Uint8Array<ArrayBuffer>;

export interface OpenedToken {
  kid: string;
  issuedAt: number;
  rawJson: string;
  metadata: Record<string, unknown>;
  signature: Bytes;
  recipientPublic: Bytes;
  message: Bytes;
  compressed: boolean;
}

const MAX_PLAINTEXT = 4096;

/** Copy into an ArrayBuffer-backed view so WebCrypto and Blob accept it. */
function bytes(input: Uint8Array): Bytes {
  return new Uint8Array(input);
}

async function inflateRaw(input: Bytes): Promise<Bytes> {
  const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return bytes(new Uint8Array(await new Response(stream).arrayBuffer()));
}

/** Decrypt a signed token and return everything needed to check its signature. */
export async function openToken(token: string, decoderPrivateHex: string): Promise<OpenedToken> {
  if (tokenVersion(token) !== 2) throw new Error("token is not a signed MQ2 token");
  const envelope = bytes(parse(token));
  const privateKey = bytes(hexToBytes(decoderPrivateHex));
  const plain = bytes(await openSealed(envelope, privateKey, { version: 2 }));

  const flag = plain[0] ?? 0;
  if ((flag & ~1) !== 0) throw new Error("unknown payload flag bits");
  const kidBytes = plain.slice(1, 9);
  const iatBytes = plain.slice(9, 13);
  const nonce = plain.slice(13, 21);
  const signature = plain.slice(21, 85);
  let body = plain.slice(85);
  if (body.length === 0) throw new Error("token has no payload");
  if (body.length > MAX_PLAINTEXT) throw new Error("payload too large");
  if (flag & 1) body = await inflateRaw(body);
  if (body.length > MAX_PLAINTEXT) throw new Error("payload too large after inflate");

  const iat = new DataView(iatBytes.buffer, iatBytes.byteOffset, 4).getUint32(0, false);
  const rawJson = new TextDecoder("utf-8", { fatal: true }).decode(body);
  const parsed = JSON.parse(rawJson) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("payload is not a JSON object");
  }

  // The signature covers the recipient key, so a token re-encrypted to another decoder fails.
  const recipientPublic = await recipientPublicOf(privateKey);
  const message = bytes(signingMessage(recipientPublic, kidBytes, iat, nonce, body));

  return {
    kid: bytesToHex(kidBytes),
    issuedAt: iat,
    rawJson,
    metadata: parsed as Record<string, unknown>,
    signature,
    recipientPublic,
    message,
    compressed: (flag & 1) === 1,
  };
}

/** X25519 public key of the decoder private key (same derivation the encoder uses). */
async function recipientPublicOf(privateKey: Bytes): Promise<Bytes> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("WebCrypto is unavailable");
  const prefix = Uint8Array.from([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20,
  ]);
  const pkcs8 = new Uint8Array(prefix.length + privateKey.length);
  pkcs8.set(prefix, 0);
  pkcs8.set(privateKey, prefix.length);
  const imported = await subtle.importKey("pkcs8", pkcs8, { name: "X25519" }, true, ["deriveBits"]);
  const jwk = (await subtle.exportKey("jwk", imported)) as JsonWebKey;
  const raw = jwk.x ?? "";
  const normalised = raw.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalised + "=".repeat((4 - (normalised.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** Check the Ed25519 signature over the opened token with the account's public key. */
export async function verifySignature(opened: OpenedToken, accountPublicHex: string): Promise<boolean> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("WebCrypto is unavailable");
  const key = await subtle.importKey("raw", bytes(hexToBytes(accountPublicHex)), { name: "Ed25519" }, false, [
    "verify",
  ]);
  return subtle.verify({ name: "Ed25519" }, key, opened.signature, opened.message);
}
