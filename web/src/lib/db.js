/**
 * Videos never leave the browser — only sampled frames go to the model. Caching
 * the file in IndexedDB means reopening a project restores its video instead of
 * asking the analyst to find the file again.
 */
const DB_NAME = 'scoregt';
const STORE = 'videos';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => {
      db.close();
      resolve(req?.result);
    };
    t.onerror = () => {
      db.close();
      reject(t.error);
    };
  });
}

export const saveVideo = (id, file) => tx('readwrite', (s) => s.put(file, id)).catch(() => null);
export const loadVideo = (id) => tx('readonly', (s) => s.get(id)).catch(() => null);
export const dropVideo = (id) => tx('readwrite', (s) => s.delete(id)).catch(() => null);
