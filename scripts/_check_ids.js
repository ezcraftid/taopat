const fs = require("fs");
const path = require("path");
// Resolve relative to this script, not the current working directory.
const html = fs.readFileSync(
  path.join(__dirname, "..", "public", "index.html"),
  "utf8"
);

// IDs referenced by app.js / fx.js / game.js / music.js / menu.js.
const ids = [
  "character","characterStage","characterImg","characterFallback",
  "patHand","patHandSprite","fxRing","fxLayer","muteBtn","musicBtn",
  "userTaps","userTPS","connectionDot","connectionText",
  "board","boardToggle","topFlag","topTaps",
  "myRegion","myRegionFlag","regionTaps","regionTPS",
  "globalTaps","globalTPS","leaderboard",
  "menu","menuBtn","menuPanel","boardMenuBtn","creatorLink",
  "musicToast","musicToastTitle","recordBtn","record","recordScrim",
  "recordClose","recordStats","recordStamps"
];

let ok = true;
for (const id of ids) {
  if (!html.includes(`id="${id}"`)) {
    console.log("MISSING: " + id);
    ok = false;
  }
}

if (!html.includes('class="status"')) {
  console.log("MISSING: .status element");
  ok = false;
}

// Duplicate ID detection.
const found = html.match(/id="[^"]+"/g) || [];
const counts = {};
for (const match of found) {
  counts[match] = (counts[match] || 0) + 1;
}
for (const [key, value] of Object.entries(counts)) {
  if (value > 1) {
    console.log(`DUPLICATE: ${key} x${value}`);
    ok = false;
  }
}

if (ok) console.log("All required IDs present exactly once and .status found");
process.exit(ok ? 0 : 1);
