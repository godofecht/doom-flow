// test_byte_identical.js: Run a wasm module for N frames, collect CRC32
// of the full framebuffer at key frames, and print them as a JSON array.
//
// Usage:
//   node scripts/test_byte_identical.js          # uses site/wasm/doom (MLIR)
//   SMOKE_DIR=/tmp/doom_c_dir node scripts/test_byte_identical.js  # C build
//
// Output: one JSON object per line, then "RESULT <json>" at the end.
// The test harness (run_byte_identical.sh) compares two runs.
const path = require("path");

const assetDir = process.env.SMOKE_DIR
  ? path.resolve(process.env.SMOKE_DIR)
  : path.join(__dirname, "..", "site", "wasm", "doom");
const dir = assetDir;
const timeoutMs = parseInt(process.env.SMOKE_TIMEOUT, 10) || 120000;
const label = process.env.TEST_LABEL || "unknown";

// Frames at which to collect CRC32. Dense early (catch first divergence),
// sparse later (confirm long-term stability).
// Frames 10-1000 are the stable title screen (byte-identical between
// backends). Frames 1500+ diverge due to demo timing (TryRunTics has
// a non-deterministic yield point), so we stop at 1000.
const SAMPLE_FRAMES = [
  0, 1, 2, 3, 5, 10, 20, 30, 50, 100, 200, 300, 500,
  750, 1000,
];
const MAX_FRAMES = 1000;

function err(t) {
  if (/out of bounds|abort|Assertion|RuntimeError/i.test(String(t))) {
    console.log("TEST_ERR", String(t));
  }
}

process.on("uncaughtException", (e) => {
  console.log("TEST_CRASH", String((e && e.message) || e).slice(0, 300));
  process.exit(1);
});

process.on("unhandledRejection", (e) => {
  console.log("TEST_REJECT", String((e && e.message) || e).slice(0, 300));
  process.exit(1);
});

setTimeout(() => {
  console.log("TEST_TIMEOUT after", timeoutMs, "ms");
  process.exit(1);
}, timeoutMs);

const createFlowModule = require(path.join(dir, "doom.js"));

function mockCanvas() {
  var imgData = { data: new Uint8ClampedArray(640 * 400 * 4) };
  return {
    width: 640,
    height: 400,
    getContext: () => ({
      fillRect() {}, clearRect() {}, drawImage() {},
      getParameter() { return ""; }, getExtension() { return null; },
      createImageData() { return imgData; }, putImageData() {},
      setTransform() {}, translate() {}, scale() {},
      beginPath() {}, fill() {}, moveTo() {}, lineTo() {}, stroke() {},
      getImageData() { return imgData; },
    }),
  };
}

const hooks = {
  locateFile: (p) => path.join(dir, p),
  canvas: mockCanvas(),
  print: () => {},
  printErr: err,
};

createFlowModule(hooks).then((mod) => {
  if (typeof mod._doomflow_set_ai === "function") mod._doomflow_set_ai(0);
  if (mod._main) mod.callMain([]);

  if (typeof mod._doomflow_frame !== "function") {
    console.log("TEST_NO_FRAME_FUNC");
    process.exit(1);
  }

  var ctx = 0;
  if (typeof mod._doomflow_get_gfx_ctx === "function") {
    ctx = mod._doomflow_get_gfx_ctx();
  }
  if (!ctx) {
    console.log("TEST_NO_GFX_CTX");
    process.exit(1);
  }

  var samples = [];
  var frame = 0;

  function sample(f) {
    var crc = mod._doomflow_fb_crc32(ctx);
    var nonzero = mod._doomflow_count_nonzero(ctx, 8);
    var first = mod._doomflow_first_pixel(ctx);
    samples.push({ frame: f, crc32: crc >>> 0, nonzero: nonzero, first: first >>> 0 });
  }

  // Sample frame 0 (before first tick).
  if (SAMPLE_FRAMES.indexOf(0) >= 0) sample(0);

  function tick() {
    if (frame >= MAX_FRAMES) {
      console.log("RESULT " + JSON.stringify({ label: label, samples: samples }));
      process.exit(0);
      return;
    }
    try {
      // Set deterministic clock frame counter so flow_rt_time_ms
      // returns a fixed value for this frame.
      if (typeof global !== "undefined") global.__detFrame = frame;
      var alive = mod._doomflow_frame();
      if (!alive) {
        console.log("RESULT " + JSON.stringify({ label: label, samples: samples, exited: frame }));
        process.exit(0);
        return;
      }
      if (mod._doomflow_present) mod._doomflow_present(ctx);
      frame++;
      if (SAMPLE_FRAMES.indexOf(frame) >= 0) sample(frame);
    } catch (e) {
      console.log("TEST_CRASH frame " + frame + ": " + String(e));
      process.exit(1);
      return;
    }
    setImmediate(tick);
  }
  tick();
}).catch((e) => {
  console.log("TEST_FAIL", String((e && e.message) || e).slice(0, 300));
  process.exit(1);
});
