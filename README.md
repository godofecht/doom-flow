# doom-flow

[![WASM smoke](https://github.com/godofecht/doom-flow/actions/workflows/wasm-smoke.yml/badge.svg)](https://github.com/godofecht/doom-flow/actions/workflows/wasm-smoke.yml)
[![Deploy GitHub Pages](https://github.com/godofecht/doom-flow/actions/workflows/pages.yml/badge.svg)](https://github.com/godofecht/doom-flow/actions/workflows/pages.yml)

**Play:** [godofecht.github.io/doom-flow](https://godofecht.github.io/doom-flow/)

Doom, rewritten in [Flow](https://github.com/flooooooooooow/flow).
Native build uses Flow's C backend. The browser demo ships with the
MLIR backend (MLIR to LLVM to emcc). Framebuffer output is byte-identical
to the C backend, verified across the deterministic parity suites.

![Doom AI pilot gameplay (CI GIF)](site/doom.gif)

| | |
| --- | --- |
| Flow language | [github.com/flooooooooooow/flow](https://github.com/flooooooooooow/flow) |
| Flow wiki | [flooooooooooow.github.io/flow](https://flooooooooooow.github.io/flow/) |
| WASM gallery | [wiki /wasm/](https://flooooooooooow.github.io/flow/wasm/) |
| Flow playground | [flooooooooooow.github.io/flow/playground/](https://flooooooooooow.github.io/flow/playground/) |
| RL sister repo | [doom-flow-rl](https://github.com/godofecht/doom-flow-rl) |
| Discord | [https://discord.gg/YK7VaHy24T](https://discord.gg/YK7VaHy24T) |

## Compile path

```
*.flow  ──flow.transpiler──►  C  ──clang──►  native (macOS gfx)
         │
         └── --mlir --llvm ►  emcc + gfx_wasm.c ──►  .wasm (Pages)
```

The MLIR object compiles at -O2 and links with emcc at -O2. The C
backend is used for native macOS builds. Both backends produce
byte-identical framebuffer output.

CI records the GIF by driving the MLIR WASM build in Node with the
deterministic test clock, capturing RGBA frames, and encoding with
`frames_to_gif.py`.

GitHub Pages rebuilds the production WASM from the current Flow checkout
before uploading `site/`, then runs the MLIR smoke test against that freshly
built artifact. The checked-in `site/wasm/doom/doom.wasm` is therefore no
longer allowed to silently become a stale production binary.

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
through levels every 3600 frames).

## Byte-identical verification

```bash
FLOW_DIR=~/flow bash scripts/run_byte_identical.sh
FLOW_DIR=~/flow bash scripts/run_gameplay_test.sh
```

Both suites build C and MLIR WASM variants, drive them through the
deterministic test clock, and compare CRC32 values per sampled frame.

## Record a GIF

```bash
FLOW_DIR=~/flow ./scripts/build_wasm.sh --doom-only --test-clock
FLOW_DIR=~/flow node scripts/record_wasm_gif.js --frames 600 --skip 6 --fps 15 --width 320 --out media/doom.gif
```

## Controls

Arrows / WASD move. X or F fire. Space or E use. 1-7 weapons. Tab automap. Esc menu.

See [`PORTING.md`](PORTING.md) for how the C to Flow port works.

## Postmortem: the barrel bug

Issue #8 exposed a gap in the verification strategy rather than a missing Doom
mechanic. The Flow source already contained the vanilla barrel path: barrels
have 20 health, enter the expected BEXP death-state sequence, dispatch
`A_Explode`, and call `P_RadiusAttack`. The hitscan, damage, death-state, and
radius-attack paths also match the original Doom implementation.

The browser nevertheless served a broken barrel implementation because a
previous optimization experiment post-processed generated LLVM IR with
aggressive pointer attributes, including blanket `noalias` annotations. That
assumption is invalid for Doom's heavily aliased object/state model. The pass
was later removed from `scripts/build_wasm.sh`, but the already-generated
`site/wasm/doom/doom.wasm` remained checked in. The Pages workflow simply
uploaded `site/`, so production continued serving the stale miscompiled binary
while CI rebuilt correct binaries from source.

This also explains why CRC parity did not catch the problem. The parity suites
compare the C and MLIR backends of the same Flow port. They are excellent at
finding backend divergences, but they do not prove semantic equivalence with
vanilla Doom, and they say nothing about a separately checked-in production
artifact. Two backends can agree perfectly on the same porting mistake, and a
correct CI build can coexist with an obsolete deployed binary.

The corrective rule is now simple: production is built from source during the
Pages job and smoke-tested before deployment. Backend parity remains useful,
but it is treated as one layer of verification rather than a complete gameplay
oracle. Behavioural regressions should be tested at the level where users
observe them, and deployment artifacts must be derived from the commit being
deployed rather than trusted as independent source files.
