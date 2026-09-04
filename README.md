# smagen — deterministic-content image pipeline

FLUX makes the picture. The browser makes the words.

The image model never renders a number, a label, an axis or a logo. Text, charts
and layout are produced by a browser against local fonts and a validated palette,
then a QA gate checks the result and corrects it *before* the screenshot is taken.

```
Brief ──► LLM (schema-constrained) ──► validated Design JSON
                                              │
            ┌─────────────────────────────────┤
            ▼                                 ▼
   Background resolver                 Template selector
 (cache → mesh | FLUX texture           (12 archetypes over
  | FLUX hero, seeded)                   one token file)
            │                                 │
            └──────────────┬──────────────────┘
                           ▼
              ONE Playwright page @2–4x
           (local fonts + ECharts in-page)
                           ▼
            ┌──────── QA gate ────────┐
            │ fit · contrast · overlap│──fail──► adjust & re-render
            └────────────┬────────────┘
                         ▼ pass
            screenshot(clip) → Lanczos downsample
                         ▼
              PNG up to 8K  +  vector PDF
```

## Ethara brand mode

`theme` defaults to `ethara` and `canvas` to `portrait`. The brand system (Ethara
Purple family, Roboto display / DM Sans body, platform placements, forbidden stock
imagery, required alt text, A/B options) is enforced per the `image-brief` skill.

**Read [BRAND.md](BRAND.md) first** — it documents rule-by-rule compliance and one
genuine conflict in the skill that needs a human decision: a single hue family
cannot encode unordered chart categories, and the pipeline flags that rather than
silently adding off-brand hues.

```bash
python3 generate.py --placement linkedin-portrait --options 2 --out 4k
```

## Quick start

```bash
npm install                       # also fetches Chromium
node scripts/fetch-fonts.mjs      # only if assets/fonts is empty

# from a brief, via a local model
python3 generate.py "How Indian SaaS companies are adopting AI agents in 2026" \
        --canvas portrait --out 4k --pdf

# from hand-written JSON (no model involved)
node src/cli.js examples/ai-adoption.json --out 4k --pdf
```

`--out` takes `hd | 2k | 4k | 8k`, or an explicit long-edge pixel count. It means
the **long edge**, so `4k` is 3840×2160 landscape and 3072×3840 portrait.

## Why it is built this way

**Never let a diffusion model render semantic content.** FLUX.2 Klein is good
enough at typography to produce *plausible* headlines, which is worse than
obviously-wrong ones, because plausible errors ship. Numbers, labels and logos
are data; they belong in a renderer that is exact.

**Templates, not freeform layout.** The model picks one of 12 archetypes and fills
a JSON schema. It never writes CSS. This is the single biggest quality lever in
the pipeline — it is what makes output consistently on-brand instead of randomly
styled.

**Supersample, then downsample.** Every render happens at 2–4× device scale and is
resampled with Lanczos to the exact target. Even at 1080p output this beats
rendering at 1×; glyph edges and chart antialiasing are visibly cleaner.

**One browser pass, not three tools passing files.** ECharts runs *inside* the
render page rather than through its Node SSR path. SSR has no canvas, so it
estimates text widths — and label collisions only surface after the fact. In-page,
the chart shares the page's real font metrics and CSS custom properties.

## The QA gate

`src/browser/qa.js` runs in-page after layout, before the shot.

1. **Fit.** Every `[data-fit]` element is shrunk until it genuinely fits, down to a
   per-element floor. Nothing is ever cropped to hide an overflow.
2. **Contrast.** The renderer takes a first screenshot of *just the background
   layers*, feeds those real pixels back into the page, and samples the luminance
   under every text block. The scrim is then raised to the **lowest** value at
   which all text clears WCAG (4.5:1, or 3:1 for large type). Sampling the actual
   composite is the only honest way to do this — it accounts for the mesh
   gradients, the soft-light texture blend and the hero mask, none of which a
   naive model of the background would capture.
3. **Audit.** Overflow, out-of-frame and text-overlap are reported. `strict` mode
   (the default) fails the render rather than shipping a broken PNG.

Overflow detection is fussier than `scrollHeight > clientHeight`: inline boxes
have no scroll metrics at all, and tight leading makes the ink box taller than the
line box (a 76px headline at line-height 1.04 reports 85 vs 79 while looking
perfect). The gate skips inline boxes and tolerates leading overshoot but not a
full extra line.

## Backgrounds

