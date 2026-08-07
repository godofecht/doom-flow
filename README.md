# doom-flow

[![Record gameplay GIF](https://github.com/godofecht/doom-flow/actions/workflows/record-gif.yml/badge.svg)](https://github.com/godofecht/doom-flow/actions/workflows/record-gif.yml)
[![Deploy GitHub Pages](https://github.com/godofecht/doom-flow/actions/workflows/pages.yml/badge.svg)](https://github.com/godofecht/doom-flow/actions/workflows/pages.yml)

**Play:** [godofecht.github.io/doom-flow](https://godofecht.github.io/doom-flow/)

Doom, rewritten in [Flow](https://github.com/flooooooooooow/flow).
Native build uses Flow’s **C backend**. The browser demo can build with
**C → emcc** (default, what Pages ships) or **MLIR → LLVM → emcc**
(`BACKEND=mlir`) once Flow tip includes epic [#221](https://github.com/flooooooooooow/flow/issues/221).

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
         ├── --c ──────────►  emcc + gfx_wasm.c ──►  .wasm (Pages default)
         └── --mlir --llvm ►  emcc + gfx_wasm.c ──►  .wasm (BACKEND=mlir)
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
FLOW_DIR=~/flow ./scripts/build_wasm.sh                 # C backend (Pages)
FLOW_DIR=~/flow BACKEND=mlir ./scripts/build_wasm.sh    # MLIR → LLVM → emcc
python3 -m http.server 8000 --directory site
```

Pages modes: **Play**, **Watch AI** (`DOOMFLOW_AI` pilot), **RL Arena**.

**Known quirks (browser path):**
- IWAD is preloaded (`doom.data` → `/doom1.wad`); TITLEPIC/HUD load.
- **Audio is silent** — `FEATURE_SOUND` is off in this port.
- Light tables must use native pointer width (wasm32 ≠ LP64); a hardcoded
  `* 8` row stride used to blank walls/sprites in dim areas.

Stock Flow (post-[#221](https://github.com/flooooooooooow/flow/issues/221)) can also build
snake-class gfx + preload without this script:

```bash
~/flow/flow wasm examples/games/snake_gfx.flow --backend=mlir
~/flow/flow wasm prog.flow --backend=mlir \
  --preload DOOM1.WAD@/doom1.wad \
  --link runtime/flow_rt_support.c \
  --initial-memory=64MB --asyncify-stack-size=65536
```

Doom itself still uses `scripts/build_wasm.sh` for the extra exported AI
symbols (`_doomflow_set_ai` / `_doomflow_get_ai`) and `-DNORMALUNIX`.

## Record a GIF

```bash
FLOW_DIR=~/flow ./scripts/record_gif.sh
# optional: --frames 180 --out media/doom.gif --args "-timedemo demo1"
```

## Controls

Arrows / WASD move · X or F fire · Space or E use · 1–7 weapons · Tab automap · Esc menu.

See [`PORTING.md`](PORTING.md) for how the C→Flow port works.
