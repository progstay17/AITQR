// Type declarations added by AITQR for the vendored Metaqr modules that index.js does not re-export.
// Upstream code is unchanged; see ../SOURCE.md.
export function openSealed(
  envelope: Uint8Array,
  recipientPrivate: Uint8Array | string,
  options?: { version?: 1 | 2 },
): Promise<Uint8Array>;