| mode | what it does | when |
|---|---|---|
| `mesh` | seeded CSS gradient mesh + grain | default — instant, free, always on-brand |
| `texture` | mesh + a FLUX wash in `soft-light` at ~20% | generative richness, zero legibility cost |
| `hero` | FLUX confined to a masked side panel | covers; type sits on clean ground |
| `flux` | full-bleed FLUX, slightly blurred | editorial covers only, never behind a chart |
| `solid` | flat surface | dense/analytical layouts, tables |

**Measured on this machine:** FLUX.2 Klein via Ollama takes **~77–80s** per image
and **always returns 1024×1024** — it ignores `width`/`height` options. So every
generation is cached by `hash(model, prompt, seed)` and the square is cover-cropped
and Lanczos-upscaled to the canvas. That upscale is fine for abstract washes and
gets soft on detailed imagery, which is why `texture` is the recommended default
rather than full-bleed.

Backgrounds are reusable. Prefer building a curated library over generating fresh
per slide — it is faster and more consistent.

## Colour

The palette is validated, not eyeballed. Both modes pass every gate (lightness
band, chroma floor, CVD separation, normal-vision floor, contrast) against this
system's own surfaces. Re-run after **any** palette edit:

```bash
./scripts/validate-palette.sh
```

Two constraints are worth knowing before you touch `tokens.css`:

- **`--text-muted` and `--accent` are the binding constraint**, not the primary
  text colour. They must clear 4.5:1 over the *lightest region of the mesh*, not
  just over the flat surface. The mesh blob lightness is capped for exactly this
  reason — depth comes from saturation and hue spread. Lift those blobs and the
  contrast gate will crank the scrim and flatten the effect you were reaching for.
- **Status colours are specified for marks, not text.** As small text on a lit
  dark ground they fall under 4.5:1, so `--status-good-text` /
  `--status-critical-text` are separate, lighter steps.

`--accent` deliberately differs from `--series-1`: text never wears a data colour.

## Design JSON

`src/schema.js` is the contract. `node src/validate.js --json-schema` emits the
JSON Schema fed to the model's constrained decoding, derived from the same zod
schema that enforces it — so the two cannot drift.

The schema makes the worst charting mistakes unrepresentable rather than merely
discouraged: series length must match categories, dual axes have no
representation, and `donut` accepts exactly one series.

```json
{
  "canvas": "landscape",
  "theme": "midnight",
  "template": "chart-insight",
  "brand": { "logoText": "Ethara AI" },
  "background": { "mode": "mesh", "hue": 214, "seed": 7 },
  "content": {
    "eyebrow": "AI Adoption 2026",
    "title": "Enterprise adoption keeps pulling away",
    "chart": {
      "type": "bar", "unit": "%", "max": 100,
      "categories": ["Enterprise", "Mid-Market", "SMB"],
      "series": [{ "name": "In production", "data": [78, 61, 43] }]
    },
    "insight": { "label": "Key insight", "text": "Enterprise adoption rose 24 points year on year." },
    "source": "Ethara AI Survey, n=1,240"
  }
}
```

Templates: `cover · chart-insight · chart-split · stat-hero · kpi-grid ·
comparison · cards-3up · list-insight · timeline · process-flow · quote · table`

Charts: `bar · hbar · line · area · stacked-bar · donut`

Canvases: `landscape` 1920×1080 · `portrait` 1080×1350 · `square` · `story`

## Layout

```
generate.py            brief -> design JSON -> render (retries on validation failure)
src/cli.js             design JSON -> PNG/PDF
src/render.js          two-pass Playwright renderer
src/schema.js          the contract (zod, single source of truth)
src/templates.js       the 12 archetypes
src/background.js      mesh generator + FLUX cache
src/browser/chart.js   ECharts house style, runs in-page
src/browser/qa.js      the QA gate, runs in-page
assets/css/tokens.css  every colour, size and space — rebrand here
```

## Known limits

- **The 1024² upscale is real.** Full-bleed `flux` at 4K is a 3.75× upscale and
  reads soft. Mitigated with a deliberate slight blur; use `texture` or `hero`
  when sharpness matters.
- **Masked inpainting isn't wired up.** The strongest version of this idea —
  render HTML, emit a mask of all text and chart boxes, diffuse only the
  background regions — needs seed/mask/img2img control that Ollama's image API
  doesn't expose. That needs an MLX-native FLUX runner or ComfyUI.
- **`qwen2.5:7b` is weak for design decisions.** It works because output is
  schema-constrained and retried, but it drifts on canvas and theme (which
  `generate.py` overrides) and writes flatter titles than a frontier model.

## Environment

`OLLAMA_HOST` (default `http://localhost:11434`), `FLUX_MODEL` (default
`x/flux2-klein:9b`), `SMA_MODEL` (default `qwen2.5:7b`).
