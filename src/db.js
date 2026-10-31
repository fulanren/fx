const DB_NAME = ' fx_db';
const DB_VERSION = 2;
let dbPromise = null;
export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      ['images','patterns','audios','audio_chunks','ocr_cache','backups'].forEach(n => {
        if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, { keyPath: 'id' });
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
export async function dbPut(store, value) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction(store, 'readwrite').objectStore(store).put(value);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
export async function dbGet(store, key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction(store, 'readonly').objectStore(store).get(key);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
export async function dbDelete(store, key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction(store, 'readwrite').objectStore(store).delete(key);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
export async function storageSelfCheck() {
  try {
    await dbPut('backups', { id: '__sc__', at: Date.now() });
    await dbDelete('backups', '__sc__');
    return { ok: true };
  } catch (e) { return { ok: false, error: e }; }
}
export async function dbAll(storeName) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}