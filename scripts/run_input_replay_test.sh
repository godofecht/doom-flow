#!/usr/bin/env bash
# run_input_replay_test.sh: Build C and MLIR backends with the deterministic
# test clock, run the input replay test against both, and compare CRC32
# values frame-by-frame. The replay sends deterministic keyboard input
# (forward, turn, strafe, fire, use, weapon switch) to E1M1.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FLOW_DIR="${FLOW_DIR:-$HOME/flow}"
TMP_C="$ROOT/build/test_c_input"
TMP_MLIR="$ROOT/build/test_mlir_input"
TIMEOUT="${SMOKE_TIMEOUT:-300000}"
MAX_FRAMES="${MAX_FRAMES:-3000}"

export WASM_ENVIRONMENT="${WASM_ENVIRONMENT:-web,node}"
export PATH="$ROOT/.venv/bin:$PATH"
export PYTHONPATH="$FLOW_DIR/src${PYTHONPATH:+:$PYTHONPATH}"

echo "==> Building C backend (deterministic clock)"
"$ROOT/scripts/build_wasm.sh" --doom-only --backend=c --test-clock >/dev/null 2>&1
mkdir -p "$TMP_C"
cp "$ROOT/site/wasm/doom/doom".{js,wasm,data} "$TMP_C/"

echo "==> Building MLIR backend (deterministic clock)"
"$ROOT/scripts/build_wasm.sh" --doom-only --backend=mlir --test-clock >/dev/null 2>&1
mkdir -p "$TMP_MLIR"
cp "$ROOT/site/wasm/doom/doom".{js,wasm,data} "$TMP_MLIR/"

echo "==> Running C backend input replay test"
SMOKE_DIR="$TMP_C" SMOKE_TIMEOUT="$TIMEOUT" TEST_LABEL=c \
  MAX_FRAMES="$MAX_FRAMES" \
  node "$ROOT/scripts/test_input_replay.js" > /tmp/c_input_replay.json 2>&1

echo "==> Running MLIR backend input replay test"
SMOKE_DIR="$TMP_MLIR" SMOKE_TIMEOUT="$TIMEOUT" TEST_LABEL=mlir \
  MAX_FRAMES="$MAX_FRAMES" \
  node "$ROOT/scripts/test_input_replay.js" > /tmp/mlir_input_replay.json 2>&1

echo "==> Comparing CRC32 values (input replay)"
node "$ROOT/scripts/compare_crc.js" /tmp/c_input_replay.json /tmp/mlir_input_replay.json
