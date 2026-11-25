/** Minimal encrypted-only MQ1 issuer. No per-user signing key or allow-list is required. */
import { encode, PayloadTooLargeError } from "../vendor/metaqr/src/index.js";

export class TokenTooLargeError extends Error {}

export interface IssuedToken { token: string; chars: number; }

export async function issueEncryptedToken(payload: Record<string, unknown>, recipientPublic: string, maxChars: number): Promise<IssuedToken> {
  try {
    const token = await encode(payload, recipientPublic, { maxChars });
    return { token, chars: token.length };
  } catch (error) {
    if (error instanceof PayloadTooLargeError && /chars/i.test(error.message)) throw new TokenTooLargeError(error.message);
    throw error;
  }
}
