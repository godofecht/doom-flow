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
# BACKEND=mlir also needs Flow's static string-array global init
# (fix/mlir-static-string-arrays). Prefer a dedicated worktree so other
# checkouts of ~/flow cannot race the build:
#   git -C ~/flow worktree add ~/flow-mlir-doom fix/mlir-static-string-arrays
#
#   FLOW_DIR=~/flow ./scripts/build_wasm.sh
#   FLOW_DIR=~/flow-mlir-doom BACKEND=mlir ./scripts/build_wasm.sh --doom-only
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
WASM_ENVIRONMENT="${WASM_ENVIRONMENT:-web}"
TEST_CLOCK=0

while [ $# -gt 0 ]; do
  case "$1" in
    --ai-only) DO_DOOM=0; shift ;;
    --doom-only) DO_AI=0; shift ;;
    --backend=*) BACKEND="${1#--backend=}"; shift ;;
    --backend) shift; BACKEND="${1:-c}"; shift ;;
    --test-clock) TEST_CLOCK=1; shift ;;
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

# MLIR→LLVM IR is not opt-stable at -O1+: LLVM miscompiles string scanning
# loops (IdentifyIWADByName hangs on a null-byte check). Compile the Flow
# object at -O0 and the C runtime at -O2, then link with -O1 so binaryen
# can still optimize the final wasm without touching the Flow IR.
EMCC_OPT=(-O2)
EMCC_LINK_OPT=()
JS_LIBRARY=""
if [ "$TEST_CLOCK" = "1" ]; then
  JS_LIBRARY="--js-library $ROOT/scripts/deterministic_clock.js"
fi
if [ "$BACKEND" = "mlir" ]; then
  EMCC_OPT=(-O0)
  EMCC_LINK_OPT=(-O1)
  # Config string-table globals must be initialized (Flow branch
  # fix/mlir-static-string-arrays). Without this, M_LoadDefaults dies on
  # 'use_mouse' from an undef @config_*_names array.
  if ! python3 -c "from flow.mlir_generator import MLIRGenerator; import sys; sys.exit(0 if hasattr(MLIRGenerator, '_emit_static_llvm_array_global') else 1)"; then
    echo "BACKEND=mlir needs Flow with static string-array global init" >&2
    echo "  (checkout fix/mlir-static-string-arrays in $FLOW_DIR)" >&2
    exit 1
  fi
fi

ASYNCIFY_STACK=65536
STACK_SIZE=16MB
INITIAL_MEMORY=64MB
if [ "$BACKEND" = "mlir" ]; then
  # MLIR -O0 frames are heavy; title/demo need large wasm + asyncify stacks.
  ASYNCIFY_STACK=16777216
  STACK_SIZE=64MB
  INITIAL_MEMORY=128MB
fi

emcc_common=(
  "${EMCC_OPT[@]}"
  -sASYNCIFY=1
  -sASYNCIFY_STACK_SIZE=$ASYNCIFY_STACK
  -sSTACK_SIZE=$STACK_SIZE
  -sINITIAL_MEMORY=$INITIAL_MEMORY
  -sALLOW_MEMORY_GROWTH=1
  -sENVIRONMENT=${WASM_ENVIRONMENT}
  -sMODULARIZE=1
  -sEXPORT_NAME=createFlowModule
  -sINVOKE_RUN=0
  -sEXIT_RUNTIME=0
  -sEXPORTED_RUNTIME_METHODS=callMain,ccall,ENV
  -sEXPORTED_FUNCTIONS=_main,_malloc,_free,_doomflow_set_ai,_doomflow_get_ai,_doomflow_frame,_doomflow_present,_doomflow_get_gfx_ctx,_doomflow_should_close,_doomflow_dump_pixel,_doomflow_count_nonzero,_doomflow_first_pixel,_doomflow_fb_crc32,_doomflow_fb_row
  -Wno-implicit-function-declaration
  -lm
)
# Cookie at stack_get_end()==0 false-trips after ~title; keep running while
# we chase real overflow. Remove once stack discipline is solid.
if [ "$BACKEND" = "mlir" ]; then
  emcc_common+=(-sSTACK_OVERFLOW_CHECK=0)
fi

