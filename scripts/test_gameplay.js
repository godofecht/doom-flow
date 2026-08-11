// test_gameplay.js: Run a wasm module with AI pilot (skips menu, warps to
// E1M1 skill 3), collect CRC32 at sampled frames during actual gameplay.
//
// Usage:
//   node scripts/test_gameplay.js
//   SMOKE_DIR=/tmp/doom_mlir node scripts/test_gameplay.js
const path = require("path");

const dir = process.env.SMOKE_DIR
  ? path.resolve(process.env.SMOKE_DIR)
  : path.join(__dirname, "..", "site", "wasm", "doom");
const timeoutMs = parseInt(process.env.SMOKE_TIMEOUT, 10) || 180000;
const label = process.env.TEST_LABEL || "unknown";
const maxFrames = parseInt(process.env.MAX_FRAMES, 10) || 2000;

// Sample densely early (level load), then periodically through gameplay.
const SAMPLE_FRAMES = [];
for (let f = 0; f <= 50; f += 5) SAMPLE_FRAMES.push(f);
for (let f = 60; f <= 500; f += 20) SAMPLE_FRAMES.push(f);
for (let f = 520; f <= maxFrames; f += 50) SAMPLE_FRAMES.push(f);

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
  print: (t) => {
    if (/gamestate|GS_LEVEL|E1M1|skill|warp|ai pilot/i.test(String(t))) {
      console.log("[" + label + "]", t);
    }
  },
  printErr: err,
};

createFlowModule(hooks).then((mod) => {
  // Enable AI pilot: warps to E1M1 skill 3, drives forward/turn/fire.
  if (typeof mod._doomflow_set_ai === "function") mod._doomflow_set_ai(1);
  if (mod._main) mod.callMain([]);

  if (typeof mod._doomflow_frame !== "function") {
    console.log("TEST_NO_FRAME_FUNC");
    process.exit(1);
  }

  var ctx = mod._doomflow_get_gfx_ctx();
  if (!ctx) {
    console.log("TEST_NO_GFX_CTX");
    process.exit(1);
  }

  var samples = [];
  var frame = 0;

  function sample(f) {
    var crc = mod._doomflow_fb_crc32(ctx);
    var nonzero = mod._doomflow_count_nonzero(ctx, 8);
    samples.push({ frame: f, crc32: crc >>> 0, nonzero: nonzero });
  }

  if (SAMPLE_FRAMES.indexOf(0) >= 0) sample(0);

  function tick() {
    if (frame >= maxFrames) {
      console.log("RESULT " + JSON.stringify({ label: label, samples: samples }));
      process.exit(0);
      return;
    }
    try {
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
