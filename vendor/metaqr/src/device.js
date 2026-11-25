// Persistent per-device signing key for the web tool (browser only: needs IndexedDB + WebCrypto Ed25519).
// The private key is generated NON-extractable and stored as a CryptoKey: JavaScript on the page can sign
// with it but cannot read it, so a copied web page or an injected script cannot exfiltrate it.
// Caveats: clearing site data (or some browsers' storage eviction, notably iOS for unused web apps) deletes
// the key. The device would then need a new key and a new allow-list entry.
import { bytesToHex } from "./keys.js";
import { createDeviceSigner, kidOf, signerFromKeyPair } from "./signing.js";

const DEFAULTS = { dbName: "metaqr", storeName: "device-keys", keyName: "signing" };

function openDb({ dbName, storeName }) {
  return new Promise((resolve, reject) => {
    const req = globalThis.indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(storeName);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
}

function tx(db, storeName, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const r = fn(t.objectStore(storeName));
    t.oncomplete = () => resolve(r.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

async function describe(signer, keyPair, extra) {
  return { signer, keyPair, publicKey: signer.publicKey, publicHex: bytesToHex(signer.publicKey),
    kidHex: bytesToHex(await kidOf(signer.publicKey)), ...extra };
}

/**
 * Load this device's signing key, creating and storing it on first use.
 * Returns `{ signer, publicHex, kidHex, persisted, created }`.
 * `persisted: false` means storage was unavailable (private mode, blocked): the key lives only until the
 * page closes. Show that to the operator, because such a key cannot be added to the allow-list usefully.
 */
export async function loadOrCreateDeviceSigner(options = {}) {
  const o = { ...DEFAULTS, ...options };
  let db;
  try {
    db = await openDb(o);
    const stored = await tx(db, o.storeName, "readonly", (s) => s.get(o.keyName));
    if (stored?.privateKey && stored?.publicKey) {
      return describe(await signerFromKeyPair(stored), stored, { persisted: true, created: false });
    }
    const fresh = await createDeviceSigner();
    await tx(db, o.storeName, "readwrite", (s) => s.put(
      { privateKey: fresh.keyPair.privateKey, publicKey: fresh.keyPair.publicKey, createdAt: Date.now() }, o.keyName));
    return describe(fresh.signer, fresh.keyPair, { persisted: true, created: true });
  } catch (e) {
    if (e?.name === "UnsupportedPlatformError") throw e;
    const fresh = await createDeviceSigner();          // storage failed: still usable for this page's lifetime
    return describe(fresh.signer, fresh.keyPair, { persisted: false, created: true, storageError: String(e?.message ?? e) });
  } finally {
    db?.close();
  }
}

/** Delete the stored device key (the device will need a new allow-list entry). */
export async function forgetDeviceKey(options = {}) {
  const o = { ...DEFAULTS, ...options };
  const db = await openDb(o);
  try { await tx(db, o.storeName, "readwrite", (s) => s.delete(o.keyName)); } finally { db.close(); }
}
