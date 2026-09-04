import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

/* ============================================================
   Background resolver.

   Measured on this machine: FLUX.2 Klein via Ollama takes ~80s
   per image and ALWAYS returns 1024x1024 -- it ignores width and
   height options. Both facts shape this module:

     - every generation is cached by hash(model, prompt, seed), so
       a background is paid for once and reused forever;
     - the 1024 square is cover-cropped and Lanczos-upscaled to the
       canvas. That's fine for abstract washes and gets soft on
       detailed imagery, which is one more reason `texture` (a
       low-opacity wash) is the default rather than full-bleed.
   ============================================================ */

const OLLAMA = process.env.OLLAMA_HOST || 'http://localhost:11434';
const MODEL = process.env.FLUX_MODEL || 'x/flux2-klein:9b';
const CACHE = 'cache/backgrounds';

/* FLUX will happily scribble fake words into a "clean" background.
   Say so explicitly, every time. */
/* Two jobs. First, keep semantic content out of the image -- FLUX will
   happily scribble fake words into a "clean" background. Second, enforce
   the image-brief skill's forbidden visual direction: cliche AI stock
   imagery is off-brand and must never be generated in the first place. */
const GUARD =
  'no text, no words, no letters, no numbers, no typography, no charts, ' +
  'no graphs, no logos, no watermark, no signature, no UI, no people. ' +
  'Absolutely no glowing brains, no humanoid robots, no neon circuit swirls, ' +
  'no holographic faces, no generic server rooms or data centres, ' +
  'no cyberpunk city, no handshakes or lightbulbs or puzzle pieces. ' +
  'Clean, minimal, technical, research-forward. High signal-to-noise, ' +
  'generous negative space, restrained engineered composition, not busy.';

/* ---- deterministic mesh (free, instant, on-brand) --------------------- */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Blob lightness is capped so type stays legible on the mesh WITHOUT a
   heavy scrim -- the depth comes from saturation and hue spread, not
   from luminance. Lifting these means the contrast gate will crank the
   scrim and flatten the very effect you were reaching for. */
const MESH_TONE = {
  midnight: { base: [64, 6, 11], blobs: [[62, 20], [56, 16], [46, 13]], alpha: 0.9 },
  ink:      { base: [0, 0, 6],   blobs: [[40, 15], [34, 11], [28, 9]],  alpha: 0.8 },
  paper:    { base: [30, 97, 93], blobs: [[46, 93], [38, 96], [30, 94]], alpha: 0.9 },
};

/* A few large, soft, seeded blobs read as depth; CSS gradients alone
   band badly, which is what the grain layer is for. */
export function meshCSS(hue, seed, theme) {
  const rnd = mulberry32(seed);
  const tone = MESH_TONE[theme] || MESH_TONE.midnight;
  const layers = tone.blobs.map(([s, l], i) => {
    const h = (hue + (i - 1) * 16 + rnd() * 12 - 6 + 360) % 360;
    const x = Math.round(8 + rnd() * 84);
    const y = Math.round(6 + rnd() * 80);
    const w = Math.round(46 + rnd() * 44);
    const hgt = Math.round(38 + rnd() * 42);
    return `radial-gradient(${w}% ${hgt}% at ${x}% ${y}%, hsl(${h.toFixed(0)} ${s}% ${l}% / ${tone.alpha}) 0%, transparent 68%)`;
  });
  const baseH = theme === 'ink' ? 0 : hue;
  layers.push(`linear-gradient(152deg, hsl(${baseH} ${tone.base[0]}% ${tone.base[1]}%) 0%, hsl(${(baseH + 16) % 360} ${tone.base[0]}% ${tone.base[2]}%) 100%)`);
  return layers.join(', ');
}

/* Fine monochrome grain. Kills gradient banding and stops flat
   fills reading as plastic. */
