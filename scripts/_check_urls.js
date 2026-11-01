const http = require("http");

const urls = [
  "/",
  "/healthz",
  "/css/style.css",
  "/js/app.js",
  "/js/fx.js",
  "/js/game.js",
  "/js/tao-core.js",
  "/js/music.js",
  "/js/menu.js",
  "/assets/img/patpat.png",
  "/assets/img/tao-base.png",
  "/assets/audio/pat.ogg",
  "/assets/audio/pat1.ogg",
  "/assets/audio/pat2.ogg",
  "/assets/audio/pat.mp3",
  "/assets/audio/pat1.mp3",
  "/assets/audio/pat2.mp3",
  "/assets/fonts/ShipporiMinchoB1-ExtraBold.woff2",
  "/assets/fonts/IBMPlexMono-Regular.woff2",
  "/assets/fonts/IBMPlexMono-SemiBold.woff2",
];

let pass = 0, fail = 0;
const { PORT } = require("../config");

async function check(path) {
  return new Promise((resolve) => {
    http.get(`http://localhost:${PORT}${path}`, (res) => {
      res.resume();
      if (res.statusCode === 200) { pass++; console.log(`  OK  ${path}`); }
      else { fail++; console.log(`FAIL  ${path} -> ${res.statusCode}`); }
      resolve();
    }).on("error", (e) => {
      fail++;
      console.log(`ERR   ${path} -> ${e.message}`);
      resolve();
    });
  });
}

(async () => {
  for (const u of urls) await check(u);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
