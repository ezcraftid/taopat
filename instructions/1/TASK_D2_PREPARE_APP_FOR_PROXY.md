# TASK D2 - Prepare TaoPat for running behind Cloudflare Tunnel

Goal: three small, low-risk code changes plus a backup script. Work in `SRC_DIR`. Context needed: this file + `DEPLOY_FACTS.md` (for `APP_PORT`).

Why (professional review notes):
- A load balancer/tunnel needs a cheap health endpoint (`/healthz`) that turns 503 during shutdown.
- `express.static` currently sends no cache headers. Behind Cloudflare, JS/CSS must revalidate (no stale code after deploy) while heavy media (audio/images/fonts) should be cached.
- Client IP: with `HOST=127.0.0.1` and `TRUST_PROXY=cloudflare`, `lib/guard.js` uses `CF-Connecting-IP`. This is safe ONLY because the app is reachable exclusively through the tunnel. Do not set `cloudflare` mode if the port is ever exposed directly.

Do NOT touch `public1/`. Do NOT change Socket.IO event names.

## Step 1 - Health endpoint and cache headers in `server.js`

Find this block:

```js
// Only public/ is exposed. The SQLite database lives in ../data, outside this
// directory, so it can never be served as a static file.
app.use(
    express.static(
        PUBLIC_DIR
    )
);
```

Replace it with:

```js
// Health check for the tunnel / monitoring. 503 while shutting down.
app.get("/healthz", (req, res) => {

    res.set("Cache-Control", "no-store");

    if (shuttingDown || dbClosed) {
        return res.status(503).type("text/plain").send("stopping");
    }

    res.type("text/plain").send("ok");
});

// Only public/ is exposed. The SQLite database lives in ../data, outside this
// directory, so it can never be served as a static file.
// Code (html/js/css) must revalidate so a deploy is visible immediately;
// heavy media is cached for a week (rename a file to bust its cache).
app.use(
    express.static(PUBLIC_DIR, {
        etag: true,
        setHeaders(res, filePath) {

            if (/\.(png|jpe?g|gif|webp|mp3|ogg|woff2)$/i.test(filePath)) {
                res.setHeader("Cache-Control", "public, max-age=604800");
            } else {
                res.setHeader("Cache-Control", "no-cache");
            }
        }
    })
);
```

`shuttingDown` and `dbClosed` are module-level `let` variables declared earlier in the same file, so they are in scope.

## Step 2 - Startup warning for a risky proxy setup

Find the final `server.listen(listenOptions, () => {` callback. Immediately BEFORE `const listenOptions = { port: PORT };` add:

```js
if (TRUST_PROXY === "cloudflare" && HOST !== "127.0.0.1" && HOST !== "::1") {
    console.warn(
        "WARNING: TRUST_PROXY=cloudflare but HOST is not loopback. " +
        "Anyone who can reach this port directly can spoof CF-Connecting-IP. " +
        "Set HOST=127.0.0.1 when using Cloudflare Tunnel."
    );
}
```

## Step 3 - Add `/healthz` to the URL checker

In `_check_urls.js`, add `"/healthz",` as the second entry of the `urls` array (after `"/"`).

## Step 4 - DB backup script (online-safe, uses SQLite backup API)

Create `scripts/backup-db.js`:

```js
// scripts/backup-db.js
// Online, consistent backup of data/tapgame.db using better-sqlite3's backup API.
// Safe while the server is running (WAL). Keeps the newest KEEP backups.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const KEEP = Number(process.env.BACKUP_KEEP) || 14;
const root = path.join(__dirname, "..");
const source = path.join(root, "data", "tapgame.db");
const dir = path.join(root, "data", "backups");

if (!fs.existsSync(source)) {
    console.error("No database at", source);
    process.exit(1);
}

fs.mkdirSync(dir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dest = path.join(dir, `tapgame-${stamp}.db`);
const db = new Database(source, { fileMustExist: true });

db.backup(dest)
    .then(() => {
        db.close();

        const files = fs.readdirSync(dir)
            .filter((name) => /^tapgame-.*\.db$/.test(name))
            .sort();

        for (const name of files.slice(0, Math.max(0, files.length - KEEP))) {
            fs.unlinkSync(path.join(dir, name));
        }

        console.log("Backup written:", dest);
    })
    .catch((error) => {
        try { db.close(); } catch (_) { /* ignore */ }
        console.error("Backup failed:", error.message);
        process.exit(1);
    });
```

## Step 5 - Production `.env` template

Create `.env.production.example` in `SRC_DIR` (replace `3100` with `APP_PORT` from `DEPLOY_FACTS.md`):

```
# Used on the EC2 instance. Copy to /opt/taopat/.env (mode 640, owner taopat).
PORT=3100
HOST=127.0.0.1
TRUST_PROXY=cloudflare
ALLOWED_ORIGINS=https://taopat.deni26.games
```

Confirm `.gitignore` already ignores `.env` (it does) and does NOT ignore `.env.production.example`.

## Step 6 - Verify (run and show output)

```bash
node --check server.js
node --check scripts/backup-db.js
npm test
```

All tests must pass (the existing suites do not need `npm install`). Then, only if dependencies are installed locally, a quick smoke test:

```bash
PORT=3999 HOST=127.0.0.1 node server.js &   # then:
curl -si http://127.0.0.1:3999/healthz | head -5      # expect 200 + "ok"
curl -sI http://127.0.0.1:3999/js/app.js | grep -i cache-control   # expect no-cache
curl -sI http://127.0.0.1:3999/assets/img/tao-base.png | grep -i cache-control   # expect max-age=604800
kill -TERM %1     # expect exactly one "Database saved." in the output
```

If dependencies are not installed here, skip the smoke test and say so; it is repeated on the real service in D5.

## Done when

`npm test` passes, the three `node --check` commands succeed, and you have appended to `DEPLOY_FACTS.md`: `D2: done (healthz, cache headers, backup script, .env.production.example)`.
