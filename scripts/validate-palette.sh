#!/usr/bin/env bash
# Re-run the colour gates after ANY palette edit in assets/css/tokens.css.
# Requires the dataviz skill's validator; point SKILL at its base directory.
set -euo pipefail
SKILL="${SKILL:-$(find /private/tmp/claude-501/bundled-skills -type d -name dataviz 2>/dev/null | head -1)}"
V="$SKILL/scripts/validate_palette.js"
[ -f "$V" ] || { echo "validator not found. Set SKILL=<path to dataviz skill>"; exit 1; }

echo "== midnight / ink (dark surface #0b1220) =="
node "$V" "#3987e5,#d95926,#199e70,#c98500,#d55181,#008300,#9085e9,#e66767" --mode dark --surface "#0b1220"
echo
echo "== paper (light surface #fcfcfb) =="
node "$V" "#2a78d6,#eb6834,#1baf7a,#eda100,#e87ba4,#008300,#4a3aa7,#e34948" --mode light --surface "#fcfcfb"
