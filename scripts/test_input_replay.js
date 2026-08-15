// test_input_replay.js: Run a deterministic keyboard input replay and
// collect CRC32 of the framebuffer at sampled frames. Used to verify
// that human-style input produces byte-identical frames between C and
// MLIR backends.
//
// Usage:
//   node scripts/test_input_replay.js          # uses site/wasm/doom (MLIR)
//   SMOKE_DIR=/tmp/doom_c_dir node scripts/test_input_replay.js  # C build
//
// The replay warps to E1M1, then sends a deterministic sequence of
// key events: forward, turn, strafe, fire, use, weapon switch.

const path = require("path");

const assetDir = process.env.SMOKE_DIR
  ? path.resolve(process.env.SMOKE_DIR)
  : path.join(__dirname, "..", "site", "wasm", "doom");
const dir = assetDir;
const timeoutMs = parseInt(process.env.SMOKE_TIMEOUT, 10) || 300000;
const label = process.env.TEST_LABEL || "unknown";
const maxFrames = parseInt(process.env.MAX_FRAMES, 10) || 3000;

// Deterministic input replay sequence.
// Each entry is [frame, key, press] where key is a Doom key code and
// press is 1 for keydown, 0 for keyup.
// Key codes: 0x80=up, 0x81=down, 0x82=left, 0x83=right,
// 0xA0=fire(Ctrl), 0xA2=use(space), 0xB0-0xB7=weapon 1-8,
// 0xA3=strafe, 0xA4=strafe left, 0xA5=strafe right
const INPUT_SEQUENCE = [
  // Frame 40: start moving forward
  [40, 0x80, 1],
  // Frame 80: turn right
  [80, 0x83, 1],
  // Frame 120: stop turning
  [120, 0x83, 0],
  // Frame 140: strafe
  [140, 0xA3, 1],
  [140, 0xA4, 1],
  // Frame 180: stop strafing
  [180, 0xA4, 0],
  [180, 0xA3, 0],
  // Frame 200: fire
  [200, 0xA0, 1],
  [210, 0xA0, 0],
  // Frame 240: use
  [240, 0xA2, 1],
  [245, 0xA2, 0],
  // Frame 280: switch to weapon 3
  [280, 0xB2, 1],
  [281, 0xB2, 0],
  // Frame 320: turn left
  [320, 0x82, 1],
  [360, 0x82, 0],
  // Frame 400: stop moving forward
  [400, 0x80, 0],
  // Frame 440: backward
  [440, 0x81, 1],
  [480, 0x81, 0],
  // Frame 520: fire again
  [520, 0xA0, 1],
  [530, 0xA0, 0],
  // Frame 600: forward again
  [600, 0x80, 1],
  // Frame 800: turn around
  [800, 0x83, 1],
  [850, 0x83, 0],
  // Frame 1000: stop
  [1000, 0x80, 0],
  // Frame 1200: weapon 5
  [1200, 0xB4, 1],
  [1201, 0xB4, 0],
  // Frame 1400: fire
  [1400, 0xA0, 1],
  [1410, 0xA0, 0],
  // Frame 1600: use
  [1600, 0xA2, 1],
  [1605, 0xA2, 0],
  // Frame 1800: strafe right
  [1800, 0xA3, 1],
  [1800, 0xA5, 1],
  [1840, 0xA5, 0],
  [1840, 0xA3, 0],
  // Frame 2000: forward
  [2000, 0x80, 1],
  // Frame 2400: turn
  [2400, 0x82, 1],
  [2440, 0x82, 0],
  // Frame 2800: stop
  [2800, 0x80, 0],
];

// Sample frames for CRC comparison.
const SAMPLE_FRAMES = [];
for (let f = 0; f <= 50; f += 5) SAMPLE_FRAMES.push(f);
for (let f = 60; f <= 500; f += 20) SAMPLE_FRAMES.push(f);
for (let f = 520; f <= maxFrames; f += 100) SAMPLE_FRAMES.push(f);
// Extra samples around input events
for (const [frame] of INPUT_SEQUENCE) {
  for (let f = frame - 5; f <= frame + 10; f += 5) {
    if (f >= 0 && f <= maxFrames && SAMPLE_FRAMES.indexOf(f) < 0) {
      SAMPLE_FRAMES.push(f);
    }
  }
}
SAMPLE_FRAMES.sort((a, b) => a - b);

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
  process.exit(2);
}, timeoutMs);

async function main() {
  const createModule = require(path.join(dir, "doom.js"));
  const Module = await createModule({
    locateFile: (p) => path.join(dir, p),
    print: () => {},
    printErr: (t) => err(t),
    noInitialRun: true,
  });

  // Set AI mode off and warp to E1M1 for deterministic input replay
  Module._doomflow_set_ai(0);
  Module.callMain([
    "-iwad", "doom1.wad",
    "-skill", "3",
    "-warp", "1", "1",
    "-nograb",
  ]);

  const samples = [];
  const inputMap = {};
  for (const [f, key, press] of INPUT_SEQUENCE) {
    if (!inputMap[f]) inputMap[f] = [];
    inputMap[f].push([key, press]);
  }

  for (let frame = 0; frame <= maxFrames; frame++) {
    // Send deterministic input events at the right frames
    if (inputMap[frame]) {
      for (const [key, press] of inputMap[frame]) {
        Module._dg_push_key(press, key);
      }
    }

    // Set deterministic clock
    globalThis.__detFrame = frame;

    const alive = Module._doomflow_frame();
    if (!alive) break;

    if (SAMPLE_FRAMES.indexOf(frame) >= 0) {
      const ctx = Module._doomflow_get_gfx_ctx();
      const crc = Module._doomflow_fb_crc32(ctx);
      const nonzero = Module._doomflow_count_nonzero(ctx, 8);
      samples.push({ frame, crc32: crc >>> 0, nonzero });
    }
  }

  console.log("RESULT", JSON.stringify({ label, samples }));
  process.exit(0);
}

main().catch((e) => {
  console.log("TEST_FAIL", String((e && e.message) || e).slice(0, 300));
  process.exit(1);
});
