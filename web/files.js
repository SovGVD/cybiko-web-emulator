/* The file manager: one window for each place the Cybiko keeps files, with
 * upload, download and delete of single files and a zip backup and restore
 * of the whole place:
 *
 *   Xtreme   internal memory (the RAM disk), the MP3 cartridge's card
 *   Classic  internal memory (the DataFlash, CyOS's own files too), the
 *            memory card's flash, the MP3 player's card
 *
 * CyOS reads its disks only at power-on and writes them while it runs, so
 * the Cybiko is saved and stopped while the window is open, and started
 * again when it closes. The disks are edited in their saved images
 * (cyfs.js), the cards in their file lists, all in this browser. */
"use strict";

/* A place to keep files: { name, note, folders, load(), files(), read(path),
 * write(path, data) -> "" or why not, del(path), save(), info() } */
function imageStorage(name, note, keys, open, empty) {
    let img = null;
    return {
        name, note, folders: false, wipeable: !!empty,
        async load() {
            let data = null;
            for (const k of keys()) if (!data) data = await store.get(k);
            img = open(data);
        },
        files: () => img.list().map(f => ({ path: f.name, size: f.size, date: f.date })),
        read: path => img.read(path),
        write: (path, data) => img.write(path, data),
        del: path => img.delete(path),
        wipe() { img = open(null, true); },
        save: () => store.set(keys()[0], img.d),
        info: () => `${Math.round(img.free() / 1024)} KB free`,
    };
}

function cardStorage(name, note) {
    let card = [];
    return {
        name, note, folders: true, wipeable: true,
        async load() { card = await store.get(pk("card")) || []; },
        files: () => card.map(f => ({ path: f.path, size: f.data.length, date: null })),
        read: path => (card.find(f => f.path === path) || {}).data || null,
        write(path, data) {
            path = path.replace(/^\/+/, "");
            if (!path || path.split("/").some(s => s === "" || s === "." || s === "..")) return "bad name";
            const i = card.findIndex(f => f.path === path);
            if (i >= 0) card[i] = { path, data }; else card.push({ path, data });
            return "";
        },
        del(path) { const n = card.length; card = card.filter(f => f.path !== path); return card.length < n; },
        wipe() { card = []; },
        save: () => store.set(pk("card"), card),
        info() {
            const total = card.reduce((n, f) => n + f.data.length, 0);
            return card.length ? `${(total / 1048576).toFixed(1)} MB in ${card.length} files` : "empty";
        },
    };
}

function storages() {
    if (classic) return {
        internal: imageStorage("Internal memory (flash)",
            "CyOS 1.2 keeps everything in the Classic's 1 MB DataFlash: its own files (*.boot, System.a, .dl " +
            "libraries, the built-in apps) and yours. Deleting CyOS's files can stop it from starting; " +
            "Settings → Download backup keeps the whole flash.",
            () => [slotKey("flash"), pk("flash")],          /* a new tab starts from the dump */
            data => new CyFS.Image(CyFS.classicFlash(data), true), null),
        mcard: imageStorage("Memory card (flash)",
            "The Cybiko 1Mb Memory Card's flash (the File Manager's Card Flash). CyOS 1.2.57 uses it, and the " +
            "Classic sees it while Settings → Slot has the memory card.",
            () => [slotKey("mcard")],
            (data, fresh) => new CyFS.Image(data && !fresh && data.length === CyFS.AT45_SIZE ? data : CyFS.emptyCard(), true), true),
        card: cardStorage("MP3 player's card",
            "The MP3 player's SmartMedia card: MP3s, read-only for the player. Shared by every tab."),
    };
    return {
        internal: imageStorage("Internal memory (RAM disk)",
            "The Xtreme's RAM disk, where CyOS keeps apps and files added to it (CyOS itself is in the flash).",
            () => [slotKey("disk")],
            (data, fresh) => new CyFS.Image(data && !fresh ? data : new Uint8Array(Math.max(data ? data.length : 0, settings.disk << 20)), false), true),
        card: cardStorage("MP3 cartridge's card",
            "The MP3 cartridge's card: MP3s, MXD clips and folders, as on the real card. Shared by every tab."),
    };
}

