'use client';

/**
 * The offline write queue.
 *
 * Osman Nagar will lose power and 4G, and the counter cannot stop taking orders when it
 * does. Every POS write is recorded in IndexedDB with a client-generated UUID and an
 * Idempotency-Key *before* it is attempted; the queue is drained whenever the browser
 * regains connectivity. Because the server keys on both the idempotency key and the
 * order's `clientRef`, replaying blindly is safe — a retry returns the original result
 * rather than billing twice.
 *
 * IndexedDB rather than localStorage: it survives more, holds more, and is transactional.
 */
const DB_NAME = 'mk-pos';
const STORE = 'queue';
const DB_VERSION = 1;

export interface QueuedWrite {
  id: string;
  path: string;
  method: 'POST' | 'PUT' | 'PATCH';
  body: unknown;
  idempotencyKey: string;
  createdAt: number;
  attempts: number;
  lastError?: string;
  label: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function enqueue(write: Omit<QueuedWrite, 'createdAt' | 'attempts'>): Promise<void> {
  await withStore('readwrite', (s) => s.put({ ...write, createdAt: Date.now(), attempts: 0 }));
}

export async function listQueue(): Promise<QueuedWrite[]> {
  const all = await withStore<QueuedWrite[]>('readonly', (s) => s.getAll() as IDBRequest<QueuedWrite[]>);
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function dequeue(id: string): Promise<void> {
  await withStore('readwrite', (s) => s.delete(id));
}

export async function markFailed(id: string, error: string): Promise<void> {
  const existing = await withStore<QueuedWrite | undefined>('readonly', (s) => s.get(id) as IDBRequest<QueuedWrite | undefined>);
  if (!existing) return;
  await withStore('readwrite', (s) => s.put({ ...existing, attempts: existing.attempts + 1, lastError: error }));
}

export async function queueSize(): Promise<number> {
  return withStore<number>('readonly', (s) => s.count());
}

/**
 * Drains the queue oldest-first, stopping at the first network failure so ordering is
 * preserved — a settle must not be replayed before the order it settles.
 *
 * A 4xx other than 409 means the request is *permanently* wrong (bad data, revoked
 * access). Retrying it forever would block every write behind it, so it is dropped and
 * surfaced to the operator instead.
 */
export async function drainQueue(
  send: (w: QueuedWrite) => Promise<void>,
  onProgress?: (remaining: number) => void,
): Promise<{ sent: number; failed: number; dropped: QueuedWrite[] }> {
  const items = await listQueue();
  let sent = 0;
  let failed = 0;
  const dropped: QueuedWrite[] = [];

  for (const item of items) {
    try {
      await send(item);
      await dequeue(item.id);
      sent += 1;
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status && status >= 400 && status < 500 && status !== 409 && status !== 429) {
        await dequeue(item.id);
        dropped.push({ ...item, lastError: (err as Error).message });
        continue;
      }
      await markFailed(item.id, (err as Error).message);
      failed += 1;
      break;
    } finally {
      onProgress?.(await queueSize());
    }
  }

  return { sent, failed, dropped };
}
