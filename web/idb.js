/* A tiny key-value store in IndexedDB, used by the page and the emulator
 * worker: the ROM, the flash, the RAM disk, the Cybiko ID and the settings
 * stay in this browser only. */
"use strict";
const store = (() => {
    let dbp = null;
    function db() {
        if (!dbp) dbp = new Promise((ok, fail) => {
            const r = indexedDB.open("cybiko-web", 1);
            r.onupgradeneeded = () => r.result.createObjectStore("files");
            r.onsuccess = () => ok(r.result);
            r.onerror = () => fail(r.error);
        });
        return dbp;
    }
    async function run(mode, fn) {
        const d = await db();
        return new Promise((ok, fail) => {
            const tx = d.transaction("files", mode);
            const req = fn(tx.objectStore("files"));
            tx.oncomplete = () => ok(req ? req.result : undefined);
            tx.onerror = () => fail(tx.error);
            tx.onabort = () => fail(tx.error);
        });
    }
    return {
        get: key => run("readonly", s => s.get(key)),
        set: (key, value) => run("readwrite", s => s.put(value, key)),
        del: key => run("readwrite", s => s.delete(key)),
    };
})();
