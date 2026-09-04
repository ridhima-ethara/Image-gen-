import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { CANVASES, validateDesign } from './schema.js';
import { renderTemplate } from './templates.js';
import { resolveBackground } from './background.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Named output presets = target LONG EDGE in pixels. Scale is derived
   from the canvas preset, so "4k" means 4K whatever the aspect ratio. */
export const OUTPUTS = { hd: 1920, '2k': 2560, '4k': 3840, '8k': 7680 };

/* ---- page assembly ----------------------------------------------------- */

function buildHTML(design, canvas, bg) {
  const layers = [
    `<div class="canvas__bg" style="background:${bg.bgCss}"></div>`,
    bg.heroUrl ? `<div class="herobg" style="background-image:url('${bg.heroUrl}')"></div>` : '',
    bg.textureUrl
      ? `<div class="canvas__texture" style="background-image:url('${bg.textureUrl}');opacity:${bg.textureOpacity}"></div>`
      : '',
    `<div class="canvas__scrim canvas__scrim--${bg.scrim}"></div>`,
    `<div class="canvas__grain"></div>`,
  ].filter(Boolean).join('\n    ');

  return `<!doctype html>
<html data-theme="${design.theme}" style="--canvas-w:${canvas.w}px;--canvas-h:${canvas.h}px;--u:${canvas.u};--grain-url:${bg.grain}${design.brand.accent ? `;--accent:${design.brand.accent}` : ''}">
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="${pathToFileURL(path.join(ROOT, 'assets/css/fonts.css')).href}">
  <link rel="stylesheet" href="${pathToFileURL(path.join(ROOT, 'assets/css/tokens.css')).href}">
  <link rel="stylesheet" href="${pathToFileURL(path.join(ROOT, 'assets/css/base.css')).href}">
</head>
<body>
  <div class="canvas">
    ${layers}
    ${renderTemplate(design)}
  </div>
</body>
</html>`;
}

/* ---- browser lifecycle -------------------------------------------------
   One browser, reused across a batch. Launching Chromium costs more
   than rendering a slide does. */
let _browser = null;
export async function getBrowser() {
  if (!_browser) _browser = await chromium.launch({ args: ['--font-render-hinting=none'] });
  return _browser;
}
export async function closeBrowser() {
  if (_browser) { await _browser.close(); _browser = null; }
}

/* ---- the render --------------------------------------------------------- */

