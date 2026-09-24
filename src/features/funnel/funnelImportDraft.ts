// One local draft lets an interrupted browser tab recover the selected source file.
// Only the current browser profile can read it; it is removed after success or cancellation.
const DB_NAME = 'analytics-v5-funnel-import';
const STORE = 'draft';
const KEY = 'current';

function openDraftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Локальное хранилище недоступно'));
  });
}

async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDraftDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = operation(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Ошибка локального хранилища'));
      tx.onerror = () => reject(tx.error || new Error('Ошибка локального хранилища'));
    });
  } finally {
    db.close();
  }
}

export async function saveFunnelDraft(file: File): Promise<void> {
  await transaction('readwrite', store => store.put(file, KEY));
}

export async function loadFunnelDraft(): Promise<File | null> {
  const value = await transaction<unknown>('readonly', store => store.get(KEY));
  return value instanceof File ? value : null;
}

export async function clearFunnelDraft(): Promise<void> {
  await transaction('readwrite', store => store.delete(KEY));
}
