// frame_dump.js: Run doomflow_frame() step by step, dump framebuffer
// contents at key frames via C shim functions.
const path = require("path");

const assetDir = process.env.SMOKE_DIR
  ? path.resolve(process.env.SMOKE_DIR)
  : path.join(__dirname, "..", "site", "wasm", "doom");
const dir = assetDir;
const timeoutMs = parseInt(process.env.SMOKE_TIMEOUT, 10) || 60000;

const DUMP_FRAMES = [1, 2, 3, 5, 10, 50, 100, 256, 512, 1024, 2048];
const MAX_FRAMES = 3000;

function err(t) {
  if (/out of bounds|abort|Assertion|RuntimeError/i.test(String(t))) {
    console.log("DUMP_ERR", String(t));
  }
}

process.on("uncaughtException", (e) => {
  console.log("DUMP_CRASH", String((e && e.message) || e).slice(0, 300));
  if (e && e.stack)
    console.log("DUMP_STACK", String(e.stack).split("\n").slice(0, 10).join(" | "));
  process.exit(1);
});

process.on("unhandledRejection", (e) => {
  console.log("DUMP_REJECT", String((e && e.message) || e).slice(0, 300));
  process.exit(1);
});

setTimeout(() => {
  console.log("DUMP_TIMEOUT after", timeoutMs, "ms");
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
  print: (t) => console.log("doom:", t),
  printErr: err,
};

createFlowModule(hooks).then((mod) => {
  console.log("DUMP module_loaded");
  if (typeof mod._doomflow_set_ai === "function") mod._doomflow_set_ai(0);
  if (mod._main) mod.callMain([]);
  console.log("DUMP callMain_returned");

  if (typeof mod._doomflow_frame !== "function") {
    console.log("DUMP_NO_FRAME_FUNC");
    process.exit(1);
  }

  var ctx = 0;
  if (typeof mod._doomflow_get_gfx_ctx === "function") {
    ctx = mod._doomflow_get_gfx_ctx();
    console.log("DUMP gfx_ctx=" + ctx);
  }

  function dumpFrame(frame) {
    if (!ctx) {
      console.log("DUMP frame=" + frame + " NO_CTX");
      return;
    }
    var firstPx = mod._doomflow_first_pixel(ctx);
    var nonzero = mod._doomflow_count_nonzero(ctx, 8);
    // Sample a few key pixels: top-left, center, title screen area
    var tl = mod._doomflow_dump_pixel(ctx, 0, 0);
    var ctr = mod._doomflow_dump_pixel(ctx, 320, 200);
    var tl10 = mod._doomflow_dump_pixel(ctx, 10, 10);
    var mid = mod._doomflow_dump_pixel(ctx, 160, 100);
    console.log("DUMP frame=" + frame +
      " first=0x" + (firstPx >>> 0).toString(16).padStart(8, "0") +
      " nonzero=" + nonzero +
      " tl=0x" + (tl >>> 0).toString(16).padStart(8, "0") +
      " ctr=0x" + (ctr >>> 0).toString(16).padStart(8, "0") +
      " tl10=0x" + (tl10 >>> 0).toString(16).padStart(8, "0") +
      " mid=0x" + (mid >>> 0).toString(16).padStart(8, "0"));
  }

  // Also dump right after init (before first frame)
  dumpFrame(0);

  var frame = 0;
  function tick() {
    if (frame >= MAX_FRAMES) {
      console.log("DUMP_DONE completed " + frame + " frames");
      process.exit(0);
      return;
    }
    try {
      var alive = mod._doomflow_frame();
      if (!alive) {
        console.log("DUMP_DONE exited at frame " + frame);
        process.exit(0);
        return;
      }
      if (mod._doomflow_present) mod._doomflow_present(ctx);
      frame++;
      if (DUMP_FRAMES.indexOf(frame) >= 0) {
        dumpFrame(frame);
      }
    } catch (e) {
      console.log("DUMP_CRASH frame " + frame + ": " + String(e));
      process.exit(1);
      return;
    }
    setImmediate(tick);
  }
  tick();
}).catch((e) => {
  console.log("DUMP_FAIL", String((e && e.message) || e).slice(0, 300));
  if (e && e.stack)
    console.log("DUMP_STACK", String(e.stack).split("\n").slice(0, 10).join(" | "));
  process.exit(1);
});