export async function render(rawDesign, opts = {}) {
  const {
    output = '4k',
    outDir = 'out',
    name = 'slide',
    pdf = false,
    strict = true,
    log = console.error,
  } = opts;

  const v = validateDesign(rawDesign);
  if (!v.ok) {
    const err = new Error('design JSON failed validation');
    err.issues = v.issues;
    throw err;
  }
  const design = v.design;
  const canvas = CANVASES[design.canvas];

  const longEdge = OUTPUTS[output] || Number(output);
  if (!longEdge || !Number.isFinite(longEdge)) throw new Error(`bad output preset: ${output}`);
  const scale = longEdge / Math.max(canvas.w, canvas.h);
  const targetW = Math.round(canvas.w * scale);
  const targetH = Math.round(canvas.h * scale);

  /* Supersample, then Lanczos down to the exact target. Even at 1x
     output this beats rendering at 1x -- glyph edges and chart
     antialiasing are visibly cleaner. */
  const dsf = Math.min(4, Math.max(2, Math.ceil(scale)));

  log(`  canvas ${canvas.w}x${canvas.h} @${canvas.u} -> ${targetW}x${targetH} (render dsf ${dsf})`);

  const bg = await resolveBackground(design, canvas, targetW, targetH, log);

  await fs.mkdir(path.join(ROOT, '.build'), { recursive: true });
  await fs.mkdir(path.resolve(outDir), { recursive: true });
  const htmlPath = path.join(ROOT, '.build', `${name}.html`);
  await fs.writeFile(htmlPath, buildHTML(design, canvas, bg));

  const browser = await getBrowser();
  const page = await browser.newPage({
    viewport: { width: canvas.w, height: canvas.h },
    deviceScaleFactor: dsf,
  });

  try {
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });

    /* Local scripts, injected rather than <script src> so file://
       origin rules can't bite us. */
    await page.addScriptTag({ path: path.join(ROOT, 'node_modules/echarts/dist/echarts.min.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'src/browser/chart.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'src/browser/qa.js') });

    /* Fonts BEFORE charts: ECharts measures label widths against the
       live font, so mounting early bakes in fallback-face metrics. */
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.SMAChart.mountAll());

    /* --- pass 1: the background exactly as composited ---------------
       Sampling the real pixels (mesh gradients, the soft-light
       texture blend, the hero mask) is the only way the contrast
       gate can be honest about what's behind the type. */
    await page.evaluate(() => {
      document.querySelector('.canvas__content').style.visibility = 'hidden';
      document.querySelector('.canvas__scrim').style.setProperty('--scrim-opacity', 0);
    });
    const bgShot = await page.screenshot({ clip: { x: 0, y: 0, width: canvas.w, height: canvas.h } });
    const bgSmall = await sharp(bgShot).resize(220, null, { kernel: 'lanczos3' }).png().toBuffer();
    const bgURL = `data:image/png;base64,${bgSmall.toString('base64')}`;
    await page.evaluate(() => {
      document.querySelector('.canvas__content').style.visibility = '';
    });

    /* --- pass 2: the QA gate ---------------------------------------- */
    const qa = await page.evaluate(
      ([url, w, h, scrim]) => window.SMAQa.run({ bgUrl: url, canvasW: w, canvasH: h, scrim }),
      [bgURL, canvas.w, canvas.h, bg.scrim]
    );

    for (const s of qa.shrunk) log(`  fit: shrank ${s.el} to ${s.scale}x`);
    if (qa.scrim.worst) {
      const { ratio, need } = qa.scrim.worst;
      log(`  scrim: ${qa.scrim.alpha} -> worst contrast ${ratio.toFixed(2)}:1 (need ${need}:1)`);
      if (ratio < need) {
        qa.problems.push({ kind: 'contrast', el: `${qa.scrim.worst.el} at ${ratio.toFixed(2)}:1 (need ${need}:1)` });
      }
    }
    for (const p of qa.problems) log(`  ! ${p.kind}: ${p.el}`);
    if (strict && qa.problems.length) {
      const err = new Error(`QA gate failed with ${qa.problems.length} problem(s)`);
      err.problems = qa.problems;
      throw err;
    }

    /* --- the shot ----------------------------------------------------
       fullPage is deliberately NOT used: with a fixed viewport it
       silently changes the output dimensions the moment anything
       overflows. An explicit clip cannot. */
    const shot = await page.screenshot({
      clip: { x: 0, y: 0, width: canvas.w, height: canvas.h },
      animations: 'disabled',
    });

    const pngPath = path.join(path.resolve(outDir), `${name}.png`);
    const pipeline = sharp(shot);
    const meta = await pipeline.metadata();
    const out = (meta.width === targetW && meta.height === targetH)
      ? pipeline
      : pipeline.resize(targetW, targetH, { kernel: 'lanczos3', fit: 'fill' });
    await out.png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(pngPath);

    const result = { png: pngPath, width: targetW, height: targetH, qa, design };

    if (pdf) {
      /* Vector, resolution-independent, same HTML. Free deliverable. */
      const pdfPath = path.join(path.resolve(outDir), `${name}.pdf`);
      await page.pdf({
        path: pdfPath,
        width: `${canvas.w}px`,
        height: `${canvas.h}px`,
        printBackground: true,
        pageRanges: '1',
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });
      result.pdf = pdfPath;
    }

    return result;
  } finally {
    await page.close();
  }
}
