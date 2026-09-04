# Ethara.AI brand compliance

How the `image-brief` skill is enforced in this pipeline, rule by rule, and the
one place where the skill's rules conflict with each other.

## ⚠️ The conflict you need to decide

**Rule 9 says "Use the purple family as the accent… Never use any other colors."
A single hue family cannot encode unordered categories.** This is measured, not
an opinion:

```
Ethara purple family as a CATEGORICAL palette (surface #0b0714)
  [FAIL] Lightness band      #5E1BC7 0.447, #C084FC 0.722 — outside band
  [FAIL] Normal-vision floor #C084FC ↔ #A855F7  ΔE 11.0  — below the 15 floor
  → FAILED

Same family as an ORDINAL ramp
  [PASS] Lightness monotone · [PASS] Adjacent ΔL · [PASS] Single hue (15°)
  → ALL CHECKS PASS
```

ΔE 11.0 means readers **with full colour vision** cannot reliably tell those two
purples apart — this is not only a colourblindness issue.

So the pipeline does this:

| Chart shape | Behaviour |
|---|---|
| One series | Bright Purple `#A855F7`. Fully compliant. **The common case.** |
| Several *ordered* series (tiers, stages, buckets) — `chart.ordered: true` | The validated purple ordinal ramp. Compliant. |
| Several *unordered* series | **Flagged as off-brand, not silently recoloured** (rule 12 / Constitution VII). You choose: split into small multiples, reduce to one series, or accept non-brand hues. |

Re-run the evidence any time: `./scripts/validate-palette.sh`

## Schematic motifs

Rule 4 names the imagery this brand wants — reward curves, RL loops,
agent–verifier diagrams, benchmark charts, state transitions, trajectories — and
says it should be *schematic rather than literal*. That is a drawing problem, not
a diffusion problem: these are line systems with exact geometry, so they are
generated as SVG (`src/motifs.js`), not prompted.

Deterministic, a few KB of vectors, always on-palette, and structurally incapable
of producing a glowing brain.

| motif | reads as | default placement |
|---|---|---|
| `trajectory` | agent paths converging on a goal region | right |
| `reward-curve` | a learning curve with its variance band | band |
| `rl-loop` | agent → action → environment → reward | behind |
| `lattice` | an agent–verifier graph | right |
| `state-grid` | a path stepping through a state lattice | full |
| `contour` | a reward landscape with two optima | behind |
| `grid` | engineered graph paper with registration marks | full |

```json
"background": { "mode": "mesh", "hue": 272, "seed": 17,
                "motif": { "type": "reward-curve", "opacity": 0.5 } }
```

Two kinds, scaled differently. **Field** motifs are unbounded textures and crop
safely. **Composed** motifs (`rl-loop`, `contour`) are a single centred drawing —
cover-cropping one into a side panel slices the composition apart, so they fit
instead, and side placements are refused for them. Placement defaults per motif;
`behind` deliberately sits high, because most templates put their headline in the
lower half.

Opacity is capped at 0.85 and the layer sits *below* the scrim, so the contrast
gate measures it as part of the real background — a motif can never quietly push
text under 4.5:1.

## Editorial typography

`content.titleAccent` sets one exact substring of the headline in the accent
colour — emphasis without a second type size. A phrase that isn't in the title is
dropped silently rather than triggering a retry.

```json
"title": "No model resolves more than a quarter of SWE-EVO",
"titleAccent": "a quarter"
```

## Rule-by-rule

| # | Rule | Where it lives |
|---|---|---|
| 1 | Subject from shared CoreContext | the brief passed to `generate.py` |
| 2 | Visual type selection; never a chart without data | system prompt + `wants_chart()` + the no-numbers source guard |
| 3 | One focal visual system | one template per image; templates cannot be combined |
| 4 | Clean, minimal, technical, research-forward | `ethara` theme; generous `--pad-canvas`; hairline grid; thin marks |
| 5 | Forbidden stock imagery | `FORBIDDEN_IMAGERY` in `schema.js` (flags) + the negative `GUARD` in `background.js` (prevents) |
| 6 | Never fabricate chart data | source is overwritten with an illustrative-data notice when the brief has no numbers; fabricated citations forbidden in the system prompt |
| 7–8 | Two distinct options, ≥2 visual dimensions | `--options 2`; option B is told what A used and must differ on composition, focal subject, visual type or viewpoint |
| 9 | Ethara Purple family only | `[data-theme='ethara']` in `tokens.css` — see the conflict above |
| 10 | Roboto display / DM Sans body | `--font-display` / `--font-body`, self-hosted in `assets/fonts` |
| 11 | Accessible alt text | `design.altText`, written beside the PNG as `<name>.alt.txt`; missing alt is flagged |
| 12 | Flag off-brand, never silently correct | `brandCheck()` returns warnings; the renderer logs `BRAND:` lines and returns `brandFlags` |
| 13 | Iteration integrity | edit the saved design JSON and re-render — untouched fields cannot drift, because layout is deterministic |
| 14 | Logo usage | `brand.logoText` renders as a wordmark in brand type; no logo file is scaled or recoloured |
| 15 | Platform dimensions | `CANVASES` + `PLACEMENTS`; select with `--placement` |

## Placements

```
--placement linkedin-portrait    1080×1350   4:5
--placement linkedin-square      1080×1080   1:1
--placement linkedin-landscape   1200×627    1.91:1
--placement linkedin-carousel    1080×1080   1:1
--placement linkedin-banner      1584×396    4:1
--placement instagram-feed       1080×1350   4:5
--placement instagram-square     1080×1080   1:1
--placement instagram-story      1080×1920   9:16
--placement youtube-thumbnail    1280×720    16:9
--placement youtube-video        1920×1080   16:9
```

These are configurable references in `src/schema.js`, not hard-coded constants.

## Usage

```bash
# two brand options for the human gate, sized for the LinkedIn feed
python3 generate.py --placement linkedin-portrait --options 2 --out 4k

# a specific brief, one option, with the vector PDF
python3 generate.py "SWE-EVO shows agents resolve only 25% of long-horizon tasks" \
        --placement linkedin-portrait --out 4k --pdf
```

`theme` defaults to `ethara`; `canvas` defaults to `portrait`. Anything off-brand
is reported on stderr as `BRAND:` lines and returned in `result.brandFlags` — it is
never quietly fixed.

## What is NOT yet implemented

- **Logo asset files.** Only the `logoText` wordmark is supported. Clear-space
  rules for the actual logo SVG/PNG need the Knowledge Base assets.
- **The 0.85 similarity threshold (rule 8)** is enforced structurally — option B is
  required to differ on ≥2 named dimensions — but no numeric similarity score is
  computed. Scoring it needs a defined metric.
- **`brand-voice` skill** is referenced by the spec but not present in this repo.
