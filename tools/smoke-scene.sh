#!/bin/sh
# Render one scene headless at a fixed simulation time and fail on shader or script errors.
# Capture mode advances the real simulation and draws the real WebGL scene, so the
# screenshot is deterministic for a given time. Usage:
#   sh tools/smoke-scene.sh <scene-dir> <out.png> [query]
set -eu
scene=$1 out=$2 query=${3:-capture&time=20}
port=${SMOKE_PORT:-8093}
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
root=$(cd "$(dirname "$0")/.." && pwd)
PORT=$port node "$root/serve.mjs" >/dev/null 2>&1 & server=$!
trap 'kill $server 2>/dev/null' EXIT
sleep 1
log=$(mktemp)
"$chrome" --headless=new --enable-unsafe-swiftshader --use-angle=swiftshader --window-size=1440,750 \
  --virtual-time-budget=20000 --enable-logging=stderr --v=0 --screenshot="$out" \
  "http://localhost:$port/scenes/$scene/?$query" 2>"$log"
if grep -E "Shader Error|Uncaught|SyntaxError|Failed to load module|Unable to load" "$log"; then
  echo "smoke: errors in $scene" >&2; exit 1
fi
test -s "$out" && echo "smoke: $scene ok -> $out"