export function grainDataURL() {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220">` +
    `<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch"/>` +
    `<feColorMatrix type="saturate" values="0"/></filter>` +
    `<rect width="220" height="220" filter="url(#n)"/></svg>`;
  return `url('data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}')`;
}

/* ---- FLUX via Ollama --------------------------------------------------- */

const keyOf = (prompt, seed) =>
  crypto.createHash('sha256').update(`${MODEL}|${prompt}|${seed}`).digest('hex').slice(0, 20);

async function generateRaw(prompt, seed, log) {
  const key = keyOf(prompt, seed);
  const file = path.join(CACHE, `${key}.png`);
  try {
    await fs.access(file);
    log(`  background: cache hit ${key}`);
    return file;
  } catch { /* miss -- generate */ }

  log(`  background: generating with ${MODEL} (~80s, cached as ${key})`);
  const t0 = Date.now();
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt: `${prompt}. ${GUARD}`,
      stream: false,
      options: { seed },
    }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (!json.image) throw new Error('ollama returned no image (is this an image-capable model?)');

  await fs.mkdir(CACHE, { recursive: true });
  await fs.writeFile(file, Buffer.from(json.image, 'base64'));
  log(`  background: generated in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  return file;
}

/* Cover-crop + Lanczos upscale to the exact pixel size we'll paint at.
   Doing this in sharp rather than leaving it to CSS means the browser
   never resamples a big image mid-layout, and lets us blur full-bleed
   backgrounds so the 1024 -> 4K upscale reads as depth of field
   rather than mush. */
async function derive(rawFile, w, h, blur) {
  const key = `${path.basename(rawFile, '.png')}-${w}x${h}${blur ? `-b${blur}` : ''}.png`;
  const out = path.join(CACHE, key);
  try { await fs.access(out); return out; } catch { /* build it */ }
  let img = sharp(rawFile).resize(w, h, { fit: 'cover', position: 'attention', kernel: 'lanczos3' });
  if (blur) img = img.blur(blur);
  await img.png({ compressionLevel: 9 }).toFile(out);
  return out;
}

const toDataURL = async f =>
  `data:image/png;base64,${(await fs.readFile(f)).toString('base64')}`;

/* ---- public ------------------------------------------------------------ */

/**
 * @returns {{bgCss:string, textureUrl:?string, heroUrl:?string,
 *            grain:string, scrim:'flood'|'linear'|'bottom'}}
 */
export async function resolveBackground(design, canvas, pxW, pxH, log = () => {}) {
  const b = design.background;
  const mesh = meshCSS(b.hue, b.seed, design.theme);
  const out = { bgCss: mesh, textureUrl: null, heroUrl: null, grain: grainDataURL(), scrim: 'flood' };

  if (b.mode === 'solid') { out.bgCss = 'var(--surface-1)'; return out; }
  if (b.mode === 'mesh') return out;

  if (!b.prompt) {
    log('  background: mode wants FLUX but no prompt given -- falling back to mesh');
    return out;
  }

  const raw = await generateRaw(b.prompt, b.seed, log);

  if (b.mode === 'texture') {
    /* The safe way to use a generative image: a wash over the
       deterministic mesh, in soft-light, at low opacity. Legibility
       is unaffected; the surface stops looking synthetic. */
    out.textureUrl = await toDataURL(await derive(raw, Math.round(pxW / 2), Math.round(pxH / 2), 0));
    out.textureOpacity = b.strength;
    return out;
  }

  if (b.mode === 'hero') {
    /* Confined to a masked panel. Type lives on clean ground, so the
       scrim only has to protect the left side. */
    out.heroUrl = await toDataURL(await derive(raw, Math.round(pxW * 0.45), pxH, 0));
    out.scrim = 'linear';
    return out;
  }

  /* full-bleed */
  out.bgCss = `url('${await toDataURL(await derive(raw, pxW, pxH, 1.2))}')`;
  out.scrim = 'linear';
  return out;
}

export const _internal = { keyOf, mulberry32 };
