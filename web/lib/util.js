// From SovGVD/cybiko-docs web/lib/util.js (the converters' page), copied as is.
// Shared helpers for the Cybiko converters: Python's number rules (so the
// results match the Python tools in ../tools byte for byte), bytes, zlib,
// PNG and ZIP writing. Plain script, no modules: works from file:// too.
(function (C) {
  "use strict";
  const U = C.util = {};

  // ---- Python's arithmetic -----------------------------------------------

  // round(): halves go to the even neighbour.
  U.round = function (x) {
    const r = Math.round(x);
    return Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : r;
  };

  // a // b for whole numbers (floors, also below zero).
  U.floorDiv = (a, b) => Math.floor(a / b);

  // "%.Nf": rounds the exact binary value, halves to even, as Python does.
  U.fixed = function (x, d) {
    if (!isFinite(x)) return x > 0 ? "inf" : x < 0 ? "-inf" : "nan";
    const neg = x < 0 || Object.is(x, -0);
    const full = Math.abs(x).toFixed(100);
    const dot = full.indexOf(".");
    let keep = full.slice(0, dot + 1 + d).replace(".", "");
    const rest = full.slice(dot + 1 + d);
    const up = rest[0] > "5" || (rest[0] === "5" && /[1-9]/.test(rest.slice(1))) ||
      (rest[0] === "5" && !/[1-9]/.test(rest.slice(1)) && (keep.charCodeAt(keep.length - 1) & 1));
    if (up) {
      const digits = keep.split("").map(Number);
      let i = digits.length - 1;
      while (i >= 0 && digits[i] === 9) digits[i--] = 0;
      if (i < 0) digits.unshift(1); else digits[i]++;
      keep = digits.join("");
    }
    let s = d ? keep.slice(0, keep.length - d) + "." + keep.slice(keep.length - d) : keep;
    if (s.startsWith(".")) s = "0" + s;
    return (neg ? "-" : "") + s;
  };

  // "%-Nd" / "%Nd" / "%0Nx" style padding.
  U.padL = (s, n, c) => String(s).padStart(n, c || " ");
  U.padR = (s, n) => String(s).padEnd(n, " ");
  U.hex = (v, n) => v.toString(16).padStart(n, "0");

  // int(s) and int(s, 0) for the strings a user types.
  U.int = function (s, base0) {
    let t = String(s).trim().replace(/(\w)_(?=\w)/g, "$1");
    let m = /^([+-]?)(\d+)$/.exec(t);
    if (m && (!base0 || !/^0\d/.test(m[2]) || /^0+$/.test(m[2]))) return Number(m[1] + m[2]);
    if (base0 && (m = /^([+-]?)0([xob])([0-9a-f]+)$/i.exec(t))) {
      const b = { x: 16, o: 8, b: 2 }[m[2].toLowerCase()];
      if ([...m[3]].every(ch => parseInt(ch, 16) < b)) return (m[1] === "-" ? -1 : 1) * parseInt(m[3], b);
    }
    throw new Error("invalid literal for int(): '" + s + "'");
  };

  // float(s).
  U.float = function (s) {
    const t = String(s).trim().replace(/(\d)_(?=\d)/g, "$1");
    if (/^[+-]?((\d+\.?\d*|\.\d+)(e[+-]?\d+)?)$/i.test(t)) return Number(t);
    const m = /^([+-]?)(inf|infinity|nan)$/i.exec(t);
    if (m) return m[2].toLowerCase() === "nan" ? NaN : (m[1] === "-" ? -Infinity : Infinity);
    throw new Error("could not convert string to float: '" + s + "'");
  };

  // str.splitlines()
  U.splitlines = function (text) {
    const lines = text.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    return lines;
  };

  // ---- bytes -----------------------------------------------------------------

  U.concat = function (parts) {
    let n = 0;
    for (const p of parts) n += p.length;
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };

  U.latin1 = function (bytes) {           // bytes -> str
    let s = "";
    for (let i = 0; i < bytes.length; i += 8192)
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return s;
  };

  U.toLatin1 = function (str, replace) {  // str -> bytes
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      if (c > 255) {
        if (!replace) throw new Error("'latin-1' codec can't encode character " + JSON.stringify(str[i]));
        out[i] = 63;                       // "?"
      } else out[i] = c;
    }
    return out;
  };

  U.utf8 = s => new TextEncoder().encode(s);
  U.fromUtf8 = b => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(b);
  U.startsWith = (bytes, s) => s.length <= bytes.length && [...s].every((c, i) => bytes[i] === c.charCodeAt(0));

  // A growing byte buffer with big- and little-endian writers.
  U.Buf = class {
    constructor() { this.a = new Uint8Array(256); this.n = 0; }
    room(k) {
      if (this.n + k > this.a.length) {
        const b = new Uint8Array(Math.max(this.a.length * 2, this.n + k));
        b.set(this.a.subarray(0, this.n));
        this.a = b;
      }
    }
    u8(v) { this.room(1); this.a[this.n++] = v & 255; return this; }
    bytes(b) { this.room(b.length); this.a.set(b, this.n); this.n += b.length; return this; }
    str(s) { return this.bytes(U.toLatin1(s)); }
    u16be(v) { return this.u8(v >> 8).u8(v); }
    u32be(v) { return this.u8(v >>> 24).u8(v >>> 16).u8(v >>> 8).u8(v); }
    u16le(v) { return this.u8(v).u8(v >> 8); }
    u32le(v) { return this.u8(v).u8(v >>> 8).u8(v >>> 16).u8(v >>> 24); }
    done() { return this.a.slice(0, this.n); }
  };

  function need(b, off, n) {
    if (off < 0 || off + n > b.length) throw new Error("unpack requires a buffer of " + n + " bytes");
  }
  U.u16be = (b, o) => (need(b, o, 2), b[o] << 8 | b[o + 1]);
  U.u32be = (b, o) => (need(b, o, 4), (b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) >>> 0);
  U.u16le = (b, o) => (need(b, o, 2), b[o] | b[o + 1] << 8);
  U.i16le = (b, o) => (U.u16le(b, o) << 16) >> 16;
  U.u32le = (b, o) => (need(b, o, 4), (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0);
  U.i32le = (b, o) => U.u32le(b, o) | 0;

  // ---- CRC-32 and zlib ---------------------------------------------------------

  const CRC = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    CRC[n] = c >>> 0;
  }
  U.crc32 = function (b, crc) {
    let c = (crc === undefined ? 0 : crc) ^ 0xFFFFFFFF;
    for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };

  async function stream(data, ts) {
    const out = new Response(new Blob([data]).stream().pipeThrough(ts));
    return new Uint8Array(await out.arrayBuffer());
  }
  U.inflate = data => stream(data, new DecompressionStream("deflate"));   // zlib.decompress
  U.deflate = data => stream(data, new CompressionStream("deflate"));     // zlib.compress

  // An 8-bit grey PNG from rows of 0-255 values.
  U.greyPng = async function (w, h, rows) {
    const raw = new Uint8Array(h * (w + 1));
    rows.forEach((r, y) => raw.set(r, y * (w + 1) + 1));
    const chunk = (kind, data) => {
      const body = U.concat([U.toLatin1(kind), data]);
      return new U.Buf().u32be(data.length).bytes(body).u32be(U.crc32(body)).done();
    };
    const ihdr = new U.Buf().u32be(w).u32be(h).bytes([8, 0, 0, 0, 0]).done();
    return U.concat([new Uint8Array([0x89, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr),
      chunk("IDAT", await U.deflate(raw)), chunk("IEND", new Uint8Array(0))]);
  };

  // A ZIP file (stored, no compression) from [{name, data}].
  U.zip = function (files) {
    const head = new U.Buf(), dir = new U.Buf();
    for (const f of files) {
      const name = U.utf8(f.name), crc = U.crc32(f.data), at = head.n;
      head.u32le(0x04034b50).u16le(20).u16le(0x800).u16le(0).u16le(0).u16le(0x21)
        .u32le(crc).u32le(f.data.length).u32le(f.data.length).u16le(name.length).u16le(0)
        .bytes(name).bytes(f.data);
      dir.u32le(0x02014b50).u16le(20).u16le(20).u16le(0x800).u16le(0).u16le(0).u16le(0x21)
        .u32le(crc).u32le(f.data.length).u32le(f.data.length).u16le(name.length)
        .u16le(0).u16le(0).u16le(0).u16le(0).u32le(0).u32le(at).bytes(name);
    }
    const d = dir.done();
    const end = new U.Buf().u32le(0x06054b50).u16le(0).u16le(0).u16le(files.length)
      .u16le(files.length).u32le(d.length).u32le(head.n).u16le(0).done();
    return U.concat([head.done(), d, end]);
  };

  // os.path.splitext
  U.splitext = function (name) {
    const base = name.slice(name.lastIndexOf("/") + 1);
    const dot = base.lastIndexOf(".");
    if (dot <= 0 || /^\.+$/.test(base.slice(0, dot + 1))) return [name, ""];
    const cut = name.length - base.length + dot;
    return [name.slice(0, cut), name.slice(cut)];
  };
})(globalThis.Cybiko = globalThis.Cybiko || {});
