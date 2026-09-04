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
    r = node(["src/validate.js", "--json-schema"])
    return json.loads(r.stdout)


SYSTEM = """You are the visual director for a business-content pipeline. You emit ONE JSON \
object matching the provided schema. No prose, no markdown, no code fences.

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

WRITING:
- title: a claim, not a label. "Enterprise adoption keeps pulling away",
  not "Adoption by segment". Under 70 characters.
- eyebrow: 2-4 words of context, e.g. the topic or period.
- insight.text: one sentence saying what the data MEANS. No restating numbers.
- Never invent a statistic that is not in the brief or clearly implied by it.
  If the brief gives no numbers, use plainly illustrative ones and say so in
  content.source.

BACKGROUND -- pick honestly:
  mesh ..... default. Deterministic, instant, always on-brand.
  texture .. mesh plus a generated wash. Use when you want visual richness.
  hero ..... a generated image confined to a side panel. Good for covers.
  flux ..... full-bleed generated image. Editorial covers only, never behind a chart.
  solid .... flat. Dense/analytical layouts.
When mode is texture, hero or flux you MUST write background.prompt: an abstract,
photographic or material description with NO text, people, charts or logos in it.

THEMES: midnight (dark navy, default), paper (light, best for tables and print),
ink (near-black, editorial -- good with quote and cover).

CANVAS: landscape for decks, portrait for LinkedIn/Instagram feed, square, story.
"""


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
    ap.add_argument("brief", nargs="?", help="what the image should say")
    ap.add_argument("--model", default=os.environ.get("SMA_MODEL", "qwen2.5:7b"),
                    help="Ollama model for the design JSON (default qwen2.5:7b)")
    ap.add_argument("--canvas", default="landscape", help="landscape|portrait|square|story")
    ap.add_argument("--theme", default="midnight", help="midnight|paper|ink")
    ap.add_argument("--out", default="4k", help="hd|2k|4k|8k or a long-edge pixel count")
    ap.add_argument("--dir", default="out")
    ap.add_argument("--name", default="slide")
    ap.add_argument("--pdf", action="store_true")
    ap.add_argument("--loose", action="store_true", help="warn on QA problems instead of failing")
    ap.add_argument("--retries", type=int, default=3)
    ap.add_argument("--design", help="skip the model; render this design JSON file")
    ap.add_argument("--save-design", help="write the generated design JSON here")
    args = ap.parse_args()

    if args.design:
        design_json = open(args.design).read()
    else:
        if not args.brief:
            ap.error("a brief is required unless --design is given")
        cat = catalog()
        schema = json_schema()
        design_json, last = None, None
        user = build_prompt(args.brief, cat, args.canvas, args.theme)

        for attempt in range(1, args.retries + 1):
            print(f"[{attempt}/{args.retries}] asking {args.model} for a design...", file=sys.stderr)
            try:
                out = call_ollama(args.model, SYSTEM, user, schema,
                                  0.4 if attempt == 1 else 0.7)
            except Exception as e:
                print(f"  ollama call failed: {e}", file=sys.stderr)
                break

            check = node(["src/validate.js"], stdin=out)
            result = json.loads(check.stdout or '{"ok":false,"issues":["no validator output"]}')
            if result["ok"]:
                design_json = out
                break
            last = result["issues"]
            for i in last:
                print(f"  invalid: {i}", file=sys.stderr)
            # Feed the exact failures back rather than just asking again.
            user = (build_prompt(args.brief, cat, args.canvas, args.theme)
                    + "\n\nYour previous answer was REJECTED for these reasons. "
                      "Fix every one of them:\n"
                    + "\n".join(f"- {i}" for i in last))

        if design_json is None:
            print("could not get a valid design from the model.", file=sys.stderr)
            if last:
                print("last failures:", file=sys.stderr)
                for i in last:
                    print(f"  - {i}", file=sys.stderr)
            print("\nTry: a stronger --model, or hand-write the JSON and use --design.", file=sys.stderr)
            return 2

    # --canvas and --theme are the caller's instruction. Models drift on
    # them constantly, so we overwrite rather than hope.
    _d = json.loads(design_json)
    for _one in (_d if isinstance(_d, list) else [_d]):
        _one["canvas"] = args.canvas
        _one["theme"] = args.theme
    design_json = json.dumps(_d, indent=2)

    if args.save_design:
        with open(args.save_design, "w") as f:
            f.write(design_json)
        print(f"design -> {args.save_design}", file=sys.stderr)

    cmd = ["src/cli.js", "-", "--out", args.out, "--dir", args.dir, "--name", args.name]
    if args.pdf:
        cmd.append("--pdf")
    if args.loose:
        cmd.append("--loose")

    proc = subprocess.Popen(["node", *cmd], cwd=ROOT, stdin=subprocess.PIPE, text=True)
    proc.communicate(design_json)
    return proc.returncode


if __name__ == "__main__":
    sys.exit(main())
