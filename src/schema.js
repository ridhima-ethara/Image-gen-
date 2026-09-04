import { z } from 'zod/v4';

/* ============================================================
   The contract between the LLM and the renderer.

   Nothing free-text ever reaches the renderer: the model emits
   this shape, we validate it, and only then do we lay anything
   out. A validation failure is a retry, not a broken slide.
   ============================================================ */

export const CANVASES = {
  landscape: { w: 1920, h: 1080, u: 1.0 },   // decks, LinkedIn link cards
  portrait:  { w: 1080, h: 1350, u: 0.72 },  // LinkedIn / IG feed -- highest reach
  square:    { w: 1080, h: 1080, u: 0.68 },
  story:     { w: 1080, h: 1920, u: 0.74 },  // stories / reels
};

export const THEMES = ['midnight', 'paper', 'ink'];

export const TEMPLATES = [
  'cover', 'chart-insight', 'chart-split', 'stat-hero', 'kpi-grid',
  'comparison', 'timeline', 'quote', 'cards-3up', 'list-insight',
  'process-flow', 'table',
];

export const CHART_TYPES = ['bar', 'hbar', 'line', 'area', 'stacked-bar', 'donut'];

const Delta = z.object({
  value: z.string().max(16),
  direction: z.enum(['up', 'down', 'flat']),
  /* Whether "up" is good is domain knowledge -- churn going up is bad.
     The model must say so; we never infer it from the arrow. */
  goodDirection: z.enum(['up', 'down', 'neutral']).default('up'),
}).strict();

const Stat = z.object({
  value: z.string().max(12),
  unit: z.string().max(8).optional(),
  label: z.string().max(60),
  delta: Delta.optional(),
}).strict();

const Series = z.object({
  name: z.string().max(40),
  data: z.array(z.number()).min(1).max(24),
}).strict();

const Chart = z.object({
  type: z.enum(CHART_TYPES),
  categories: z.array(z.string().max(28)).min(1).max(24),
  series: z.array(Series).min(1).max(8),
  unit: z.string().max(8).default(''),
  /* Axis maximum. Leave null and ECharts picks a clean bound. */
  max: z.number().nullable().default(null),
  /* Which single series the story is about -- direct labels ride
     that one; the rest are carried by legend + axis. Index is
     0-based; null means "label sensibly by default". */
  focusSeries: z.number().int().min(0).max(7).nullable().default(null),
}).strict()
  .refine(c => c.series.every(s => s.data.length === c.categories.length),
    { message: 'every series.data must be the same length as categories' })
  /* A dual-axis chart is the single most common charting mistake,
     so the schema makes it unrepresentable rather than discouraged. */
  .refine(c => !(c.type === 'donut' && c.series.length > 1),
    { message: 'donut takes exactly one series' });

const Insight = z.object({
  label: z.string().max(24).default('Key insight'),
  text: z.string().max(240),
}).strict();

const Item = z.object({
  title: z.string().max(60),
  text: z.string().max(180).optional(),
  value: z.string().max(12).optional(),
}).strict();

const Step = z.object({
  label: z.string().max(16),
  title: z.string().max(48),
  text: z.string().max(140).optional(),
}).strict();

const Quote = z.object({
  text: z.string().max(300),
  attribution: z.string().max(60),
  role: z.string().max(80).optional(),
}).strict();

const Table = z.object({
  columns: z.array(z.string().max(28)).min(2).max(6),
  rows: z.array(z.array(z.string().max(32))).min(1).max(10),
  /* Column indices to right-align + tabular-align as numbers. */
  numericColumns: z.array(z.number().int().min(0)).default([]),
}).strict()
  .refine(t => t.rows.every(r => r.length === t.columns.length),
    { message: 'every row must have exactly columns.length cells' });

