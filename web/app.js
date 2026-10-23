/* The page: loads the dumps, starts the emulator worker (emu-worker.js),
 * draws its screen, plays its beeper and sends it keys and files. */
"use strict";

const $ = id => document.getElementById(id);
const K = (row, bit) => (row << 4) | bit;          /* CY_KEY in cybiko.h */
const KEY = {
    F7: K(0, 0), M: K(0, 8), K: K(0, 11), I: K(0, 12), O: K(0, 13), L: K(0, 14), RPAREN: K(0, 9), COMMA: K(0, 10),
    F6: K(1, 0), G: K(1, 1), B: K(1, 2), N: K(1, 3), H: K(1, 4), Y: K(1, 5), U: K(1, 6), J: K(1, 7),
    F5: K(2, 0), D: K(2, 8), C: K(2, 9), V: K(2, 11), F: K(2, 12), R: K(2, 13), T: K(2, 14), LPAREN: K(2, 10),
    F4: K(3, 0), Q: K(3, 1), A: K(3, 2), Z: K(3, 3), X: K(3, 4), S: K(3, 5), W: K(3, 6), E: K(3, 7),
    F3: K(4, 0), ENTER: K(4, 3), SELECT: K(4, 4), SPACE: K(4, 6), MENU: K(4, 5),
    F2: K(5, 0), TAB: K(5, 7), DEL: K(5, 8), INS: K(5, 9), ESC: K(5, 10),
    F1: K(6, 0), UP: K(6, 11), RIGHT: K(6, 12), DOWN: K(6, 13), LEFT: K(6, 14),
    FN: K(7, 15), SHIFT: K(8, 15),
    HELP: K(9, 0), DOT: K(9, 1), P: K(9, 4), EXCL: K(9, 2), SEMI: K(9, 3),
    ONOFF: K(15, 15),
};

/* ---- log ---- */

const logLines = [];
function log(line) {
    const t = new Date().toTimeString().slice(0, 8);
    logLines.push(`${t} ${line}`);
    if (logLines.length > 2000) logLines.splice(0, logLines.length - 2000);
    console.log(line);
    if ($("log-box").open) showLog();
}
function showLog() {
    const el = $("log");
    el.textContent = logLines.join("\n");
    el.scrollTop = el.scrollHeight;
}
$("log-box").addEventListener("toggle", showLog);

/* ---- settings ---- */

const DEFAULTS = { proxy: SITE.proxy, room: SITE.room, online: true, gate: true, home: "",
                   disk: 4, volume: 60, zoom: 0, cart: "auto" };
let settings = { ...DEFAULTS };

async function loadSettings() {
    try { settings = { ...DEFAULTS, ...(await store.get("settings") || {}) }; }
    catch (e) { log(`settings: could not read (${e}); using defaults`); }
    /* a local server (proxy/local.js) is its own proxy */
    if (!settings.proxy && /^(localhost|127\.|\[::1\])/.test(location.host)) settings.proxy = location.origin;
}

function fillSettings() {
    $("set-proxy").value = settings.proxy;
    $("set-room").value = settings.room;
    $("set-online").checked = settings.online;
    $("set-gate").checked = settings.gate;
    $("set-home").value = settings.home;
    $("set-disk").value = String(settings.disk);
    $("set-volume").value = String(settings.volume);
    $("set-zoom").value = String(settings.zoom);
    $("set-cart").value = settings.cart;
}

function readSettings() {
    return { proxy: $("set-proxy").value.trim(), room: $("set-room").value.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32) || "public",
             online: $("set-online").checked, gate: $("set-gate").checked, home: $("set-home").value.trim(),
             disk: +$("set-disk").value, volume: +$("set-volume").value, zoom: +$("set-zoom").value,
             cart: $("set-cart").value };
}

