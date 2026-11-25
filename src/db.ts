/** One IndexedDB connection for the app: local history and the account signing key. */
import type { IssueRecord } from "./types.js";

export const DB_NAME = "aitqr";
export const DB_VERSION = 2;
export const SESSIONS = "sessions";
export const ACCOUNT_KEYS = "account_keys";

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSIONS)) {
        const store = db.createObjectStore(SESSIONS, { keyPath: "sid" });
        store.createIndex("issuedAt", "issuedAt");
      }
      if (!db.objectStoreNames.contains(ACCOUNT_KEYS)) {
        db.createObjectStore(ACCOUNT_KEYS, { keyPath: "username" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB unavailable"));
    request.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
}

export function run<T>(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = work(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error ?? new Error("transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
}

export async function addRecord(record: IssueRecord): Promise<void> {
  const db = await openDb();
  try {
    await run(db, SESSIONS, "readwrite", (store) => store.put(record));
  } finally {
    db.close();
  }
}

export async function listRecords(limit = 50): Promise<IssueRecord[]> {
  const db = await openDb();
  try {
    const all = await run<IssueRecord[]>(db, SESSIONS, "readonly", (store) => store.getAll() as IDBRequest<IssueRecord[]>);
    return all.sort((a, b) => b.issuedAt - a.issuedAt).slice(0, limit);
  } finally {
    db.close();
  }
}

export async function clearRecords(): Promise<void> {
  const db = await openDb();
  try {
    await run(db, SESSIONS, "readwrite", (store) => store.clear() as IDBRequest<undefined>);
  } finally {
    db.close();
  }
}

export function rememberLocale(locale: "id" | "en"): void {
  try {
    localStorage.setItem("aitqr.locale", locale);
  } catch {
    // ignore
  }
}

export function readLocale(): "id" | "en" | null {
  try {
    const value = localStorage.getItem("aitqr.locale");
    return value === "id" || value === "en" ? value : null;
  } catch {
    return null;
  }
}
