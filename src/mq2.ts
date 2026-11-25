/**
 * The only adapter to the Metaqr encoder.
 * Signing uses the account key imported from the device (see keys.ts); the recipient public key comes
 * from the published configuration.
 */
import { encode, signerFromKeyPair } from "../vendor/metaqr/src/index.js";
import type { StoredAccountKey } from "./keys.js";

export class TokenTooLargeError extends Error {}

export interface IssuedToken {
  token: string;
  chars: number;
}

export async function issueToken(
  payload: Record<string, unknown>,
  recipientPublic: string,
  accountKey: StoredAccountKey,
  maxChars: number,
): Promise<IssuedToken> {
  const signer = await signerFromKeyPair({ privateKey: accountKey.privateKey, publicKey: accountKey.publicKey });
  try {
    const token = await encode(payload, recipientPublic, { signer, maxChars });
    return { token, chars: token.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/chars/i.test(message)) throw new TokenTooLargeError(message);
    throw error;
  }
}
