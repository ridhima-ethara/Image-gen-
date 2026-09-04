/* ============================================================
   Schematic motif engine.

   The image-brief skill names the imagery it wants -- reward curves,
   RL loops, agent-verifier diagrams, benchmark charts, state
   transitions, trajectories -- and says it should be SCHEMATIC
   rather than literal. That is a drawing problem, not a diffusion
   problem: these are line systems with exact geometry, so they are
   generated as SVG rather than prompted.

   Deterministic (seeded), weightless (a few KB of vectors), always
   on-palette, and incapable of producing a glowing brain.

   Every motif is a background LAYER. It carries no meaning, never
   sits where it competes with type, and is capped in opacity -- the
   brief demands high signal-to-noise and forbids busy compositions.
   ============================================================ */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 1600, H = 1000;              /* motif viewBox; scaled by CSS */
const r2 = (n) => Math.round(n * 100) / 100;

/* ---- individual motifs -------------------------------------------------
   Each returns SVG body markup. `c` is the stroke colour, `a` the accent
   used for the few emphasised marks that give the drawing a focal point. */

function trajectory(rnd, c, a) {
  /* A bundle of agent trajectories fanning toward a goal region: the
     spread narrows as they converge, which is the visual idea. */
  const n = 14, out = [];
  const gx = W * 0.86, gy = H * 0.24;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const sy = H * (0.62 + t * 0.34) + rnd() * 40;
    const sx = -40 + rnd() * 120;
    const c1x = W * (0.28 + rnd() * 0.12), c1y = sy - rnd() * 160;
    const c2x = W * (0.60 + rnd() * 0.10), c2y = gy + (rnd() - 0.5) * 260;
    const ex = gx + (rnd() - 0.5) * 90, ey = gy + (rnd() - 0.5) * 90;
    const emph = i % 5 === 2;
    out.push(`<path d="M${r2(sx)} ${r2(sy)} C${r2(c1x)} ${r2(c1y)} ${r2(c2x)} ${r2(c2y)} ${r2(ex)} ${r2(ey)}" fill="none" stroke="${emph ? a : c}" stroke-width="${emph ? 2.4 : 1.2}" opacity="${emph ? 0.95 : 0.62}"/>`);
    out.push(`<circle cx="${r2(ex)}" cy="${r2(ey)}" r="${emph ? 4.5 : 2.6}" fill="${emph ? a : c}" opacity="${emph ? 0.95 : 0.6}"/>`);
  }
  out.push(`<circle cx="${gx}" cy="${gy}" r="120" fill="none" stroke="${a}" stroke-width="1.2" opacity="0.525"/>`);
  out.push(`<circle cx="${gx}" cy="${gy}" r="190" fill="none" stroke="${a}" stroke-width="1.3" opacity="0.28"/>`);
  return out.join('');
}

function rewardCurve(rnd, c, a) {
  /* A learning curve with its variance band -- the canonical RL figure. */
  const pts = [], lo = [], hi = [];
  const N = 90;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const base = 1 - Math.exp(-3.1 * t);                 /* saturating */
    const noise = (rnd() - 0.5) * 0.055 * (1 - t * 0.6);
    const y = H * 0.86 - (base + noise) * H * 0.62;
    const spread = (0.10 * (1 - t) + 0.022) * H * 0.62;
    const x = t * W;
    pts.push(`${r2(x)} ${r2(y)}`);
    lo.push(`${r2(x)} ${r2(y + spread)}`);
    hi.unshift(`${r2(x)} ${r2(y - spread)}`);
  }
  return [
    `<path d="M${lo.join(' L')} L${hi.join(' L')} Z" fill="${a}" opacity="0.175"/>`,
    `<path d="M${pts.join(' L')}" fill="none" stroke="${a}" stroke-width="2.4" opacity="0.95" stroke-linejoin="round"/>`,
    /* asymptote the curve is reaching for */
    `<line x1="0" y1="${r2(H * 0.86 - H * 0.62)}" x2="${W}" y2="${r2(H * 0.86 - H * 0.62)}" stroke="${c}" stroke-width="1.3" opacity="0.49"/>`,
  ].join('');
}

