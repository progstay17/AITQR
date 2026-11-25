/** Crockford base32, 16 characters = 80 bits. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const SESSION_ID_LENGTH = 16;

/**
 * 80 random bits as 16 base32 characters. The RNG is injected so tests are deterministic and so the
 * caller owns the source of entropy (`crypto.getRandomValues` in the app).
 */
export function newSessionId(randomBytes: (length: number) => Uint8Array): string {
  const bytes = randomBytes(10);
  if (bytes.length !== 10) throw new Error("session id needs exactly 10 random bytes");
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out.slice(0, SESSION_ID_LENGTH);
}

/** Collision check helper: 80 bits makes a repeat practically impossible, but never trust "practically". */
export function isDistinctSessionId(candidate: string, seen: ReadonlySet<string>): boolean {
  return !seen.has(candidate);
}