const Content = z.object({
  eyebrow: z.string().max(40).optional(),
  title: z.string().max(90).optional(),
  subtitle: z.string().max(160).optional(),
  chart: Chart.optional(),
  insight: Insight.optional(),
  stats: z.array(Stat).min(1).max(4).optional(),
  items: z.array(Item).min(2).max(6).optional(),
  steps: z.array(Step).min(2).max(5).optional(),
  quote: Quote.optional(),
  table: Table.optional(),
  source: z.string().max(80).optional(),
}).strict();

const Background = z.object({
  /* mesh    -- deterministic CSS gradient mesh. Free, instant, on-brand.
     texture -- mesh + a FLUX wash at low opacity in soft-light. The
                default when you want generative richness safely.
     hero    -- FLUX image confined to a masked panel; type never
                sits on it.
     flux    -- full-bleed FLUX. Highest risk; the scrim gate does
                the heavy lifting.
     solid   -- flat surface. */
  mode: z.enum(['mesh', 'texture', 'hero', 'flux', 'solid']).default('mesh'),
  prompt: z.string().max(600).default(''),
  seed: z.number().int().min(0).max(2 ** 31 - 1).default(7),
  /* Base hue for the deterministic mesh, degrees. */
  hue: z.number().min(0).max(360).default(214),
  /* Overlay strength for `texture` mode. */
  strength: z.number().min(0).max(1).default(0.18),
}).strict();

export const DesignSchema = z.object({
  canvas: z.enum(Object.keys(CANVASES)).default('landscape'),
  theme: z.enum(THEMES).default('midnight'),
  template: z.enum(TEMPLATES),
  brand: z.object({
    logoText: z.string().max(28).default(''),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  }).strict().default({}),
  background: Background.default({}),
  content: Content,
}).strict();

/* Templates declare what they cannot render without. Enforced here
   so a missing field is a clean retriable error, not an empty box
   discovered in the PNG. */
const REQUIRED = {
  'cover':        ['title'],
  'chart-insight': ['title', 'chart'],
  'chart-split':  ['title', 'chart'],
  'stat-hero':    ['stats'],
  'kpi-grid':     ['stats'],
  'comparison':   ['items'],
  'timeline':     ['steps'],
  'quote':        ['quote'],
  'cards-3up':    ['items'],
  'list-insight': ['items'],
  'process-flow': ['steps'],
  'table':        ['table'],
};


/* ============================================================
   Repair pass.

   Small models fail the schema in two very different ways:

     - COSMETIC: a strength of 1.4, a hue of 400, a title three
       characters too long, a stray key. None of these change what
       the slide MEANS, so rejecting them just burns a retry.
     - SEMANTIC: series data that doesn't line up with its
       categories. That one stays a hard error -- silently trimming
       it would misrepresent the data, which is the exact failure
       this whole pipeline exists to prevent.

   So we clamp, truncate and strip the first kind, and refuse the
   second kind.
   ============================================================ */

const clamp = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);
const trunc = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);

const CONTENT_KEYS = ['eyebrow', 'title', 'subtitle', 'chart', 'insight', 'stats', 'items', 'steps', 'quote', 'table', 'source'];

function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

/* If the model picked a chart template but gave us no chart, don't
   fail -- move it to the archetype its content actually fits. */
function retarget(d) {
  const c = d.content || {};
  const needsChart = d.template === 'chart-insight' || d.template === 'chart-split';
  if (needsChart && !c.chart) {
    if (Array.isArray(c.stats) && c.stats.length) d.template = c.stats.length === 1 ? 'stat-hero' : 'kpi-grid';
    else if (Array.isArray(c.items) && c.items.length >= 2) d.template = c.items.length === 3 ? 'cards-3up' : 'list-insight';
    else if (Array.isArray(c.steps) && c.steps.length >= 2) d.template = 'timeline';
    else if (c.table) d.template = 'table';
    else if (c.quote) d.template = 'quote';
    else d.template = 'cover';
  }
  /* Same in reverse: a cover with a chart in it should show the chart. */
  if (d.template === 'cover' && c.chart) d.template = 'chart-insight';

  /* Templates with an exact item count: the model routinely picks
     `comparison` for three things. The item count is the honest signal
     of what the content actually is, so follow it rather than reject. */
  const n = Array.isArray(c.items) ? c.items.length : 0;
  if (d.template === 'comparison' && n !== 2) d.template = n === 3 ? 'cards-3up' : 'list-insight';
  if (d.template === 'cards-3up' && n !== 3) d.template = n === 2 ? 'comparison' : 'list-insight';
  if (d.template === 'stat-hero' && Array.isArray(c.stats) && c.stats.length > 1) d.template = 'kpi-grid';
  if (d.template === 'kpi-grid' && Array.isArray(c.stats) && c.stats.length === 1) d.template = 'stat-hero';

  return d;
}

