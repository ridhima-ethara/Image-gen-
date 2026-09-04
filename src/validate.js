#!/usr/bin/env node
/* Validation as its own step, so the generate loop can retry a bad
   design for free instead of paying for a render to find out. */
import { z } from 'zod/v4';
import { DesignSchema, validateDesign, TEMPLATES, CHART_TYPES, THEMES, CANVASES } from './schema.js';

if (process.argv.includes('--json-schema')) {
  /* Fed to Ollama's `format` so the model is constrained at decode
     time. Derived from the same zod schema that enforces it, so the
     two can never drift. */
  console.log(JSON.stringify(z.toJSONSchema(DesignSchema, { io: 'input' }), null, 2));
  process.exit(0);
}

if (process.argv.includes('--catalog')) {
  console.log(JSON.stringify({ templates: TEMPLATES, chartTypes: CHART_TYPES, themes: THEMES, canvases: Object.keys(CANVASES) }));
  process.exit(0);
}

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
let raw;
try {
  raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
} catch (e) {
  console.log(JSON.stringify({ ok: false, issues: [`not valid JSON: ${e.message}`] }));
  process.exit(1);
}
const designs = Array.isArray(raw) ? raw : [raw];
const issues = [];
designs.forEach((d, i) => {
  const r = validateDesign(d);
  if (!r.ok) issues.push(...r.issues.map(x => (designs.length > 1 ? `[${i}] ${x}` : x)));
});
console.log(JSON.stringify({ ok: !issues.length, issues }));
process.exit(issues.length ? 1 : 0);
