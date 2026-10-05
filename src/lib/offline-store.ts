// Device storage for the Till: the recoverable sale draft and a short outage log.
// Only non-secret sale-form data is ever stored here. Never PINs, sign-in tokens or payment keys.
import type { PosDraft } from "./pos-draft";

const DB_NAME = "nairaplate-offline";
const DB_VERSION = 1;
const OUTAGE_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("drafts")) db.createObjectStore("drafts", { keyPath: "key" });
      if (!db.objectStoreNames.contains("outages")) db.createObjectStore("outages", { keyPath: "id", autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => { resolve(r ? (r.result as T) : null); db.close(); };
    t.onerror = () => { resolve(null); db.close(); };
  });
}

/** One draft per business and staff member on this device. */
export const draftKey = (businessId: string, userId: string) => `${businessId}:${userId}`;
const sessionKey = (key: string) => `np-pos-draft:${key}`;

export async function saveDraft(d: PosDraft): Promise<void> {
  try { sessionStorage.setItem(sessionKey(d.key), JSON.stringify(d)); } catch { /* storage full or blocked */ }
  await tx("drafts", "readwrite", (s) => s.put(d));
}

export async function loadDraft(key: string): Promise<PosDraft | null> {
  try {
    const raw = sessionStorage.getItem(sessionKey(key));
    if (raw) return JSON.parse(raw) as PosDraft;
  } catch { /* ignore */ }
  return (await tx<PosDraft>("drafts", "readonly", (s) => s.get(key))) ?? null;
}

export async function deleteDraft(key: string): Promise<void> {
  try { sessionStorage.removeItem(sessionKey(key)); } catch { /* ignore */ }
  await tx("drafts", "readwrite", (s) => s.delete(key));
}

export type OutageEntry =
  | { kind: "start"; atUtc: string }
  | { kind: "end"; atUtc: string; startedAtUtc: string | null }
  | { kind: "draft_discarded"; atUtc: string; reason: string; clientSaleId: string; expired?: boolean }
  /** Minimal tombstone: no items, no customer details. */
  | { kind: "draft_auto_purged"; atUtc: string; clientSaleId: string; createdAtUtc: string | null; expiredAtUtc: string }
  | { kind: "draft_review_requested"; atUtc: string; clientSaleId: string };

export async function logOutage(e: OutageEntry): Promise<void> {
  await tx("outages", "readwrite", (s) => s.add(e));
  // Keep the log short: drop entries older than 30 days.
  const cutoff = Date.now() - OUTAGE_KEEP_MS;
  const db = await openDb();
  if (!db) return;
  const t = db.transaction("outages", "readwrite");
  const cur = t.objectStore("outages").openCursor();
  cur.onsuccess = () => {
    const c = cur.result;
    if (!c) return;
    if (Date.parse((c.value as OutageEntry).atUtc) < cutoff) c.delete();
    c.continue();
  };
  t.oncomplete = () => db.close();
}

/** Paper reference counter, per device, per business, per Nigeria date. */
export function nextPaperSequence(businessId: string, dateKey: string): number {
  const k = `np-paper-seq:${businessId}:${dateKey}`;
  try {
    const n = Number(localStorage.getItem(k) ?? "0") + 1;
    localStorage.setItem(k, String(n));
    return n;
  } catch { return 1; }
}

const TILL_LABEL_KEY = "np-till-label";
export function getTillLabel(): string { try { return localStorage.getItem(TILL_LABEL_KEY) ?? ""; } catch { return ""; } }
export function setTillLabel(v: string) { try { localStorage.setItem(TILL_LABEL_KEY, v); } catch { /* ignore */ } }
