const DB_NAME = 'kaogong_db';
const DB_VERSION = 3;
let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      ['images', 'patterns', 'audios', 'audio_chunks', 'ocr_cache', 'backups', 'attachments'].forEach(name => {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
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
    const tx = db.transaction(store, 'readwrite');
    const r = tx.objectStore(store).put(value);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function dbGet(store, key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const r = tx.objectStore(store).get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

// ============ 图片内存缓存 ============
const imageCache = new Map();

export async function getImageCached(imageId) {
  if (imageCache.has(imageId)) return imageCache.get(imageId);
  const img = await dbGet('images', imageId);
  if (img) imageCache.set(imageId, img);
  return img;
}

export async function putImageCached(record) {
  await dbPut('images', record);
  imageCache.set(record.id, record);
}

export async function deleteImageCached(imageId) {
  await dbDelete('images', imageId);
  imageCache.delete(imageId);
}

export function clearImageCache() {
  imageCache.clear();
}

export async function dbDelete(store, key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    const r = tx.objectStore(store).delete(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function dbAll(store) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const r = tx.objectStore(store).getAll();
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function storageSelfCheck() {
  try {
    await dbPut('backups', { id: '__sc__', at: Date.now() });
    await dbDelete('backups', '__sc__');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e };
  }
}