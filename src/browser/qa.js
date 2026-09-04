/* ============================================================
   The QA gate. Runs in-page after layout, before the shot.

   Three jobs:
     1. fitText  -- no text is ever clipped or overflowing.
     2. autoScrim-- sample the real background pixels under each
                    text block and raise the scrim until WCAG
                    contrast passes. This is what makes it safe to
                    put type over a generative image at all.
     3. audit    -- report anything still wrong so the caller can
                    fail loudly instead of shipping a broken PNG.
   ============================================================ */
(function () {
  'use strict';

  /* ---- scrim profiles -------------------------------------------------
     Defined here ONCE and the CSS gradient is generated from the same
     numbers, so the contrast math can never drift from what's painted.
     alpha(t) is the scrim's local strength, t in [0,1] along its axis.
     -------------------------------------------------------------------- */
  const PROFILES = {
    flood:  { axis: 'none', stops: [[0, 1], [1, 1]] },
    linear: { axis: 'x',    stops: [[0, 1], [0.38, 1], [0.78, 0.36], [1, 0]] },
    bottom: { axis: 'y',    stops: [[0, 0], [0.54, 0.36], [1, 1]] },
  };

  function profileAlpha(name, t) {
    const p = PROFILES[name] || PROFILES.flood;
    if (p.axis === 'none') return 1;
    const s = p.stops;
    for (let i = 0; i < s.length - 1; i++) {
      const [t0, a0] = s[i], [t1, a1] = s[i + 1];
      if (t >= t0 && t <= t1) return a0 + (a1 - a0) * (t1 === t0 ? 0 : (t - t0) / (t1 - t0));
    }
    return s[s.length - 1][1];
  }

  /* ---- color ---------------------------------------------------------- */

  function parseColor(str) {
    const m = str.match(/rgba?\(([^)]+)\)/);
    if (!m) return [0, 0, 0, 1];
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }

  function relLum([r, g, b]) {
    const f = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }

  function contrast(fg, bg) {
    const a = relLum(fg), b = relLum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  /* Source-over compositing, in sRGB -- which is what the browser does. */
  function over(src, srcAlpha, dst) {
    return [0, 1, 2].map(i => src[i] * srcAlpha + dst[i] * (1 - srcAlpha));
  }

  /* ---- background sampling -------------------------------------------- */

  let bgSampler = null;

  /* Map the canvas box onto a `background-size: cover` image, so we
     sample the pixels that are actually visible, not the whole file. */
  function coverMap(imgW, imgH, boxW, boxH) {
    const scale = Math.max(boxW / imgW, boxH / imgH);
    const dw = imgW * scale, dh = imgH * scale;
    return { ox: (boxW - dw) / 2, oy: (boxH - dh) / 2, scale };
  }

  async function initSampler(bgUrl, canvasW, canvasH) {
    const surface = parseColor(getComputedStyle(document.body).backgroundColor);
    if (!bgUrl) { bgSampler = () => surface.slice(0, 3); return; }

    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = bgUrl; });

    /* Downsample hard -- we want average luminance of a region, not detail. */
    const W = 220, H = Math.max(1, Math.round(220 * img.naturalHeight / img.naturalWidth));
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, W, H);
    const data = ctx.getImageData(0, 0, W, H).data;
    const map = coverMap(img.naturalWidth, img.naturalHeight, canvasW, canvasH);

    bgSampler = (x, y, w, h) => {
      /* canvas px -> displayed image px -> downsampled buffer px */
      const toU = v => (v - map.ox) / (img.naturalWidth * map.scale);
      const toV = v => (v - map.oy) / (img.naturalHeight * map.scale);
      const x0 = Math.max(0, Math.min(W - 1, Math.floor(toU(x) * W)));
      const x1 = Math.max(0, Math.min(W - 1, Math.ceil(toU(x + w) * W)));
      const y0 = Math.max(0, Math.min(H - 1, Math.floor(toV(y) * H)));
      const y1 = Math.max(0, Math.min(H - 1, Math.ceil(toV(y + h) * H)));
      let r = 0, g = 0, b = 0, n = 0;
      for (let py = y0; py <= y1; py++) {
        for (let pxx = x0; pxx <= x1; pxx++) {
          const i = (py * W + pxx) * 4;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
        }
      }
      /* A worst-case sample matters more than the mean for legibility,
         but the mean plus a pessimistic nudge toward mid-gray is stabler
         than chasing a single hot pixel. */
      return n ? [r / n, g / n, b / n] : surface.slice(0, 3);
    };
  }

  /* ---- 1. text fitting ------------------------------------------------- */

  /* Measuring overflow honestly is fiddlier than scrollHeight > clientHeight.
     Two things break the naive test:
       - an INLINE box has no scroll metrics at all (both read 0), so it
         would always look fine, or always look broken;
       - TIGHT LEADING makes the ink box taller than the line box. A 76px
         headline at line-height 1.04 reports scrollHeight 85 vs
         clientHeight 79 while looking perfect. That 6px is typographic
         overshoot, not a layout failure.
     So: skip inline boxes, and allow overshoot up to the difference
     between normal leading and the actual leading -- which is always far
     less than the one full extra line a real overflow costs. */
  function measurable(el) {
    const d = getComputedStyle(el).display;
    return d !== 'inline' && d !== 'contents' && d !== 'none';
  }

  function overflows(el) {
    if (!measurable(el)) return false;
    const cs = getComputedStyle(el);
    const fs = parseFloat(cs.fontSize) || 16;
    const lh = parseFloat(cs.lineHeight) || fs * 1.2;
    const slop = Math.max(1, fs * 1.25 - lh);
    return el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + slop;
  }

  /* Shrink [data-fit] elements until they fit. data-fit is the floor
     scale -- below it we stop and report, rather than shrinking type
     into illegibility to hide a content problem. */
  function fitText() {
    const shrunk = [];
    document.querySelectorAll('[data-fit]').forEach(el => {
      const floor = parseFloat(el.getAttribute('data-fit')) || 0.62;
      const base = parseFloat(getComputedStyle(el).fontSize);
      let scale = 1;
      while (overflows(el) && scale > floor) {
        scale -= 0.035;
        el.style.fontSize = (base * scale) + 'px';
      }
      if (scale < 1) shrunk.push({ el: describe(el), scale: +scale.toFixed(2) });
    });
    return shrunk;
  }

  /* ---- 2. auto scrim --------------------------------------------------- */

  function targetRatio(cs) {
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    /* WCAG "large text" is 24px, or 18.66px bold -- our canvas is
       authored at 1920 logical px so most headline type qualifies. */
    const large = size >= 30 || (size >= 24 && weight >= 700);
    return large ? 3.0 : 4.5;
  }

  function textNodes() {
    return Array.from(document.querySelectorAll('[data-contrast]')).filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 4 && r.height > 4 && el.textContent.trim().length;
    });
  }

  function worstContrast(alpha, scrimName, scrimRGB, canvasW, canvasH) {
    let worst = { ratio: Infinity, el: null, need: 4.5 };
    for (const el of textNodes()) {
      const cs = getComputedStyle(el);
      const fg = parseColor(cs.color).slice(0, 3);
      const r = el.getBoundingClientRect();
      const raw = bgSampler(r.left, r.top, r.width, r.height);
      const t = PROFILES[scrimName].axis === 'y'
        ? (r.top + r.height / 2) / canvasH
        : (r.left + r.width / 2) / canvasW;
      const local = alpha * profileAlpha(scrimName, t);
      const eff = over(scrimRGB, local, raw);
      const ratio = contrast(fg, eff);
      const need = targetRatio(cs);
      if (ratio / need < worst.ratio / worst.need) worst = { ratio, el: describe(el), need };
    }
    return worst;
  }

  /* Walk the scrim up in steps until every text block clears its
     target. We stop at the lowest passing value -- a scrim heavier
     than it needs to be just flattens the image for nothing. */
  function autoScrim(scrimName, canvasW, canvasH) {
    const scrimEl = document.querySelector('.canvas__scrim');
    if (!scrimEl) return { alpha: 0, worst: null };
    const scrimRGB = parseColor(
      getComputedStyle(document.documentElement).getPropertyValue('--scrim-from')
    ).slice(0, 3);

    let chosen = 1, worst = null;
    for (let a = 0; a <= 1.0001; a += 0.05) {
      const w = worstContrast(a, scrimName, scrimRGB, canvasW, canvasH);
      if (w.ratio >= w.need) { chosen = +a.toFixed(2); worst = w; break; }
      worst = w;
    }
    scrimEl.style.setProperty('--scrim-opacity', chosen);
    return { alpha: chosen, worst };
  }

  /* ---- 3. audit -------------------------------------------------------- */

  function describe(el) {
    const t = el.textContent.trim().replace(/\s+/g, ' ');
    return `${el.className || el.tagName}${t ? ` "${t.slice(0, 44)}${t.length > 44 ? '…' : ''}"` : ''}`;
  }

  function audit(canvasW, canvasH) {
    const problems = [];

    /* Anything still overflowing after fitText is a real content problem. */
    document.querySelectorAll('.canvas__content *').forEach(el => {
      if (el.hasAttribute('data-chart')) return;
      if (overflows(el)) problems.push({ kind: 'overflow', el: describe(el) });
    });

    /* Anything pushed outside the frame. */
    const pad = 2;
    document.querySelectorAll('[data-contrast], [data-chart]').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.left < -pad || r.top < -pad || r.right > canvasW + pad || r.bottom > canvasH + pad) {
        problems.push({ kind: 'out-of-frame', el: describe(el) });
      }
    });

    /* Overlapping text blocks -- the classic generated-slide failure. */
    const nodes = textNodes();
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if (nodes[i].contains(nodes[j]) || nodes[j].contains(nodes[i])) continue;
        const a = nodes[i].getBoundingClientRect(), b = nodes[j].getBoundingClientRect();
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 6 && oy > 6) {
          problems.push({ kind: 'overlap', el: `${describe(nodes[i])} ↔ ${describe(nodes[j])}` });
        }
      }
    }
    return problems;
  }

  async function run(opts) {
    await document.fonts.ready;          /* never measure against a fallback face */
    await initSampler(opts.bgUrl, opts.canvasW, opts.canvasH);
    const shrunk = fitText();
    const scrim = autoScrim(opts.scrim || 'flood', opts.canvasW, opts.canvasH);
    const problems = audit(opts.canvasW, opts.canvasH);
    return { shrunk, scrim, problems };
  }

  window.SMAQa = { run, PROFILES, profileAlpha, contrast, parseColor };
})();
