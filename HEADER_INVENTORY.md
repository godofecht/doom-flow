# C surface status

**Done.** No project-local `*_shim.c` / `*_data.c` / `platform_stub.c`.

Engine + platform wrappers are Flow. Remaining native code is only Flow's
runtime (`flow_rt_support.c`, `gfx_macos.m`) for C-fnptr call-through,
errno, popup, clock, and graphics.

Feature request (first-class C fnptr call-through): see Flow
`docs/language/c-fnptr-call.md`.

Verify: `DOOMFLOW_ARGS="-timedemo demo1" ./build/doom` → `timed 5026 gametics`
