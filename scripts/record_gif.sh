#!/usr/bin/env bash
# Record a headless Doom run with Flow's gfx-record backend and encode a GIF.
#
# Same capture env vars and frames_to_gif.py path as `flow record`, but links
# flow_rt_support (and CoreFoundation on macOS) which stock `flow record`
# does not pick up from this package's flow.toml yet.
#
# Usage (from repo root):
#   FLOW_DIR=~/flow ./scripts/record_gif.sh
#   FLOW_DIR=~/flow ./scripts/record_gif.sh --frames 180 --out media/doom.gif

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FLOW_DIR="${FLOW_DIR:-$ROOT/../flow}"
FRAMES="${FRAMES:-120}"
SKIP="${SKIP:-2}"
FPS="${FPS:-15}"
WIDTH="${WIDTH:-320}"
OUT="${OUT:-$ROOT/media/doom.gif}"
ARGS="${DOOMFLOW_ARGS:--timedemo demo1}"

while [ $# -gt 0 ]; do
  case "$1" in
    --frames) FRAMES="$2"; shift 2 ;;
    --skip) SKIP="$2"; shift 2 ;;
    --fps) FPS="$2"; shift 2 ;;
    --width) WIDTH="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --args) ARGS="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done

if [ ! -d "$FLOW_DIR/src" ] || [ ! -f "$FLOW_DIR/runtime/gfx_record.c" ]; then
  echo "FLOW_DIR=$FLOW_DIR does not look like a Flow checkout" >&2
  exit 1
fi

# Linux is case-sensitive; bootstrap asks for doom1.wad.
if [ ! -e "$ROOT/doom1.wad" ] && [ -f "$ROOT/DOOM1.WAD" ]; then
  ln -sf DOOM1.WAD "$ROOT/doom1.wad"
fi

BUILD="$ROOT/build/record"
mkdir -p "$BUILD" "$(dirname "$OUT")"
FRAME_DIR="$BUILD/frames"
rm -rf "$FRAME_DIR"
mkdir -p "$FRAME_DIR"

C_FILE="$BUILD/doom.record.c"
EXE="$BUILD/doom.record"
REC_LOGIC="$BUILD/gfx_record_logic.c"

export PYTHONPATH="$FLOW_DIR/src${PYTHONPATH:+:$PYTHONPATH}"
FLOWC="flow.transpiler"

echo "==> transpile doom.flow"
python3 -m "$FLOWC" "$ROOT/doom.flow" --c --lenient -o "$C_FILE"

echo "==> transpile gfx_record.flow"
python3 -m "$FLOWC" "$FLOW_DIR/lib/runtime/gfx_record.flow" \
  --c --library --lenient -o "$REC_LOGIC"

echo "==> link recorder"
CF_FLAGS=()
case "$(uname -s)" in
  Darwin) CF_FLAGS=(-framework CoreFoundation) ;;
esac

# The C generator's fault handler is overridden via -DFLOW_FAULT_HANDLER
# so Doom's intentional negative left-shifts don't abort. Provide the
# handler as a real function in a small shim TU (doom_shim.c pulls
# emscripten.h, not available for native builds).
SHIM_C="$BUILD/noop_shim.c"
cat > "$SHIM_C" <<'EOF'
static inline void flow_noop_handler(const char* msg) { (void)msg; }
EOF

clang -O2 -fno-omit-frame-pointer \
  -include sys/types.h -include sys/stat.h \
  -DNORMALUNIX -DSNDSERV -D_DEFAULT_SOURCE \
  -DFLOW_FAULT_HANDLER=flow_noop_handler \
  -include "$SHIM_C" \
  "$C_FILE" "$REC_LOGIC" \
  "$FLOW_DIR/runtime/gfx_record.c" \
  "$FLOW_DIR/runtime/flow_rt_support.c" \
  "${CF_FLAGS[@]}" \
  -o "$EXE" -lm

echo "==> record ($FRAMES presents, skip=$SKIP, args=$ARGS)"
cd "$ROOT"
export DOOMFLOW_ARGS="$ARGS"
export FLOW_GFX_RECORD_FRAMES="$FRAMES"
export FLOW_GFX_RECORD_SKIP="$SKIP"
export FLOW_GFX_RECORD_DIR="$FRAME_DIR"
"$EXE"

nframes="$(find "$FRAME_DIR" -name 'frame_*.ppm' | wc -l | tr -d ' ')"
if [ "${nframes:-0}" -lt 1 ]; then
  echo "no frames written under $FRAME_DIR" >&2
  exit 1
fi

echo "==> encode $OUT ($nframes frames)"
python3 "$FLOW_DIR/scripts/frames_to_gif.py" "$FRAME_DIR" "$OUT" \
  --fps "$FPS" --width "$WIDTH"
ls -la "$OUT"
echo "done"
