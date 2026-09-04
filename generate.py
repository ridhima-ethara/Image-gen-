#!/usr/bin/env python3
"""
generate.py -- brief in, high-resolution image out.

    python3 generate.py "Create a LinkedIn infographic about AI adoption"

The model's ONLY job is to emit a design JSON that satisfies the schema.
It never writes CSS, never places anything, and never renders a number.
Layout, charts and typography are deterministic, so the failure mode of a
weak model is "retry", not "subtly wrong chart".
"""
import argparse
import json
import re
import os
import subprocess
import sys
import textwrap
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
OLLAMA = os.environ.get("OLLAMA_HOST", "http://localhost:11434")


def node(args, stdin=None):
    return subprocess.run(
        ["node", *args], cwd=ROOT, input=stdin, capture_output=True, text=True
    )


def catalog():
    r = node(["src/validate.js", "--catalog"])
    return json.loads(r.stdout)


def json_schema():
    """The schema handed to Ollama's constrained decoder.

    altText is OPTIONAL in src/schema.js, so hand-written JSON without it
    still renders (with a brand flag). But a model given an optional field
    simply omits it -- no amount of retrying fixes that, because constrained
    decoding never demands it. So we promote it to required here, at the
    only layer where it changes the model's behaviour.
    """
    schema = json.loads(node(["src/validate.js", "--json-schema"]).stdout)
    req = schema.setdefault("required", [])
    if "altText" in schema.get("properties", {}) and "altText" not in req:
        req.append("altText")
    return schema