$("settings-btn").onclick = () => { fillSettings(); showCard(); $("settings").hidden = !$("settings").hidden; };
$("set-close").onclick = () => { $("settings").hidden = true; };
$("set-volume").oninput = () => { settings.volume = +$("set-volume").value; setVolume(); };
$("set-zoom").onchange = () => { settings.zoom = +$("set-zoom").value; fitScreen(); };
$("set-save").onclick = async () => {
    settings = readSettings();
    await store.set("settings", settings);
    $("settings").hidden = true;
    if (worker) restart();
};
$("set-files").onclick = () => worker && worker.postMessage({ t: "files" });
$("set-forget").onclick = async () => {
    if (!confirm("Forget the ROM, the flash, every Cybiko's files and the settings in this browser?")) return;
    if (worker) worker.terminate();
    worker = null;
    await new Promise(ok => { const r = indexedDB.deleteDatabase("cybiko-web"); r.onsuccess = r.onerror = r.onblocked = ok; });
    location.reload();
};

/* ---- screen ---- */

const canvas = $("screen");
const ctx = canvas.getContext("2d");
const image = ctx.createImageData(160, 100);
/* a grey-green LCD: lum 0 black, 255 the panel colour (as cybiko_sdl.c) */
const PAL = new Uint32Array(256);
for (let l = 0; l < 256; l++) {
    const r = 0x18 + (l * (0xc6 - 0x18) / 255 | 0), g = 0x1c + (l * (0xd0 - 0x1c) / 255 | 0),
          b = 0x18 + (l * (0xbc - 0x18) / 255 | 0);
    PAL[l] = 0xff000000 | b << 16 | g << 8 | r;
}
const pixels = new Uint32Array(image.data.buffer);
function draw(lum) {
    for (let i = 0; i < lum.length; i++) pixels[i] = PAL[lum[i]];
    ctx.putImageData(image, 0, 0);
}

/* integer zoom only */
function fitScreen() {
    const avail = Math.min($("screen-wrap").clientWidth || window.innerWidth, window.innerWidth - 16);
    let z = settings.zoom || Math.floor(avail / 160);
    z = Math.max(1, Math.min(z, 8));
    canvas.style.width = 160 * z + "px";
    canvas.style.height = 100 * z + "px";
}
window.addEventListener("resize", fitScreen);

/* ---- sound: the worker's samples (beeper and MP3 cartridge, mixed in C),
 * played as a queue of short buffers ---- */

