# TASK D5 - End-to-end verification, other-project safety check, rollback

Context needed: this file + `DEPLOY_FACTS.md`. Show real command output for every check; mark each PASS/FAIL.

## Check 1 - App is local-only

```bash
curl -s http://127.0.0.1:3100/healthz                 # PASS: ok
sudo ss -ltnp | grep ":3100"                          # PASS: 127.0.0.1:3100 only
systemctl is-active taopat cloudflared                # PASS: active / active
```

## Check 2 - Public HTTPS via the tunnel

```bash
curl -sI https://taopat.deni26.games/ | head -5                          # PASS: HTTP/2 200, server: cloudflare
curl -s  https://taopat.deni26.games/healthz                              # PASS: ok
curl -s  https://taopat.deni26.games/api/status                           # PASS: JSON with globalTaps
curl -sI https://taopat.deni26.games/js/app.js | grep -i cache-control    # PASS: no-cache
curl -sI https://taopat.deni26.games/assets/audio/music-01.mp3 | head -3  # PASS: 200 (or 404 if the owner has not uploaded it yet - report which)
```

DNS not resolving yet? Wait 1-2 minutes, then `dig +short taopat.deni26.games` (should return Cloudflare IPs, not the EC2 IP).

## Check 3 - WebSocket + real client IP + region

On the EC2, in a throwaway directory (outside the repo):

```bash
mkdir -p /tmp/smoke && cd /tmp/smoke && PATH=/opt/taopat-node/bin:$PATH npm init -y >/dev/null && PATH=/opt/taopat-node/bin:$PATH npm i socket.io-client >/dev/null
cat > ws-smoke.js <<'EOF'
const { io } = require("socket.io-client");
const { randomUUID } = require("node:crypto");
const s = io(process.argv[2], { auth: { clientId: randomUUID() }, transports: ["websocket"] });
const t = setTimeout(() => { console.error("FAIL: timeout (no initialState)"); process.exit(1); }, 10000);
s.on("initialState", (d) => {
  console.log("OK initialState | region:", d.region.code, d.region.name, "| user taps:", d.user && d.user.taps);
  clearTimeout(t); s.close(); process.exit(0);
});
s.on("connect_error", (e) => { console.error("FAIL connect_error:", e.message); process.exit(1); });
EOF
PATH=/opt/taopat-node/bin:$PATH node ws-smoke.js https://taopat.deni26.games
```

PASS: prints `OK initialState`. The region must NOT be `LOCAL`. If it is `LOCAL`, `CF-Connecting-IP` is not reaching the app: check `TRUST_PROXY=cloudflare` in `/opt/taopat/.env`, restart the service, and re-test.
Then confirm the logged IP is the visitor's, not `127.0.0.1`:

```bash
journalctl -u taopat --since "-2min" --no-pager | grep "Connected:"     # PASS: IP shown is not 127.0.0.1
```

(The smoke client never sends taps, so counters are not changed.)

## Check 4 - Browser test (human)

Open `https://taopat.deni26.games` on desktop and phone. Expect: status text "Live", pat counter increases, pat sound plays after the first tap,
the menu opens, "Your record" opens, leaderboard opens, and reloading keeps the lifetime pat total (browser identity in localStorage).
In DevTools > Network, `socket.io/` should show a `101` WebSocket upgrade.

## Check 5 - The other project is unaffected

Re-run `bash /tmp/discover.sh > /tmp/discover.after` and compare with `/tmp/discover.out` from D1:
`diff <(grep -v FREE_PORT /tmp/discover.out) <(grep -v FREE_PORT /tmp/discover.after)`.
PASS: the only differences are the new `taopat`/`cloudflared` entries and the new `127.0.0.1:APP_PORT` listener. The other project's listeners/processes must be unchanged.

## Check 6 - Failure handling

```bash
sudo systemctl kill -s SIGKILL taopat; sleep 5; systemctl is-active taopat      # PASS: active (auto-restart)
```

SIGKILL skips the final save; SQLite WAL keeps the DB consistent, and at most ~1 s of taps (the save interval) is lost. Report that this is expected.

## Rollback (undo everything, other project untouched)

```bash
# 1. Remove the public hostname:
#    Case A/C: dashboard > tunnel > Public Hostname > delete taopat.deni26.games
#    Case B  : sudo cp -a <config>.bak-<stamp> <config>  and ask the human before: sudo systemctl restart cloudflared
# 2. Stop the app:
sudo systemctl disable --now taopat taopat-backup.timer
sudo rm -f /etc/systemd/system/taopat.service /etc/systemd/system/taopat-backup.service /etc/systemd/system/taopat-backup.timer
sudo systemctl daemon-reload
# 3. Keep data unless the human says otherwise:  /opt/taopat/data  (do NOT delete automatically)
```

## Troubleshooting cheat-sheet

| Symptom | Likely cause | Fix |
|---|---|---|
| Cloudflare 502 | app down or wrong port in hostname | `systemctl status taopat`; hostname URL must be `127.0.0.1:<APP_PORT>` |
| Cloudflare 1033 / 530 | `cloudflared` not connected | `journalctl -u cloudflared -n 50`; check outbound 7844/443 |
| Page loads, status stays "Offline" | WebSockets off, or `ALLOWED_ORIGINS` mismatch | Cloudflare Network > WebSockets ON; origin must be exactly `https://taopat.deni26.games` |
| Region is `LOCAL` / everyone shares one IP bucket | `CF-Connecting-IP` missing | `TRUST_PROXY=cloudflare` in `.env`, restart |
| Old JS after deploy | stale browser/CF cache | hard reload; code files send `no-cache`; purge Cloudflare cache for the hostname |
| `better-sqlite3` load error | wrong Node ABI | rerun `npm ci --omit=dev` with `/opt/taopat-node/bin` first in PATH |
| `EADDRINUSE` | port taken after D1 | pick another free port, update `.env` and the tunnel hostname URL |

## Done when

Checks 1-3, 5, 6 pass (4 is human). Append to `DEPLOY_FACTS.md`: `D5: done (<date>, all checks listed with PASS/FAIL)`. Then write a final report: what was installed, paths, ports, how to update (rsync + `npm ci` + `sudo systemctl restart taopat`), and anything still manual.
