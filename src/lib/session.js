// A recovery copy of the work in progress, kept in this browser (IndexedDB) so an accidentally
// closed tab can be picked up again. Nothing is sent anywhere. IndexedDB stores objects with the
// structured-clone algorithm, which keeps shared references shared: the undo history is many
// arrays that mostly point at the same block objects, and it is saved that way (not copied many
// times over), then comes back with the sharing intact.

const DB_NAME = 'to-markdown';
const STORE = 'session';

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const out = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
    });
  } finally {
    db.close();
  }
}

export const saveSession = (state) => run('readwrite', (s) => s.put(state, 'state'));

// The original PDF is kept separately: it is large and only written once per file. Null removes it.
export const savePdf = (bytes) => run('readwrite', (s) => (bytes ? s.put(bytes, 'pdf') : s.delete('pdf')));

export async function loadSession() {
  const [state, pdfBytes] = await Promise.all([
    run('readonly', (s) => s.get('state')),
    run('readonly', (s) => s.get('pdf')),
  ]);
  return state ? { state, pdfBytes: pdfBytes || null } : null;
}

export const clearSession = () => run('readwrite', (s) => { s.delete('state'); s.delete('pdf'); });
