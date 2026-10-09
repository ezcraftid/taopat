const fs = require("fs");
const html = fs.readFileSync("public/index.html", "utf8");
const ids = [
  "character","characterStage","characterImg","characterFallback",
  "patHand","patHandSprite","patHandSvg","fxRing","muteBtn",
  "userTaps","userTPS","connectionDot","connectionText",
  "board","boardToggle","topFlag","topTaps",
  "myRegion","myRegionFlag","regionTaps","regionTPS",
  "globalTaps","globalTPS","leaderboard"
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
if (ok) console.log("All required IDs and .status found");