const fm = { stores: null, cur: null, changed: false, busy: false };

async function fmOpen() {
    if (fm.busy || $("fm").open) return;
    if (suBusy && !confirm("Files are being copied, or CyOS installed, right now. Stop that and open the files?")) return;
    fm.busy = true;
    $("status").textContent = "stopped: editing files";
    await stopWorker();                      /* saves first */
    log("files: the Cybiko is stopped while its files are edited");
    fm.stores = storages();
    fm.changed = false;
    const sel = $("fm-store");
    sel.textContent = "";
    for (const [k, s] of Object.entries(fm.stores)) sel.add(new Option(s.name, k));
    if (fm.last && fm.stores[fm.last]) sel.value = fm.last;
    $("fm").showModal();
    fm.busy = false;
    await fmShow();
}

async function fmShow() {
    const k = $("fm-store").value;
    fm.last = k;
    fm.cur = fm.stores[k];
    $("fm-note").textContent = fm.cur.note;
    $("fm-dir").hidden = !fm.cur.folders;
    $("fm-wipe").disabled = !fm.cur.wipeable;
    $("fm-wipe").checked = false;
    $("fm-wipe-label").title = fm.cur.wipeable ? "Delete every file here before the zip's go in"
        : "Not for the Classic's internal memory: CyOS lives there (Settings → Restore backup replaces the whole flash)";
    try { await fm.cur.load(); }
    catch (e) { log(`files: ${fm.cur.name} could not be read: ${e.message}`); $("fm-info").textContent = `could not be read: ${e.message}`; return; }
    fmList();
}

function fmList() {
    const tb = $("fm-list");
    tb.textContent = "";
    const files = fm.cur.files().sort((a, b) => a.path.localeCompare(b.path));
    $("fm-info").textContent = fm.cur.info();
    if (!files.length) {
        const tr = tb.insertRow(), td = tr.insertCell();
        td.colSpan = 4;
        td.className = "empty";
        td.textContent = "No files.";
    }
    for (const f of files) {
        const tr = tb.insertRow();
        tr.insertCell().textContent = f.path;
        const size = tr.insertCell();
        size.className = "num";
        size.textContent = f.size < 10240 ? `${f.size} B` : `${Math.round(f.size / 1024)} KB`;
        tr.insertCell().textContent = f.date ? f.date.toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "";
        const act = tr.insertCell();
        act.className = "act";
        const get = document.createElement("button");
        get.type = "button";
        get.className = "small";
        get.textContent = "Download";
        get.onclick = () => {
            const data = fm.cur.read(f.path);
            if (!data) { log(`files: ${f.path} could not be read from ${fm.cur.name}`); return; }
            download(f.path.split("/").pop(), data);
        };
        const del = document.createElement("button");
        del.type = "button";
        del.className = "small danger";
        del.textContent = "Delete";
        del.onclick = async () => {
            if (!confirm(`Delete ${f.path} from ${fm.cur.name}?`)) return;
            if (!fm.cur.del(f.path)) { log(`files: ${f.path} was not in ${fm.cur.name}`); return; }
            log(`files: ${f.path} deleted from ${fm.cur.name}`);
            await fmSave();
        };
        act.append(get, del);
    }
}

async function fmSave() {
    fm.changed = true;
    try { await fm.cur.save(); }
    catch (e) { log(`files: ${fm.cur.name} not saved: ${e.message}`); alert(`${fm.cur.name} could not be saved: ${e.message}`); }
    fmList();
}

/* Files into the open place: [{ path, data }]. Installers (.cap, .csu) are
 * unpacked for the internal memories; the Xtreme cartridge's software goes
 * to the internal memory, where it runs. Returns how many went in. */
