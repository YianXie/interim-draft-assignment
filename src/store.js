// What this browser remembers, in IndexedDB: one parsed upload, and one Snapshot per version. Browser only.
const BOTH = ["upload", "snapshots"];
let opened = null;

export function openStore() {
  opened ||= new Promise((resolve, reject) => {
    const req = indexedDB.open("interim-demo", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("upload");
      req.result.createObjectStore("snapshots", { keyPath: "version" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opened;
}

// Resolves when the whole transaction is on disk, not when a request inside it succeeds.
async function write(stores, work) {
  const db = await openStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, "readwrite", { durability: "strict" });
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
    work(tx);
  });
}

// Each upload carries a random id, saveId. A tab writes only while the stored upload is still the one it has, and never
// over a version already written, so a second tab's work is never overwritten: the write fails instead.
const mine = (tx, saveId, then) => {
  const req = tx.objectStore("upload").get("school");
  req.onsuccess = () => { if (req.result && req.result.saveId === saveId) then(); else tx.abort(); };
};
// A new upload starts a new history, so snapshots of an older one can never be read against it.
export const saveUpload = (school, saveId) => write(BOTH, (tx) => {
  tx.objectStore("snapshots").clear();
  tx.objectStore("upload").put({ ...school, saveId }, "school");
});
// The same upload with later forms added: the history goes on, so snapshots stay. next is the version this tab writes
// next; if another tab on the same upload already wrote it, the forms it added would no longer match, so nothing is written.
export const replaceUpload = (school, saveId, next) => write(BOTH, (tx) => mine(tx, saveId, () => {
  const taken = tx.objectStore("snapshots").count(next);
  taken.onsuccess = () => { if (taken.result) tx.abort(); else tx.objectStore("upload").put({ ...school, saveId }, "school"); };
}));
export const addSnapshot = (s, saveId) => write(BOTH, (tx) => mine(tx, saveId, () => tx.objectStore("snapshots").add(s)));
// Only this tab's own upload: a draft another tab built since is never wiped from here.
export const wipe = (saveId) => write(BOTH, (tx) => mine(tx, saveId, () => BOTH.forEach((name) => tx.objectStore(name).clear())));

// An upload with no snapshots never finished saving a draft, so it counts as nothing saved.
export async function loadAll() {
  const db = await openStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BOTH);
    const school = tx.objectStore("upload").get("school");
    const snapshots = tx.objectStore("snapshots").getAll();
    tx.oncomplete = () => {
      if (!school.result || !snapshots.result.length) return resolve(null);
      const { saveId, ...rest } = school.result;
      resolve({ school: rest, saveId, snapshots: snapshots.result });
    };
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
