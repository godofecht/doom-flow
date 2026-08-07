#!/usr/bin/env bash
# Build doom-flow (and the Q-DOOM watch agent) to WebAssembly for GitHub Pages.
#
# Flow's browser path today is:
#   doom.flow  --(flow.transpiler --c)-->  build/wasm/*.c  --(emcc)-->  .wasm/.js
#
# The .c is a throwaway intermediate (same as `./flow wasm` / `flow build-native`).
# Source of truth stays the *.flow files. Intermediate C never ships in site/.
#
# Requires: emcc on PATH, Flow checkout at FLOW_DIR (default ../flow).
#
#   FLOW_DIR=~/flow ./scripts/build_wasm.sh
#   FLOW_DIR=~/flow ./scripts/build_wasm.sh --ai-only
#   FLOW_DIR=~/flow ./scripts/build_wasm.sh --doom-only

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FLOW_DIR="${FLOW_DIR:-$ROOT/../flow}"
OUT_DOOM="$ROOT/site/wasm/doom"
OUT_AI="$ROOT/site/wasm/ai"
TMP="$ROOT/build/wasm"
DO_DOOM=1
DO_AI=1

while [ $# -gt 0 ]; do
  case "$1" in
    --ai-only) DO_DOOM=0; shift ;;
    --doom-only) DO_AI=0; shift ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done

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
  -sEXPORTED_FUNCTIONS=_main,_malloc,_free
  -Wno-implicit-function-declaration
  -lm
)

build_doom() {
  echo "==> doom.flow → C (scratch) → WASM"
  mkdir -p "$OUT_DOOM"
  local c="$TMP/doom.c"
  local wad="$ROOT/DOOM1.WAD"
  if [ ! -f "$wad" ]; then
    echo "missing $wad" >&2
    exit 1
  fi
  python3 -m "$FLOWC" "$ROOT/doom.flow" --c --lenient -o "$c"
  emcc "$c" \
    "$FLOW_DIR/runtime/gfx_wasm.c" \
    "$FLOW_DIR/runtime/flow_rt_support.c" \
    "${emcc_common[@]}" \
    -sFORCE_FILESYSTEM=1 \
    --preload-file "$wad@/doom1.wad" \
    -DNORMALUNIX -DSNDSERV -D_DEFAULT_SOURCE \
    -o "$OUT_DOOM/doom.js"
  rm -f "$c"
  ls -lh "$OUT_DOOM"/doom.{js,wasm,data}
}

build_ai() {
  echo "==> q_doom_watch.flow → C (scratch) → WASM"
  mkdir -p "$OUT_AI"
  local c="$TMP/ai.c"
  python3 -m "$FLOWC" "$ROOT/site/ai/q_doom_watch.flow" --c --lenient -o "$c"
  emcc "$c" \
    "$FLOW_DIR/runtime/gfx_wasm.c" \
    "$FLOW_DIR/runtime/flow_rt_support.c" \
    "${emcc_common[@]}" \
    -sINITIAL_MEMORY=32MB \
    -o "$OUT_AI/ai.js"
  rm -f "$c"
  ls -lh "$OUT_AI"/ai.{js,wasm}
}

[ "$DO_DOOM" = 1 ] && build_doom
[ "$DO_AI" = 1 ] && build_ai

touch "$ROOT/site/.nojekyll"
echo "done → $ROOT/site/wasm  (no .c shipped; scratch under build/wasm/)"