async function fmPut(list, what) {
    const problems = [];
    let n = 0;
    const internal = fm.cur === fm.stores.internal;
    let moved = [];
    for (const f of list) {
        let items = [f];
        const base = f.path.split("/").pop();
        if (internal && isPack(f.data)) items = unpack(base, f.data).map(a => ({ path: a.name, data: a.data }));
        else if (!classic && fm.cur === fm.stores.card && isSoftware(base, f.data)) { moved.push(f); continue; }
        for (const it of items) {
            let path = it.path;
            if (!fm.cur.folders && path.includes("/")) {
                path = path.split("/").pop();
                log(`files: ${it.path}: CyOS has no folders here; stored as ${path}`);
            }
            const why = fm.cur.write(path, it.data);
            if (why) problems.push(`${path}: ${why}`);
            else n++;
        }
    }
    if (moved.length) {
        const internalStore = fm.stores.internal;
        await internalStore.load();
        for (const f of moved) {
            const base = f.path.split("/").pop();
            for (const a of isPack(f.data) ? unpack(base, f.data) : [{ name: base, data: f.data }]) {
                const why = internalStore.write(a.name, a.data);
                if (why) problems.push(`${a.name}: ${why}`);
                else log(`files: ${a.name} is Cybiko software, not for the card; put on the internal memory`);
            }
        }
        try { await internalStore.save(); } catch (e) { problems.push(`internal memory not saved: ${e.message}`); }
        fm.changed = true;
    }
    for (const p of problems) log(`files: ${what}: ${p}`);
    log(`files: ${n} file(s) ${what} into ${fm.cur.name}${problems.length ? `, ${problems.length} not` : ""}`);
    await fmSave();
    if (problems.length) alert(`Not copied:\n${problems.join("\n")}`);
    return n;
}

async function fmUpload(input) {
    const list = [];
    for (const f of Array.from(input.files))
        list.push({ path: (f.webkitRelativePath || f.name).replace(/^\/+/, ""), data: new Uint8Array(await f.arrayBuffer()) });
    input.value = "";
    if (list.length) await fmPut(list, "uploaded");
}

async function fmBackup() {
    const files = [];
    for (const f of fm.cur.files()) {
        const data = fm.cur.read(f.path);
        if (data) files.push({ path: f.path, data, date: f.date });
        else log(`files: ${f.path} could not be read; left out of the zip`);
    }
    const z = await CyFS.zip(files);
    const name = `${MODELS[profile.model]} ${slot > 1 ? `${slot} ` : ""}${fm.cur.name.replace(/[^\w ]+/g, "")}`.trim().replace(/\s+/g, "-").toLowerCase();
    download(`${name}.zip`, z);
    log(`files: ${files.length} file(s) of ${fm.cur.name} saved as ${name}.zip`);
}

async function fmRestore(input) {
    const f = input.files[0];
    input.value = "";
    if (!f) return;
    let list;
    try { list = await CyFS.unzip(new Uint8Array(await f.arrayBuffer()), w => log(`files: ${f.name}: ${w}`)); }
    catch (e) { log(`files: ${f.name}: ${e.message}`); alert(`${f.name}: ${e.message}`); return; }
    const wipe = $("fm-wipe").checked && fm.cur.wipeable;
    if (!confirm(`${wipe ? `Delete everything in ${fm.cur.name} and put` : "Put"} the ${list.length} file(s) of ${f.name} ` +
                 `${wipe ? "there" : `into ${fm.cur.name} (files of the same name are replaced)`}?`)) return;
    if (wipe) { fm.cur.wipe(); log(`files: ${fm.cur.name} emptied for ${f.name}`); }
    await fmPut(list, `restored from ${f.name}`);
}

$("fm-store").onchange = fmShow;
$("fm-up").onclick = () => $("fm-file").click();
$("fm-dir").onclick = () => $("fm-folder").click();
$("fm-file").onchange = () => fmUpload($("fm-file"));
$("fm-folder").onchange = () => fmUpload($("fm-folder"));
$("fm-zip").onclick = fmBackup;
$("fm-unzip").onclick = () => $("fm-zipfile").click();
$("fm-zipfile").onchange = () => fmRestore($("fm-zipfile"));
$("fm-close").onclick = () => $("fm").close();
$("fm").addEventListener("close", () => {
    log(fm.changed ? "files: changes saved; starting the Cybiko to see them" : "files: starting the Cybiko again");
    if (fm.changed) showCard();
    if (!worker) boot();
});
for (const id of ["fm-btn", "set-fm"]) $(id).onclick = fmOpen;