SYSTEM = """You are the Image Brief author for Ethara.AI, an RL/AGI infrastructure \
company. You emit ONE JSON object matching the provided schema. No prose, no \
markdown, no code fences.

The visual must read as a serious, technical AI/RL infrastructure company -- never
stocky, never consumer-cute.

VISUAL TYPE SELECTION -- choose from the evidence you actually have:
  quantitative contrast in the brief -> a restrained chart
  a process or mechanism            -> a systems diagram (process-flow / timeline)
  a broad idea with no dataset      -> conceptual/schematic (cover, quote, cards, list)
NEVER use a chart when the brief contains no supporting quantitative data. A chart
with invented numbers is the single worst output you can produce.

FOCAL SYSTEM: reduce the idea to ONE focal visual system. Do not try to illustrate
every paragraph of the source.

VISUAL DIRECTION: clean, minimal, technical, research-forward. High signal-to-noise,
generous negative space, strong typographic treatment, restrained and engineered.
Appropriate abstract imagery is schematic, not literal: reward curves, RL loops,
agent-verifier diagrams, benchmark charts, state transitions, trajectories.

FORBIDDEN -- never describe these in background.prompt: glowing brains, humanoid
robots, neon circuit swirls, holographic AI faces, generic futuristic server rooms,
busy compositions, cheesy metaphors (handshakes, lightbulbs, puzzle pieces, rockets).

BRAND: theme is ALWAYS "ethara". The palette is the Ethara Purple family only and
the renderer owns it -- never set brand.accent. Typography (Roboto display, DM Sans
body) is likewise the renderer's job.

ALT TEXT: always write design.altText -- one or two sentences describing the visual
for a reader who cannot see it. Describe what is shown, not "an image of".

CHART SERIES AND THE BRAND PALETTE: the Ethara palette is a single hue family, so it
can only encode ONE series, or several series that form a genuinely ORDERED set
(tiers, stages, time buckets) -- in which case set chart.ordered = true. If the
series are unordered categories, prefer a single series instead. Do not request more
than 4 series.

You are choosing a LAYOUT and supplying CONTENT. You never write CSS, never position \
anything, and never describe how something should look. The renderer owns all of that.

TEMPLATES -- pick the one whose shape matches the story:
  cover .......... a title moment; opening or closing frame
  chart-insight .. one chart plus a written takeaway. The default for data
  chart-split .... chart beside supporting stats or an insight
  stat-hero ...... ONE number that is the whole story
  kpi-grid ....... 2-4 headline metrics side by side
  comparison ..... exactly two things held against each other
  cards-3up ...... exactly three parallel points
  list-insight ... 2-6 ranked or enumerated takeaways
  timeline ....... 2-5 points in time
  process-flow ... 2-5 sequential stages
  quote .......... a pull quote with attribution
  table .......... precise values that must be read, not eyeballed

CHART RULES -- these are enforced; violating them fails the render:
- Every series.data array must be EXACTLY as long as categories.
- One measure per chart. Two measures on different scales are two charts.
- Prefer bar for magnitude, hbar when category names are long, line/area for
  change over time, stacked-bar for part-to-whole over categories.
- Avoid donut. Use it only for genuine part-to-whole with <= 6 segments.
- A single number is NOT a chart -- use stat-hero.
- Two numbers are NOT a chart -- use comparison or kpi-grid.
- With 2+ series, set focusSeries to the index of the one the story is about.

THE MOST COMMON MISTAKE -- read this twice.
"categories" are the things on the axis. "series" is the MEASURE being plotted.
They are not the same list. One number per category means ONE series.

Comparing spend across AWS, Azure and GCP -- CORRECT:
  "categories": ["AWS", "Azure", "GCP"],
  "series": [{"name": "Annual spend ($M)", "data": [42, 31, 18]}]

The SAME data, WRONG -- three series named after the categories, nine numbers
where there are only three facts:
  "categories": ["AWS", "Azure", "GCP"],
  "series": [{"name": "AWS", "data": [42, 0, 0]},
             {"name": "Azure", "data": [0, 31, 0]},
             {"name": "GCP", "data": [0, 0, 18]}]

Use more than one series ONLY when every category genuinely has more than one
number -- e.g. categories are years and series are ["Training", "Inference"].
Name each series after the MEASURE, never after a category.

WRITING:
- title: a claim, not a label. "Enterprise adoption keeps pulling away",
  not "Adoption by segment". Under 70 characters.
- eyebrow: 2-4 words of context, e.g. the topic or period.
- insight.text: one sentence saying what the data MEANS. No restating numbers.
- Never invent a statistic that is not in the brief or clearly implied by it.
- NEVER attribute data to a real organisation, report or dataset. Inventing a
  citation like "Statista, Q4 2023" is the single worst thing you can do here.
  If the numbers are illustrative, content.source must say exactly that and
  name nobody.
- If the brief asks for a chart, graph, trend or breakdown, you MUST pick a
  template that has a chart (chart-insight or chart-split) and fill
  content.chart. A cover or quote is not an acceptable answer to "make a chart".

BACKGROUND -- pick honestly:
  mesh ..... default. Deterministic, instant, always on-brand.
  texture .. mesh plus a generated wash. Use when you want visual richness.
  hero ..... a generated image confined to a side panel. Good for covers.
  flux ..... full-bleed generated image. Editorial covers only, never behind a chart.
  solid .... flat. Dense/analytical layouts.
When mode is texture, hero or flux you MUST write background.prompt: an abstract,
photographic or material description with NO text, people, charts or logos in it.

background.hue is the mesh's base hue in degrees. The chart series start at blue,
so a warm background fights them: use 195-240 whenever the slide contains a chart.
Warm hues (20-45) are for chart-free frames only -- cover, quote, list-insight.
Always set brand.logoText if the brief names an organisation.

CANVAS / PLACEMENT: portrait (1080x1350, Instagram + LinkedIn feed -- the default
for social), square (1080x1080), story (1080x1920), li-landscape (1200x627),
yt-thumb (1280x720), li-banner (1584x396), landscape (1920x1080).
"""


# A brief can ask for a chart in many words; if it does, a chartless
# template is a wrong answer no schema can catch on its own.
CHART_INTENT = re.compile(
    r"\b(chart|graph|plot|visuali[sz]\w*|trend|growth|breakdown|distribution|"
    r"over time|compare|comparison|by (?:segment|region|category|year|quarter))\b",
    re.I,
)


