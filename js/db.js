// IndexedDB storage. Keep all data local. No backend.
// Stores: folders, projects, images (photo blobs), meta (settings).

const DB_NAME = 'dalmierz';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('projects')) {
        const s = db.createObjectStore('projects', { keyPath: 'id' });
        s.createIndex('folderId', 'folderId');
      }
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    let result;
    Promise.resolve(fn(t)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
  });
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export async function getAll(store) {
  const db = await open();
  return wrap(db.transaction(store).objectStore(store).getAll());
}

export async function get(store, id) {
  const db = await open();
  return wrap(db.transaction(store).objectStore(store).get(id));
}

export function put(store, value) {
  return tx(store, 'readwrite', (t) => { t.objectStore(store).put(value); });
}

export function del(store, id) {
  return tx(store, 'readwrite', (t) => { t.objectStore(store).delete(id); });
}

export async function projectsInFolder(folderId) {
  const db = await open();
  const idx = db.transaction('projects').objectStore('projects').index('folderId');
  const list = await wrap(idx.getAll(folderId));
  return list.sort((a, b) => b.updatedAt - a.updatedAt);
}

// Delete a project and its photo.
export async function deleteProject(p) {
  await tx(['projects', 'images'], 'readwrite', (t) => {
    t.objectStore('projects').delete(p.id);
    if (p.imageId) t.objectStore('images').delete(p.imageId);
  });
}

// Delete a folder with all its projects and photos.
export async function deleteFolder(folderId) {
  const projects = await projectsInFolder(folderId);
  await tx(['folders', 'projects', 'images'], 'readwrite', (t) => {
    t.objectStore('folders').delete(folderId);
    for (const p of projects) {
      t.objectStore('projects').delete(p.id);
      if (p.imageId) t.objectStore('images').delete(p.imageId);
    }
  });
}

export async function getSetting(key, fallback) {
  const r = await get('meta', key);
  return r ? r.value : fallback;
}

export function setSetting(key, value) {
  return put('meta', { key, value });
}

// Ask the browser to keep data. Safari can remove script storage after 7 days without use.
export async function requestPersist() {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* not supported */ }
  return false;
}

export async function storageInfo() {
  try {
    const e = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    return { usage: e.usage || 0, quota: e.quota || 0, persisted };
  } catch {
    return null;
  }
}
