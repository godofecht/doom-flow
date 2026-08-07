# Porting doomgeneric modules from C to Flow

The goal of this repo is a Doom engine written in Flow. Modules move from
`doomgeneric/*.c` into `*.flow` at the repo root one at a time, keeping the
game bootable after every step. `wad.flow` and `fixp.flow` are the reference
ports; read them before writing a new one.

## Architecture

- `doom.flow` is the entry module. Every ported module is added there as
  `import "<module>.flow"`. The whole Flow side transpiles to ONE C file.
- Remaining host ABI that Flow cannot express yet (calling through opaque
  C function pointers, `errno`, macOS error popup) uses Flow's runtime
  trampolines (`flow_rt_call_*` in `flow_rt_support.c`). Doom wraps them
  in `platform.flow`. See Flow `docs/language/c-fnptr-call.md`.
  `doomgeneric/` holds LICENSE only.
- Shared layouts live in Flow `*_OFF_*` / `*_SIZEOF` tables
  (`PLAYER_OFF_*`, `MOBJ_OFF_*`, `GEOM_OFF_*`, …).
- Build: `$FLOW_DIR/flow build-native` (see [`flow.toml`](flow.toml))
  → `./build/doom`.
- Verification:
  `$FLOW_DIR/flow build-native && DOOMFLOW_ARGS="-timedemo demo1" ./build/doom`
  must print `timed 5026 gametics` and exit. That plays a full recorded
  demo through the engine deterministically.

## Rules for a port

1. Exact ABI. Every function the C engine calls keeps its exact name via
   `@flow_api` on the line above `function`. Without it, Flow mangles
   names with type suffixes (`W_AddFile` becomes `W_AddFile_string`).
2. Exact memory layout. If C code indexes a struct array the module owns,
   keep the byte layout identical and access fields through explicit
   offset helpers (see the lumpinfo accessors in `wad.flow`).
3. Exact behavior, including quirks. Overflow saturation, scan order,
   off-by-one oddities: copy them.
4. Globals: a top-level `let mut` in Flow is emitted as a C `static`,
   private to the translation unit. Share across modules with `@flow_api`
   (including `return &x` for bind addresses). Host ABI Flow cannot
   express yet goes through Flow runtime trampolines via `platform.flow`.
5. Enum and macro values formerly in doomgeneric headers are hardcoded as
   `const` in Flow.

## Flow language facts (learned the hard way, Flow 0.9.0)

- Transpiles to C via `PYTHONPATH=$HOME/flow/src python3 -m flow.transpiler
  file.flow --c --lenient -o out.c` (this port’s path). Flow also has an
  MLIR → LLVM CPU backend; Doom does not use it yet. The generated C includes
  stdint, stdbool, stdio, stdlib, string, math.
- `extern { function name(args) -> ret }` emits a plain C prototype.
  Known libc names (malloc, calloc, free, memcpy, memset, strlen, strcmp,
  strncpy, printf, fopen, fclose, fread, fwrite, fseek, ftell, getenv...)
  are NOT re-declared; the system header's real prototype is used, so
  approximate Flow types are fine for those. For any OTHER libc function,
  your extern's C type must not conflict with the system header.
- Variadic externs (`...`) do not parse. Declare a fixed-arg subset:
  `extern { function printf(fmt: string, s: string) -> i32 }` works
  because printf's declaration is suppressed. For engine variadics like
  `I_Error`, declare `(msg: string) -> void` and pass a plain message.
- `string` is `char*`. Cast to bytes with `name as ptr<u8>`.
- Pointer casts all work with `as`: `ptr<u8>` to `ptr<i32>`/`ptr<i64>`,
  pointer to `i64` and back. Address arithmetic:
  `((base as i64) + off as i64) as ptr<u8>`. Indexing `p[i]` scales by
  element size.
- `null` is the null pointer; test with `(p as i64) == 0`.
- Top-level mutable state must be `let mut` (plain `let` is rejected).
  Fixed arrays are `array<T, N>` with a full literal initializer.
- Operators: `and`, `or`, `!`. No `+=`, write `x = x + 1`. No ternary.
  Prefer `for i in 0 to n { ... }` (exclusive end) over hand-rolled
  `while` counters when the C was a simple integer for-loop.
- Casts are explicit everywhere: `x as u8`, `x as i64`, `(i as u32)`.
- Comments are `#`.
- **Use Flow structs** for module-private records:
  `struct Glow { sector: ptr<void>, min: i32, max: i32, dir: i32 }`
  and `let g: Glow = Glow { sector: s, min: 0, max: 1, dir: 1 }`,
  field access `g.min` / `file[0].buflen`. Do NOT invent offset helpers
  for data that only this Flow module owns. Keep byte-offset / C-shim
  accessors only when C still shares the memory (mobj / sector / player
  blobs via Flow `*_OFF_*`). Prefer Flow structs for module-private
  records (`memio.flow`, `sound.flow`, `iwad.flow`).
- `elif` is supported. Prefer it over nested `else { if ... }`.
- Reserved identifiers include `handle` and `type` — rename parameters.
- Shifts/bitwise on u32/i32 behave like C. i64 intermediates for wide
  multiplies: `((a as i64) * (b as i64)) >> 16`.

## Syntax-checking a module before integration

A module alone has no `main`; make a scratch harness:

    cd /tmp && cat > harness.flow <<EOF
    import "/path/to/repo/<module>.flow"
    function main() -> i32 { return 0 }
    EOF
    PYTHONPATH=$HOME/flow/src python3 -m flow.transpiler harness.flow \
        --c --lenient -o harness.c && clang -c harness.c -o /dev/null

This catches parse, type, and C-level errors. Link errors only surface at
integration (`flow build-native`).

## Integration checklist (done by the integrator, not the module port)

1. `import "<module>.flow"` added to `doom.flow`.
2. Prefer Flow-owned state; host escape hatches go through `platform.flow`
   / Flow `flow_rt_*` trampolines.
3. Shared struct sizes/offsets go in Flow `*_OFF_*` / `*_SIZEOF`.
4. `flow build-native` links clean; timedemo prints `timed 5026 gametics`.
