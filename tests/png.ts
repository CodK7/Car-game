// Minimal PNG decoder (8-bit RGB/RGBA/gray, non-interlaced) for tests. Uses node:zlib only.
import { inflateSync } from 'node:zlib';

export const PNG = {
  decode(buf: Buffer): { width: number; height: number; rgba: Uint8Array } {
    let p = 8;
    let width = 0, height = 0, depth = 0, ctype = 0;
    const idat: Buffer[] = [];
    while (p < buf.length) {
      const len = buf.readUInt32BE(p);
      const type = buf.toString('ascii', p + 4, p + 8);
      const d = buf.subarray(p + 8, p + 8 + len);
      if (type === 'IHDR') {
        width = d.readUInt32BE(0);
        height = d.readUInt32BE(4);
        depth = d[8];
        ctype = d[9];
        if (d[12] !== 0) throw new Error('interlaced PNG not supported');
      } else if (type === 'IDAT') idat.push(d);
      else if (type === 'IEND') break;
      p += 12 + len;
    }
    if (depth !== 8) throw new Error(`PNG depth ${depth} not supported`);
    const ch = ctype === 6 ? 4 : ctype === 2 ? 3 : ctype === 0 ? 1 : ctype === 4 ? 2 : 0;
    if (!ch) throw new Error(`PNG colour type ${ctype} not supported`);
    const raw = inflateSync(Buffer.concat(idat));
    const stride = width * ch;
    const cur = new Uint8Array(stride);
    const prev = new Uint8Array(stride);
    const out = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      const f = raw[y * (stride + 1)];
      const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
      for (let i = 0; i < stride; i++) {
        const a = i >= ch ? cur[i - ch] : 0;
        const b = prev[i];
        const c = i >= ch ? prev[i - ch] : 0;
        let v = row[i];
        if (f === 1) v += a;
        else if (f === 2) v += b;
        else if (f === 3) v += (a + b) >> 1;
        else if (f === 4) {
          const pp = a + b - c;
          const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        cur[i] = v & 255;
      }
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        if (ch >= 3) {
          out[o] = cur[x * ch]; out[o + 1] = cur[x * ch + 1]; out[o + 2] = cur[x * ch + 2]; out[o + 3] = ch === 4 ? cur[x * ch + 3] : 255;
        } else {
          out[o] = out[o + 1] = out[o + 2] = cur[x * ch]; out[o + 3] = ch === 2 ? cur[x * ch + 1] : 255;
        }
      }
      prev.set(cur);
    }
    return { width, height, rgba: out };
  },
};