let audio = null, gain = null, playAt = 0;
function audioOn() {
    if (audio) { if (audio.state === "suspended") audio.resume(); return; }
    try {
        audio = new AudioContext();
        gain = audio.createGain();
        gain.connect(audio.destination);
        setVolume();
    } catch (e) { log(`sound: not available (${e})`); }
}
function setVolume() { if (gain) gain.gain.value = settings.volume / 100; }
let late = 0;
function play(pcm, rate) {
    if (!audio || audio.state !== "running" || !pcm.length) return;
    const now = audio.currentTime;
    /* keep 60-250 ms queued: start again a little ahead after a gap, and
     * skip a buffer when the queue runs long (the two clocks drift) */
    if (playAt < now + 0.02) playAt = now + 0.06;
    if (playAt > now + 0.25) { if (!(late++ & 255)) log("sound: running ahead of the sound card, a bit skipped"); return; }
    const buf = audio.createBuffer(1, pcm.length, rate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = audio.createBufferSource();
    src.buffer = buf;
    src.connect(gain);
    src.start(playAt);
    playAt += pcm.length / rate;
}

/* ---- keys ---- */

let worker = null;
function key(k, down) {
    if (worker) worker.postMessage({ t: "key", k, down });
}

const PC_KEYS = {
    Enter: KEY.ENTER, NumpadEnter: KEY.ENTER, Escape: KEY.ESC, Space: KEY.SPACE,
    ArrowUp: KEY.UP, ArrowDown: KEY.DOWN, ArrowLeft: KEY.LEFT, ArrowRight: KEY.RIGHT,
    Tab: KEY.TAB, Backspace: KEY.DEL, Delete: KEY.DEL, ShiftLeft: KEY.SHIFT, ShiftRight: KEY.SHIFT,
    ControlLeft: KEY.FN, ControlRight: KEY.FN, Period: KEY.DOT, Comma: KEY.COMMA, Semicolon: KEY.SEMI,
    BracketLeft: KEY.LPAREN, BracketRight: KEY.RPAREN, Slash: KEY.EXCL,
    F1: KEY.F1, F2: KEY.F2, F3: KEY.F3, F4: KEY.F4, F5: KEY.F5, F6: KEY.F6, F7: KEY.F7,
    F8: KEY.SELECT, Home: KEY.SELECT, F9: KEY.HELP, F10: KEY.INS, Insert: KEY.INS,
    F11: KEY.MENU, ContextMenu: KEY.MENU, F12: KEY.ONOFF,
};
function pcKey(e) {
    if (!worker || !$("settings").hidden || e.target.tagName === "INPUT") return undefined;
    if (/^Key[A-Z]$/.test(e.code)) return KEY[e.code[3]];
    return PC_KEYS[e.code];
}
window.addEventListener("keydown", e => {
    const k = pcKey(e);
    if (k === undefined) return;
    e.preventDefault();
    audioOn();
    if (!e.repeat) key(k, true);
});
window.addEventListener("keyup", e => {
    const k = pcKey(e);
    if (k === undefined) return;
    e.preventDefault();
    key(k, false);
});

/* The on-screen keyboard, laid out like the board's (cybiko_ui.c). Shift
 * and Fn latch: tap them, then the key. */
const LAYOUT = [
    [["F1"], ["F2"], ["F3"], ["F4"], ["F5"], ["F6"], ["F7"], ["INS", "Ins"]],
    [["ESC", "Esc"], ["UP", "▲"], ["MENU", "Menu"], ["HELP", "Help"], ["ONOFF", "On/Off"]],
    [["LEFT", "◀"], ["SELECT", "Sel"], ["RIGHT", "▶"], ["TAB", "Tab"], ["DEL", "Del"]],
    [[null], ["DOWN", "▼"], [null], [null], [null]],
    "QWERTYUIOP".split("").map(c => [c]),
    [..."ASDFGHJKL".split("").map(c => [c]), ["SEMI", ";"]],
    [..."ZXCVBNM".split("").map(c => [c]), ["COMMA", ","], ["DOT", "."], ["EXCL", "!"]],
    [["SHIFT", "Shift"], ["LPAREN", "("], ["SPACE", "Space", 3], ["RPAREN", ")"], ["FN", "Fn"], ["ENTER", "Enter", 2]],
];
const latched = { SHIFT: false, FN: false };
function buildKeyboard() {
    const kb = $("keyboard");
    for (const row of LAYOUT) {
        const r = document.createElement("div");
        r.className = "kb-row";
        for (const [name, label, span] of row) {
            const b = document.createElement(name ? "button" : "span");
            b.className = name ? "key" : "key blank";
            b.style.flexGrow = span || 1;
            if (name) {
                b.type = "button";
                b.textContent = label || name;
                b.dataset.key = name;
                bindKey(b, name);
            }
            r.appendChild(b);
        }
        kb.appendChild(r);
    }
}
function bindKey(b, name) {
    const k = KEY[name];
    let mods = [], pressed = Promise.resolve();
    b.addEventListener("pointerdown", e => {
        e.preventDefault();
        audioOn();
        if (name === "SHIFT" || name === "FN") {
            latched[name] = !latched[name];
            b.classList.toggle("on", latched[name]);
            return;
        }
        b.setPointerCapture(e.pointerId);
        /* a latched modifier goes down first and the key 60 ms later, as on
         * the board, so CyOS sees Shift before the key */
        mods = ["SHIFT", "FN"].filter(m => latched[m]);
        mods.forEach(m => key(KEY[m], true));
        pressed = new Promise(ok => setTimeout(() => { key(k, true); ok(); }, mods.length ? 60 : 0));
    });
    const up = async e => {
        if (name === "SHIFT" || name === "FN") return;
        e.preventDefault();
        await pressed;
        key(k, false);
        if (!mods.length) return;
        const m = mods;
        mods = [];
        setTimeout(() => m.forEach(x => key(KEY[x], false)), 60);
        for (const x of m) {
            latched[x] = false;
            document.querySelector(`[data-key=${x}]`).classList.remove("on");
        }
    };
    b.addEventListener("pointerup", up);
    b.addEventListener("pointercancel", up);
}

/* ---- files ---- */

async function readFile(input) {
    const f = input.files[0];
    return f ? new Uint8Array(await f.arrayBuffer()) : null;
}

let pending = { rom: null, flash: null, boot: null };
function checkSetup() {
    $("rom-ok").textContent = pending.rom ? `${pending.rom.length} bytes` : "";
    $("flash-ok").textContent = pending.flash ? `${pending.flash.length} bytes` : "";
    $("boot-ok").textContent = pending.boot ? `${pending.boot.length} bytes` : "";
    const romOk = pending.rom && pending.rom.length === 0x8000, flashOk = pending.flash && pending.flash.length === 0x80000;
    if (pending.rom && !romOk) $("rom-ok").textContent += " (should be 32768: not a boot ROM?)";
    if (pending.flash && !flashOk) $("flash-ok").textContent += " (should be 524288: not a flash dump?)";
    $("start-btn").disabled = !(romOk && flashOk);
}
/* MAME's ROM set, as a zip: take the Xtreme's boot ROM and CyOS 1.5.08 out of it */
async function unzip(data) {
    const out = {}, u16 = o => data[o] | data[o + 1] << 8, u32 = o => (u16(o) | u16(o + 2) << 16) >>> 0;
    let end = data.length - 22;
    while (end >= 0 && u32(end) !== 0x06054b50) end--;
    if (end < 0) throw new Error("not a zip file");
    let p = u32(end + 16);
    for (let i = 0, n = u16(end + 10); i < n; i++) {
        const method = u16(p + 10), csize = u32(p + 20), nlen = u16(p + 28), xlen = u16(p + 30), clen = u16(p + 32);
        const name = new TextDecoder().decode(data.subarray(p + 46, p + 46 + nlen)).replace(/^.*\//, "").toLowerCase();
        const local = u32(p + 42), start = local + 30 + u16(local + 26) + u16(local + 28);
        const raw = data.subarray(start, start + csize);
        if (method === 0) out[name] = raw;
        else if (method === 8)
            out[name] = new Uint8Array(await new Response(new Blob([raw]).stream()
                .pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
        p += 46 + nlen + xlen + clen;
    }
    return out;
}
$("zip-file").onchange = async () => {
    const data = await readFile($("zip-file"));
    if (!data) return;
    try {
        const z = await unzip(data);
        const rom = z["cyrom150.bin"], flash = z["cyos_v1508.bin"];
        if (rom) pending.rom = rom;
        if (flash) pending.flash = flash;
        $("zip-ok").textContent = rom && flash ? "found cyrom150.bin and cyos_v1508.bin"
            : `no ${[rom ? "" : "cyrom150.bin", flash ? "" : "cyos_v1508.bin"].filter(Boolean).join(" or ")} in it (it has ${Object.keys(z).join(", ")})`;
    } catch (e) {
        $("zip-ok").textContent = `could not read it: ${e.message}`;
    }
    checkSetup();
};
/* ---- files from cybiko-roms (SITE.files): the dumps with one click, and
 * the CD software list ---- */

async function fetchFile(path) {
    const r = await fetch(SITE.files + path.split("/").map(encodeURIComponent).join("/"));
    if (!r.ok) throw new Error(`${path}: ${r.status} ${r.statusText}`);
    return new Uint8Array(await r.arrayBuffer());
}

$("quick-btn").onclick = async () => {
    const ru = $("quick-ru").checked;
    $("quick-btn").disabled = true;
    $("quick-ok").textContent = "fetching the firmware…";
    try {
        const [rom, flash, upd] = await Promise.all(["xtreme/cyrom150.bin", "xtreme/cyos_v1508.bin",
            ...(ru ? ["cyos-updates/ccyphRU1.5.08r.boot"] : [])].map(fetchFile));
        if (rom.length !== 0x8000 || flash.length !== 0x80000) throw new Error("the files are not the right size");
        await store.set("rom", rom);
        await store.set("flash", flash);
        if (upd) await store.set("boot", upd);
        log(`setup: boot ROM and CyOS 1.5.08 fetched from ${SITE.filesPage}${upd ? ", with the Russian CyOS update" : ""}`);
        $("quick-ok").textContent = "";
        $("setup").hidden = true;
        audioOn();
        boot();
    } catch (e) {
        log(`setup: could not fetch the firmware (${e.message})`);
        $("quick-ok").textContent = `Could not fetch it (${e.message}). Try again, or use your own files below.`;
        $("own-files").open = true;
    }
    $("quick-btn").disabled = false;
};

let onCybiko = new Set();              /* names on the RAM disk, lower case, from the last file list */
function showCatalog() {
    const box = $("catalog");
    box.textContent = "";
    CATALOG.forEach((c, i) => {
        if (c.group) {
            const h = document.createElement("h3");
            h.textContent = c.group;
            box.appendChild(h);
            return;
        }
        const has = (c.has || c.app[0].split("/").pop()).toLowerCase();
        const label = document.createElement("label");
        const box1 = document.createElement("input");
        box1.type = "checkbox";
        box1.dataset.i = i;
        box1.onchange = () => {
            const n = box.querySelectorAll("input:checked").length;
            $("install-btn").disabled = !n;
            $("install-btn").textContent = n > 1 ? `Install ${n}` : "Install";
        };
        const name = document.createElement("span");
        name.textContent = c.name;
        label.append(box1, name);
        if (c.what) { const w = document.createElement("span"); w.className = "what"; w.textContent = c.what; label.append(w); }
        if (onCybiko.has(has)) { const w = document.createElement("span"); w.className = "have"; w.textContent = "on the Cybiko"; label.append(w); }
        box.appendChild(label);
    });
}
$("software").addEventListener("toggle", () => { if ($("software").open) showCatalog(); });

$("install-btn").onclick = async () => {
    const picked = Array.from($("catalog").querySelectorAll("input:checked")).map(b => CATALOG[+b.dataset.i]);
    if (!picked.length || !worker) return;
    $("install-btn").disabled = true;
    const files = [];
    try {
        let done = 0;
        for (const c of picked) {
            $("install-ok").textContent = `fetching ${c.name} (${++done} of ${picked.length})…`;
            for (const path of c.app) files.push({ name: path.split("/").pop(), data: await fetchFile(path) });
        }
    } catch (e) {
        log(`files: could not fetch (${e.message}); nothing installed`);
        $("install-ok").textContent = `Could not fetch it (${e.message}). Nothing was installed; try again.`;
        $("install-btn").disabled = false;
        return;
    }
    if (picked.some(c => c.cart) && settings.cart !== "on") {
        settings.cart = "on";                /* plugged in even with nothing on the card yet */
        fillSettings();
        await store.set("settings", settings);
        log("settings: MP3 cartridge plugged in");
    }
    log(`files: installing ${picked.map(c => c.name).join(", ")} from ${SITE.filesPage}`);
    $("install-ok").textContent = "";
    for (const b of $("catalog").querySelectorAll("input:checked")) b.checked = false;
    $("install-btn").textContent = "Install";
    addFiles(files);
};

$("rom-file").onchange = async () => { pending.rom = await readFile($("rom-file")); checkSetup(); };
$("flash-file").onchange = async () => { pending.flash = await readFile($("flash-file")); checkSetup(); };
$("boot-file").onchange = async () => { pending.boot = await readFile($("boot-file")); checkSetup(); };
$("start-btn").onclick = async () => {
    await store.set("rom", pending.rom);
    await store.set("flash", pending.flash);
    if (pending.boot) await store.set("boot", pending.boot);
    $("setup").hidden = true;
    audioOn();
    boot();
};

/* .app and other files dropped on the page go onto the RAM disk on a
 * restart (CyOS reads its disk at power-on, like the board copies apps/). */
let dragDepth = 0;
window.addEventListener("dragenter", e => { e.preventDefault(); if (worker && !dragDepth++) $("drop").hidden = false; });
window.addEventListener("dragleave", e => { e.preventDefault(); if (!--dragDepth) $("drop").hidden = true; });
window.addEventListener("dragover", e => e.preventDefault());
window.addEventListener("drop", e => {
    e.preventDefault();
    dragDepth = 0;
    $("drop").hidden = true;
    addFiles(Array.from(e.dataTransfer.files));   /* taken now: the list is gone after the event */
});
/* the same through a file picker (phones have no drag and drop) */
$("add-btn").onclick = () => $("add-file").click();
$("add-file").onchange = () => { const list = Array.from($("add-file").files); $("add-file").value = ""; addFiles(list); };

/* An EZ Loader pack (.cap, .csu: the CD's installers, such as the MP3
 * cartridge software) holds the files to put on the Cybiko: unpack it, as
 * EZ Loader did. Its scripts ran on the PC and are left out. */
function isPack(data) {
    return data.length > 0x1b && data[0] === 0x43 && data[1] === 0x41 && data[2] === 0x50;   /* "CAP" */
}
function unpack(name, data) {
    const out = [];
    try {
        for (const e of Cybiko.cap.parsePack(data)) {
            if (e.type === 2) out.push({ name: Cybiko.cap.safeName(e.name), data: Cybiko.cap.decodeFile(e) });
            else log(`files: ${name}: ${Cybiko.cap.TYPE_NAMES[e.type] || "entry"} ${e.name} is for EZ Loader on the PC; not copied`);
        }
        log(`files: ${name} unpacked: ${out.map(f => f.name).join(", ")}`);
        const sdflash = out.find(f => f.name.toLowerCase() === "sdflash.dl");
        const inf = sdflash && Cybiko.cap.cyEntries(sdflash.data).find(e => e.name === "root.inf" && e.data);
        if (inf && /^21\.1\.3\r?$/m.test(Cybiko.util.latin1(inf.data)))
            log(`files: ${name} has the older MP3 cartridge software (sdflash.dl 21.1.3, the MP3.cap on the Xtreme Installation CD): ` +
                "it stops after reading the card's size and the card never shows up. MP3.cap from the MP3 cartridge's CD (21.1.4) works.");
    } catch (e) {
        log(`files: ${name} could not be unpacked (${e.message}); not copied`);
    }
    return out;
}

async function addFiles(files) {
    if (!worker) return;
    const apps = [];
    for (const f of files) {
        const data = f.data || new Uint8Array(await f.arrayBuffer());
        for (const a of isPack(data) ? unpack(f.name, data) : [{ name: f.name, data }]) {
            if (a.name.length > 58) { log(`files: ${a.name}: name too long for CyOS (58 at most); not copied`); continue; }
            apps.push(a);
        }
    }
    if (apps.length) restart(apps);
}

/* ---- backup: the RAM disk as ramdisk.bin (the board's and the desktop
 * app's format), and single files ---- */

function download(name, data) {
    const url = URL.createObjectURL(new Blob([data], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}
$("backup-btn").onclick = () => worker && worker.postMessage({ t: "getdisk" });
$("restore-btn").onclick = () => $("restore-file").click();
$("restore-file").onchange = async () => {
    const f = $("restore-file").files[0];
    $("restore-file").value = "";
    if (!f) return;
    const data = new Uint8Array(await f.arrayBuffer());
    if (data.length < 0x80000 || data.length > 0x600000 || data.length % 0x10000) {
        alert(`${f.name} is not a RAM disk image (512 KB to 6 MB, in 64 KB steps).`);
        return;
    }
    if (!confirm(`Replace everything on Cybiko ${slot} with ${f.name}?`)) return;
    const w = worker;
    worker = null;
    if (w) w.terminate();                      /* no last save: the disk is replaced */
    await store.set(slotKey("disk"), data);
    log(`files: Cybiko ${slot}'s disk restored from ${f.name}`);
    boot();
};

/* ---- the MP3 cartridge's card: files kept in this browser, shared by all
 * tabs; the cartridge reads them as a FAT card (writes last until a restart) */

async function showCard() {
    const card = await store.get("card") || [];
    const total = card.reduce((n, f) => n + f.data.length, 0);
    $("card-info").textContent = card.length ? `${card.length} files, ${(total / 1048576).toFixed(1)} MB` : "empty";
    const ul = $("card-list");
    ul.textContent = "";
    for (const f of card) {
        const li = document.createElement("li");
        li.textContent = `${f.path} (${f.data.length} bytes)`;
        ul.appendChild(li);
    }
}

/* Cybiko software put on the card by an older version of this page (or by
 * hand) does nothing there: it has to be on the Cybiko's disk. */
const isSoftware = (name, data) => isPack(data) || /\.dl$/i.test(name) || /^mp3player\.app$/i.test(name);
async function softwareOffCard() {
    const card = await store.get("card") || [];
    const soft = card.filter(f => isSoftware(f.path.split("/").pop(), f.data));
    if (!soft.length) return [];
    await store.set("card", card.filter(f => !soft.includes(f)));
    log(`card: ${soft.map(f => f.path).join(", ")} is Cybiko software, not for the card; moved onto the Cybiko`);
    const apps = [];
    for (const f of soft) {
        const name = f.path.split("/").pop();
        apps.push(...(isPack(f.data) ? unpack(name, f.data) : [{ name, data: f.data }]));
    }
    return apps;
}

/* The cartridge without its software: CyOS does nothing with it. Say so
 * where it is seen, with the way to fix it. */
async function checkCartSoftware() {
    const card = await store.get("card") || [];
    const cartIn = settings.cart === "on" || (settings.cart !== "off" && card.length);
    if (!cartIn || onCybiko.has("mp3player.app")) return;
    $("notice").textContent = "";
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "Install the MP3 player";
    b.onclick = () => {
        $("notice").hidden = true;
        $("software").open = true;
        showCatalog();
        const box = Array.from($("catalog").querySelectorAll("label")).find(l => /MP3 player/.test(l.textContent));
        if (box) { box.querySelector("input").checked = true; box.querySelector("input").onchange(); }
        $("software").scrollIntoView({ behavior: "smooth" });
    };
    $("notice").append("The MP3 cartridge is in, but its software is not on the Cybiko, so CyOS ignores the card. ", b);
    $("notice").hidden = false;
}
$("card-add").onclick = () => $("card-file").click();
$("card-folder").onclick = () => $("card-dir").click();
async function addToCard(files) {
    const card = await store.get("card") || [];
    const packs = [];
    let added = 0;
    for (const f of files) {
        const path = (f.webkitRelativePath || f.name).replace(/^\/+/, "");
        const data = new Uint8Array(await f.arrayBuffer());
        if (isSoftware(f.name, data)) {
            /* the cartridge's software runs from the Cybiko's disk, not the card */
            log(`card: ${path} is Cybiko software; putting it on the Cybiko instead`);
            packs.push({ name: f.name, data });
            continue;
        }
        const i = card.findIndex(c => c.path === path);
        if (i >= 0) card[i] = { path, data }; else card.push({ path, data });
        added++;
    }
    await store.set("card", card);
    if (added) log(`card: ${added} files added`);
    showCard();
    if (packs.length && worker) addFiles(packs);
    else if (worker) restart();
}
$("card-file").onchange = () => { const l = Array.from($("card-file").files); $("card-file").value = ""; addToCard(l); };
$("card-dir").onchange = () => { const l = Array.from($("card-dir").files); $("card-dir").value = ""; addToCard(l); };
$("card-clear").onclick = async () => {
    if (!confirm("Take every file off the MP3 card?")) return;
    await store.del("card");
    showCard();
    if (worker) restart();
};

/* ---- the worker ---- */

/* Every open tab is a Cybiko of its own: the first takes slot 1, a second
 * tab slot 2 and so on, each with its own RAM disk and Cybiko ID (CyOS
 * ignores packets from its own ID, so two tabs as one Cybiko could not chat).
 * The ROM and the flash dump are shared. */
let slot = 0;
function claimSlot() {
    if (!navigator.locks) { log("this browser has no Web Locks: every tab is Cybiko 1"); return Promise.resolve(1); }
    return new Promise(found => {
        const tryN = n => navigator.locks.request(`cybiko-slot-${n}`, { ifAvailable: true }, lock => {
            if (!lock) { tryN(n + 1); return undefined; }
            found(n);
            return new Promise(() => {});             /* held while the tab is open */
        });
        tryN(1);
    });
}
const slotKey = k => slot > 1 ? `${k}#${slot}` : k;

let id24 = 0;
async function boot(apps) {
    if (!slot) slot = await claimSlot();
    const [rom, base, flash, disk, boot] = await Promise.all(
        ["rom", "flash", slotKey("flash"), slotKey("disk"), "boot"].map(k => store.get(k)));
    if (!rom || !base) { $("setup").hidden = false; $("machine").hidden = true; return; }
    id24 = await store.get(slotKey("id24"));
    if (!id24) {
        id24 = 1 + Math.floor(Math.random() * 0xfffffe);
        await store.set(slotKey("id24"), id24);
    }
    $("machine").hidden = false;
    fitScreen();
    putDone = [];
    apps = [...(apps || []), ...await softwareOffCard()];
    worker = new Worker("emu-worker.js");
    worker.onmessage = onWorker;
    worker.onerror = e => log(`worker error: ${e.message}`);
    const card = await store.get("card") || [];
    worker.postMessage({ t: "start", rom, flash: flash || base, disk: disk || null, apps: apps || [], card,
                         boot: slot === 1 && boot ? boot : null, slot,
                         diskSize: settings.disk << 20, id24, settings });
}

/* Saves, then powers the Cybiko off and on again (with new files). */
let noticeTimer = 0;
function notice(text, ms = 8000) {
    $("notice").textContent = text;
    $("notice").hidden = false;
    clearTimeout(noticeTimer);
    if (ms) noticeTimer = setTimeout(() => { $("notice").hidden = true; }, ms);
}

function restart(apps) {
    const w = worker;
    worker = null;
    $("status").textContent = "restarting";
    if (apps && apps.length)
        notice(`Copying ${apps.map(a => a.name).join(", ")} to the Cybiko: it restarts to see them (CyOS reads its disk at power-on).`, 0);
    const go = () => { w.terminate(); boot(apps); };
    const timer = setTimeout(() => { log("restart: the worker did not answer; restarting without the last save"); go(); }, 3000);
    w.onmessage = e => {
        if (e.data.t === "saved") { clearTimeout(timer); go(); } else onWorker(e);
    };
    w.postMessage({ t: "save" });
}

let putDone = [];
function onWorker(e) {
    const m = e.data;
    switch (m.t) {
    case "frame": draw(m.lum); break;
    case "log": log(m.line); break;
    case "audio": play(m.pcm, m.rate); break;
    case "file": download(m.name, m.data); break;
    case "disk": download(slot > 1 ? `ramdisk-${slot}.bin` : "ramdisk.bin", m.data); break;
    case "started": log("started"); break;
    case "put":
        log(`files: ${m.name} ${m.ok ? "is on the Cybiko" : "not copied: " + m.why}`);
        putDone.push(m.ok ? m.name : `${m.name} (not copied: ${m.why})`);
        notice(`On the Cybiko: ${putDone.join(", ")}. Apps appear at the end of the Main desktop once CyOS has started.`, 20000);
        break;
    case "files": {
        onCybiko = new Set(m.list.map(f => f.name.toLowerCase()));
        if ($("software").open) showCatalog();
        checkCartSoftware();
        const ul = $("file-list");
        ul.textContent = "";
        for (const f of m.list) {
            const li = document.createElement("li");
            const a = document.createElement("a");
            a.href = "#";
            a.textContent = f.name;
            a.title = "Download";
            a.onclick = e => { e.preventDefault(); worker && worker.postMessage({ t: "getfile", name: f.name }); };
            li.append(a, ` (${f.size} bytes)`);
            ul.appendChild(li);
        }
        const li = document.createElement("li");
        li.textContent = `${Math.round(m.free / 1024)} KB free`;
        ul.appendChild(li);
        break;
    }
    case "status": {
        const r = m.radio;
        $("status").textContent = `Cybiko ${slot} · ID ${m.id} · room ${settings.room} · relay ${m.relay} · radio ${r.sent} out, ${r.heard} in · ${m.speed}%`;
        break;
    }
    case "saved": break;
    default: log(`page: unknown message from the worker: ${m.t}`);
    }
}

window.addEventListener("pagehide", () => worker && worker.postMessage({ t: "save" }));

(async () => {
    buildKeyboard();
    await loadSettings();
    boot();
})();
