#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { render, closeBrowser, OUTPUTS } from './render.js';

const USAGE = `
smagen -- render a validated design JSON to a high-resolution PNG

  node src/cli.js <design.json | -> [options]

Options
  --out <preset>    hd | 2k | 4k | 8k, or an explicit long-edge px   (default 4k)
  --dir <path>      output directory                                 (default out)
  --name <base>     output basename                                  (default from input)
  --pdf             also emit a vector PDF of the same layout
  --loose           warn on QA problems instead of failing the render
  -                 read the design JSON from stdin

The input may be a single design object or an array of them (a deck).
`;

function parseArgs(argv) {
  const a = { out: '4k', dir: 'out', name: null, pdf: false, strict: true, input: null };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--out') a.out = argv[++i];
    else if (t === '--dir') a.dir = argv[++i];
    else if (t === '--name') a.name = argv[++i];
    else if (t === '--pdf') a.pdf = true;
    else if (t === '--loose') a.strict = false;
    else if (t === '-h' || t === '--help') { console.log(USAGE); process.exit(0); }
    else a.input = t;
  }
  return a;
}

async function readInput(src) {
  if (src === '-' || src === null) {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  return JSON.parse(await fs.readFile(src, 'utf8'));
}

const args = parseArgs(process.argv.slice(2));
if (!args.input && process.stdin.isTTY) { console.log(USAGE); process.exit(1); }

let raw;
try {
  raw = await readInput(args.input);
} catch (e) {
  console.error(`could not read design JSON: ${e.message}`);
  process.exit(1);
}

const designs = Array.isArray(raw) ? raw : [raw];
const base = args.name || (args.input && args.input !== '-'
  ? path.basename(args.input, path.extname(args.input))
  : 'slide');

if (!OUTPUTS[args.out] && !Number(args.out)) {
  console.error(`unknown --out "${args.out}" (expected ${Object.keys(OUTPUTS).join(' | ')} or a pixel width)`);
  process.exit(1);
}

let failed = 0;
for (const [i, d] of designs.entries()) {
  const name = designs.length > 1 ? `${base}-${String(i + 1).padStart(2, '0')}` : base;
  console.error(`\n[${name}] ${d.template ?? '?'} / ${d.theme ?? 'midnight'} / bg:${d.background?.mode ?? 'mesh'}`);
  try {
    const r = await render(d, { output: args.out, outDir: args.dir, name, pdf: args.pdf, strict: args.strict });
    console.error(`  -> ${r.png}  ${r.width}x${r.height}`);
    if (r.pdf) console.error(`  -> ${r.pdf}`);
    console.log(r.png);
  } catch (e) {
    failed++;
    console.error(`  FAILED: ${e.message}`);
    for (const x of e.issues || []) console.error(`    · ${x}`);
    for (const p of e.problems || []) console.error(`    · ${p.kind}: ${p.el}`);
  }
}

await closeBrowser();
process.exit(failed ? 1 : 0);
