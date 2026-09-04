import sharp from 'sharp';
import fs from 'node:fs/promises';
const files = (await fs.readdir(process.argv[2])).filter(f => f.endsWith('.png')).sort();
const COLS = 3, W = 620, GAP = 10;
const tiles = [];
let maxH = 0;
for (const f of files) {
  const buf = await sharp(`${process.argv[2]}/${f}`).resize(W).png().toBuffer();
  const m = await sharp(buf).metadata();
  maxH = Math.max(maxH, m.height);
  tiles.push(buf);
}
const rows = Math.ceil(tiles.length / COLS);
const canvasW = COLS * W + (COLS + 1) * GAP;
const canvasH = rows * maxH + (rows + 1) * GAP;
const composite = tiles.map((input, i) => ({
  input,
  left: GAP + (i % COLS) * (W + GAP),
  top: GAP + Math.floor(i / COLS) * (maxH + GAP),
}));
await sharp({ create: { width: canvasW, height: canvasH, channels: 3, background: '#2b2b2b' } })
  .composite(composite).png().toFile(process.argv[3]);
console.log(process.argv[3], canvasW + 'x' + canvasH, files.length + ' tiles');