def wants_chart(brief):
    return bool(CHART_INTENT.search(brief))


def brief_has_numbers(brief):
    return bool(re.search(r"\d", brief))


def build_prompt(brief, cat, want_canvas, want_theme):
    return textwrap.dedent(f"""\
        BRIEF
        {brief}

        Canvas: {want_canvas}
        Theme preference: {want_theme}

        Emit the design JSON now.""")


def call_ollama(model, system, user, schema, temperature):
    body = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        # Constrain at decode time -- the model cannot emit a shape the
        # schema forbids, which removes most of the retry loop's work.
        "format": schema,
        "stream": False,
        "options": {"temperature": temperature},
    }).encode()
    req = urllib.request.Request(
        f"{OLLAMA}/api/chat", data=body, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.loads(r.read())["message"]["content"]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("brief", nargs="*", help="what the image should say (quotes optional)")
    ap.add_argument("--brief-file", help="read the brief from a text file instead")
    ap.add_argument("--model", default=os.environ.get("SMA_MODEL", "qwen2.5:7b"),
                    help="Ollama model for the design JSON (default qwen2.5:7b)")
    ap.add_argument("--canvas", default=None,
                    help="landscape|portrait|square|story|li-landscape|yt-thumb|li-banner")
    ap.add_argument("--placement", default=None,
                    help="linkedin-portrait|instagram-feed|youtube-thumbnail|linkedin-banner|... (sets --canvas)")
    ap.add_argument("--theme", default="ethara", help="ethara (brand) | midnight | paper | ink")
    ap.add_argument("--options", type=int, default=1,
                    help="how many distinct brief options to render (2 = the A/B human gate)")
    ap.add_argument("--out", default="4k", help="hd|2k|4k|8k or a long-edge pixel count")
    ap.add_argument("--dir", default="out")
    ap.add_argument("--name", default="slide")
    ap.add_argument("--pdf", action="store_true")
    ap.add_argument("--loose", action="store_true", help="warn on QA problems instead of failing")
    ap.add_argument("--retries", type=int, default=4)
    ap.add_argument("--design", help="skip the model; render this design JSON file")
    ap.add_argument("--save-design", help="write the generated design JSON here")
    args = ap.parse_args()

    # A placement names a real platform slot; it wins over a raw canvas.
    if args.placement:
        placements = json.loads(node(["src/validate.js", "--placements"]).stdout)
        if args.placement not in placements:
            ap.error(f"unknown placement. choose from: {', '.join(sorted(placements))}")
        args.canvas = placements[args.placement]
    if not args.canvas:
        args.canvas = "portrait"   # social feed is the default destination

    # Accept the brief three ways, because quoting a long prompt into a
    # shell is the most annoying step in the whole pipeline:
    #   1. as arguments, quoted or not
    #   2. from a file via --brief-file
    #   3. typed or pasted at an interactive prompt
    if args.brief_file:
        args.brief = open(args.brief_file).read().strip()
    elif args.brief:
        args.brief = " ".join(args.brief)
    elif not args.design and sys.stdin.isatty():
        print("Describe the image you want. Press Enter twice when done.\n", file=sys.stderr)
        lines = []
        while True:
            try:
                line = input()
            except EOFError:
                break
            if not line and lines:
                break
            if line:
                lines.append(line)
        args.brief = " ".join(lines).strip()
        print("", file=sys.stderr)
    elif not args.design:
        args.brief = sys.stdin.read().strip()

    if args.design:
        designs = [open(args.design).read()]
    else:
        if not args.brief:
            ap.error("a brief is required unless --design is given")
        cat = catalog()
        schema = json_schema()
        designs = []

        # The skill requires two DISTINCT options for the human gate, differing
        # on at least two visual dimensions -- composition, focal subject,
        # palette emphasis or viewpoint. Wording changes are not a second
        # direction, so option B is told explicitly what A already did.
        for opt in range(args.options):
            label = chr(ord("A") + opt)
            user = build_prompt(args.brief, cat, args.canvas, args.theme)
            if opt > 0:
                prev = json.loads(designs[-1])
                user += (
                    f"\n\nThis is option {label}. Option A already used:\n"
                    f"- template/composition: {prev['template']}\n"
                    f"- focal subject: {prev['content'].get('title')}\n"
                    f"- visual type: {'chart' if prev['content'].get('chart') else 'conceptual/schematic'}\n"
                    "Option " + label + " MUST differ on at least TWO of: composition (a different "
                    "template), focal subject, visual type, or viewpoint. Rewording option A is NOT "
                    "an acceptable second option."
                )
            got, last = None, None

            for attempt in range(1, args.retries + 1):
                print(f"[option {label} · {attempt}/{args.retries}] asking {args.model}...", file=sys.stderr)
                try:
                    out = call_ollama(args.model, SYSTEM, user, schema,
                                      0.4 if attempt == 1 else 0.75)
                except Exception as e:
                    print(f"  ollama call failed: {e}", file=sys.stderr)
                    break

                check = node(["src/validate.js"], stdin=out)
                result = json.loads(check.stdout or '{"ok":false,"issues":["no validator output"]}')

                # Alt text is a hard requirement of the image-brief skill
                # (rule 11), not a nice-to-have -- so it is worth a retry
                # rather than shipping a non-compliant image with a warning.
                if result["ok"] and not (result["design"].get("altText") or "").strip():
                    result = {"ok": False, "issues": [
                        "design.altText is missing. Write one or two sentences describing the "
                        "visual for a reader who cannot see it: what is shown and what it says. "
                        "Do not begin with \"an image of\"."
                    ]}

                if result["ok"] and wants_chart(args.brief) and not result["design"]["content"].get("chart"):
                    result = {"ok": False, "issues": [
                        'the brief asks for a chart, but you chose template '
                        f'"{result["design"]["template"]}" with no content.chart. '
                        "Use chart-insight or chart-split and fill content.chart."
                    ]}

                if result["ok"]:
                    design = result["design"]
                    design["canvas"] = args.canvas
                    design["theme"] = args.theme
                    # No numbers in the brief means anything plotted was invented.
                    # Never let invented data carry a citation.
                    if not brief_has_numbers(args.brief):
                        design["content"]["source"] = "Illustrative data \u2014 not from a real source"
                    got = json.dumps(design, indent=2)
                    break

                last = result["issues"]
                for i in last:
                    print(f"  invalid: {i}", file=sys.stderr)
                user = user + "\n\nYour previous answer was REJECTED. Fix every one of these:\n" + \
                    "\n".join(f"- {i}" for i in last)

            if got is None:
                print(f"could not get a valid design for option {label}.", file=sys.stderr)
                for i in (last or []):
                    print(f"  - {i}", file=sys.stderr)
                if not designs:
                    print("\nTry: a stronger --model, or hand-write the JSON and use --design.", file=sys.stderr)
                    return 2
                break
            designs.append(got)

    rc = 0
    for opt, design_json in enumerate(designs):
        label = chr(ord("A") + opt)
        name = args.name if len(designs) == 1 else f"{args.name}-{label}"

        if args.save_design:
            path = args.save_design if len(designs) == 1 else \
                args.save_design.replace(".json", f"-{label}.json")
            with open(path, "w") as f:
                f.write(design_json)
            print(f"design -> {path}", file=sys.stderr)

        cmd = ["src/cli.js", "-", "--out", args.out, "--dir", args.dir, "--name", name]
        if args.pdf:
            cmd.append("--pdf")
        if args.loose:
            cmd.append("--loose")

        proc = subprocess.Popen(["node", *cmd], cwd=ROOT, stdin=subprocess.PIPE, text=True)
        proc.communicate(design_json)
        rc = rc or proc.returncode
    return rc


if __name__ == "__main__":
    sys.exit(main())
