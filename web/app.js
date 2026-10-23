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

async function addFiles(files) {
    if (!worker) return;
    const apps = [];
    for (const f of files) {
        if (f.name.length > 58) { log(`files: ${f.name}: name too long for CyOS (58 at most); not copied`); continue; }
        apps.push({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
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
}
$("card-add").onclick = () => $("card-file").click();
$("card-folder").onclick = () => $("card-dir").click();
async function addToCard(files) {
    const card = await store.get("card") || [];
    for (const f of files) {
        const path = (f.webkitRelativePath || f.name).replace(/^\/+/, "");
        const i = card.findIndex(c => c.path === path);
        const entry = { path, data: new Uint8Array(await f.arrayBuffer()) };
        if (i >= 0) card[i] = entry; else card.push(entry);
    }
    await store.set("card", card);
    log(`card: ${files.length} files added`);
    showCard();
    if (worker) restart();
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
