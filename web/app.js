/* The page: loads the dumps, starts the emulator worker (emu-worker.js),
 * draws its screen, plays its beeper and sends it keys and files. It runs
 * one device (profile) at a time, an Xtreme or a Classic. */
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
/* The Classic's keys (CYC_* in cybiko.h): its own matrix, with digit keys
 * (D0-D9) and no Menu */
const KEYC = {
    F7: K(0, 0), ESC: K(0, 1), DEL: K(0, 2), LEFT: K(0, 3), Q: K(0, 4), A: K(0, 5), GRAVE: K(0, 6), SHIFT: K(0, 7),
    F6: K(1, 0), UP: K(1, 1), INS: K(1, 2), D2: K(1, 3), W: K(1, 4), S: K(1, 5), Z: K(1, 6), FN: K(1, 7),
    F5: K(2, 0), F3: K(2, 1), SPACE: K(2, 2), D3: K(2, 3), E: K(2, 4), D: K(2, 5), X: K(2, 6), HELP: K(2, 7),
    F4: K(3, 0), D1: K(3, 1), TAB: K(3, 2), D4: K(3, 3), R: K(3, 4), F: K(3, 5), C: K(3, 6), LBRACKET: K(3, 7),
    RIGHT: K(4, 0), DOWN: K(4, 1), SELECT: K(4, 2), D5: K(4, 3), T: K(4, 4), G: K(4, 5), V: K(4, 6), RBRACKET: K(4, 7),
    F2: K(5, 0), SEMI: K(5, 1), ENTER: K(5, 2), D6: K(5, 3), Y: K(5, 4), H: K(5, 5), B: K(5, 6), BACKSLASH: K(5, 7),
    F1: K(6, 0), SLASH: K(6, 1), BKSP: K(6, 2), D7: K(6, 3), U: K(6, 4), J: K(6, 5), N: K(6, 6),
    MINUS: K(7, 0), DOT: K(7, 1), D0: K(7, 2), D8: K(7, 3), I: K(7, 4), K: K(7, 5), M: K(7, 6),
    QUOTE: K(8, 0), EQUALS: K(8, 1), D9: K(8, 2), P: K(8, 3), O: K(8, 4), L: K(8, 5), COMMA: K(8, 6),
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

/* ---- devices (profiles): each one is a Cybiko of its own, an Xtreme or a
 * Classic, with its own firmware, files, settings and IDs. The first keeps
 * the store's plain keys (as before there were devices), the others put
 * "pN:" in front. A tab runs the device in its address (?device=N), else
 * the one picked last. ---- */

const MODELS = { xtreme: "Cybiko Xtreme", classic: "Cybiko Classic" };
let profiles = { list: [{ id: 1, name: "My Xtreme", model: "xtreme" }], current: 1 };
let profile = profiles.list[0];
let classic = false;
const prefixOf = p => p.id === 1 ? "" : `p${p.id}:`;
const pk = k => prefixOf(profile) + k;
/* the store's keys of a device: pN:..., or for the first, all but the others' */
const keyOf = (p, k) => p.id === 1 ? !/^p\d+:/.test(k) && k !== "profiles" && k !== "mp3cap" : k.startsWith(prefixOf(p));

async function loadProfiles() {
    try {
        const p = await store.get("profiles");
        if (p && Array.isArray(p.list) && p.list.length) profiles = p;
    } catch (e) { log(`devices: could not read the list (${e}); using the first`); }
    const want = +new URLSearchParams(location.search).get("device");
    profile = profiles.list.find(p => p.id === want) || profiles.list.find(p => p.id === profiles.current) || profiles.list[0];
    if (want && profile.id !== want) log(`devices: there is no device ${want}; running ${profile.name}`);
    classic = profile.model === "classic";
    document.body.classList.toggle("classic", classic);
    document.title = `${MODELS[profile.model]} emulator`;
    for (const el of document.querySelectorAll(".model-name")) el.textContent = MODELS[profile.model];
    fillProfiles();
}

function fillProfiles() {
    const sel = $("dev-select");
    sel.textContent = "";
    for (const p of profiles.list) {
        const o = document.createElement("option");
        o.value = String(p.id);
        o.textContent = `${p.name} (${MODELS[p.model] || p.model})`;
        sel.appendChild(o);
    }
    sel.value = String(profile.id);
}

/* Saves this device (when it runs) and opens another in this tab. */
async function switchTo(id) {
    profiles.current = id;
    await store.set("profiles", profiles);
    await stopWorker();
    const u = new URL(location.href);
    u.searchParams.set("device", String(id));
    location.href = u.href;
}

$("dev-select").onchange = () => switchTo(+$("dev-select").value);
$("dev-new").onclick = () => {
    $("dev-form").hidden = !$("dev-form").hidden;
    $("dev-name").value = "";
    $("dev-model").value = "classic";
};
$("dev-cancel").onclick = () => { $("dev-form").hidden = true; };
$("dev-create").onclick = async () => {
    const model = $("dev-model").value;
    const id = Math.max(...profiles.list.map(p => p.id)) + 1;
    const name = $("dev-name").value.trim().slice(0, 40) ||
        `My ${model === "classic" ? "Classic" : "Xtreme"} ${profiles.list.filter(p => p.model === model).length + 1}`;
    profiles.list.push({ id, name, model });
    /* it starts with this device's settings; firmware, files and ID are its own */
    await store.set(`p${id}:settings`, settings);
    log(`devices: ${name} (${MODELS[model]}) made`);
    switchTo(id);
};
$("dev-rename").onclick = async () => {
    const name = (prompt("Name of this device", profile.name) || "").trim().slice(0, 40);
    if (!name) return;
    profile.name = name;
    await store.set("profiles", profiles);
    fillProfiles();
};
$("dev-delete").onclick = async () => {
    if (profiles.list.length < 2) { alert("This is the only device. To start over, use Settings \u2192 Forget everything."); return; }
    if (!confirm(`Delete ${profile.name}: its firmware, files, settings and IDs, in this browser?`)) return;
    const gone = profile;
    await stopWorker(true);
    const keys = (await store.keys()).filter(k => typeof k === "string" && keyOf(gone, k));
    for (const k of keys) await store.del(k);
    profiles.list = profiles.list.filter(p => p !== gone);
    log(`devices: ${gone.name} deleted (${keys.length} entries)`);
    switchTo(profiles.list[0].id);
};

/* ---- settings ---- */

const DEFAULTS = { proxy: SITE.proxy, room: SITE.room, online: true, gate: true, home: "",
                   disk: 4, volume: 60, zoom: 0, cart: "auto", cartSoft: true, vsync: true,
                   palette: "lcd" };
let settings = { ...DEFAULTS };

async function loadSettings() {
    try { settings = { ...DEFAULTS, ...(await store.get(pk("settings")) || {}) }; }
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
    $("set-cart-soft").checked = settings.cartSoft;
    $("set-vsync").checked = settings.vsync;
    $("set-palette").value = settings.palette;
}

function readSettings() {
    return { proxy: $("set-proxy").value.trim(), room: $("set-room").value.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32) || "public",
             online: $("set-online").checked, gate: $("set-gate").checked, home: $("set-home").value.trim(),
             disk: +$("set-disk").value, volume: +$("set-volume").value, zoom: +$("set-zoom").value,
             cart: $("set-cart").value, cartSoft: $("set-cart-soft").checked,
             vsync: $("set-vsync").checked, palette: $("set-palette").value };
}

