#!/usr/bin/env bash
# Build doom-flow (and the Q-DOOM watch agent) to WebAssembly for GitHub Pages.
#
# Flow browser path (selectable CPU backend):
#   BACKEND=c    (default): doom.flow → C → emcc
#   BACKEND=mlir           : doom.flow → MLIR → LLVM IR → emcc
#
# Both paths link gfx_wasm.c + flow_rt_support.c, preload DOOM1.WAD, and use
# doom-scale ASYNCIFY / INITIAL_MEMORY. Intermediate .c / .ll never ships in site/.
#
# Requires: emcc on PATH, Flow checkout at FLOW_DIR (default ../flow).
# Flow tip should include epic #221 / PR #229 (preload, link, MLIR gfx).
#
#   FLOW_DIR=~/flow ./scripts/build_wasm.sh
#   FLOW_DIR=~/flow BACKEND=mlir ./scripts/build_wasm.sh --doom-only
#   FLOW_DIR=~/flow ./scripts/build_wasm.sh --ai-only

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FLOW_DIR="${FLOW_DIR:-$ROOT/../flow}"
OUT_DOOM="$ROOT/site/wasm/doom"
OUT_AI="$ROOT/site/wasm/ai"
TMP="$ROOT/build/wasm"
DO_DOOM=1
DO_AI=1
BACKEND="${BACKEND:-c}"

while [ $# -gt 0 ]; do
  case "$1" in
    --ai-only) DO_DOOM=0; shift ;;
    --doom-only) DO_AI=0; shift ;;
    --backend=*) BACKEND="${1#--backend=}"; shift ;;
    --backend) shift; BACKEND="${1:-c}"; shift ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done

BACKEND="$(printf '%s' "$BACKEND" | tr '[:upper:]' '[:lower:]')"
if [ "$BACKEND" != "c" ] && [ "$BACKEND" != "mlir" ]; then
  echo "BACKEND must be c or mlir (got $BACKEND)" >&2
  exit 1
fi

if [ ! -d "$FLOW_DIR/src" ] || [ ! -f "$FLOW_DIR/runtime/gfx_wasm.c" ]; then
  echo "FLOW_DIR=$FLOW_DIR does not look like a Flow checkout" >&2
  exit 1
fi
if ! command -v emcc >/dev/null 2>&1; then
  echo "emcc not on PATH (install emsdk / brew emscripten)" >&2
  exit 1
fi

# Homebrew emscripten often needs these; ignore if missing.
if [ -z "${EMSDK_PYTHON:-}" ] && [ -x /opt/homebrew/bin/python3.14 ]; then
  export EMSDK_PYTHON=/opt/homebrew/bin/python3.14
fi
if [ -z "${EM_LLVM_ROOT:-}" ] && [ -d /opt/homebrew/opt/emscripten/libexec/llvm/bin ]; then
  export EM_LLVM_ROOT=/opt/homebrew/opt/emscripten/libexec/llvm/bin
fi
if [ -z "${EM_BINARYEN_ROOT:-}" ] && [ -d /opt/homebrew/opt/emscripten/libexec/binaryen ]; then
  export EM_BINARYEN_ROOT=/opt/homebrew/opt/emscripten/libexec/binaryen
fi

export PYTHONPATH="$FLOW_DIR/src${PYTHONPATH:+:$PYTHONPATH}"
FLOWC=flow.transpiler
mkdir -p "$TMP"

emcc_common=(
  -O2
  -sASYNCIFY=1
  -sASYNCIFY_STACK_SIZE=65536
  -sSTACK_SIZE=16MB
  -sINITIAL_MEMORY=64MB
  -sALLOW_MEMORY_GROWTH=1
  -sENVIRONMENT=web
  -sMODULARIZE=1
  -sEXPORT_NAME=createFlowModule
  -sINVOKE_RUN=0
  -sEXIT_RUNTIME=0
  -sEXPORTED_RUNTIME_METHODS=callMain,ccall,ENV
  -sEXPORTED_FUNCTIONS=_main,_malloc,_free,_doomflow_set_ai,_doomflow_get_ai
  -Wno-implicit-function-declaration
  -lm
)

# Lower .flow → intermediate for emcc. Echoes the path on stdout.
flow_lower() {
  local src="$1"
  local stem="$2"
  if [ "$BACKEND" = "mlir" ]; then
    local ll="$TMP/${stem}.ll"
    if ! python3 -m "$FLOWC" "$src" --mlir --llvm --lenient -o "$ll"; then
      echo "Flow→MLIR→LLVM failed for $src" >&2
      exit 1
    fi
    if [ ! -s "$ll" ]; then
      echo "empty LLVM IR written to $ll" >&2
      exit 1
    fi
    echo "$ll"
  else
    local c="$TMP/${stem}.c"
    if ! python3 -m "$FLOWC" "$src" --c --lenient -o "$c"; then
      echo "Flow→C failed for $src" >&2
      exit 1
    fi
    if [ ! -s "$c" ]; then
      echo "empty C written to $c" >&2
      exit 1
    fi
    echo "$c"
  fi
}

build_doom() {
  echo "==> doom.flow → ${BACKEND} → WASM"
  mkdir -p "$OUT_DOOM"
  local wad="$ROOT/DOOM1.WAD"
  if [ ! -f "$wad" ]; then
    echo "missing $wad" >&2
    exit 1
  fi
  local ir
  ir="$(flow_lower "$ROOT/doom.flow" doom)"
  emcc "$ir" \
    "$FLOW_DIR/runtime/gfx_wasm.c" \
    "$FLOW_DIR/runtime/flow_rt_support.c" \
    "${emcc_common[@]}" \
    -sFORCE_FILESYSTEM=1 \
    --preload-file "$wad@/doom1.wad" \
    -DNORMALUNIX -DSNDSERV -D_DEFAULT_SOURCE \
    -o "$OUT_DOOM/doom.js"
  rm -f "$ir"
  ls -lh "$OUT_DOOM"/doom.{js,wasm,data}
}

build_ai() {
  echo "==> q_doom_watch.flow → ${BACKEND} → WASM"
  mkdir -p "$OUT_AI"
  local ir
  ir="$(flow_lower "$ROOT/site/ai/q_doom_watch.flow" ai)"
  emcc "$ir" \
    "$FLOW_DIR/runtime/gfx_wasm.c" \
    "$FLOW_DIR/runtime/flow_rt_support.c" \
    "${emcc_common[@]}" \
    -sINITIAL_MEMORY=32MB \
    -o "$OUT_AI/ai.js"
  rm -f "$ir"
  ls -lh "$OUT_AI"/ai.{js,wasm}
}

[ "$DO_DOOM" = 1 ] && build_doom
[ "$DO_AI" = 1 ] && build_ai

touch "$ROOT/site/.nojekyll"
echo "done → $ROOT/site/wasm  (backend=$BACKEND; scratch under build/wasm/)"
