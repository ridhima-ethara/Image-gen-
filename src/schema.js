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

export function validateDesign(raw) {
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