export function repairDesign(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const d = pick(raw, ['canvas', 'theme', 'template', 'brand', 'background', 'content']);

  if (d.brand) {
    d.brand = pick(d.brand, ['logoText', 'accent']);
    if (d.brand.logoText !== undefined) d.brand.logoText = trunc(d.brand.logoText, 28);
    if (typeof d.brand.accent === 'string' && !/^#[0-9a-fA-F]{6}$/.test(d.brand.accent)) delete d.brand.accent;
  }

  if (d.background) {
    const b = pick(d.background, ['mode', 'prompt', 'seed', 'hue', 'strength']);
    if (b.strength !== undefined) b.strength = clamp(b.strength, 0, 1);
    if (b.hue !== undefined) b.hue = clamp(b.hue, 0, 360);
    if (b.seed !== undefined) b.seed = clamp(Math.round(b.seed), 0, 2 ** 31 - 1);
    if (b.prompt !== undefined) b.prompt = trunc(b.prompt, 600);
    for (const k of Object.keys(b)) if (b[k] === undefined) delete b[k];
    d.background = b;
  }

  const c = pick(d.content, CONTENT_KEYS);
  if (c.eyebrow !== undefined) c.eyebrow = trunc(c.eyebrow, 40);
  if (c.title !== undefined) c.title = trunc(c.title, 90);
  if (c.subtitle !== undefined) c.subtitle = trunc(c.subtitle, 160);
  if (c.source !== undefined) c.source = trunc(c.source, 80);

  if (c.insight) {
    c.insight = pick(c.insight, ['label', 'text']);
    if (c.insight.label !== undefined) c.insight.label = trunc(c.insight.label, 24);
    if (c.insight.text !== undefined) c.insight.text = trunc(c.insight.text, 240);
  }

  if (c.chart) {
    const ch = pick(c.chart, ['type', 'categories', 'series', 'unit', 'max', 'focusSeries']);
    if (Array.isArray(ch.categories)) ch.categories = ch.categories.slice(0, 24).map(x => trunc(String(x), 28));
    if (Array.isArray(ch.series)) {
      ch.series = ch.series.slice(0, 8).map(s => ({
        name: trunc(String(s?.name ?? ''), 40),
        data: Array.isArray(s?.data) ? s.data.map(Number) : [],
      }));
    }
    if (ch.unit !== undefined) ch.unit = trunc(String(ch.unit), 8);
    if (ch.focusSeries !== undefined && ch.focusSeries !== null) {
      const fs = clamp(Math.round(ch.focusSeries), 0, Math.max(0, (ch.series?.length ?? 1) - 1));
      ch.focusSeries = fs === undefined ? null : fs;
    }
    /* A donut with several series is a chart-type mistake, not a data
       one -- a stacked bar says the same thing and is readable. */
    if (ch.type === 'donut' && Array.isArray(ch.series) && ch.series.length > 1) ch.type = 'stacked-bar';
    c.chart = ch;
  }

  if (Array.isArray(c.stats)) {
    c.stats = c.stats.slice(0, 4).map(s => {
      const o = pick(s, ['value', 'unit', 'label', 'delta']);
      if (o.value !== undefined) o.value = trunc(String(o.value), 12);
      if (o.unit !== undefined) o.unit = trunc(String(o.unit), 8);
      if (o.label !== undefined) o.label = trunc(String(o.label), 60);
      if (o.delta) {
        o.delta = pick(o.delta, ['value', 'direction', 'goodDirection']);
        if (o.delta.value !== undefined) o.delta.value = trunc(String(o.delta.value), 16);
      }
      return o;
    });
  }

  if (Array.isArray(c.items)) {
    c.items = c.items.slice(0, 6).map(i => {
      const o = pick(i, ['title', 'text', 'value']);
      if (o.title !== undefined) o.title = trunc(String(o.title), 60);
      if (o.text !== undefined) o.text = trunc(String(o.text), 180);
      if (o.value !== undefined) o.value = trunc(String(o.value), 12);
      return o;
    });
  }

  if (Array.isArray(c.steps)) {
    c.steps = c.steps.slice(0, 5).map(i => {
      const o = pick(i, ['label', 'title', 'text']);
      if (o.label !== undefined) o.label = trunc(String(o.label), 16);
      if (o.title !== undefined) o.title = trunc(String(o.title), 48);
      if (o.text !== undefined) o.text = trunc(String(o.text), 140);
      return o;
    });
  }

  if (c.quote) {
    c.quote = pick(c.quote, ['text', 'attribution', 'role']);
    if (c.quote.text !== undefined) c.quote.text = trunc(String(c.quote.text), 300);
    if (c.quote.attribution !== undefined) c.quote.attribution = trunc(String(c.quote.attribution), 60);
    if (c.quote.role !== undefined) c.quote.role = trunc(String(c.quote.role), 80);
  }

  if (c.table) {
    const t = pick(c.table, ['columns', 'rows', 'numericColumns']);
    if (Array.isArray(t.columns)) t.columns = t.columns.slice(0, 6).map(x => trunc(String(x), 28));
    if (Array.isArray(t.rows)) t.rows = t.rows.slice(0, 10).map(r => (Array.isArray(r) ? r.map(x => trunc(String(x), 32)) : r));
    c.table = t;
  }

  d.content = c;
  return retarget(d);
}

export function validateDesign(input) {
  const raw = repairDesign(input);
  const parsed = DesignSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join('.') || '<root>'}: ${i.message}`);
    return { ok: false, issues };
  }
  const d = parsed.data;
  const missing = (REQUIRED[d.template] || []).filter(k => d.content[k] === undefined);
  if (missing.length) {
    return { ok: false, issues: missing.map(k => `content.${k}: required by template "${d.template}"`) };
  }
  /* A classic small-model confusion: it emits one series PER CATEGORY,
     named after the categories, producing an NxN matrix where the data
     is really a single series of N values. Structurally legal, so only
     a semantic check catches it -- and it is worth catching, because
     the resulting chart is confidently wrong. */
  const ch = d.content.chart;
  if (ch && ch.series.length > 1) {
    const cats = new Set(ch.categories.map(c => c.trim().toLowerCase()));
    const echoed = ch.series.filter(s => cats.has(s.name.trim().toLowerCase())).length;
    if (echoed >= Math.min(2, ch.series.length) && echoed === ch.series.length) {
      return {
        ok: false,
        issues: ['content.chart: series names repeat the category names. If each category has ONE value, emit a SINGLE series (e.g. name it after the measure, like "Spend" or "Share") with one number per category — do not create one series per category.'],
      };
    }
  }

  if (d.template === 'stat-hero' && d.content.stats.length !== 1) {
    return { ok: false, issues: ['content.stats: stat-hero takes exactly one stat (one hero figure per view)'] };
  }
  if (d.template === 'cards-3up' && d.content.items.length !== 3) {
    return { ok: false, issues: ['content.items: cards-3up takes exactly three items'] };
  }
  if (d.template === 'comparison' && d.content.items.length !== 2) {
    return { ok: false, issues: ['content.items: comparison takes exactly two items'] };
  }
  return { ok: true, design: d };
}
