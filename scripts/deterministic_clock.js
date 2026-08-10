// deterministic_clock.js: JS library that overrides flow_rt_time_ms to
// return a deterministic value based on a frame counter set by the test
// harness. This makes C and MLIR backend runs produce identical frame
// sequences regardless of how many times I_GetTime() is called per frame.
//
// The test harness sets __detFrame before each doomflow_frame() call.
// The clock returns frame * 29 ms, so I_GetTime() sees exactly one
// new tic per frame at TICRATE=35 (1000/35 ~= 28.57, rounded to 29).
//
// Used via emcc --js-library in test builds.
mergeInto(LibraryManager.library, {
  flow_rt_time_ms: function () {
    var g = (typeof global !== "undefined") ? global : (typeof window !== "undefined") ? window : {};
    var f = g.__detFrame || 0;
    return (f * 29) | 0;
  },
});
