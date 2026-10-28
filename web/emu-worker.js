/* The emulator runs here, in a worker, so it keeps going (and keeps
 * answering the radio) while its tab is in the background. The page sends
 * keys and files; this sends back frames, sound and log lines.
 *
 * Radio: packets go to the other tabs of this browser over a
 * BroadcastChannel and to everyone else in the same room over the relay's
 * WebSocket (proxy/). A tab that hears a packet both ways takes it once. */
"use strict";
const VERSION = self.location.search;           /* app.js VERSION */
importScripts("idb.js" + VERSION, "emu.js" + VERSION);

let CLOCK = 18432000;         /* emu_clock_hz: the Xtreme's, the Classic's is lower */
let M = null;                 /* the wasm module */
let settings = {};
let slot = 1;                 /* which Cybiko of this profile (app.js) */
let prefix = "";              /* the profile's keys in the store (app.js profileKey) */
let classic = false;
const slotKey = k => slot > 1 ? `${prefix}${k}#${slot}` : prefix + k;
let updating = false;         /* a CyOS update is being installed */
let lastLcd = 0;

function log(line) { postMessage({ t: "log", line }); }

/* ---- network for the gate (net_web.c) ---- */

const net = {
    req: null,
    start(url, body, ctype, cookie) {
        this.abort();
        const proxy = (settings.proxy || "").replace(/\/+$/, "");
        const r = { state: 0, head: {}, chunks: [], done: false, error: "", ctl: new AbortController() };
        this.req = r;
        if (!proxy) { r.error = "No proxy set (Settings)"; return false; }
        if (!/^https?:\/\//i.test(url)) { r.error = "Only http and https"; return false; }
        const headers = { "X-Cookie": cookie || "" };
        if (body !== null) headers["Content-Type"] = ctype || "application/x-www-form-urlencoded";
        fetch(proxy + "/fetch?url=" + encodeURIComponent(url), {
            method: body !== null ? "POST" : "GET", body: body !== null ? body : undefined,
            headers, signal: r.ctl.signal,
        }).then(async res => {
            if (this.req !== r) return;
            const h = res.headers;
            if (!res.ok || !h.get("X-Status")) {
                r.error = h.get("X-Error") || `Proxy said ${res.status}`;
                r.state = -2;
                log(`net: ${url}: ${r.error}`);
                return;
            }
            let cookies = [];
            try { cookies = JSON.parse(decodeURIComponent(h.get("X-Set-Cookie") || "%5B%5D")); }
            catch (e) { log(`net: bad X-Set-Cookie from the proxy: ${e}`); }
            r.head = { status: h.get("X-Status"), location: h.get("X-Location") || "",
                       type: h.get("X-Content-Type") || "", url: h.get("X-Final-Url") || url };
            cookies.forEach((c, i) => { r.head["cookie" + i] = c; });
            r.state = 1;
            const reader = res.body.getReader();
            for (;;) {
                const { done, value } = await reader.read();
                if (this.req !== r) { reader.cancel(); return; }
                if (done) break;
                r.chunks.push(value);
            }
            r.done = true;
        }).catch(e => {
            if (this.req !== r || e.name === "AbortError") return;
            r.error = `Can't reach the proxy (${e.message})`;
            if (r.state === 1) r.failed = true; else r.state = -2;
            log(`net: ${url}: ${r.error}`);
        });
        return true;
    },
    poll() { return this.req ? this.req.state : -2; },
    get(what) {
        const r = this.req;
        if (!r) return "";
        if (what === "error") return r.error;
        return r.head[what] || "";
    },
    read(cap) {
        const r = this.req;
        if (!r) return -2;
        if (r.chunks.length) {
            const c = r.chunks[0];
            if (c.length <= cap) { r.chunks.shift(); return c; }
            r.chunks[0] = c.subarray(cap);
            return c.subarray(0, cap);
        }
        if (r.failed) return -2;
        return r.done ? -1 : 0;
    },
    abort() {
        if (this.req) this.req.ctl.abort();
        this.req = null;
    },
};

/* ---- radio ---- */

const tabId = (Math.random() * 0x100000000) >>> 0;
let seq = 0;
let channel = null, ws = null, wsUrl = "", wsRetry = 0, wsTimer = 0;
const seen = new Map();                         /* "tab:seq" of packets taken, the latest 512 */
const radio = { sent: 0, heard: 0, dup: 0, bad: 0 };

/* frame: tab id (4), sequence (4), radio channel (1), the packet */
function frame(pkt, ch) {
    const f = new Uint8Array(9 + pkt.length);
    const v = new DataView(f.buffer);
    v.setUint32(0, tabId);
    v.setUint32(4, seq++);
    f[8] = ch;
    f.set(pkt, 9);
    return f;
}

function heard(data, how) {
    const f = new Uint8Array(data);
    if (f.length !== 9 + 50 && f.length !== 9 + 200) {
        radio.bad++;
        log(`radio: a ${f.length}-byte frame from the ${how} is not a packet; ignored`);
        return;
    }
    const v = new DataView(f.buffer, f.byteOffset);
    if (v.getUint32(0) === tabId) return;     /* our own, echoed */
    const key = v.getUint32(0) + ":" + v.getUint32(4);
    if (seen.has(key)) { radio.dup++; return; } /* came both ways */
    seen.set(key, 1);
    if (seen.size > 512) seen.delete(seen.keys().next().value);
    radio.heard++;
    if (!M) return;
    const pkt = f.subarray(9);
    M.HEAPU8.set(pkt, M._emu_scratch(pkt.length));
    M._emu_rf_in(pkt.length, f[8]);
}

function onRadio(pkt, ch) {
    radio.sent++;
    const f = frame(pkt, ch);
    if (channel) channel.postMessage(f);
    if (ws && ws.readyState === 1) ws.send(f);
}

function radioSetup() {
    /* the relay takes letters, digits, - and _ (core.mjs roomName) */
    const room = (settings.room || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32) || "public";
    if (channel) channel.close();
    channel = new BroadcastChannel("cybiko-radio:" + room);
    channel.onmessage = e => heard(e.data, "tabs");
    const proxy = (settings.proxy || "").replace(/\/+$/, "");
    const url = proxy && settings.online !== false ? proxy.replace(/^http/i, "ws") + "/room/" + encodeURIComponent(room) : "";
    if (url === wsUrl) return;
    wsUrl = url;
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    clearTimeout(wsTimer);
    if (url) wsConnect();
    status();
}

function wsConnect() {
    const url = wsUrl;
    const s = new WebSocket(url);
    s.binaryType = "arraybuffer";
    ws = s;
    s.onopen = () => { wsRetry = 0; log(`radio: joined ${url}`); status(); };
    s.onmessage = e => {
        if (typeof e.data === "string") { log(`radio: relay says ${e.data}`); return; }
        heard(e.data, "relay");
    };
    s.onclose = e => {
        if (ws !== s) return;
        ws = null;
        const wait = Math.min(30000, 1000 * 2 ** wsRetry++);
        log(`radio: relay connection closed (${e.code}${e.reason ? " " + e.reason : ""}); again in ${wait / 1000} s`);
        status();
        wsTimer = setTimeout(() => { if (wsUrl === url) wsConnect(); }, wait);
    };
}

function status() {
    const now = performance.now();
    if (speedAt) speed = Math.round((emuMs - speedEmu) * 100 / (now - speedAt));
    speedAt = now;
    speedEmu = emuMs;
    postMessage({ speed, t: "status", relay: ws && ws.readyState === 1 ? "online" : wsUrl ? "connecting" : "off",
                  id: M ? (M._emu_unit_id() >>> 0).toString(16).padStart(8, "0") : "", radio: { ...radio } });
}

/* ---- saving ---- */

let diskSaving = false;
/* A new disk, or files put on it before start, are saved even if CyOS
 * writes nothing (it does not while its first-run setup waits). */
let diskNew = false;
let cardSaving = false;
async function save() {
    if (!M) return;
    if (!classic && (M._emu_disk_dirty() || diskNew) && !diskSaving) {
        diskSaving = true;
        diskNew = false;
        const d = M.HEAPU8.slice(M._emu_disk(M._emu_disk_size()), M._emu_disk(M._emu_disk_size()) + M._emu_disk_size());
        try { await store.set(slotKey("disk"), d); } catch (e) { log(`save: RAM disk not saved: ${e}`); }
        diskSaving = false;
    }
    if (M._emu_card_sync() && !cardSaving) {
        /* the card as CyOS left it, for the next start (shared by all tabs) */
        cardSaving = true;
        const files = [];
        const walk = dir => {
            for (const name of M.FS.readdir(dir)) {
                if (name.startsWith(".")) continue;          /* ., .. and changed files' old copies */
                const p = dir + "/" + name;
                if (M.FS.isDir(M.FS.stat(p).mode)) walk(p);
                else files.push({ path: p.slice("/card/".length), data: M.FS.readFile(p) });
            }
        };
        try {
            walk("/card");
            await store.set(prefix + "card", files);
            postMessage({ t: "card" });
        } catch (e) { log(`card: CyOS's changes not saved: ${e}`); }
        cardSaving = false;
    }
    const p = M._emu_flash_to_save(updating ? 1 : 0);
    if (p) {
        const f = M.HEAPU8.slice(p, p + M._emu_flash_size());
        try {
            await store.set(slotKey("flash"), f);
            log(classic ? "save: flash saved (CyOS and its files)" : updating ? "save: CyOS update installed, flash saved" : "save: reprogrammed flash saved");
            if (updating) { updating = false; await store.del(prefix + "boot"); }
        } catch (e) { log(`save: flash not saved: ${e}`); }
    }
}

/* ---- running ---- */

let last = 0, emuMs = 0, speedAt = 0, speedEmu = 0, speed = 0;
/* the sound made by the last run, to the page (16-bit mono, emu_audio_rate) */
function sound() {
    const n = M._emu_audio();
    if (!n) return;
    const p = M._emu_audio_buf() >> 1;
    const pcm = M.HEAP16.slice(p, p + n);
    postMessage({ t: "audio", pcm, rate: M._emu_audio_rate() }, [pcm.buffer]);
}

function tick() {
    const now = performance.now();
    let ms = now - last;
    last = now;
    if (ms > 100) ms = 100;                    /* fell behind: let emulated time slip */
    emuMs = M._emu_run(Math.round(ms * CLOCK / 1000));
    if (keyUps.length) keysDue();
    sound();
    const led = M._emu_led();
    if (led !== ledShown) { ledShown = led; postMessage({ t: "led", led }); }
    const kbd = M._emu_kbd_layout();          /* 1 while the Russian CyOS types Cyrillic */
    if (kbd !== kbdShown) { kbdShown = kbd; postMessage({ t: "kbd", cyrillic: kbd === 1 }); }
    /* whole frames only: emu_lcd_ready waits until CyOS has finished drawing */
    if (settings.vsync === false ? now - lastLcd >= 33 : now - lastLcd >= 16 && M._emu_lcd_ready()) {
        lastLcd = now;
        const ver = M._emu_lcd_render();
        if (ver !== frameVer) {
            frameVer = ver;
            const p = M._emu_lcd();
            const lum = M.HEAPU8.slice(p, p + 160 * 100);
            postMessage({ t: "frame", lum }, [lum.buffer]);
        }
    }
}
let frameVer = -1, ledShown = -1, kbdShown = -1;

async function start(msg) {
    settings = msg.settings || {};
    slot = msg.slot || 1;
    prefix = msg.prefix || "";
    classic = msg.model === "classic";
    M = await CybikoModule({
        locateFile: (file, dir) => dir + file + VERSION,
        onLog: log,
        onRadio,
        net,
        print: log,
        printErr: line => log("wasm: " + line),
    });
    if (classic) M._emu_classic();
    CLOCK = M._emu_clock_hz();
    M.HEAPU8.set(msg.rom.subarray(0, 0x8000), M._emu_rom());
    M.HEAPU8.set(msg.flash.subarray(0, M._emu_flash_size()), M._emu_flash());
    if (classic) { startClassic(msg); return; }
    const size = msg.disk ? Math.max(msg.disk.length, msg.diskSize) : msg.diskSize;
    const dp = M._emu_disk(size);
    if (msg.disk) M.HEAPU8.set(msg.disk.subarray(0, M._emu_disk_size()), dp);
    if (msg.boot) {
        M.HEAPU8.set(msg.boot, M._emu_scratch(msg.boot.length));
        updating = M._emu_stage_boot(msg.boot.length) === 0;
        if (!updating) await store.del(prefix + "boot");
    }
    let apps = msg.apps || [];
    const hasSoftware = () => M.UTF8ToString(M._emu_disk_list()).toLowerCase().split("\n").some(l => l.startsWith("mp3player.app\t"));
    if (msg.cartSoftware && !hasSoftware()) {
        log("MP3 cartridge: installing its software (MP3 Player) on the Cybiko");
        apps = [...apps, ...msg.cartSoftware];
    }
    diskNew = !msg.disk || apps.length > 0;
    for (const a of apps) {
        const name = M.stringToNewUTF8(a.name);
        M.HEAPU8.set(a.data, M._emu_scratch(a.data.length));
        const r = M._emu_disk_put(name, a.data.length);
        M._free(name);
        postMessage({ t: "put", name: a.name, ok: r === 0, why: r === -1 ? "does not fit" : r === -2 ? "bad name" : "" });
    }
    const home = M.stringToNewUTF8(settings.home || "");
    /* the MP3 cartridge's card: the page's files in /card (cy_vfat) */
    let cardFiles = 0;
    for (const f of msg.card || []) {
        const path = "/card/" + f.path.replace(/^\/+/, "");
        try {
            M.FS.mkdirTree(path.slice(0, path.lastIndexOf("/")));
            M.FS.writeFile(path, f.data);
            cardFiles++;
        } catch (e) { log(`card: ${f.path} not put on the card: ${e}`); }
    }
    if (!cardFiles) M.FS.mkdirTree("/card");
    /* auto: plugged in when the card has files or the cartridge's software
     * is on the Cybiko (it is sold with the cartridge) */
    const cart = settings.cart === "off" ? 0 : settings.cart === "on" || hasSoftware() ? 2 : 1;
    if (!M._emu_start(msg.id24, settings.gate === false ? 0 : 1, home, cart)) {
        log("could not start the machine");
        return;
    }
    running();
    files();
    if (cart === 2 || (cart === 1 && cardFiles)) {
        const names = M.UTF8ToString(M._emu_disk_list()).split("\n").map(l => l.split("\t")[0].toLowerCase());
        const need = ["sddisk.dl", "sdflash.dl", "mp3player.app"].filter(n => !names.includes(n));
        if (need.length)
            log(`MP3 cartridge: its software is not on the Cybiko (no ${need.join(", ")}), so CyOS will not see the card. ` +
                "Add MP3.cap from the MP3 cartridge's CD with \"Add files to the Cybiko\".");
    }
}

/* The Classic: only its flash (CyOS 1.2 keeps its files there); no RAM
 * disk, cartridge or gate, so files, apps and the card are left out. */
function startClassic(msg) {
    if (M._emu_classic_flash(msg.flash.length) < 0) { postMessage({ t: "badflash" }); return; }
    if (msg.apps && msg.apps.length) log(`files: ${msg.apps.length} files not copied: the Classic has no RAM disk`);
    if (!M._emu_start(msg.id24, 0, 0, 0)) {
        log("could not start the machine");
        return;
    }
    running();
}

function running() {
    radioSetup();
    last = performance.now();
    setInterval(tick, 10);
    setInterval(save, 3000);
    setInterval(status, 2000);
    postMessage({ t: "started" });
}

/* A key is held for at least KEY_MIN_MS of emulated time: a quick tap can
 * come down and up between two runs, and CyOS only takes a key that stays
 * down for a few of its key scans (shorter letters were lost on the
 * Xtreme's nickname screen, at 40 ms). */
const KEY_MIN_MS = 100;
const keyDownAt = new Map(), keyUps = [];
function key(k, down) {
    if (!M) return;
    if (down) {
        const i = keyUps.findIndex(u => u.k === k);
        if (i >= 0) keyUps.splice(i, 1);
        keyDownAt.set(k, emuMs);
        M._emu_key(k, 1);
    } else if (emuMs - (keyDownAt.get(k) ?? -1e9) < KEY_MIN_MS) {
        keyUps.push({ k, at: keyDownAt.get(k) + KEY_MIN_MS });
    } else {
        M._emu_key(k, 0);
    }
}
function keysDue() {
    for (let i = keyUps.length - 1; i >= 0; i--)
        if (emuMs >= keyUps[i].at) { M._emu_key(keyUps[i].k, 0); keyUps.splice(i, 1); }
}

function files() {
    if (!M) return;
    const list = M.UTF8ToString(M._emu_disk_list()).split("\n").filter(Boolean)
        .map(l => { const [name, size] = l.split("\t"); return { name, size: +size }; });
    postMessage({ t: "files", list, free: M._emu_disk_free() });
}

onmessage = async e => {
    const m = e.data;
    switch (m.t) {
    case "start": start(m); break;
    case "key": key(m.k, m.down); break;
    case "files": files(); break;
    case "getfile": {
        if (!M) break;
        const name = M.stringToNewUTF8(m.name);
        const n = M._emu_disk_read(name);
        M._free(name);
        if (n < 0) { log(`files: ${m.name} is not on the Cybiko`); break; }
        const p = M._emu_scratch(0);
        postMessage({ t: "file", name: m.name, data: M.HEAPU8.slice(p, p + n) });
        break;
    }
    case "getdisk": {
        if (!M) break;
        if (classic) {                          /* the Classic's files are in its flash */
            const p = M._emu_flash();
            postMessage({ t: "disk", data: M.HEAPU8.slice(p, p + M._emu_flash_size()) });
            break;
        }
        const p = M._emu_disk(M._emu_disk_size());
        postMessage({ t: "disk", data: M.HEAPU8.slice(p, p + M._emu_disk_size()) });
        break;
    }
    case "settings": settings = m.settings; if (M) radioSetup(); break;
    case "save": await save(); postMessage({ t: "saved" }); break;
    default: log(`worker: unknown message ${m.t}`);
    }
};
