// Type declarations added by AITQR for the vendored Metaqr modules that index.js does not re-export.
// Upstream code is unchanged; see ../SOURCE.md.
export const KID_LEN: number;
export const IAT_LEN: number;
export const NONCE_LEN: number;
export const SIG_LEN: number;
export function signingMessage(
  recipientPublic: Uint8Array,
  kid: Uint8Array,
  iat: number,
  nonce: Uint8Array,
  rawJson: Uint8Array,
): Uint8Array;
