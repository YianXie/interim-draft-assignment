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

// A new upload starts a new history, so snapshots of an older one can never be read against it.
export const saveUpload = (school) => write(BOTH, (tx) => {
  tx.objectStore("snapshots").clear();
  tx.objectStore("upload").put(school, "school");
});
export const addSnapshot = (s) => write(["snapshots"], (tx) => tx.objectStore("snapshots").put(s));
export const wipe = () => write(BOTH, (tx) => BOTH.forEach((name) => tx.objectStore(name).clear()));

// An upload with no snapshots never finished saving a draft, so it counts as nothing saved.
export async function loadAll() {
  const db = await openStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BOTH);
    const school = tx.objectStore("upload").get("school");
    const snapshots = tx.objectStore("snapshots").getAll();
    tx.oncomplete = () => resolve(school.result && snapshots.result.length ? { school: school.result, snapshots: snapshots.result } : null);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
