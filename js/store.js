/* Archivio dati: IndexedDB del browser.
   Tutto passa da questo modulo: per pubblicare con un server/cloud basterà
   sostituire queste funzioni mantenendo la stessa interfaccia. */
(function (Q) {
  'use strict';
  const DB_NAME = 'quiz-lim';
  const DB_VER = 1;
  const STORES = ['quizzes', 'classes', 'sessions'];
  let dbp = null;

  function db() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const r = indexedDB.open(DB_NAME, DB_VER);
        r.onupgradeneeded = () => {
          for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' });
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    }
    return dbp;
  }

  function run(store, mode, fn) {
    return db().then((d) => new Promise((resolve, reject) => {
      const tx = d.transaction(store, mode);
      let result;
      const req = fn(tx.objectStore(store));
      if (req) req.onsuccess = () => { result = req.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
  }

  Q.store = {
    all: (store) => run(store, 'readonly', (s) => s.getAll()).then((x) => x || []),
    get: (store, id) => run(store, 'readonly', (s) => s.get(id)),
    put: (store, obj) => { obj.updatedAt = Date.now(); return run(store, 'readwrite', (s) => s.put(obj)); },
    del: (store, id) => run(store, 'readwrite', (s) => s.delete(id)),
    clear: (store) => run(store, 'readwrite', (s) => s.clear()),

    async exportAll() {
      const out = { app: 'quiz-lim', kind: 'backup', version: 1, exportedAt: Date.now() };
      for (const s of STORES) out[s] = await Q.store.all(s);
      return out;
    },
    async importAll(data, replace) {
      if (!data || data.app !== 'quiz-lim' || data.kind !== 'backup') throw new Error('File di backup non valido');
      for (const s of STORES) {
        if (replace) await Q.store.clear(s);
        for (const obj of data[s] || []) {
          if (s === 'sessions' && obj.status === 'live') obj.status = 'done';
          await run(s, 'readwrite', (st) => st.put(obj));
        }
      }
    },
    async persist() {
      try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) { /* ignora */ }
      return false;
    },
  };
})(window.Q);
