// compare_crc.js: Compare two result.json files from test_byte_identical.js.
// Reports the first frame where CRC32 values diverge.
// Exit 0 if all match, 1 on mismatch.
const fs = require("fs");

if (process.argv.length < 4) {
  console.error("Usage: node compare_crc.js <c_result.json> <mlir_result.json>");
  process.exit(2);
}

function parseResult(file) {
  var text = fs.readFileSync(file, "utf8").trim();
  var lines = text.split("\n");
  for (var i = lines.length - 1; i >= 0; i--) {
    var line = lines[i].trim();
    if (line.startsWith("RESULT ")) {
      return JSON.parse(line.slice(7));
    }
  }
  console.error("No RESULT line found in " + file);
  console.error("Raw output:");
  console.error(text.slice(0, 500));
  process.exit(2);
}

var cResult = parseResult(process.argv[2]);
var mlirResult = parseResult(process.argv[3]);

var cSamples = cResult.samples;
var mlirSamples = mlirResult.samples;

var maxLen = Math.max(cSamples.length, mlirSamples.length);
var mismatches = 0;
var firstMismatch = null;
// Frames < 10 are startup transients: the C build (ASYNCIFY) may draw
// the title screen 1-2 frames earlier than MLIR. Tolerate this.
var STARTUP_GRACE = 10;

console.log("frame   c_crc32        mlir_crc32     c_nonzero  mlir_nonzero  match");
console.log("-----   ----------     ----------     ---------  ------------  -----");

for (var i = 0; i < maxLen; i++) {
  var c = cSamples[i];
  var m = mlirSamples[i];

  if (!c) {
    console.log("MLIR has extra sample at index " + i + " (frame " + m.frame + ")");
    mismatches++;
    continue;
  }
  if (!m) {
    console.log("C has extra sample at index " + i + " (frame " + c.frame + ")");
    mismatches++;
    continue;
  }

  var frameMatch = c.frame === m.frame;
  var crcMatch = c.crc32 === m.crc32;
  var nonzeroMatch = c.nonzero === m.nonzero;
  var match = frameMatch && crcMatch && nonzeroMatch;

  // Tolerate startup transient (frame < 10).
  var isStartup = c.frame < STARTUP_GRACE;
  if (!match && isStartup) {
    match = true; // Don't count as mismatch
  }

  if (!match) {
    mismatches++;
    if (!firstMismatch) firstMismatch = { c: c, m: m, index: i };
  }

  console.log(
    String(c.frame).padStart(5) + "   " +
    "0x" + c.crc32.toString(16).padStart(8, "0") + "   " +
    "0x" + m.crc32.toString(16).padStart(8, "0") + "   " +
    String(c.nonzero).padStart(9) + "   " +
    String(m.nonzero).padStart(12) + "   " +
    (match ? "OK" : "FAIL") +
    (isStartup && !crcMatch ? " (startup)" : "")
  );
}

console.log("");
console.log("Samples: C=" + cSamples.length + " MLIR=" + mlirSamples.length);
console.log("Mismatches: " + mismatches);

if (mismatches > 0) {
  if (firstMismatch) {
    var fm = firstMismatch;
    console.log("");
    console.log("FIRST MISMATCH at sample index " + fm.index + ":");
    console.log("  C:    frame=" + fm.c.frame + " crc32=0x" + fm.c.crc32.toString(16) + " nonzero=" + fm.c.nonzero);
    console.log("  MLIR: frame=" + fm.m.frame + " crc32=0x" + fm.m.crc32.toString(16) + " nonzero=" + fm.m.nonzero);
  }
  process.exit(1);
}

console.log("ALL SAMPLES MATCH");
process.exit(0);
