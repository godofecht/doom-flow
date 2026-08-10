#!/usr/bin/env bash
# run_byte_identical.sh: Build C and MLIR backends, run each through
# test_byte_identical.js, compare CRC32 values at every sampled frame.
#
# Exit 0 if all samples match, 1 on any mismatch.
#
# Usage: ./scripts/run_byte_identical.sh
#   FLOW_DIR=~/flow-mlir-doom ./scripts/run_byte_identical.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FLOW_DIR="${FLOW_DIR:-$HOME/flow-mlir-doom}"
TMP_C="$ROOT/build/test_c"
TMP_MLIR="$ROOT/build/test_mlir"
TIMEOUT="${SMOKE_TIMEOUT:-120000}"

export WASM_ENVIRONMENT="${WASM_ENVIRONMENT:-web,node}"
export PATH="$ROOT/.venv/bin:$PATH"
export PYTHONPATH="$FLOW_DIR/src${PYTHONPATH:+:$PYTHONPATH}"

# Source emscripten if available.
if [ -f "$HOME/emsdk/emsdk_env.sh" ]; then
  # shellcheck disable=SC1091
  source "$HOME/emsdk/emsdk_env.sh" 2>/dev/null || true
fi

echo "==> Building C backend (deterministic clock)"
rm -rf "$TMP_C" && mkdir -p "$TMP_C"
FLOW_DIR="$FLOW_DIR" "$ROOT/scripts/build_wasm.sh" --doom-only --backend=c --test-clock 2>&1 | tail -3
cp "$ROOT/site/wasm/doom/doom.js" "$TMP_C/doom.js"
cp "$ROOT/site/wasm/doom/doom.wasm" "$TMP_C/doom.wasm"
cp "$ROOT/site/wasm/doom/doom.data" "$TMP_C/doom.data"

echo "==> Building MLIR backend (deterministic clock)"
rm -rf "$TMP_MLIR" && mkdir -p "$TMP_MLIR"
FLOW_DIR="$FLOW_DIR" "$ROOT/scripts/build_wasm.sh" --doom-only --backend=mlir --test-clock 2>&1 | tail -3
cp "$ROOT/site/wasm/doom/doom.js" "$TMP_MLIR/doom.js"
cp "$ROOT/site/wasm/doom/doom.wasm" "$TMP_MLIR/doom.wasm"
cp "$ROOT/site/wasm/doom/doom.data" "$TMP_MLIR/doom.data"

echo "==> Running C backend test"
SMOKE_DIR="$TMP_C" SMOKE_TIMEOUT="$TIMEOUT" TEST_LABEL=c \
  node "$ROOT/scripts/test_byte_identical.js" > "$TMP_C/result.json" 2>&1 || {
  echo "C backend test failed:"
  cat "$TMP_C/result.json"
  exit 1
}

echo "==> Running MLIR backend test"
SMOKE_DIR="$TMP_MLIR" SMOKE_TIMEOUT="$TIMEOUT" TEST_LABEL=mlir \
  node "$ROOT/scripts/test_byte_identical.js" > "$TMP_MLIR/result.json" 2>&1 || {
  echo "MLIR backend test failed:"
  cat "$TMP_MLIR/result.json"
  exit 1
}

echo "==> Comparing CRC32 values"
node "$ROOT/scripts/compare_crc.js" "$TMP_C/result.json" "$TMP_MLIR/result.json"