$("settings-btn").onclick = () => { fillSettings(); showCard(); $("settings").hidden = !$("settings").hidden; };
$("set-close").onclick = () => { $("settings").hidden = true; };
$("set-volume").oninput = () => { settings.volume = +$("set-volume").value; setVolume(); };
$("set-zoom").onchange = () => { settings.zoom = +$("set-zoom").value; fitScreen(); };
$("set-palette").onchange = () => { settings.palette = $("set-palette").value; setPalette(); };
$("set-save").onclick = async () => {
    settings = readSettings();
    await store.set(pk("settings"), settings);
    $("settings").hidden = true;
    if (worker) restart();
};
$("set-files").onclick = () => worker && worker.postMessage({ t: "files" });
$("set-forget").onclick = async () => {
    if (!confirm("Forget every device: the ROMs, the flash, every Cybiko's files and the settings in this browser?")) return;
    if (worker) worker.terminate();
    worker = null;
    await new Promise(ok => { const r = indexedDB.deleteDatabase("cybiko-web"); r.onsuccess = r.onerror = r.onblocked = ok; });
    location.reload();
};

/* ---- screen ---- */

const canvas = $("screen");
const ctx = canvas.getContext("2d");
const image = ctx.createImageData(160, 100);
/* settings.palette "lcd": a grey-green LCD, lum 0 black, 255 the panel colour
   (as cybiko_sdl.c); "gray": plain greys, 0 black, 255 white */
