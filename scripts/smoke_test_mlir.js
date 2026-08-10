// Boot the Doom-flow wasm bundle in Node and report how far Doom gets.
// Usage: SMOKE_TIMEOUT=15000 node scripts/smoke_test_mlir.js
const path = require("path");

const assetDir = process.env.SMOKE_DIR ? path.resolve(process.env.SMOKE_DIR) : path.join(__dirname, "..", "site", "wasm", "doom");
const dir = assetDir;
const timeoutMs = parseInt(process.env.SMOKE_TIMEOUT, 10) || 90000;

let failCount = 0;

function locateFile(p) {
  return path.join(dir, p);
}

function err(t) {
  if (/out of bounds|abort|Assertion|RuntimeError/i.test(String(t))) {
    failCount++;
    console.log("SMOKE_ERR", String(t));
  }
}

process.on("uncaughtException", (e) => {
  failCount++;
  console.log("SMOKE_RESULT", String(e && e.message || e).slice(0, 200));
  if (e && e.stack) console.log("SMOKE_UE_STACK", String(e.stack).split("\n").slice(0, 15).join(" | "));
  process.exit(1);
});

process.on("unhandledRejection", (e) => {
  failCount++;
  console.log("SMOKE_RESULT", String(e && e.message || e).slice(0, 200));
  if (e && e.stack) console.log("SMOKE_UR_STACK", String(e.stack).split("\n").slice(0, 15).join(" | "));
  process.exit(1);
});

setTimeout(() => {
  if (failCount > 0) {
    console.log("SMOKE_FAIL", failCount, "error(s) observed before timeout");
    process.exit(1);
  }
  console.log("SMOKE_OK boot did not crash within window");
  process.exit(0);
}, timeoutMs);

const createFlowModule = require(path.join(dir, "doom.js"));
const hooks = {
  locateFile: (p) => path.join(dir, p),
  canvas: { width: 640, height: 400, getContext: () => ({ fillRect(){}, clearRect(){}, drawImage(){}, getParameter(){ return ""; }, getExtension(){ return null; }, createImageData(){ return {data:new Uint8ClampedArray(1)}; }, putImageData(){}, setTransform(){}, translate(){}, scale(){}, beginPath(){}, fill(){}, moveTo(){}, lineTo(){}, stroke(){}, getImageData(){ return {data:new Uint8ClampedArray(1)}; } }) },
  print: (t) => console.log("doom:", t),
  printErr: err,
};

createFlowModule(hooks).then((mod) => {
  console.log("SMOKE module_loaded");
  if (typeof mod._doomflow_set_ai === "function") mod._doomflow_set_ai(0);
  if (mod._main) mod.callMain([]);
  console.log("SMOKE callMain_returned");

  // MLIR build: main() returns after init. Drive frames manually.
  if (typeof mod._doomflow_frame === "function") {
    var ctx = null;
    if (typeof mod._doomflow_get_gfx_ctx === "function") {
      ctx = mod._doomflow_get_gfx_ctx();
    }
    var frame = 0;
    function tick() {
      if (frame >= 3000) {
        console.log("SMOKE_OK frame loop completed 3000 frames");
        process.exit(0);
        return;
      }
      try {
        var alive = mod._doomflow_frame();
        if (!alive) {
          console.log("SMOKE_OK frame loop exited at frame " + frame);
          process.exit(0);
          return;
        }
        if (mod._doomflow_present) mod._doomflow_present(ctx);
        frame++;
      } catch (e) {
        console.log("SMOKE_FAIL frame " + frame + ": " + String(e));
        process.exit(1);
        return;
      }
      setImmediate(tick);
    }
    tick();
  }
}).catch((e) => {
  console.log("SMOKE_RESULT", String(e && e.message || e).slice(0, 300));
  if (e && e.stack) {
    const lines = String(e.stack).split("\n");
    console.log("SMOKE_STACK", lines.slice(0, 12).join(" | "));
  }
  process.exit(1);
});
