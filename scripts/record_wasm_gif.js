// record_wasm_gif.js: Drive the MLIR WASM build, capture presented frames
// as PPMs, then encode a GIF via Flow's frames_to_gif.py.
//
// Usage:
//   node scripts/record_wasm_gif.js --frames 120 --skip 2 --out media/doom.gif
//
// Env:
//   SMOKE_DIR     path to wasm/doom directory (default: site/wasm/doom)
//   SMOKE_TIMEOUT   ms (default 120000)
//   DOOMFLOW_AI    "1" to arm the AI pilot

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const assetDir = process.env.SMOKE_DIR
  ? path.resolve(process.env.SMOKE_DIR)
  : path.join(__dirname, "..", "site", "wasm", "doom");
const dir = assetDir;
const timeoutMs = parseInt(process.env.SMOKE_TIMEOUT, 10) || 120000;

let FRAMES = 120;
let SKIP = 2;
let OUT = path.join(__dirname, "..", "media", "doom.gif");
let WIDTH = 320;
let FPS = 15;
let AI = process.env.DOOMFLOW_AI === "1";

for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--frames") { FRAMES = parseInt(process.argv[++i], 10); }
  else if (a === "--skip") { SKIP = parseInt(process.argv[++i], 10); }
  else if (a === "--out") { OUT = process.argv[++i]; }
  else if (a === "--width") { WIDTH = parseInt(process.argv[++i], 10); }
  else if (a === "--fps") { FPS = parseInt(process.argv[++i], 10); }
  else if (a === "--ai") { AI = true; }
}

const FRAME_DIR = path.join(__dirname, "..", "build", "gif-frames");
fs.rmSync(FRAME_DIR, { recursive: true, force: true });
fs.mkdirSync(FRAME_DIR, { recursive: true });
fs.mkdirSync(path.dirname(OUT), { recursive: true });

process.on("uncaughtException", (e) => {
  console.error("CRASH", String((e && e.message) || e).slice(0, 300));
  process.exit(1);
});
process.on("unhandledRejection", (e) => {
  console.error("REJECT", String((e && e.message) || e).slice(0, 300));
  process.exit(1);
});
setTimeout(() => { console.error("TIMEOUT"); process.exit(1); }, timeoutMs);

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

const createFlowModule = require(path.join(dir, "doom.js"));

createFlowModule({
  locateFile: (p) => path.join(dir, p),
  canvas: mockCanvas(),
  print: () => {},
  printErr: () => {},
}).then((mod) => {
  if (AI && typeof mod._doomflow_set_ai === "function") mod._doomflow_set_ai(1);
  if (mod.callMain) mod.callMain([]);

  if (typeof mod._doomflow_frame !== "function") {
    console.error("no doomflow_frame export");
    process.exit(1);
  }

  var ctx = 0;
  if (typeof mod._doomflow_get_gfx_ctx === "function") {
    ctx = mod._doomflow_get_gfx_ctx();
  }
  if (!ctx) {
    console.error("no gfx ctx");
    process.exit(1);
  }

  var w = mod._doomflow_width(ctx);
  var h = mod._doomflow_height(ctx);
  var pixPtr = mod._doomflow_pixels(ctx);
  if (!w || !h || !pixPtr) {
    console.error("no pixel buffer (w=" + w + " h=" + h + " ptr=" + pixPtr + ")");
    process.exit(1);
  }
  console.log("recording " + FRAMES + " frames at " + w + "x" + h + ", skip=" + SKIP);

  var frame = 0;
  var written = 0;

  function tick() {
    if (frame >= FRAMES) {
      console.log("done: " + written + " frames written");
      encodeGif();
      return;
    }
    try {
      var alive = mod._doomflow_frame();
      if (!alive) {
        console.log("game exited at frame " + frame);
        encodeGif();
        return;
      }
      mod._doomflow_present(ctx);
      frame++;
      if (frame % SKIP === 0) {
        writePpm(frame);
        written++;
      }
    } catch (e) {
      console.error("crash at frame", frame, String(e));
      process.exit(1);
    }
    setImmediate(tick);
  }

  function writePpm(n) {
    var npx = w * h;
    var header = "P6\n" + w + " " + h + "\n255\n";
    var buf = Buffer.alloc(header.length + npx * 3);
    var off = buf.write(header, 0, "ascii");
    var heap = mod.HEAPU8;
    for (var i = 0; i < npx; i++) {
      var src = pixPtr + i * 4;
      buf[off++] = heap[src];
      buf[off++] = heap[src + 1];
      buf[off++] = heap[src + 2];
    }
    var fname = path.join(FRAME_DIR, "frame_" + String(n).padStart(5, "0") + ".ppm");
    fs.writeFileSync(fname, buf);
  }

  function encodeGif() {
    if (written === 0) {
      console.error("no frames captured");
      process.exit(1);
    }
    var flowDir = process.env.FLOW_DIR || path.join(__dirname, "..", "..", "flow");
    var gifScript = path.join(flowDir, "scripts", "frames_to_gif.py");
    if (!fs.existsSync(gifScript)) {
      console.error("frames_to_gif.py not found at " + gifScript);
      console.log("PPM frames in " + FRAME_DIR);
      process.exit(0);
    }
    try {
      execFileSync("python3",
        [gifScript, FRAME_DIR, OUT, "--fps", String(FPS), "--width", String(WIDTH)],
        { stdio: "inherit" });
      console.log("GIF written to " + OUT);
    } catch (e) {
      console.error("GIF encoding failed: " + String(e));
      console.log("PPM frames in " + FRAME_DIR);
    }
    process.exit(0);
  }

  tick();
}).catch((e) => {
  console.error("FAIL", String((e && e.message) || e).slice(0, 300));
  process.exit(1);
});