function rlLoop(rnd, c, a) {
  /* agent -> action -> environment -> reward -> agent. Two nodes and the
     cycle between them, which is the whole mechanism in four marks. */
  const cx = W / 2, cy = H / 2, R = 196;
  const arc = (r, from, to, col, op, wdt) => {
    const p = (ang, rr) => [cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr];
    const [x1, y1] = p(from, r), [x2, y2] = p(to, r);
    const large = Math.abs(to - from) > Math.PI ? 1 : 0;
    return `<path d="M${r2(x1)} ${r2(y1)} A${r} ${r} 0 ${large} 1 ${r2(x2)} ${r2(y2)}" fill="none" stroke="${col}" stroke-width="${wdt}" opacity="${op}"/>`;
  };
  const head = (ang, r, col) => {
    const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r;
    const t = ang + Math.PI / 2;
    const s = 22;
    return `<path d="M${r2(x + Math.cos(t) * s)} ${r2(y + Math.sin(t) * s)} L${r2(x + Math.cos(t + 2.5) * s)} ${r2(y + Math.sin(t + 2.5) * s)} L${r2(x + Math.cos(t - 2.5) * s)} ${r2(y + Math.sin(t - 2.5) * s)} Z" fill="${col}" opacity="0.95"/>`;
  };
  const node = (x, y, col, op) => [
    `<rect x="${r2(x - 132)}" y="${r2(y - 46)}" width="264" height="92" rx="12" fill="none" stroke="${col}" stroke-width="2.6" opacity="${op}"/>`,
    /* a couple of interior rules so the node reads as a block, not an empty box */
    `<line x1="${r2(x - 96)}" y1="${r2(y - 12)}" x2="${r2(x + 40)}" y2="${r2(y - 12)}" stroke="${col}" stroke-width="2" opacity="${r2(op * 0.55)}"/>`,
    `<line x1="${r2(x - 96)}" y1="${r2(y + 14)}" x2="${r2(x + 4)}" y2="${r2(y + 14)}" stroke="${col}" stroke-width="2" opacity="${r2(op * 0.4)}"/>`,
  ].join('');
  return [
    arc(R, -2.45, -0.70, a, 0.95, 3.4), head(-0.70, R, a),
    arc(R, 0.70, 2.45, c, 0.8, 3.0), head(2.45, R, c),
    arc(R + 96, -2.15, -1.0, c, 0.42, 1.8),
    node(cx, cy - R - 30, a, 0.9),
    node(cx, cy + R + 30, c, 0.8),
    `<circle cx="${cx}" cy="${cy}" r="6" fill="${a}" opacity="0.875"/>`,
  ].join('');
}

function lattice(rnd, c, a) {
  /* An agent-verifier graph: a loose node field with only near edges
     drawn, so it reads as structure rather than as noise. */
  const cols = 9, rows = 6, nodes = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      nodes.push({
        x: (i + 0.5) * (W / cols) + (rnd() - 0.5) * 62,
        y: (j + 0.5) * (H / rows) + (rnd() - 0.5) * 62,
        k: rnd(),
      });
    }
  }
  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
      const d = Math.hypot(dx, dy);
      if (d < W / cols * 1.25) {
        out.push(`<line x1="${r2(nodes[i].x)}" y1="${r2(nodes[i].y)}" x2="${r2(nodes[j].x)}" y2="${r2(nodes[j].y)}" stroke="${c}" stroke-width="1.3" opacity="${r2(0.52 * (1 - d / (W / cols * 1.25)))}"/>`);
      }
    }
  }
  for (const n of nodes) {
    const hot = n.k > 0.86;
    out.push(`<circle cx="${r2(n.x)}" cy="${r2(n.y)}" r="${hot ? 5.5 : 2.6}" fill="${hot ? a : c}" opacity="${hot ? 0.95 : 0.62}"/>`);
  }
  return out.join('');
}

