# doom-flow

[![Record gameplay GIF](https://github.com/godofecht/doom-flow/actions/workflows/record-gif.yml/badge.svg)](https://github.com/godofecht/doom-flow/actions/workflows/record-gif.yml)
[![Deploy GitHub Pages](https://github.com/godofecht/doom-flow/actions/workflows/pages.yml/badge.svg)](https://github.com/godofecht/doom-flow/actions/workflows/pages.yml)

**Play:** [godofecht.github.io/doom-flow](https://godofecht.github.io/doom-flow/)

Doom, rewritten in [Flow](https://github.com/flooooooooooow/flow).
Native build and the browser demo both use Flow’s **C backend** today
(`flow.transpiler --c` → clang / emcc). An **MLIR → LLVM → WASM** path is
tracked upstream — not wired here yet (see below).

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

**Known quirks (C → emcc path):**
- IWAD is preloaded (`doom.data` → `/doom1.wad`); TITLEPIC/HUD load.
- **Audio is silent** — `FEATURE_SOUND` is off in this port.
- Light tables must use native pointer width (wasm32 ≠ LP64); a hardcoded
  `* 8` row stride used to blank walls/sprites in dim areas.

## MLIR WASM (upstream)

Goal: same `*.flow` → `./flow wasm --backend=mlir` with gfx + WAD preload,
instead of the custom C/`emcc` script. Flow epic and blockers:

| | |
| --- | --- |
| Epic | [flow#221](https://github.com/flooooooooooow/flow/issues/221) |
| `uN` → `iN` | [flow#222](https://github.com/flooooooooooow/flow/issues/222) |
| null → `llvm.mlir.zero` | [flow#223](https://github.com/flooooooooooow/flow/issues/223) |
| memref vs GEP | [flow#224](https://github.com/flooooooooooow/flow/issues/224) |
| `--preload` / `--link` | [flow#225](https://github.com/flooooooooooow/flow/issues/225) |
| Gallery roadmap | [discussion #226](https://github.com/flooooooooooow/flow/discussions/226) |

Once snake-class gfx + preload pass on MLIR, dual-build here and A/B the Pages bundle.

## Record a GIF

```bash
FLOW_DIR=~/flow ./scripts/record_gif.sh
# optional: --frames 180 --out media/doom.gif --args "-timedemo demo1"
```

## Controls

Arrows / WASD move · X or F fire · Space or E use · 1–7 weapons · Tab automap · Esc menu.

See [`PORTING.md`](PORTING.md) for how the C→Flow port works.
