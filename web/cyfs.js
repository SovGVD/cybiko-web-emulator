/* CyOS's own file system in a saved image, read and written by the page
 * while the Cybiko is stopped (the file manager, files.js), and zip files
 * for its backups. CyOS finds its files by scanning the blocks at power-on,
 * so what is written here shows up on the next start.
 *
 * Both models keep files the same way, in 256-byte blocks:
 *
 *   0     flags, bit 7 set when the block is in use
 *   1     number of data bytes in this block
 *   2-3   file id (big endian), the number of its first block counted from
 *         the first file page
 *   4-5   part number, 0 for the first block
 *   part 0 only:
 *   6     attributes
 *   7     file name, NUL terminated
 *   4a-4d date, seconds since 1900-01-01 (big endian), 0 for none
 *   4e    data; later parts carry data from byte 6
 *
 * The Xtreme's RAM disk is a row of 258-byte pages: a 16-bit checksum, then
 * the block (Dragonfruit's cy_disk.c, after MAME's imgtool "cybikoxt" module
 * by Tim Schuerewegen). The Classic's DataFlash (and its memory card's) is a
 * row of 264-byte pages: a CRC-32 of bytes 8-261, a 16-bit write counter,
 * a check word, then the block, of which bytes 0-253 are used (read from
 * flash_v1257.bin; the empty page is ReBiko's, as cybiko_at45_format_free in
 * Dragonfruit's cy_classic.c). The first 5 pages hold no files. */