function stateGrid(rnd, c, a) {
  /* State transitions: a lattice of cells with a single highlighted
     path stepping through it. */
  const cols = 16, rows = 10, cw = W / cols, ch = H / rows, out = [];
  for (let i = 0; i <= cols; i++) out.push(`<line x1="${r2(i * cw)}" y1="0" x2="${r2(i * cw)}" y2="${H}" stroke="${c}" stroke-width="1.3" opacity="0.228"/>`);
  for (let j = 0; j <= rows; j++) out.push(`<line x1="0" y1="${r2(j * ch)}" x2="${W}" y2="${r2(j * ch)}" stroke="${c}" stroke-width="1.3" opacity="0.228"/>`);
  let cx = 0, cy = rows - 2;
  const path = [];
  while (cx < cols) {
    path.push([cx, cy]);
    if (rnd() > 0.42 && cy > 0) cy -= 1; else cx += 1;
  }
  const pts = path.map(([x, y]) => `${r2((x + 0.5) * cw)} ${r2((y + 0.5) * ch)}`);
  out.push(`<path d="M${pts.join(' L')}" fill="none" stroke="${a}" stroke-width="2.4" opacity="0.95" stroke-linejoin="round" stroke-linecap="round"/>`);
  for (const [x, y] of path.filter((_, i) => i % 3 === 0)) {
    out.push(`<rect x="${r2(x * cw + 3)}" y="${r2(y * ch + 3)}" width="${r2(cw - 6)}" height="${r2(ch - 6)}" fill="${a}" opacity="0.175"/>`);
  }
  return out.join('');
}

function contour(rnd, c, a) {
  /* A reward landscape: nested closed curves around two optima. */
  const out = [];
  const peaks = [{ x: W * 0.34, y: H * 0.42 }, { x: W * 0.71, y: H * 0.61 }];
  peaks.forEach((p, pi) => {
    for (let k = 1; k <= 9; k++) {
      const rr = k * 46 * (pi ? 0.82 : 1);
      const pts = [];
      for (let d = 0; d <= 40; d++) {
        const ang = (d / 40) * Math.PI * 2;
        const wob = 1 + Math.sin(ang * 3 + pi * 2 + k * 0.3) * 0.12 + Math.sin(ang * 5 + k) * 0.05;
        pts.push(`${r2(p.x + Math.cos(ang) * rr * wob * 1.35)} ${r2(p.y + Math.sin(ang) * rr * wob)}`);
      }
      out.push(`<path d="M${pts.join(' L')} Z" fill="none" stroke="${k <= 2 ? a : c}" stroke-width="${k <= 2 ? 1.8 : 1}" opacity="${r2(k <= 2 ? 0.85 : 0.46 * (1 - k / 11))}"/>`);
    }
    out.push(`<circle cx="${r2(p.x)}" cy="${r2(p.y)}" r="4" fill="${a}" opacity="0.95"/>`);
  });
  return out.join('');
}

function gridField(rnd, c, a) {
  /* Engineered graph paper with a few emphasised registration marks --
     the quietest option, for when type is doing all the work. */
  const step = 64, out = [];
  for (let x = 0; x <= W; x += step) out.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${c}" stroke-width="1.3" opacity="${x % (step * 4) === 0 ? 0.34 : 0.16}"/>`);
  for (let y = 0; y <= H; y += step) out.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${c}" stroke-width="1.3" opacity="${y % (step * 4) === 0 ? 0.34 : 0.16}"/>`);
  for (let i = 0; i < 7; i++) {
    const x = Math.round(rnd() * (W / step)) * step, y = Math.round(rnd() * (H / step)) * step;
    out.push(`<path d="M${x - 9} ${y} L${x + 9} ${y} M${x} ${y - 9} L${x} ${y + 9}" stroke="${a}" stroke-width="1.6" opacity="0.95"/>`);
  }
  return out.join('');
}

/* Where the motif sits. It must never fight the type, so each placement
   is a region the templates keep relatively clear. */
export const MOTIF_PLACEMENTS = ['full', 'right', 'corner', 'band', 'behind'];

/* Two kinds of motif, and they cannot be scaled the same way.
   FIELD motifs are unbounded textures -- cropping them is harmless.
   COMPOSED motifs are a single centred drawing; cover-cropping one into
   a 52%-wide panel slices the composition apart, so they must fit. */
