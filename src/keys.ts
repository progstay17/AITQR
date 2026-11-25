/**
 * The account's private key lives only on the device.
 *
 * AITQR never generates account keys: the key comes from outside (pasted once) and the administrator
 * only knows its public key. The pasted seed is imported as a NON-extractable CryptoKey, so page
 * script can sign with it but cannot read it back out; the CryptoKey is stored in IndexedDB.
 */
import { ACCOUNT_KEYS, openDb, run } from "./db.js";
import { kidOf, signerFromSeed } from "../vendor/metaqr/src/index.js";
import { bytesToHex, hexToBytes } from "../vendor/metaqr/src/keys.js";

const PKCS8_ED25519 = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

export interface StoredAccountKey {
  username: string;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicHex: string;
  kid: string;
}

export class KeyImportError extends Error {}

function normaliseHex(input: string): string {
  const hex = input.trim().toLowerCase().replace(/^0x/, "").replace(/\s+/g, "");
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new KeyImportError("Kunci privat harus 64 karakter hex (32 byte seed Ed25519).");
  }
  return hex;
}

/** Validate and import a pasted seed. Returns non-extractable keys plus the public key and kid. */
export async function prepareAccountKey(seedInput: string): Promise<Omit<StoredAccountKey, "username">> {
  const seed = normaliseHex(seedInput);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new KeyImportError("WebCrypto tidak tersedia; buka lewat HTTPS.");
  // Derive the public key first (this import is transient and never stored).
  let publicHex: string;
  let kid: string;
  try {
    const probe = await signerFromSeed(seed);
    publicHex = bytesToHex(probe.publicKey);
    kid = bytesToHex(await kidOf(probe.publicKey));
  } catch {
    throw new KeyImportError("Browser ini tidak mendukung Ed25519. Gunakan Chrome/Edge terbaru atau Safari 17+.");
  }
  try {
    const privateKey = await subtle.importKey(
      "pkcs8",
      new Uint8Array([...PKCS8_ED25519, ...hexToBytes(seed)]),
      { name: "Ed25519" },
      false,
      ["sign"],
    );
    const publicKey = await subtle.importKey("raw", new Uint8Array(hexToBytes(publicHex)), { name: "Ed25519" }, true, [
      "verify",
    ]);
    return { privateKey, publicKey, publicHex, kid };
  } catch (error) {
    throw new KeyImportError(error instanceof Error ? error.message : "Kunci tidak dapat diimpor.");
  }
}

export async function saveAccountKey(username: string, key: Omit<StoredAccountKey, "username">): Promise<void> {
  const db = await openDb();
  try {
    await run(db, ACCOUNT_KEYS, "readwrite", (store) => store.put({ ...key, username }));
  } finally {
    db.close();
  }
}

export async function loadAccountKey(username: string): Promise<StoredAccountKey | null> {
  const db = await openDb();
  try {
    const record = await run<StoredAccountKey | undefined>(
      db,
      ACCOUNT_KEYS,
      "readonly",
      (store) => store.get(username) as IDBRequest<StoredAccountKey | undefined>,
    );
    return record ?? null;
  } finally {
    db.close();
  }
}

export async function clearAccountKey(username: string): Promise<void> {
  const db = await openDb();
  try {
    await run(db, ACCOUNT_KEYS, "readwrite", (store) => store.delete(username));
  } finally {
    db.close();
  }
}
