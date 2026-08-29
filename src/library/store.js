// Where saved sections and songs live in the browser.
//
// IndexedDB, with localStorage as the fallback, and the reason is size. A
// section is a few kilobytes of JSON — a couple of hundred notes, a drum
// pattern, some seeds — and a song with a dozen sections in it is a few hundred.
// That is nothing on its own, but a library is not one of them: a year of
// working on this is hundreds of sections and dozens of songs, which is tens of
// megabytes. localStorage is around five megabytes for the whole origin, shared
// with the app's own state, and every read and write of it blocks the page.
// IndexedDB is asynchronous and measured in hundreds of megabytes.
//
// So: IndexedDB where there is one, localStorage where there is not (an old
// browser, or a private window that refuses to open a database), and a plain
// in-memory shelf where there is neither, so the app runs and the export
// buttons still work even when nothing can be kept.
//
// Nothing here knows what a section is. It stores records; format.js decides
// what goes in them.

const DB_NAME = 'cut-up-library';
const DB_VERSION = 1;
export const STORES = { sections: 'sections', songs: 'songs' };

const LOCAL_PREFIX = 'cut-up:library:';

/** What actually ended up holding the library, for the line under the shelf. */
let backend = 'unknown';
export function storageKind() {
  return backend;
}

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('no indexeddb'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of Object.values(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: 'id' });
          store.createIndex('savedAt', 'savedAt');
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexeddb refused'));
    // Firefox in a private window resolves neither; do not hang the shelf on it.
    request.onblocked = () => reject(new Error('indexeddb blocked'));
  }).catch((error) => {
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

function idbRun(storeName, mode, run) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = run(tx.objectStore(storeName));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
    tx.onerror = () => reject(tx.error || new Error('transaction failed'));
    tx.oncomplete = () => resolve(request ? request.result : undefined);
  }));
}

// --- the fallbacks ----------------------------------------------------------

/** Whatever is in the tab's memory, for when there is nowhere at all to write. */
const memory = { sections: new Map(), songs: new Map() };

function localKey(storeName) {
  return `${LOCAL_PREFIX}${storeName}`;
}

function localRead(storeName) {
  try {
    const raw = localStorage.getItem(localKey(storeName));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function localWrite(storeName, records) {
  localStorage.setItem(localKey(storeName), JSON.stringify(records));
}

/**
 * Runs an operation against whichever shelf this browser actually has.
 *
 * The first call decides: IndexedDB if it opens, localStorage if it does not,
 * memory if that throws too. Everything after it goes to the same place, so a
 * library never ends up half in one and half in another.
 */
async function withStore(storeName, mode, { idb, local, mem }) {
  if (backend === 'localstorage') return local();
  if (backend === 'memory') return mem();
  try {
    const result = await idbRun(storeName, mode, idb);
    backend = 'indexeddb';
    return result;
  } catch {
    try {
      const result = local();
      backend = 'localstorage';
      return result;
    } catch {
      backend = 'memory';
      return mem();
    }
  }
}

// --- the shelf --------------------------------------------------------------

/** Newest first, which is the order a shelf is useful in. */
const byNewest = (a, b) => (b.savedAt || 0) - (a.savedAt || 0);

export async function list(storeName) {
  const records = await withStore(storeName, 'readonly', {
    idb: (store) => store.getAll(),
    local: () => localRead(storeName),
    mem: () => [...memory[storeName].values()],
  });
  return (records || []).sort(byNewest);
}

export async function put(storeName, record) {
  const entry = { ...record, savedAt: record.savedAt || Date.now() };
  await withStore(storeName, 'readwrite', {
    idb: (store) => store.put(entry),
    local: () => {
      const records = localRead(storeName).filter((r) => r.id !== entry.id);
      records.push(entry);
      localWrite(storeName, records);
    },
    mem: () => memory[storeName].set(entry.id, entry),
  });
  return entry;
}

export async function remove(storeName, id) {
  await withStore(storeName, 'readwrite', {
    idb: (store) => store.delete(id),
    local: () => localWrite(storeName, localRead(storeName).filter((r) => r.id !== id)),
    mem: () => memory[storeName].delete(id),
  });
}

export async function get(storeName, id) {
  const record = await withStore(storeName, 'readonly', {
    idb: (store) => store.get(id),
    local: () => localRead(storeName).find((r) => r.id === id),
    mem: () => memory[storeName].get(id),
  });
  return record || null;
}

export async function clear(storeName) {
  await withStore(storeName, 'readwrite', {
    idb: (store) => store.clear(),
    local: () => localWrite(storeName, []),
    mem: () => memory[storeName].clear(),
  });
}

/**
 * How much room the browser will admit to, where it will say.
 *
 * Only Chromium-family browsers answer this honestly and none of them promise
 * anything, so it is shown as "about" and never relied on.
 *
 * @returns {Promise<{usage: number, quota: number}|null>}
 */
export async function estimate() {
  try {
    const info = await navigator.storage?.estimate?.();
    if (!info || !Number.isFinite(info.quota)) return null;
    return { usage: info.usage || 0, quota: info.quota };
  } catch {
    return null;
  }
}