"use strict";
const CyFS = (() => {
    const BOOT_PAGES = 5, HDR = 0x4e;

    const CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        CRC[n] = c >>> 0;
    }
    function crc32(b, start = 0, end = b.length, crc = 0) {
        let c = ~crc >>> 0;
        for (let i = start; i < end; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
        return ~c >>> 0;
    }

    /* the Xtreme's page checksum (page_sum in cy_disk.c) */
    function xsum(d, o) {
        let v = 0;
        for (let i = 0; i < 256; i++) {
            v = ((v ^ d[o + i] ^ i) << 1) >>> 0;
            v |= (v >>> 16) & 1;
        }
        return v & 0xffff;
    }

    const XTREME = {
        page: 258, block: 2, used: 256,
        ok(d, p) { const o = p * 258; return ((d[o] << 8) | d[o + 1]) === xsum(d, o + 2); },
        seal(d, p) { const o = p * 258, s = xsum(d, o + 2); d[o] = s >> 8; d[o + 1] = s & 0xff; },
        erase(d, p) { d.fill(0, p * 258, p * 258 + 258); },
        nameMax: 58,
    };
    const CLASSIC = {
        page: 264, block: 8, used: 254,
        ok(d, p) {
            const o = p * 264;
            return crc32(d, o + 8, o + 262) === ((d[o] << 24 | d[o + 1] << 16 | d[o + 2] << 8 | d[o + 3]) >>> 0);
        },
        seal(d, p, seq = 0) {
            const o = p * 264, c = crc32(d, o + 8, o + 262);
            d[o] = c >>> 24; d[o + 1] = (c >>> 16) & 0xff; d[o + 2] = (c >>> 8) & 0xff; d[o + 3] = c & 0xff;
            d[o + 4] = seq >> 8; d[o + 5] = seq & 0xff;
            const v = 0xaf17 ^ ((d[o] << 8) | d[o + 1]) ^ ((d[o + 2] << 8) | d[o + 3]) ^ ((d[o + 4] << 8) | d[o + 5]);
            d[o + 6] = v & 0xff; d[o + 7] = v >> 8;
        },
        /* an empty page, as a fresh card or the unused half of a 512 KB dump */
        erase(d, p) {
            const o = p * 264;
            d.fill(0xff, o, o + 264);
            d[o + 8] = 0x7f;
            this.seal(d, p, 0);
        },
        /* CyOS 1.2's longest names are about 20 characters; the name field ends before 0x40 */
        nameMax: 56,
    };
    const AT45_SIZE = 264 * 4096, AT45_DB041 = 264 * 2048;

    /* CyOS keeps local time: a Date whose local fields are the Cybiko's */
    function localDate(t) {
        const u = new Date((t - 2208988800) * 1000);
        return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes(), u.getUTCSeconds());
    }

    class Image {
        /* data: the image (kept and changed in place); classic: the DataFlash format */
        constructor(data, classic) {
            this.d = data;
            this.g = classic ? CLASSIC : XTREME;
            this.pages = Math.floor(data.length / this.g.page);
        }
        blk(p) { return p * this.g.page + this.g.block; }
        inUse(p) { return (this.d[this.blk(p)] & 0x80) !== 0 && this.g.ok(this.d, p); }
        id(p) { const o = this.blk(p); return (this.d[o + 2] << 8) | this.d[o + 3]; }
        part(p) { const o = this.blk(p); return (this.d[o + 4] << 8) | this.d[o + 5]; }
        nameAt(p) {
            const o = this.blk(p) + 7;
            let e = o;
            while (e < this.blk(p) + HDR && this.d[e]) e++;
            return Cybiko.util.latin1(this.d.subarray(o, e));
        }
        /* every file: { name, size, id, date (a Date or null) } */
        list() {
            const sizes = new Map(), out = [];
            for (let p = BOOT_PAGES; p < this.pages; p++)
                if (this.inUse(p)) sizes.set(this.id(p), (sizes.get(this.id(p)) || 0) + this.d[this.blk(p) + 1]);
            for (let p = BOOT_PAGES; p < this.pages; p++) {
                if (!this.inUse(p) || this.part(p)) continue;
                const o = this.blk(p) + 0x4a;
                const t = (this.d[o] << 24 | this.d[o + 1] << 16 | this.d[o + 2] << 8 | this.d[o + 3]) >>> 0;
                out.push({ name: this.nameAt(p), size: sizes.get(this.id(p)) || 0, id: this.id(p),
                           date: t ? localDate(t) : null });
            }
            return out;
        }
        first(name) {
            for (let p = BOOT_PAGES; p < this.pages; p++)
                if (this.inUse(p) && !this.part(p) && this.nameAt(p) === name) return p;
            return 0;
        }
        read(name) {
            const p0 = this.first(name);
            if (!p0) return null;
            const id = this.id(p0), parts = [];
            for (let p = BOOT_PAGES; p < this.pages; p++)
                if (this.inUse(p) && this.id(p) === id) parts[this.part(p)] = p;
            const chunks = [];
            for (let i = 0; i < parts.length && parts[i] !== undefined; i++) {
                const o = this.blk(parts[i]), off = i ? 6 : HDR;
                chunks.push(this.d.subarray(o + off, o + off + Math.min(this.d[o + 1], this.g.used - off)));
            }
            const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
            let at = 0;
            for (const c of chunks) { out.set(c, at); at += c.length; }
            return out;
        }
        erasePages(id) {
            for (let p = BOOT_PAGES; p < this.pages; p++)
                if (this.inUse(p) && this.id(p) === id) this.g.erase(this.d, p);
        }
        delete(name) {
            const p = this.first(name);
            if (!p) return false;
            this.erasePages(this.id(p));
            return true;
        }
        bytesIn(pages) { return pages ? (this.g.used - HDR) + (pages - 1) * (this.g.used - 6) : 0; }
        pagesFor(len) {
            const a = this.g.used - HDR, b = this.g.used - 6;
            return len <= a ? 1 : 1 + Math.ceil((len - a) / b);
        }
        free() {
            let n = 0;
            for (let p = BOOT_PAGES; p < this.pages; p++) if (!this.inUse(p)) n++;
            return this.bytesIn(n);
        }
        /* Stores a file, replacing one of the same name: "" or why not. */
        write(name, data, when = new Date()) {
            if (!name || /[\/\\\x00-\x1f]|[^\x00-\xff]/.test(name)) return "bad name (CyOS takes Latin-1 letters only, no / or \\)";
            if (name.length > this.g.nameMax) return `name too long (${this.g.nameMax} characters at most)`;
            const nb = Uint8Array.from(name, c => c.charCodeAt(0));
            const old = this.first(name), oldId = old ? this.id(old) : -1;
            let avail = 0;
            for (let p = BOOT_PAGES; p < this.pages; p++) if (!this.inUse(p) || this.id(p) === oldId) avail++;
            const need = this.pagesFor(data.length);
            if (need > avail) return `does not fit (${data.length} bytes, ${this.bytesIn(avail)} free)`;
            if (old) this.erasePages(oldId);
            /* the Classic's pages carry a write counter: carry on from the highest */
            let seq = 0;
            if (this.g === CLASSIC)
                for (let p = BOOT_PAGES; p < this.pages; p++)
                    if (this.inUse(p)) seq = Math.max(seq, (this.d[p * 264 + 4] << 8) | this.d[p * 264 + 5]);
            let firstFree = BOOT_PAGES;
            while (this.inUse(firstFree)) firstFree++;
            const id = firstFree - BOOT_PAGES;
            const date = Math.floor(when.getTime() / 1000) - when.getTimezoneOffset() * 60 + 2208988800;
            let part = 0, done = 0;
            for (let p = BOOT_PAGES; p < this.pages && part < need; p++) {
                if (this.inUse(p)) continue;
                const o = this.blk(p), off = part ? 6 : HDR;
                const n = Math.min(data.length - done, this.g.used - off);
                if (this.g === CLASSIC) this.d.fill(0xff, p * 264, p * 264 + 264);
                this.d.fill(0, o, o + this.g.used);
                this.d[o] = 0x80;
                this.d[o + 1] = n;
                this.d[o + 2] = id >> 8; this.d[o + 3] = id & 0xff;
                this.d[o + 4] = part >> 8; this.d[o + 5] = part & 0xff;
                if (!part) {
                    if (this.g === XTREME) {
                        this.d[o + 6] = 0x20;                    /* as cy_disk.c and CyOS 1.5 */
                        this.d[o + 0x45] = 0x7b;
                        this.d[o + 0x46] = this.d[o + 0x47] = 0xff;
                    }
                    this.d.set(nb, o + 7);
                    this.d[o + 0x4a] = date >>> 24; this.d[o + 0x4b] = (date >>> 16) & 0xff;
                    this.d[o + 0x4c] = (date >>> 8) & 0xff; this.d[o + 0x4d] = date & 0xff;
                }
                this.d.set(data.subarray(done, done + n), o + off);
                this.g.seal(this.d, p, (seq + 1 + part) & 0xffff);
                done += n;
                part++;
            }
            return "";
        }
    }

    /* A Classic flash image as the emulator runs it: a 512 KB AT45DB041 dump
     * gets the rest of the 1 MB chip as empty pages (emu_classic_flash). */
    function classicFlash(data) {
        if (data.length === AT45_SIZE) return data;
        const out = new Uint8Array(AT45_SIZE);
        out.set(data.subarray(0, AT45_DB041));
        for (let p = AT45_DB041 / 264; p < 4096; p++) CLASSIC.erase(out, p);
        return out;
    }
    /* A fresh memory card: every page empty, as emu_mcard makes it */
    function emptyCard() {
        const out = new Uint8Array(AT45_SIZE);
        for (let p = 0; p < 4096; p++) CLASSIC.erase(out, p);
        return out;
    }

    /* ---- zip: stored or deflated (the browser's own CompressionStream) ---- */

    async function inflate(raw) {
        return new Uint8Array(await new Response(new Blob([raw]).stream()
            .pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
    }
    async function deflate(raw) {
        return new Uint8Array(await new Response(new Blob([raw]).stream()
            .pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
    }

    /* The files in a zip: [{ path, data }] (folders left out). Problems
     * with single entries go to warn(text) and the entry is left out. */
    async function unzip(data, warn) {
        const u16 = o => data[o] | data[o + 1] << 8, u32 = o => (u16(o) | u16(o + 2) << 16) >>> 0;
        let end = data.length - 22;
        while (end >= 0 && u32(end) !== 0x06054b50) end--;
        if (end < 0) throw new Error("not a zip file");
        const out = [];
        let p = u32(end + 16);
        for (let i = 0, n = u16(end + 10); i < n; i++) {
            if (u32(p) !== 0x02014b50) throw new Error("its list of files is damaged");
            const flags = u16(p + 8), method = u16(p + 10), crc = u32(p + 16), csize = u32(p + 20);
            const nlen = u16(p + 28), xlen = u16(p + 30), clen = u16(p + 32), local = u32(p + 42);
            const nameBytes = data.subarray(p + 46, p + 46 + nlen);
            const path = flags & 0x800 ? new TextDecoder().decode(nameBytes) : Cybiko.util.latin1(nameBytes);
            p += 46 + nlen + xlen + clen;
            if (path.endsWith("/")) continue;
            if (flags & 1) { warn(`${path}: encrypted; left out`); continue; }
            const start = local + 30 + u16(local + 26) + u16(local + 28);
            const raw = data.subarray(start, start + csize);
            let file;
            try {
                if (method === 0) file = raw.slice();
                else if (method === 8) file = await inflate(raw);
                else { warn(`${path}: packed with method ${method}, which the page cannot unpack; left out`); continue; }
            } catch (e) { warn(`${path}: could not be unpacked (${e.message}); left out`); continue; }
            if (crc32(file) !== crc) warn(`${path}: its checksum does not match; taken anyway`);
            out.push({ path, data: file });
        }
        return out;
    }

    /* A zip of [{ path, data, date }] */
    async function zip(files) {
        const parts = [], central = [];
        let at = 0;
        const enc = new TextEncoder();
        for (const f of files) {
            const name = enc.encode(f.path), crc = crc32(f.data);
            let body = f.data, method = 0;
            if (f.data.length > 64 && typeof CompressionStream === "function") {
                try {
                    const z = await deflate(f.data);
                    if (z.length < f.data.length) { body = z; method = 8; }
                } catch (e) { /* stored instead */ }
            }
            const d = f.date || new Date();
            const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
            const dosDate = (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
            const head = (sig, extra) => {
                const h = new DataView(new ArrayBuffer(extra ? 46 : 30));
                let o = 0;
                h.setUint32(o, sig, true); o += 4;
                if (extra) { h.setUint16(o, 20, true); o += 2; }       /* made by */
                h.setUint16(o, 20, true); o += 2;                      /* needed */
                h.setUint16(o, 0x800, true); o += 2;                   /* UTF-8 names */
                h.setUint16(o, method, true); o += 2;
                h.setUint16(o, dosTime, true); o += 2;
                h.setUint16(o, dosDate, true); o += 2;
                h.setUint32(o, crc, true); o += 4;
                h.setUint32(o, body.length, true); o += 4;
                h.setUint32(o, f.data.length, true); o += 4;
                h.setUint16(o, name.length, true); o += 2;
                h.setUint16(o, 0, true); o += 2;
                if (extra) {
                    o += 2 + 2 + 2 + 4;                                /* comment, disk, attributes */
                    h.setUint32(o, at, true);
                }
                return new Uint8Array(h.buffer);
            };
            central.push(head(0x02014b50, true), name);
            const local = head(0x04034b50, false);
            parts.push(local, name, body);
            at += local.length + name.length + body.length;
        }
        const cdSize = central.reduce((n, c) => n + c.length, 0);
        const e = new DataView(new ArrayBuffer(22));
        e.setUint32(0, 0x06054b50, true);
        e.setUint16(8, files.length, true);
        e.setUint16(10, files.length, true);
        e.setUint32(12, cdSize, true);
        e.setUint32(16, at, true);
        const all = [...parts, ...central, new Uint8Array(e.buffer)];
        const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
        let o = 0;
        for (const c of all) { out.set(c, o); o += c.length; }
        return out;
    }

    return { Image, classicFlash, emptyCard, zip, unzip, crc32, AT45_SIZE, AT45_DB041 };
})();
