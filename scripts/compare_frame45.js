// compare_frame45.js: Sample a grid of pixels at a target frame for AI pilot
// mode, output differences for comparison between C and MLIR backends.
const path = require("path");
const dir = process.env.SMOKE_DIR
  ? path.resolve(process.env.SMOKE_DIR)
  : path.join(__dirname, "..", "site", "wasm", "doom");
const label = process.env.TEST_LABEL || "unknown";
const targetFrame = parseInt(process.env.TARGET_FRAME || "45", 10);

function err(t) {
  if (/out of bounds|abort|Assertion|RuntimeError/i.test(String(t))) {
    console.log("ERR", String(t));
  }
}

process.on("uncaughtException", (e) => {
  console.log("CRASH", String((e && e.message) || e).slice(0, 300));
  process.exit(1);
});

setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 120000);

const createFlowModule = require(path.join(dir, "doom.js"));

function mockCanvas() {
  var imgData = { data: new Uint8ClampedArray(640 * 400 * 4) };
  return {
    width: 640, height: 400,
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
  if (typeof mod._doomflow_set_ai === "function") mod._doomflow_set_ai(1);
  if (mod._main) mod.callMain([]);

  var ctx = mod._doomflow_get_gfx_ctx();
  if (!ctx) { console.log("NO_CTX"); process.exit(1); }

  var frame = 0;
  function tick() {
    if (frame >= targetFrame) {
      // Sample every 4th pixel in a grid and output as compact hex
      var parts = ["GRID", label, targetFrame];
      for (var y = 0; y < 400; y += 2) {
        for (var x = 0; x < 640; x += 2) {
          var px = mod._doomflow_dump_pixel(ctx, x, y);
          // Pack RGB into 12 bits (4 bits each) for compactness
          var r = (px >>> 24) & 0xff;
          var g = (px >>> 16) & 0xff;
          var b = (px >>> 8) & 0xff;
          // Quantize to 4 bits each
          var q = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
          parts.push(q.toString(16).padStart(3, "0"));
        }
      }
      console.log(parts.join(" "));
      process.exit(0);
      return;
    }
    try {
      if (typeof global !== "undefined") global.__detFrame = frame;
      var alive = mod._doomflow_frame();
      if (!alive) { console.log("EXITED at " + frame); process.exit(0); return; }
      if (mod._doomflow_present) mod._doomflow_present(ctx);
      frame++;
    } catch (e) {
      console.log("CRASH frame " + frame + ": " + e);
      process.exit(1);
    }
    setImmediate(tick);
  }
  tick();
}).catch((e) => {
  console.log("FAIL", String((e && e.message) || e).slice(0, 300));
  process.exit(1);
});