# Lower .flow → intermediate for emcc. Echoes the path on stdout.
flow_lower() {
  local src="$1"
  local stem="$2"
  if [ "$BACKEND" = "mlir" ]; then
    local ll="$TMP/${stem}.ll"
    # Flow logs on stdout; keep command substitution returning only the path.
    # --wasm32: libc size_t/long are i32 (Flow sources annotate them as i64).
    if ! python3 -m "$FLOWC" "$src" --mlir --llvm --wasm32 --lenient -o "$ll" >&2; then
      echo "Flow→MLIR→LLVM failed for $src" >&2
      exit 1
    fi
    if [ ! -s "$ll" ]; then
      echo "empty LLVM IR written to $ll" >&2
      exit 1
    fi
    # Catch Flow checkouts that still emit undef string-array globals.
    if grep -q '^@config_doom_names = .* undef' "$ll" 2>/dev/null; then
      echo "LLVM IR has undef @config_doom_names — wrong Flow checkout for MLIR" >&2
      echo "  need fix/mlir-static-string-arrays in $FLOW_DIR" >&2
      exit 1
    fi
    echo "$ll"
  else
    local c="$TMP/${stem}.c"
    if ! python3 -m "$FLOWC" "$src" --c --lenient -o "$c" >&2; then
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

  if [ "$BACKEND" = "mlir" ]; then
    # No ASYNCIFY: main() returns after init, JS drives frames via rAF
    # calling doomflow_frame() + doomflow_present(). This avoids the
    # ASYNCIFY + alloca corruption that breaks the MLIR -O0 build.
    emcc -c "$ir" -O0 -o "$TMP/doom.o"
    emcc -c "$FLOW_DIR/runtime/gfx_wasm.c" -O2 -o "$TMP/gfx_wasm.o"
    emcc -c "$FLOW_DIR/runtime/flow_rt_support.c" -O2 -o "$TMP/flow_rt.o"
    emcc -c "$ROOT/scripts/doom_shim.c" -O2 -o "$TMP/doom_shim.o"
    emcc "$TMP/doom.o" "$TMP/gfx_wasm.o" "$TMP/flow_rt.o" "$TMP/doom_shim.o" \
      -O1 \
      $JS_LIBRARY \
      -sSTACK_SIZE=$STACK_SIZE \
      -sINITIAL_MEMORY=$INITIAL_MEMORY \
      -sALLOW_MEMORY_GROWTH=1 \
      -sENVIRONMENT=${WASM_ENVIRONMENT} \
      -sMODULARIZE=1 \
      -sEXPORT_NAME=createFlowModule \
      -sINVOKE_RUN=0 \
      -sEXIT_RUNTIME=0 \
      -sEXPORTED_RUNTIME_METHODS=callMain,ccall,ENV,cwrap \
      -sEXPORTED_FUNCTIONS=_main,_malloc,_free,_doomflow_set_ai,_doomflow_get_ai,_doomflow_frame,_doomflow_present,_doomflow_get_gfx_ctx,_doomflow_should_close,_doomflow_dump_pixel,_doomflow_count_nonzero,_doomflow_first_pixel,_doomflow_fb_crc32,_doomflow_fb_row \
      -sSTACK_OVERFLOW_CHECK=0 \
      -sFORCE_FILESYSTEM=1 \
      --preload-file "$wad@/doom1.wad" \
      -DNORMALUNIX -DSNDSERV -D_DEFAULT_SOURCE \
      -Wno-implicit-function-declaration \
      -lm \
      -o "$OUT_DOOM/doom.js"
  else
    emcc "$ir" \
      "$FLOW_DIR/runtime/gfx_wasm.c" \
      "$FLOW_DIR/runtime/flow_rt_support.c" \
      "$ROOT/scripts/doom_shim.c" \
      "${emcc_common[@]}" \
      $JS_LIBRARY \
      -sFORCE_FILESYSTEM=1 \
      --preload-file "$wad@/doom1.wad" \
      -DNORMALUNIX -DSNDSERV -D_DEFAULT_SOURCE \
      -o "$OUT_DOOM/doom.js"
  fi
  # Keep MLIR IR for fast ASYNCIFY/emcc iteration (Flow transpile is the slow part).
  if [ "$BACKEND" != "mlir" ]; then
    rm -f "$ir"
  fi
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
