// Simplify index buffers with meshoptimizer. argv: manifest.json (written by convert.py)
import { MeshoptSimplifier } from 'meshoptimizer';
import fs from 'node:fs';

await MeshoptSimplifier.ready;
const f32 = (b) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
const u32 = (b) => new Uint32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
const man = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const g of man.groups) {
  const pos = f32(fs.readFileSync(g.pos));
  const idx = u32(fs.readFileSync(g.idx));
  const target = Math.max(3, Math.floor((idx.length * g.ratio) / 3) * 3);
  let out = idx;
  if (idx.length > 300 && target < idx.length) {
    const [res, err] = MeshoptSimplifier.simplify(idx, pos, 3, target, g.error, []);
    out = res;
    g.err = err;
  }
  fs.writeFileSync(g.out, Buffer.from(out.buffer, out.byteOffset, out.byteLength));
  g.before = idx.length / 3;
  g.after = out.length / 3;
}
fs.writeFileSync(process.argv[2], JSON.stringify(man, null, 1));
