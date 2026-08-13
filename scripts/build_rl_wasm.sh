#!/usr/bin/env bash
# Build the RL arena WASM module for the doom-flow site.
# Produces site/wasm/rl_arena/rl_arena.js + rl_arena.wasm
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FLOW_DIR="${FLOW_DIR:-$HOME/flow}"
OUT="$ROOT/site/wasm/rl_arena"
TMP="$ROOT/build/rl_arena_wasm"

mkdir -p "$OUT" "$TMP"

# Compile Flow to C
FLOW_HOST=python "$FLOW_DIR/flow" compile "$ROOT/rl_arena.flow" --backend=c 2>&1 | tail -3

GEN_C="$FLOW_DIR/build/rl_arena.c"
if [ ! -f "$GEN_C" ]; then
    echo "ERROR: generated C not found at $GEN_C" >&2
    exit 1
fi

# Set up emcc env (same as flow wasm command)
export EMSDK_PYTHON="${EMSDK_PYTHON:-/opt/homebrew/bin/python3.14}"
export EM_LLVM_ROOT="${EM_LLVM_ROOT:-/opt/homebrew/opt/emscripten/libexec/llvm/bin}"
export EM_BINARYEN_ROOT="${EM_BINARYEN_ROOT:-/opt/homebrew/opt/emscripten/libexec/binaryen}"

# Exported functions (Flow mangles names with type suffixes)
EXPORTS='["_main","_malloc","_free",'
EXPORTS="${EXPORTS}\"_rl_init_u32\","
EXPORTS="${EXPORTS}\"_rl_train_episode_f32_f32_f32_u32\","
EXPORTS="${EXPORTS}\"_rl_eval_episode_u32\","
EXPORTS="${EXPORTS}\"_rl_eval_i32\","
EXPORTS="${EXPORTS}\"_rl_get_w1\",\"_rl_get_b1\",\"_rl_get_w2\",\"_rl_get_b2\","
EXPORTS="${EXPORTS}\"_rl_get_hidden\",\"_rl_get_output\",\"_rl_get_input\","
EXPORTS="${EXPORTS}\"_rl_get_episode\",\"_rl_get_total_episodes\",\"_rl_get_total_kills\","
EXPORTS="${EXPORTS}\"_rl_get_eval_rate\",\"_rl_get_best_rate\",\"_rl_get_avg_return\",\"_rl_get_loss\","
EXPORTS="${EXPORTS}\"_rl_get_n_inputs\",\"_rl_get_n_hidden\",\"_rl_get_n_outputs\""
EXPORTS="${EXPORTS}]"

emcc "$GEN_C" \
    -O2 \
    -Wno-everything \
    -s WASM=1 \
    -s MODULARIZE=1 \
    -s EXPORT_NAME=createRLArenaModule \
    -s INVOKE_RUN=0 \
    -s EXIT_RUNTIME=0 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","HEAPU8","HEAPF32","HEAP32","callMain"]' \
    -s EXPORTED_FUNCTIONS="$EXPORTS" \
    -s ENVIRONMENT=web,node \
    -s STACK_SIZE=16MB \
    -s INITIAL_MEMORY=32MB \
    -lm \
    -o "$OUT/rl_arena.js"

echo "RL arena WASM built:"
ls -la "$OUT/"