const MOTIFS = {
  trajectory:     { draw: trajectory,  fit: 'cover',   place: 'right',  composed: false },
  'reward-curve': { draw: rewardCurve, fit: 'cover',   place: 'band',   composed: false },
  'rl-loop':      { draw: rlLoop,      fit: 'contain', place: 'behind', composed: true },
  lattice:        { draw: lattice,     fit: 'cover',   place: 'right',  composed: false },
  'state-grid':   { draw: stateGrid,   fit: 'cover',   place: 'full',   composed: false },
  contour:        { draw: contour,     fit: 'contain', place: 'behind', composed: true },
  grid:           { draw: gridField,   fit: 'cover',   place: 'full',   composed: false },
};

/* Each motif's natural home. A field texture can go anywhere; a composed
   drawing only works where it is not sliced or fighting the headline. */
export const MOTIF_DEFAULT_PLACEMENT =
  Object.fromEntries(Object.entries(MOTIFS).map(([k, v]) => [k, v.place]));

/* A single centred drawing cannot be cropped into a side panel without
   losing the composition, so those placements are not offered for it. */
export const MOTIF_ALLOWED_PLACEMENT = Object.fromEntries(
  Object.entries(MOTIFS).map(([k, v]) => [k, v.composed ? ['full', 'behind'] : MOTIF_PLACEMENTS])
);

export const MOTIF_TYPES = Object.keys(MOTIFS);

/* The SVG is built in Node, so it needs concrete colours rather than CSS
   custom properties. These mirror --text-muted and --accent per theme. */
export const MOTIF_INK = {
  ethara:   { stroke: '#9d94b4', accent: '#C084FC' },
  midnight: { stroke: '#98a5bc', accent: '#7db1f0' },
  ink:      { stroke: '#9a998f', accent: '#eda100' },
  paper:    { stroke: '#6b6a65', accent: '#1c5cab' },
};


const PLACEMENT_CSS = {
  full:   { inset: '0', width: '100%', height: '100%', mask: 'none' },
  right:  { inset: '0 0 0 auto', width: '52%', height: '100%', mask: 'linear-gradient(90deg, transparent 0%, #000 34%, #000 100%)' },
  corner: { inset: '0 0 auto auto', width: '46%', height: '46%', mask: 'radial-gradient(120% 120% at 100% 0%, #000 40%, transparent 78%)' },
  band:   { inset: 'auto 0 0 0', width: '100%', height: '38%', mask: 'linear-gradient(0deg, #000 30%, transparent 100%)' },
  /* Sits HIGH, not dead centre: most templates put their headline in the
     lower half, and a composed drawing centred behind it collides with
     the type. Fading from 34% down keeps the lower band clear. */
  behind: { inset: '0 0 auto 0', width: '100%', height: '82%', mask: 'radial-gradient(66% 62% at 50% 30%, #000 0%, #000 34%, transparent 76%)' },
};

/**
 * Build the motif layer.
 * @returns {{url:string, css:string}|null}
 */
export function buildMotif({ type, placement, seed = 7, opacity = 0.62, stroke, accent }) {
  const def = MOTIFS[type];
  if (!def) return null;
  const rnd = mulberry32(seed);
  const body = def.draw(rnd, stroke, accent);
  const par = def.fit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="${par}">${body}</svg>`;
  const url = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

  /* Fall back to the motif's natural placement, and refuse one that would
     slice a composed drawing apart. */
  let place = placement || def.place;
  if (!(MOTIF_ALLOWED_PLACEMENT[type] || []).includes(place)) place = def.place;
  const p = PLACEMENT_CSS[place] || PLACEMENT_CSS.full;
  const css = [
    `position:absolute`,
    `inset:${p.inset}`,
    `width:${p.width}`,
    `height:${p.height}`,
    `background-image:url('${url}')`,
    `background-size:${def.fit}`,
    `background-position:center`,
    `background-repeat:no-repeat`,
    /* Capped: the brief demands high signal-to-noise, so a motif is
       never allowed to reach full strength behind content. */
    `opacity:${Math.min(0.85, Math.max(0, opacity))}`,
    p.mask === 'none' ? '' : `-webkit-mask-image:${p.mask};mask-image:${p.mask}`,
    `pointer-events:none`,
  ].filter(Boolean).join(';');

  return { url, css };
}
