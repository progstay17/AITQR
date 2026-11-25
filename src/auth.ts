/**
 * Authentication primitives for AITQR: local username/password accounts and HMAC session cookies.
 * No third-party identity provider is involved anywhere in this file.
 */

/**
 * Default VPS password hashing cost. Successful logins transparently upgrade older stored hashes.
 * Operators can tune this through AITQR_PBKDF2_ITERATIONS for their VPS hardware.
 */
export const PBKDF2_ITERATIONS = 120_000;
export const PBKDF2_MIN_ITERATIONS = 1_000;
export const PBKDF2_MAX_ITERATIONS = 1_000_000;
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const HEX64 = /^[0-9a-f]{64}$/;

export function normaliseUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidUsername(value: string): boolean {
  return USERNAME_PATTERN.test(value);
}

/** Ed25519 public keys and other 32-byte keys are stored as lowercase hex. */
export function isHex64(value: string): boolean {
  return HEX64.test(value);
}

export function isSessionSecret(value: string | null | undefined): boolean {
  return HEX64.test((value ?? "").trim());
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const clean = hex.trim().toLowerCase();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Constant-time comparison for equal-length strings (hex digests, codes). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<string> {
  const subtle = globalThis.crypto.subtle;
  const base = await subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, 256);
  return toHex(new Uint8Array(bits));
}

/** Rounds from configuration, falling back to the default when unset, unparsable or out of range. */
export function pbkdf2Iterations(configured: string | null | undefined): number {
  const rounds = Number.parseInt((configured ?? "").trim(), 10);
  if (!Number.isInteger(rounds) || rounds < PBKDF2_MIN_ITERATIONS || rounds > PBKDF2_MAX_ITERATIONS) {
    return PBKDF2_ITERATIONS;
  }
  return rounds;
}

/** Rounds recorded in a stored hash, or null when the value is not a `pbkdf2$...` hash. */
export function storedIterations(stored: string): number | null {
  const [scheme, iterations, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !iterations || !salt || !hash) return null;
  const rounds = Number(iterations);
  return Number.isInteger(rounds) && rounds > 0 ? rounds : null;
}

/** `pbkdf2$<iterations>$<saltHex>$<hashHex>`; a fresh random salt per call. */
export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, iterations);
  return `pbkdf2$${iterations}$${toHex(salt)}$${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterations, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !iterations || !salt || !hash) return false;
  const rounds = Number(iterations);
  if (!Number.isInteger(rounds) || rounds <= 0) return false;
  const candidate = await derive(password, fromHex(salt), rounds);
  return timingSafeEqual(candidate, hash);
}

// ---------------------------------------------------------------- sessions

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(value: string): Uint8Array<ArrayBuffer> {
  const normalised = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalised + "=".repeat((4 - (normalised.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function hmacKey(secretHex: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", fromHex(secretHex), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

const encoder = new TextEncoder();

/** Stateless session value: base64url(payload).base64url(HMAC-SHA256(payload)). */
export async function createSessionToken(
  secretHex: string,
  username: string,
  ttlSeconds: number,
  nowMs: number,
): Promise<string> {
  if (!isSessionSecret(secretHex)) throw new Error("session secret must be 64 hex characters");
  const payload = { u: username, e: Math.floor(nowMs / 1000) + ttlSeconds };
  const body = encoder.encode(JSON.stringify(payload));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secretHex), body);
  return `${b64url(body)}.${b64url(new Uint8Array(signature))}`;
}

/** Returns the username for a valid, unexpired token; null for anything else. */
export async function readSessionToken(
  secretHex: string,
  token: string | null | undefined,
  nowMs: number,
): Promise<string | null> {
  if (!isSessionSecret(secretHex) || !token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  try {
    const payloadBytes = b64urlDecode(body);
    const valid = await crypto.subtle.verify("HMAC", await hmacKey(secretHex), b64urlDecode(signature), payloadBytes);
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as { u?: unknown; e?: unknown };
    if (typeof payload.u !== "string" || typeof payload.e !== "number") return null;
    if (payload.e * 1000 <= nowMs) return null;
    return payload.u;
  } catch {
    return null;
  }
}

/** Read one cookie by name from a Cookie header. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}
