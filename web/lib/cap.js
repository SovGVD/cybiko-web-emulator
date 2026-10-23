// From SovGVD/cybiko-docs web/lib/cap.js (the converters' page), copied as is.
// EZ Loader packs (.cap, .csu) and CyOS archives (.app, .dl, the "Cy"
// format): a port of tools/cybiko_cap.py.
(function (C) {
  "use strict";
  const U = C.util;
  const K = C.cap = {};

  K.TYPE_NAMES = { 1: "folder", 2: "file", 3: "script" };

  // ---- EZ Loader packs ---------------------------------------------------

  function unchain16(words, key) {
    const out = new Array(words.length);
    let prev = key;
    for (let i = 0; i < words.length; i++) prev = out[i] = words[i] ^ prev;
    return out;
  }

  function unchain8(data, key) {
    const out = new Uint8Array(data.length);
    let prev = key;
    for (let i = 0; i < data.length; i++) prev = out[i] = data[i] ^ prev;
    return out;
  }

  function words16(b, off, n) {
    const w = new Array(n);
    for (let i = 0; i < n; i++) w[i] = U.u16le(b, off + 2 * i);
    return w;
  }

  // The entries of a pack: {type, size, time, attr, name, extra, data}.
  K.parsePack = function (blob) {
    if (!U.startsWith(blob, "CAP")) throw new Error("not an EZ Loader pack (no CAP header)");
    const count = U.u32le(blob, 0x17);
    let pos = 0x1B;
    const entries = [];
    for (let i = 0; i < count; i++) {
      const type = U.u32le(blob, pos), size = (U.u32le(blob, pos + 4) ^ 0x55555555) >>> 0;
      const time = U.u32le(blob, pos + 8), attr = U.u32le(blob, pos + 12);
      pos += 16;
      // The name is UTF-16 under a 16-bit XOR chain (key 0x8228) with no
      // terminator; a 32-bit word follows it, then the next entry's type
      // (1-3) or, after the last entry, the bzip2 stream.
      let nameLen = null;
      for (let n = 1; n < 128; n++) {
        const after = pos + 2 * n + 4, nxt = blob.subarray(after, after + 4);
        const ok = i + 1 < count
          ? nxt.length === 4 && !nxt[1] && !nxt[2] && !nxt[3] && nxt[0] >= 1 && nxt[0] <= 3
          : U.startsWith(nxt, "BZh");
        if (ok) { nameLen = n; break; }
      }
      if (nameLen === null) throw new Error("entry " + i + ": cannot find the end of its name");
      const name = String.fromCharCode(...unchain16(words16(blob, pos, nameLen), 0x8228));
      pos += 2 * nameLen;
      const extra = U.u32le(blob, pos);
      pos += 4;
      entries.push({ type, size, time, attr, name, extra });
    }
    const data = C.bunzip2(blob.subarray(pos));
    let off = 0;
    for (const e of entries) {
      e.data = data.subarray(off, off + e.size);
      off += e.size;
    }
    return entries;
  };

  // A pack entry's contents as the Cybiko (or EZ Loader) uses them: files
  // under the 8-bit chain (key 0x82), scripts as UTF-8 text.
  K.decodeFile = function (e) {
    const body = e.data.subarray(12);
    if (e.type === 3) {
      const n = body.length >> 1;
      const w = unchain16(words16(body, 0, n), 0x8228);
      const raw = new Uint8Array(2 * n);
      w.forEach((v, i) => { raw[2 * i] = v & 255; raw[2 * i + 1] = v >> 8; });
      const text = new TextDecoder("utf-16le").decode(raw);
      return U.utf8(text.replace(/\r\n/g, "\n"));
    }
    return unchain8(body, 0x82);
  };

  // ---- CyOS archives -------------------------------------------------------

  class Bits {                            // LSB first
    constructor(d) { this.d = d; this.pos = 0; this.cur = 0; this.left = 0; }
    bit() {
      if (!this.left) {
        this.cur = this.pos < this.d.length ? this.d[this.pos] : 0;
        this.pos++;
        this.left = 8;
      }
      const b = this.cur & 1;
      this.cur >>= 1;
      this.left--;
      return b;
    }
    bits(n) {
      let v = 0;
      for (let i = 0; i < n; i++) v = v << 1 | this.bit();
      return v;
    }
  }

  function length(b) {
    if (!b.bit()) return 2 + b.bit();
    if (!b.bit()) return 4 + b.bit();
    if (!b.bit()) return !b.bit() ? 6 : 8 + b.bit();
    if (!b.bit()) return !b.bit() ? 7 : 10 + b.bit();
    const t = b.bits(3);
    switch (t) {
      case 0: return 12;
      case 1: return 13;
      case 2: return 0x14 + b.bits(2);
      case 3: return 16 + b.bit();
      case 4: return 0x18 + b.bits(3);
      case 5: return 14;
      case 6: return !b.bit() ? 0x20 + b.bits(5) : 18 + b.bit();
    }
    if (!b.bit()) return 15;
    if (!b.bit()) return 0x40 + b.bits(6);
    if (!b.bit()) return 0x80 + b.bits(7);
    return 0x100;
  }

  function offset(b) {
    const t = b.bits(3);
    switch (t) {
      case 0: return 0x400 + b.bits(10);
      case 1: return 0x200 + b.bits(9);
      case 2: return 0x100 + b.bits(8);
      case 3: return 0x40 + b.bits(6);
      case 4: return 0x80 + b.bits(7);
      case 5: return !b.bit() ? 0x800 + b.bits(11) : 0x1000 + b.bits(12);
      case 6: return !b.bit() ? 0x20 + b.bits(5) : 0x10 + b.bits(4);
    }
    const u = b.bits(2);
    if (u === 0) return b.bits(1);
    if (u === 1) return 6 + b.bits(2);
    if (u === 2) return b.bit() ? 2 : 4 + b.bit();
    if (!b.bit()) return 0xC + b.bits(2);
    if (!b.bit()) return 3;
    return 10 + b.bit();
  }

  // CyOS method 2: literals and back references.
  K.cyUnpack = function (data, size) {
    const b = new Bits(data), out = new Uint8Array(size);
    let n = 0;
    while (n < size) {
      if (!b.bit()) out[n++] = b.bits(8);
      else {
        const len = length(b), dist = offset(b) + len;
        for (let i = 0; i < len && n < size; i++, n++) out[n] = n >= dist ? out[n - dist] : 0;
      }
    }
    return out;
  };

  function cstr(blob, at) {
    const end = blob.indexOf(0, at);
    if (end < 0 || at >= blob.length) throw new Error("subsection not found");
    return U.latin1(blob.subarray(at, end));
  }

  // [{name, method, data}] for each part of a Cy archive (data null for an
  // unknown method).
  K.cyEntries = function (blob) {
    if (!U.startsWith(blob, "Cy")) throw new Error("not a CyOS archive (no Cy header)");
    const n = U.u16be(blob, 2), parts = [];
    for (let i = 0; i < n; i++) {
      const nameOff = U.u16be(blob, 6 + 10 * i), off = U.u32be(blob, 8 + 10 * i), size = U.u32be(blob, 12 + 10 * i);
      const name = cstr(blob, nameOff);
      const raw = blob.subarray(off, off + size);
      const method = raw.length ? raw[0] : 0;
      let data = null;
      if (method === 0) data = raw.subarray(1);
      else if (method === 2) data = K.cyUnpack(raw.subarray(5), U.u32be(raw, 1));
      parts.push({ name, method, data });
    }
    return parts;
  };

  // Codes for method 2: [bits before the extra bits, base, extra bits].
  const LENGTH_CODES = [["0", 2, 1], ["10", 4, 1], ["1100", 6, 0], ["1101", 8, 1],
    ["11100", 7, 0], ["11101", 10, 1], ["1111000", 12, 0], ["1111001", 13, 0], ["1111010", 20, 2],
    ["1111011", 16, 1], ["1111100", 24, 3], ["1111101", 14, 0], ["11111100", 32, 5],
    ["11111101", 18, 1], ["11111110", 15, 0], ["111111110", 64, 6], ["1111111110", 128, 7],
    ["1111111111", 256, 0]];
  const OFFSET_CODES = [["000", 1024, 10], ["001", 512, 9], ["010", 256, 8], ["011", 64, 6],
    ["100", 128, 7], ["1010", 2048, 11], ["1011", 4096, 12], ["1100", 32, 5], ["1101", 16, 4],
    ["11100", 0, 1], ["11101", 6, 2], ["111101", 2, 0], ["111100", 4, 1], ["111110", 12, 2],
    ["1111110", 3, 0], ["1111111", 10, 1]];

  function codeTable(codes, top) {
    const t = new Array(top + 1).fill(null);
    for (const [prefix, base, extra] of codes)
      for (let v = 0; v < 1 << extra; v++)
        t[base + v] = prefix + (extra ? v.toString(2).padStart(extra, "0") : "");
    return t;
  }
  const LENGTHS = codeTable(LENGTH_CODES, 256), OFFSETS = codeTable(OFFSET_CODES, 8191);
  const MAX_MATCH = 256, MAX_DIST = 8191;     // the CyOS decoder's window

  // Compress with CyOS method 2 (greedy LZ77), exactly as cybiko_cap.py.
  K.cyPack = function (data) {
    const n = data.length, heads = new Map();
    const out = [];
    let acc = 0, nbits = 0;
    const put = s => {
      for (let k = 0; k < s.length; k++) {
        if (s.charCodeAt(k) === 49) acc |= 1 << nbits;
        if (++nbits === 8) { out.push(acc); acc = 0; nbits = 0; }
      }
    };
    const key = p => data[p] << 16 | data[p + 1] << 8 | data[p + 2];
    const remember = p => {
      if (p + 3 <= n) {
        const k = key(p);
        let l = heads.get(k);
        if (!l) heads.set(k, l = []);
        l.push(p);
      }
    };
    let i = 0;
    while (i < n) {
      let bestLen = 0, bestDist = 0;
      const cand = i + 3 <= n ? heads.get(key(i)) : undefined;
      if (cand) {
        for (let c = cand.length - 1; c >= Math.max(0, cand.length - 48); c--) {
          const j = cand[c], dist = i - j;
          if (dist > MAX_DIST) break;
          const limit = Math.min(MAX_MATCH, dist, n - i);
          if (limit <= bestLen) continue;
          let k = 0;
          while (k < limit && data[j + k] === data[i + k]) k++;
          if (k >= 2 && k > bestLen) {
            bestLen = k; bestDist = dist;
            if (k === MAX_MATCH) break;
          }
        }
      }
      if (bestLen >= 2) {
        put("1" + LENGTHS[bestLen] + OFFSETS[bestDist - bestLen]);
        for (let p = i; p < i + bestLen; p++) remember(p);
        i += bestLen;
      } else {
        put("0" + data[i].toString(2).padStart(8, "0"));
        remember(i);
        i++;
      }
    }
    if (nbits) out.push(acc);
    return Uint8Array.from(out);
  };

  // A Cy archive from [{name, data, compress}].
  K.cyArchive = function (parts) {
    const names = parts.map(p => U.toLatin1(p.name));
    const stored = parts.map(p => {
      const packed = p.compress ? K.cyPack(p.data) : null;
      if (packed && packed.length + 5 < p.data.length + 1)
        return new U.Buf().u8(2).u32be(p.data.length).bytes(packed).done();
      return new U.Buf().u8(0).bytes(p.data).done();
    });
    const table = 6 + 10 * parts.length;
    let nameLen = 0;
    for (const nm of names) nameLen += nm.length + 1;
    const dataStart = table + nameLen;
    const head = new U.Buf().str("Cy").u16be(parts.length).u16be(dataStart - 6);
    let nameOff = table, off = dataStart;
    parts.forEach((p, k) => {
      head.u16be(nameOff).u32be(off).u32be(stored[k].length);
      nameOff += names[k].length + 1;
      off += stored[k].length;
    });
    for (const nm of names) head.bytes(nm).u8(0);
    for (const s of stored) head.bytes(s);
    return head.done();
  };

  K.safeName = function (name) {
    const parts = name.replace(/\\/g, "/").split("/");
    const last = parts[parts.length - 1];
    return ["", ".", ".."].includes(last) ? "_" : last;
  };

  // [{pos, names}] for the Cy archives in a flash dump.
  K.findArchives = function (blob) {
    const found = [];
    let pos = indexOf(blob, 0);
    while (pos >= 0) {
      try {
        const n = U.u16be(blob, pos + 2), dsize = U.u16be(blob, pos + 4);
        const names = [];
        if (n > 0 && n < 1000 && dsize >= 10 * n) {
          for (let i = 0; i < n; i++) {
            const at = pos + 6 + 10 * i;
            const no = U.u16be(blob, at), off = U.u32be(blob, at + 2), size = U.u32be(blob, at + 6);
            if (!(6 + 10 * n <= no && no < dsize + 6) || off + size > blob.length - pos) break;
            const end = blob.indexOf(0, pos + no);
            if (end < 0) throw new Error("no end");
            const name = blob.subarray(pos + no, end);
            if (!(name.length > 0 && name.length <= 40) || !name.every(c => c >= 32 && c < 127)) break;
            names.push(U.latin1(name));
          }
        }
        if (names.length && names.length === n) found.push({ pos, names });
      } catch (e) { /* not an archive */ }
      pos = indexOf(blob, pos + 1);
    }
    return found;
  };

  function indexOf(blob, from) {              // the next "Cy"
    for (let i = from; i + 1 < blob.length; i++) if (blob[i] === 0x43 && blob[i + 1] === 0x79) return i;
    return -1;
  }

  // ---- what the command line prints -------------------------------------------

  K.listPack = function (entries) {
    return entries.map(e => U.padR(K.TYPE_NAMES[e.type] || "type " + e.type, 7) + " " +
      U.padL(e.size, 8) + "  " + e.name).join("\n") + (entries.length ? "\n" : "");
  };
  K.listApp = function (parts) {
    return parts.map(p => U.padR(p.name, 24) + " method " + p.method + "  " +
      (p.data ? p.data.length : "?") + " bytes").join("\n") + (parts.length ? "\n" : "");
  };
  K.listFlash = function (found) {
    return found.map(f => U.hex(f.pos, 6) + "  " + U.padL(f.names.length, 2) + " parts: " +
      f.names.join(" ")).join("\n") + (found.length ? "\n" : "");
  };

  // `pack DIR`: files (by name) sorted, root.inf first.
  K.packFiles = function (files, store) {
    const names = files.map(f => f.name).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    const k = names.indexOf("root.inf");
    if (k >= 0) { names.splice(k, 1); names.unshift("root.inf"); }
    const byName = new Map(files.map(f => [f.name, f.data]));
    return K.cyArchive(names.map(nm => ({ name: nm, data: byName.get(nm), compress: !store.has(nm) })));
  };
})(globalThis.Cybiko = globalThis.Cybiko || {});
