// From SovGVD/cybiko-docs web/lib/bzip2.js (the converters' page), copied as is.
// bzip2 decompression (EZ Loader packs keep their files in one bzip2
// stream). Like Python's bz2.decompress: streams one after another are
// joined, and junk after a complete stream is ignored.
(function (C) {
  "use strict";

  const CRC = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 24;
    for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04C11DB7 : c << 1;
    CRC[i] = c >>> 0;
  }

  class Bits {
    constructor(data, pos) { this.d = data; this.pos = pos; this.buf = 0; this.cnt = 0; }
    get(n) {
      while (this.cnt < n) {
        if (this.pos >= this.d.length) throw new Error("bzip2: data cut short");
        this.buf = ((this.buf & 0xFFFFFF) << 8) | this.d[this.pos++];
        this.cnt += 8;
      }
      this.cnt -= n;
      return (this.buf >>> this.cnt) & ((1 << n) - 1);
    }
    bit() { return this.get(1); }
  }

  function block(b, max, out) {
    const crc = b.get(16) * 65536 + b.get(16);
    if (b.bit()) throw new Error("bzip2: randomised blocks are not supported");
    const origPtr = b.get(24);
    const used = b.get(16), seq = [];
    for (let i = 0; i < 16; i++)
      if (used & (0x8000 >> i)) {
        const m = b.get(16);
        for (let j = 0; j < 16; j++) if (m & (0x8000 >> j)) seq.push(i * 16 + j);
      }
    if (!seq.length) throw new Error("bzip2: no symbols");
    const alpha = seq.length + 2;
    const nGroups = b.get(3), nSel = b.get(15);
    if (nGroups < 2 || nGroups > 6 || !nSel) throw new Error("bzip2: bad table count");
    const mtfG = [0, 1, 2, 3, 4, 5].slice(0, nGroups), sel = new Uint8Array(nSel);
    for (let i = 0; i < nSel; i++) {
      let j = 0;
      while (b.bit()) if (++j >= nGroups) throw new Error("bzip2: bad selector");
      const v = mtfG[j];
      mtfG.splice(j, 1);
      mtfG.unshift(v);
      sel[i] = v;
    }
    const tables = [];
    for (let g = 0; g < nGroups; g++) {
      const len = new Uint8Array(alpha);
      let cur = b.get(5);
      for (let s = 0; s < alpha; s++) {
        for (;;) {
          if (cur < 1 || cur > 20) throw new Error("bzip2: bad code length");
          if (!b.bit()) break;
          cur += b.bit() ? -1 : 1;
        }
        len[s] = cur;
      }
      let minL = 32, maxL = 0;
      for (const l of len) { if (l < minL) minL = l; if (l > maxL) maxL = l; }
      const perm = [], limit = new Int32Array(22), base = new Int32Array(22);
      for (let l = minL; l <= maxL; l++) for (let s = 0; s < alpha; s++) if (len[s] === l) perm.push(s);
      let code = 0, idx = 0;
      for (let l = minL; l <= maxL; l++) {
        let cnt = 0;
        for (let s = 0; s < alpha; s++) if (len[s] === l) cnt++;
        base[l] = idx - code;
        code += cnt;
        idx += cnt;
        limit[l] = code - 1;
        code <<= 1;
      }
      tables.push({ minL, maxL, perm, limit, base });
    }
    // Huffman + run lengths + move to front -> the BWT's last column.
    const ll = new Uint8Array(max), counts = new Int32Array(256), mtf = seq.map((_, i) => i);
    let n = 0, groupLeft = 0, gi = -1, t = null, runPos = 0, run = 0;
    for (;;) {
      if (!groupLeft) {
        if (++gi >= nSel) throw new Error("bzip2: ran out of selectors");
        t = tables[sel[gi]];
        groupLeft = 50;
      }
      groupLeft--;
      let l = t.minL, v = b.get(l);
      while (v > t.limit[l]) {
        if (++l > t.maxL) throw new Error("bzip2: bad Huffman code");
        v = (v << 1) | b.bit();
      }
      const sym = t.perm[v + t.base[l]];
      if (sym <= 1) {
        if (!runPos) { runPos = 1; run = 0; }
        run += runPos << sym;
        runPos <<= 1;
        if (run > max) throw new Error("bzip2: run too long");
        continue;
      }
      if (runPos) {
        runPos = 0;
        const c = seq[mtf[0]];
        if (n + run > max) throw new Error("bzip2: block too big");
        ll.fill(c, n, n + run);
        counts[c] += run;
        n += run;
      }
      if (sym === alpha - 1) break;
      if (n >= max) throw new Error("bzip2: block too big");
      const k = sym - 1, v2 = mtf[k];
      mtf.copyWithin(1, 0, k);
      mtf[0] = v2;
      const c = seq[v2];
      ll[n++] = c;
      counts[c]++;
    }
    if (origPtr >= n && n) throw new Error("bzip2: bad origin pointer");
    // Undo the Burrows-Wheeler transform, then the first run-length step.
    const tt = new Int32Array(n), start = new Int32Array(256);
    for (let i = 0, s = 0; i < 256; i++) { start[i] = s; s += counts[i]; }
    for (let i = 0; i < n; i++) tt[start[ll[i]]++] = i;
    let p = n ? tt[origPtr] : 0, last = -1, same = 0, c32 = 0xFFFFFFFF;
    const put = v => { out.u8(v); c32 = ((c32 << 8) ^ CRC[((c32 >>> 24) ^ v) & 255]) >>> 0; };
    for (let k = 0; k < n; k++) {
      const v = ll[p];
      p = tt[p];
      if (same === 4) {
        for (let r = 0; r < v; r++) put(last);
        same = 0;
        last = -1;
        continue;
      }
      if (v === last) same++; else { same = 1; last = v; }
      put(v);
    }
    if (((c32 ^ 0xFFFFFFFF) >>> 0) !== crc) throw new Error("bzip2: block CRC mismatch");
  }

  function oneStream(data, pos, out) {
    if (data[pos] !== 0x42 || data[pos + 1] !== 0x5A || data[pos + 2] !== 0x68 ||
        data[pos + 3] < 0x31 || data[pos + 3] > 0x39) throw new Error("bzip2: not a bzip2 stream");
    const max = (data[pos + 3] - 0x30) * 100000;
    const b = new Bits(data, pos + 4);
    for (;;) {
      const h = b.get(24), l = b.get(24);
      if (h === 0x314159 && l === 0x265359) block(b, max, out);
      else if (h === 0x177245 && l === 0x385090) { b.get(16); b.get(16); return b.pos; }
      else throw new Error("bzip2: bad block header");
    }
  }

  C.bunzip2 = function (data) {
    const out = new C.util.Buf();
    let pos = 0, first = true;
    while (pos < data.length) {
      const keep = out.n;
      try {
        pos = oneStream(data, pos, out);
      } catch (e) {
        if (first) throw e;
        out.n = keep;                      // junk after the data: ignored
        break;
      }
      first = false;
    }
    return out.done();
  };
})(globalThis.Cybiko = globalThis.Cybiko || {});
