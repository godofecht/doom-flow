# doom-flow

[![WASM smoke](https://github.com/godofecht/doom-flow/actions/workflows/wasm-smoke.yml/badge.svg)](https://github.com/godofecht/doom-flow/actions/workflows/wasm-smoke.yml)
[![Deploy GitHub Pages](https://github.com/godofecht/doom-flow/actions/workflows/pages.yml/badge.svg)](https://github.com/godofecht/doom-flow/actions/workflows/pages.yml)

**Play:** [godofecht.github.io/doom-flow](https://godofecht.github.io/doom-flow/)

Doom, rewritten in [Flow](https://github.com/flooooooooooow/flow).
Native build uses Flow's C backend. The browser demo ships with the
MLIR backend (MLIR to LLVM to emcc). Framebuffer output is byte-identical
to the C backend, verified across 136 samples spanning title screen and
AI gameplay including the E1M1 to E1M2 level transition.

![Doom AI pilot gameplay (CI GIF)](site/doom.gif)

| | |
| --- | --- |
| Flow language | [github.com/flooooooooooow/flow](https://github.com/flooooooooooow/flow) |
| Flow wiki | [flooooooooooow.github.io/flow](https://flooooooooooow.github.io/flow/) |
| WASM gallery | [wiki /wasm/](https://flooooooooooow.github.io/flow/wasm/) |
| RL sister repo | [doom-flow-rl](https://github.com/godofecht/doom-flow-rl) |

## Compile path

```
*.flow  ──flow.transpiler──►  C  ──clang──►  native (macOS gfx)
         │
         └── --mlir --llvm ►  emcc + gfx_wasm.c ──►  .wasm (Pages)
```

The MLIR object compiles at -O1 and links with emcc at -O1. The C
backend is used for native macOS builds. Both backends produce
byte-identical framebuffer output.

CI records the GIF by driving the MLIR WASM build in Node with the
deterministic test clock, capturing RGBA frames, and encoding with
`frames_to_gif.py`.

## Build and run (native)

Needs Flow at `~/flow` (or sibling `../flow`; see [`flow.toml`](flow.toml)),
Python 3, clang, macOS. Shareware `DOOM1.WAD` is included.

```bash
~/flow/flow build-native
./build/doom
DOOMFLOW_ARGS="-timedemo demo1" ./build/doom   # must print: timed 5026 gametics
```

## Browser / WASM

```bash
FLOW_DIR=~/flow ./scripts/build_wasm.sh                 # MLIR backend (default)
FLOW_DIR=~/flow BACKEND=c ./scripts/build_wasm.sh       # C backend
python3 -m http.server 8000 --directory site
```

The game loop is rAF-driven: `main()` returns after init, JS calls
`doomflow_frame()` and `doomflow_present()` per `requestAnimationFrame`.
No ASYNCIFY.

Pages modes: **Play**, **Watch AI** (`DOOMFLOW_AI` pilot, auto-advances
through levels every 3600 frames), **RL Arena**.

## Byte-identical verification

```bash
FLOW_DIR=~/flow bash scripts/run_byte_identical.sh    # title screen: 15 samples
FLOW_DIR=~/flow bash scripts/run_gameplay_test.sh      # AI gameplay: 121 samples
```

Both suites build C and MLIR WASM variants, drive them through the
deterministic test clock, and compare CRC32 values per frame. Zero
mismatches across all 136 samples.

## Record a GIF

```bash
FLOW_DIR=~/flow ./scripts/build_wasm.sh --doom-only --test-clock
FLOW_DIR=~/flow node scripts/record_wasm_gif.js --frames 600 --skip 6 --fps 15 --width 320 --out media/doom.gif
```

## Controls

Arrows / WASD move. X or F fire. Space or E use. 1-7 weapons. Tab automap. Esc menu.

See [`PORTING.md`](PORTING.md) for how the C to Flow port works.
