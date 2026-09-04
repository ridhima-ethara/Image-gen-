import sharp from 'sharp';
const [src, out, w] = process.argv.slice(2);
const m = await sharp(src).resize(Number(w) || 1100).png().toFile(out);
console.log(out, m.width + 'x' + m.height);
