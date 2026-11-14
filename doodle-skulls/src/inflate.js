/* Minimal synchronous gzip/zlib/deflate decoder (no dependencies).
   Needed because DecompressionStream is missing from Safari on macOS Catalina. */
(function (root) {
  'use strict';
  var LBASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  var LEXT = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  var DBASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  var DEXT = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  var CLORD = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];

  function build(lengths, n) {
    var count = new Uint16Array(16), offs = new Uint16Array(16), symbols = new Uint16Array(n), i;
    for (i = 0; i < n; i++) count[lengths[i]]++;
    count[0] = 0;
    for (i = 1; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1];
    for (i = 0; i < n; i++) if (lengths[i]) symbols[offs[lengths[i]]++] = i;
    return { count: count, symbols: symbols };
  }

  function rawInflate(src, pos) {
    var out = new Uint8Array(Math.max(1024, src.length * 4)), op = 0, bitBuf = 0, bitCnt = 0;
    function grow(need) {
      if (op + need <= out.length) return;
      var n = new Uint8Array(Math.max(out.length * 2, op + need));
      n.set(out); out = n;
    }
    function bits(n) {
      while (bitCnt < n) { bitBuf |= src[pos++] << bitCnt; bitCnt += 8; }
      var v = bitBuf & ((1 << n) - 1);
      bitBuf >>>= n; bitCnt -= n;
      return v;
    }
    function decode(h) {
      var code = 0, first = 0, index = 0;
      for (var len = 1; len < 16; len++) {
        code |= bits(1);
        var c = h.count[len];
        if (code - c < first) return h.symbols[index + (code - first)];
        index += c; first += c; first <<= 1; code <<= 1;
      }
      throw new Error('bad huffman code');
    }
    var fl = new Uint8Array(288), i;
    for (i = 0; i < 144; i++) fl[i] = 8;
    for (; i < 256; i++) fl[i] = 9;
    for (; i < 280; i++) fl[i] = 7;
    for (; i < 288; i++) fl[i] = 8;
    var fixedL = build(fl, 288), fd = new Uint8Array(30);
    for (i = 0; i < 30; i++) fd[i] = 5;
    var fixedD = build(fd, 30), last;
    do {
      last = bits(1);
      var type = bits(2);
      if (type === 0) {
        bitBuf = 0; bitCnt = 0;
        var len = src[pos] | (src[pos + 1] << 8); pos += 4;
        grow(len);
        for (i = 0; i < len; i++) out[op++] = src[pos++];
      } else {
        var lc, dc;
        if (type === 1) { lc = fixedL; dc = fixedD; }
        else if (type === 2) {
          var nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4, lens = new Uint8Array(320);
          for (i = 0; i < ncode; i++) lens[CLORD[i]] = bits(3);
          var cl = build(lens, 19), idx = 0;
          lens = new Uint8Array(320);
          while (idx < nlen + ndist) {
            var sym = decode(cl);
            if (sym < 16) lens[idx++] = sym;
            else {
              var prev = 0, rep;
              if (sym === 16) { prev = lens[idx - 1]; rep = 3 + bits(2); }
              else if (sym === 17) rep = 3 + bits(3);
              else rep = 11 + bits(7);
              while (rep--) lens[idx++] = prev;
            }
          }
          lc = build(lens.subarray(0, nlen), nlen);
          dc = build(lens.subarray(nlen, nlen + ndist), ndist);
        } else throw new Error('bad block type');
        for (;;) {
          var s = decode(lc);
          if (s < 256) { grow(1); out[op++] = s; }
          else if (s === 256) break;
          else {
            s -= 257;
            var l = LBASE[s] + bits(LEXT[s]), ds = decode(dc), d = DBASE[ds] + bits(DEXT[ds]);
            grow(l);
            for (i = 0; i < l; i++) { out[op] = out[op - d]; op++; }
          }
        }
      }
    } while (!last);
    return out.subarray(0, op);
  }

  function gunzip(data) {
    if (data[0] === 0x1f && data[1] === 0x8b) {
      var flg = data[3], p = 10;
      if (flg & 4) { p += 2 + (data[p] | (data[p + 1] << 8)); }
      if (flg & 8) { while (data[p++]) {} }
      if (flg & 16) { while (data[p++]) {} }
      if (flg & 2) p += 2;
      return rawInflate(data, p);
    }
    if ((data[0] & 0x0f) === 8) return rawInflate(data, 2); /* zlib */
    return rawInflate(data, 0);
  }

  function base64ToBytes(b64) {
    var bin = (typeof atob === 'function') ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
    var a = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }

  root.DS2 = root.DS2 || {};
  root.DS2.gunzip = gunzip;
  root.DS2.base64ToBytes = base64ToBytes;
  if (typeof module !== 'undefined') module.exports = { gunzip: gunzip, base64ToBytes: base64ToBytes };
})(typeof window !== 'undefined' ? window : globalThis);
