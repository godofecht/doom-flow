#!/usr/bin/env bash
# run_gameplay_test.sh: Build C and MLIR backends with deterministic clock,
# run each through test_gameplay.js (AI pilot warps to E1M1), compare CRC32.
#
# Exit 0 if all samples match, 1 on any mismatch.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FLOW_DIR="${FLOW_DIR:-$HOME/flow}"
TMP_C="$ROOT/build/test_c_gameplay"
TMP_MLIR="$ROOT/build/test_mlir_gameplay"
TIMEOUT="${SMOKE_TIMEOUT:-600000}"
MAX_FRAMES="${MAX_FRAMES:-12000}"

export WASM_ENVIRONMENT="${WASM_ENVIRONMENT:-web,node}"
export PATH="$ROOT/.venv/bin:$PATH"
export PYTHONPATH="$FLOW_DIR/src${PYTHONPATH:+:$PYTHONPATH}"

if [ -f "$HOME/emsdk/emsdk_env.sh" ]; then
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

echo "==> Running C backend gameplay test"
SMOKE_DIR="$TMP_C" SMOKE_TIMEOUT="$TIMEOUT" TEST_LABEL=c MAX_FRAMES="$MAX_FRAMES" \
  node "$ROOT/scripts/test_gameplay.js" > "$TMP_C/result.json" 2>&1 || {
  echo "C backend gameplay test failed:"
  cat "$TMP_C/result.json"
  exit 1
}

echo "==> Running MLIR backend gameplay test"
SMOKE_DIR="$TMP_MLIR" SMOKE_TIMEOUT="$TIMEOUT" TEST_LABEL=mlir MAX_FRAMES="$MAX_FRAMES" \
  node "$ROOT/scripts/test_gameplay.js" > "$TMP_MLIR/result.json" 2>&1 || {
  echo "MLIR backend gameplay test failed:"
  cat "$TMP_MLIR/result.json"
  exit 1
}

echo "==> Comparing CRC32 values (gameplay)"
node "$ROOT/scripts/compare_crc.js" "$TMP_C/result.json" "$TMP_MLIR/result.json"