const PAL = new Uint32Array(256);
const pixels = new Uint32Array(image.data.buffer);
let lastLum = null;
function setPalette() {
    const gray = settings.palette === "gray";
    for (let l = 0; l < 256; l++) {
        const r = gray ? l : 0x18 + (l * (0xc6 - 0x18) / 255 | 0), g = gray ? l : 0x1c + (l * (0xd0 - 0x1c) / 255 | 0),
              b = gray ? l : 0x18 + (l * (0xbc - 0x18) / 255 | 0);
        PAL[l] = 0xff000000 | b << 16 | g << 8 | r;
    }
    if (lastLum) draw(lastLum);
}
function draw(lum) {
    lastLum = lum;
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
/* the Classic's keyboard has a PC's punctuation and digits */
const PC_KEYS_CLASSIC = {
    Enter: KEYC.ENTER, NumpadEnter: KEYC.ENTER, Escape: KEYC.ESC, Space: KEYC.SPACE,
    ArrowUp: KEYC.UP, ArrowDown: KEYC.DOWN, ArrowLeft: KEYC.LEFT, ArrowRight: KEYC.RIGHT,
    Tab: KEYC.TAB, Backspace: KEYC.BKSP, Delete: KEYC.DEL, ShiftLeft: KEYC.SHIFT, ShiftRight: KEYC.SHIFT,
    ControlLeft: KEYC.FN, ControlRight: KEYC.FN, Period: KEYC.DOT, Comma: KEYC.COMMA, Semicolon: KEYC.SEMI,
    Quote: KEYC.QUOTE, BracketLeft: KEYC.LBRACKET, BracketRight: KEYC.RBRACKET, Backslash: KEYC.BACKSLASH,
    Slash: KEYC.SLASH, Minus: KEYC.MINUS, Equal: KEYC.EQUALS, Backquote: KEYC.GRAVE,
    F1: KEYC.F1, F2: KEYC.F2, F3: KEYC.F3, F4: KEYC.F4, F5: KEYC.F5, F6: KEYC.F6, F7: KEYC.F7,
    F8: KEYC.SELECT, Home: KEYC.SELECT, F9: KEYC.HELP, F10: KEYC.INS, Insert: KEYC.INS, F12: KEYC.ONOFF,
};
const keyTable = () => classic ? KEYC : KEY;
function pcKey(e) {
    if (!worker || !$("settings").hidden || e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return undefined;
    if (/^Key[A-Z]$/.test(e.code)) return keyTable()[e.code[3]];
    if (classic && /^(Digit|Numpad)\d$/.test(e.code)) return KEYC["D" + e.code.slice(-1)];
    return (classic ? PC_KEYS_CLASSIC : PC_KEYS)[e.code];
}
window.addEventListener("keydown", e => {
    const k = pcKey(e);
    if (k === undefined) return;
    e.preventDefault();
    audioOn();
    if (!e.repeat) key(k, true);
    pcMod(e.code, true);
});
window.addEventListener("keyup", e => {
    const k = pcKey(e);
    if (k === undefined) return;
    e.preventDefault();
    key(k, false);
    pcMod(e.code, false);
});
/* PC Shift and Ctrl (= Fn) held down switch the on-screen labels too */
const held = { SHIFT: false, FN: false };
function pcMod(code, down) {
    const m = /^Shift/.test(code) ? "SHIFT" : /^Control/.test(code) ? "FN" : null;
    if (!m) return;
    held[m] = down;
    relabel();
}
window.addEventListener("blur", () => { held.SHIFT = held.FN = false; relabel(); });

/* The on-screen keyboard, laid out like the board's (cybiko_ui.c). Shift
 * and Fn latch: tap them, then the key. While one is on (or the PC's
 * Shift or Ctrl is held), the keys show what they type, as on the board. */
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
/* The Classic's: the same keys around the screen, then its PC-like rows */
const LAYOUT_CLASSIC = [
    [["F1"], ["F2"], ["F3"], ["F4"], ["F5"], ["F6"], ["F7"], ["INS", "Ins"]],
    [["ESC", "Esc"], ["UP", "▲"], ["HELP", "Help"], ["DEL", "Del"], ["ONOFF", "On/Off"]],
    [["LEFT", "◀"], ["SELECT", "Sel"], ["RIGHT", "▶"], ["TAB", "Tab"], ["BKSP", "⌫"]],
    [[null], ["DOWN", "▼"], [null], [null], [null]],
    [..."1234567890".split("").map(c => ["D" + c, c]), ["MINUS", "-"], ["EQUALS", "="]],
    [..."QWERTYUIOP".split("").map(c => [c]), ["LBRACKET", "["], ["RBRACKET", "]"]],
    [..."ASDFGHJKL".split("").map(c => [c]), ["SEMI", ";"], ["QUOTE", "'"]],
    [..."ZXCVBNM".split("").map(c => [c]), ["COMMA", ","], ["DOT", "."], ["SLASH", "/"]],
    [["SHIFT", "Shift"], ["GRAVE", "`"], ["SPACE", "Space", 3], ["BACKSLASH", "\\"], ["FN", "Fn"], ["ENTER", "Enter", 2]],
];
const latched = { SHIFT: false, FN: false };

/* What CyOS types for Fn + a letter key, by letter, and what Fn and Shift
 * type on the punctuation keys (the board's tables, cybiko_ui.c). */
const FN_CHARS = "@ } © $ 3 % * + 8 - _ = > < 9 0 1 4 & 5 7 { 2 # 6 \"".split(" ");
const PUNCT_CHARS = { DOT: ["/", "\\"], COMMA: ["'", "~"], SEMI: [":", "|"], EXCL: ["?", "^"],
    LPAREN: ["[", "`"], RPAREN: ["]", "☺"] };
/* The Russian CyOS types Cyrillic until Fn+Space (read from its key
 * tables at 482f16): letters by Latin letter, punctuation as [plain, Fn];
 * Shift gives capitals everywhere, and Fn on letters is as in Latin but
 * with ё on D and Ё on R. */
const CYR_CHARS = "ф и с в у а п р ш о л д ь т щ з й к ы е г м ц ч н я".split(" ");
const CYR_PUNCT = { DOT: ["ю", "/"], COMMA: ["б", "!"], SEMI: ["ж", ":"], EXCL: ["э", "?"],
    LPAREN: ["ъ", "."], RPAREN: ["х", ","] };
let cyrillic = false;
function keyLabel(name, label) {
    const fn = latched.FN || held.FN, shift = latched.SHIFT || held.SHIFT;
    /* the Classic: what Fn types is not known here, so only Shift shows */
    if (classic) return /^[A-Z]$/.test(name) ? (shift ? name : name.toLowerCase()) : label || name;
    if (cyrillic && CYR_PUNCT[name]) return fn ? CYR_PUNCT[name][1] : shift ? CYR_PUNCT[name][0].toUpperCase() : CYR_PUNCT[name][0];
    if (PUNCT_CHARS[name]) return fn ? PUNCT_CHARS[name][0] : shift ? PUNCT_CHARS[name][1] : label;
    if (!/^[A-Z]$/.test(name)) return label || name;
    if (fn) return cyrillic && name === "D" ? "ё" : cyrillic && name === "R" ? "Ё" : FN_CHARS[name.charCodeAt(0) - 65];
    const c = cyrillic ? CYR_CHARS[name.charCodeAt(0) - 65] : name.toLowerCase();
    return shift ? c.toUpperCase() : c;
}
function relabel() {
    for (const b of document.querySelectorAll("#keyboard .key[data-key]"))
        b.textContent = keyLabel(b.dataset.key, b.dataset.label);
    for (const m of ["SHIFT", "FN"])
        document.querySelector(`[data-key=${m}]`)?.classList.toggle("on", latched[m] || held[m]);
}
function buildKeyboard() {
    const kb = $("keyboard");
    for (const row of classic ? LAYOUT_CLASSIC : LAYOUT) {
        const r = document.createElement("div");
        r.className = "kb-row";
        for (const [name, label, span] of row) {
            const b = document.createElement(name ? "button" : "span");
            b.className = name ? "key" : "key blank";
            b.style.flexGrow = span || 1;
            if (name) {
                b.type = "button";
                b.dataset.key = name;
                if (label) b.dataset.label = label;
                b.textContent = keyLabel(name, label);
                bindKey(b, name);
            }
            r.appendChild(b);
        }
        kb.appendChild(r);
    }
}
function bindKey(b, name) {
    const k = keyTable()[name];
    let mods = [], pressed = Promise.resolve();
    b.addEventListener("pointerdown", e => {
        e.preventDefault();
        audioOn();
        if (name === "SHIFT" || name === "FN") {
            latched[name] = !latched[name];
            relabel();
            return;
        }
        b.setPointerCapture(e.pointerId);
        /* a latched modifier goes down first and the key 60 ms later, as on
         * the board, so CyOS sees Shift before the key */
        mods = ["SHIFT", "FN"].filter(m => latched[m]);
        mods.forEach(m => key(keyTable()[m], true));
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
        setTimeout(() => m.forEach(x => key(keyTable()[x], false)), 60);
        for (const x of m) latched[x] = false;
        relabel();
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
/* the Classic's DataFlash: a 512 KB AT45DB041 dump (264-byte pages) or the 1 MB one saved here */
const flashOk = f => classic ? f.length === 540672 || f.length === 1081344 : f.length === 0x80000;
function checkSetup() {
    $("rom-ok").textContent = pending.rom ? `${pending.rom.length} bytes` : "";
    $("flash-ok").textContent = pending.flash ? `${pending.flash.length} bytes` : "";
    $("boot-ok").textContent = pending.boot ? `${pending.boot.length} bytes` : "";
    const romOk = pending.rom && pending.rom.length === 0x8000, fOk = pending.flash && flashOk(pending.flash);
    if (pending.rom && !romOk) $("rom-ok").textContent += " (should be 32768: not a boot ROM?)";
    if (pending.flash && !fOk) $("flash-ok").textContent += classic ? " (should be 540672: not a Classic flash dump?)"
        : " (should be 524288: not a flash dump?)";
    $("start-btn").disabled = !(romOk && fOk);
}
/* the dumps by model: the files to fetch from cybiko-roms, the names in a
 * zip (MAME's cybikov1 set, or ReBiko's release with roms/boot.bin and
 * roms/flash.bin) */
const DUMPS = {
    xtreme: { fetch: ["xtreme/cyrom150.bin", "xtreme/cyos_v1508.bin"], rom: ["cyrom150.bin"], flash: ["cyos_v1508.bin"],
              what: "the boot ROM and CyOS 1.5.08" },
    classic: { fetch: ["classic/cyrom112.bin", "classic/flash_v1246.bin"], rom: ["cyrom112.bin", "boot.bin"],
               flash: ["flash_v1246.bin", "flash.bin"], what: "the boot ROM and CyOS 1.2.46" },
};
/* A ROM set or a release, as a zip: take this model's boot ROM and flash out of it */
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
        const z = await unzip(data), d = DUMPS[profile.model];
        const romName = d.rom.find(n => z[n]), flashName = d.flash.find(n => z[n]);
        if (romName) pending.rom = z[romName];
        if (flashName) pending.flash = z[flashName];
        $("zip-ok").textContent = romName && flashName ? `found ${romName} and ${flashName}`
            : `no ${[romName ? "" : d.rom[0], flashName ? "" : d.flash[0]].filter(Boolean).join(" or ")} in it (it has ${Object.keys(z).join(", ")})`;
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
    const ru = !classic && $("quick-ru").checked, d = DUMPS[profile.model];
    $("quick-btn").disabled = true;
    $("quick-ok").textContent = "fetching the firmware…";
    try {
        const [rom, flash, upd] = await Promise.all([...d.fetch,
            ...(ru ? ["cyos-updates/ccyphRU1.5.08r.boot"] : [])].map(fetchFile));
        if (rom.length !== 0x8000 || !flashOk(flash)) throw new Error("the files are not the right size");
        await store.set(pk("rom"), rom);
        await store.set(pk("flash"), flash);
        if (upd) await store.set(pk("boot"), upd);
        log(`setup: ${d.what} fetched from ${SITE.filesPage}${upd ? ", with the Russian CyOS update" : ""}`);
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
        await store.set(pk("settings"), settings);
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
    await store.set(pk("rom"), pending.rom);
    await store.set(pk("flash"), pending.flash);
    if (pending.boot && !classic) await store.set(pk("boot"), pending.boot);
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
function unpack(name, data, quiet) {
    const out = [];
    try {
        for (const e of Cybiko.cap.parsePack(data)) {
            if (e.type === 2) out.push({ name: Cybiko.cap.safeName(e.name), data: Cybiko.cap.decodeFile(e) });
            else if (!quiet) log(`files: ${name}: ${Cybiko.cap.TYPE_NAMES[e.type] || "entry"} ${e.name} is for EZ Loader on the PC; not copied`);
        }
        if (!quiet) log(`files: ${name} unpacked: ${out.map(f => f.name).join(", ")}`);
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
    if (classic) {
        notice("The Classic keeps its files in its flash, and this emulator cannot put files there yet.");
        log(`files: ${files.map(f => f.name).join(", ")} not copied: the Classic has no RAM disk`);
        return;
    }
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
    if (classic) {
        /* the Classic's backup is its flash, CyOS and files together (flash_saved.bin on the board) */
        if (!flashOk(data)) { alert(`${f.name} is not a Cybiko Classic flash image (540672 or 1081344 bytes).`); return; }
        if (!confirm(`Replace the flash of ${profile.name}, Cybiko ${slot}, with ${f.name}?`)) return;
        const w = worker;
        worker = null;
        if (w) w.terminate();
        await store.set(slotKey("flash"), data);
        log(`files: ${profile.name}, Cybiko ${slot}: flash restored from ${f.name}`);
        boot();
        return;
    }
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
 * tabs; the cartridge reads them as a FAT card, and what CyOS changes on it
 * (deletes, new files) is kept here too (the worker's save) */

async function showCard() {
    const card = await store.get(pk("card")) || [];
    const total = card.reduce((n, f) => n + f.data.length, 0);
    $("card-info").textContent = card.length ? `${card.length} files, ${(total / 1048576).toFixed(1)} MB` : "empty";
    const ul = $("card-list");
    ul.textContent = "";
    for (const f of card) {
        const li = document.createElement("li");
        const del = document.createElement("button");
        del.type = "button";
        del.className = "small";
        del.textContent = "Delete";
        del.title = `Take ${f.path} off the card`;
        del.onclick = () => deleteFromCard(f.path);
        li.append(`${f.path} (${f.data.length} bytes) `, del);
        ul.appendChild(li);
    }
}

/* The card's files can also be deleted here, without starting CyOS. */
async function deleteFromCard(path) {
    const card = await store.get(pk("card")) || [];
    await store.set(pk("card"), card.filter(f => f.path !== path));
    log(`card: ${path} deleted`);
    showCard();
    if (worker) restart();
}

/* Cybiko software put on the card by an older version of this page (or by
 * hand) does nothing there: it has to be on the Cybiko's disk. */
const isSoftware = (name, data) => isPack(data) || /\.dl$/i.test(name) || /^mp3player\.app$/i.test(name);
async function softwareOffCard() {
    const card = await store.get(pk("card")) || [];
    const soft = card.filter(f => isSoftware(f.path.split("/").pop(), f.data));
    if (!soft.length) return [];
    await store.set(pk("card"), card.filter(f => !soft.includes(f)));
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
    if (classic) return;
    const card = await store.get(pk("card")) || [];
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
    const card = await store.get(pk("card")) || [];
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
    await store.set(pk("card"), card);
    if (added) log(`card: ${added} files added`);
    showCard();
    if (packs.length && worker) addFiles(packs);
    else if (worker) restart();
}
$("card-file").onchange = () => { const l = Array.from($("card-file").files); $("card-file").value = ""; addToCard(l); };
$("card-dir").onchange = () => { const l = Array.from($("card-dir").files); $("card-dir").value = ""; addToCard(l); };
$("card-clear").onclick = async () => {
    if (!confirm("Take every file off the MP3 card?")) return;
    await store.del(pk("card"));
    showCard();
    if (worker) restart();
};

/* ---- the worker ---- */

/* Every open tab is a Cybiko of its own: the first tab on a device takes
 * slot 1, a second tab on it slot 2 and so on, each with its own RAM disk
 * (the Classic: flash) and Cybiko ID (CyOS ignores packets from its own ID,
 * so two tabs as one Cybiko could not chat). The device's ROM and flash
 * dump are shared. */
let slot = 0;
function claimSlot() {
    if (!navigator.locks) { log("this browser has no Web Locks: every tab is Cybiko 1"); return Promise.resolve(1); }
    return new Promise(found => {
        const dev = profile.id === 1 ? "" : `p${profile.id}-`;
        const tryN = n => navigator.locks.request(`cybiko-${dev}slot-${n}`, { ifAvailable: true }, lock => {
            if (!lock) { tryN(n + 1); return undefined; }
            found(n);
            return new Promise(() => {});             /* held while the tab is open */
        });
        tryN(1);
    });
}
const slotKey = k => slot > 1 ? `${pk(k)}#${slot}` : pk(k);

let id24 = 0;
async function boot(apps) {
    if (!slot) slot = await claimSlot();
    const [rom, base, flash, disk, boot] = await Promise.all(
        [pk("rom"), pk("flash"), slotKey("flash"), slotKey("disk"), pk("boot")].map(k => store.get(k)));
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
    const card = await store.get(pk("card")) || [];
    const cartSoftware = !classic && settings.cartSoft && (settings.cart === "on" || (settings.cart !== "off" && card.length)) ? await mp3Software() : null;
    worker.postMessage({ t: "start", rom, flash: flash || base, disk: disk || null, apps: apps || [], card, cartSoftware,
                         boot: slot === 1 && boot ? boot : null, slot, prefix: prefixOf(profile), model: profile.model,
                         diskSize: settings.disk << 20, id24, settings });
}

/* The MP3 cartridge's software (MP3.cap from its CD, in cybiko-roms),
 * fetched once and kept; the worker installs it when the cartridge is in
 * and the Cybiko does not have it yet, as the cartridge's CD would. */
async function mp3Software() {
    let cap = await store.get("mp3cap");
    if (!cap) {
        try {
            cap = await fetchFile("mp3-cartridge/MP3.cap");
            await store.set("mp3cap", cap);
        } catch (e) {
            log(`MP3 cartridge: could not fetch its software (${e.message}); it is installed on a later start`);
            return null;
        }
    }
    return unpack("MP3.cap", cap, true);
}

/* Saves, then powers the Cybiko off and on again (with new files). */
let noticeTimer = 0;
function notice(text, ms = 8000) {
    $("notice").textContent = text;
    $("notice").hidden = false;
    clearTimeout(noticeTimer);
    if (ms) noticeTimer = setTimeout(() => { $("notice").hidden = true; }, ms);
}

/* Saves and stops the worker (no save when dropped): for leaving this device. */
function stopWorker(drop) {
    const w = worker;
    worker = null;
    if (!w) return Promise.resolve();
    if (drop) { w.terminate(); return Promise.resolve(); }
    return new Promise(ok => {
        const done = () => { w.terminate(); ok(); };
        const timer = setTimeout(() => { log("devices: the worker did not answer; leaving without the last save"); done(); }, 3000);
        w.onmessage = e => { if (e.data.t === "saved") { clearTimeout(timer); done(); } else onWorker(e); };
        w.postMessage({ t: "save" });
    });
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
    case "led": $("led").className = ["", "red", "green"][m.led] || ""; break;
    case "kbd": cyrillic = m.cyrillic; relabel(); break;
    case "log": log(m.line); break;
    case "audio": play(m.pcm, m.rate); break;
    case "file": download(m.name, m.data); break;
    case "disk": download(classic ? (slot > 1 ? `flash_saved-${slot}.bin` : "flash_saved.bin")
        : slot > 1 ? `ramdisk-${slot}.bin` : "ramdisk.bin", m.data); break;
    case "badflash":
        notice(`The flash of ${profile.name} is not a Cybiko Classic flash image. Pick the files again.`, 0);
        $("setup").hidden = false;
        $("machine").hidden = true;
        break;
    case "started": log("started"); break;
    case "put":
        log(`files: ${m.name} ${m.ok ? "is on the Cybiko" : "not copied: " + m.why}`);
        putDone.push(m.ok ? m.name : `${m.name} (not copied: ${m.why})`);
        /* the libraries and icons that come with apps are in the log only */
        const shown = putDone.filter(n => !/\.(dl|ico)\b/i.test(n));
        if (shown.length)
            notice(`On the Cybiko: ${shown.join(", ")}. Apps appear at the end of the Main desktop once CyOS has started.`, 20000);
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
        $("status").textContent = $("status").title = `${profile.name} · ID ${m.id} · Cybiko ${slot} · room ${settings.room} · relay ${m.relay} · radio ${r.sent} out, ${r.heard} in · ${m.speed}%`;
        break;
    }
    case "saved": break;
    case "card": showCard(); break;
    default: log(`page: unknown message from the worker: ${m.t}`);
    }
}

window.addEventListener("pagehide", () => worker && worker.postMessage({ t: "save" }));

(async () => {
    await loadProfiles();
    buildKeyboard();
    await loadSettings();
    setPalette();
    boot();
})();
