# doom-flow

[![Record gameplay GIF](https://github.com/godofecht/doom-flow/actions/workflows/record-gif.yml/badge.svg)](https://github.com/godofecht/doom-flow/actions/workflows/record-gif.yml)
[![Deploy GitHub Pages](https://github.com/godofecht/doom-flow/actions/workflows/pages.yml/badge.svg)](https://github.com/godofecht/doom-flow/actions/workflows/pages.yml)

**Play:** [godofecht.github.io/doom-flow](https://godofecht.github.io/doom-flow/)

Doom, rewritten in [Flow](https://github.com/flooooooooooow/flow).
Native build and the browser demo both use Flow’s **C backend** today
(`flow.transpiler --c` → clang / emcc). Flow also has an **MLIR → LLVM**
CPU path; this port does not use it yet.

![Doom timedemo gameplay (CI GIF)](media/doom.gif)

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
                              └──emcc + gfx_wasm.c──►  .wasm (GitHub Pages)
```

CI records the GIF with Flow’s headless gfx-record path
(`FLOW_GFX_RECORD_*` + `frames_to_gif.py`), same idea as `flow record`.

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
FLOW_DIR=~/flow ./scripts/build_wasm.sh
python3 -m http.server 8000 --directory site
```

Pages modes: **Play**, **Watch AI** (`DOOMFLOW_AI` pilot), **RL Arena**.

## Record a GIF

```bash
FLOW_DIR=~/flow ./scripts/record_gif.sh
# optional: --frames 180 --out media/doom.gif --args "-timedemo demo1"
```

## Controls

Arrows / WASD move · X or F fire · Space or E use · 1–7 weapons · Tab automap · Esc menu.

See [`PORTING.md`](PORTING.md) for how the C→Flow port works.
