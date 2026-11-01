# TASK D3 - Install and run TaoPat as a systemd service

Goal: TaoPat runs on `127.0.0.1:APP_PORT` under user `taopat`, auto-restarts, shuts down gracefully, and has a daily DB backup.
Context needed: this file + `DEPLOY_FACTS.md` (`APP_PORT`). Replace `3100` below with `APP_PORT` if different.

Safety: this task creates NEW files/units named `taopat*` and `/opt/taopat*` only. It must not touch the other project.
Before step 1, re-check that `APP_PORT` is still free: `sudo ss -ltnH "sport = :3100" | grep -q . && echo BUSY || echo free`.

## Step 1 - System user and directories

```bash
id taopat >/dev/null 2>&1 || sudo useradd --system --home-dir /opt/taopat --shell /usr/sbin/nologin taopat
sudo mkdir -p /opt/taopat /opt/taopat/data /opt/taopat-node
sudo chown -R taopat:taopat /opt/taopat
```

## Step 2 - Dedicated Node 22 (isolated from the other project)

Requires `xz` (`sudo apt-get install -y xz-utils` or `sudo dnf install -y xz`).

```bash
ARCH=$(uname -m); case "$ARCH" in x86_64) NA=x64;; aarch64) NA=arm64;; *) echo "unsupported arch $ARCH"; exit 1;; esac
cd /tmp
curl -fsSLO https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt
FILE=$(grep -o "node-v[0-9.]*-linux-$NA\.tar\.xz" SHASUMS256.txt | head -1)
curl -fsSLO "https://nodejs.org/dist/latest-v22.x/$FILE"
grep " $FILE\$" SHASUMS256.txt | sha256sum -c -        # must print: OK
sudo tar -xJf "$FILE" -C /opt/taopat-node --strip-components=1
/opt/taopat-node/bin/node -v                            # expect v22.x
```

Reference: https://nodejs.org/en/download (checksum file is signed by the Node release team; the check above verifies the download against it).

## Step 3 - Copy the app (from `SRC_DIR` to `APP_DIR`)

```bash
cd ~/taopat-src      # = SRC_DIR
sudo rsync -a \
  --exclude node_modules --exclude data --exclude .env --exclude .git --exclude public1 \
  --exclude repomix-output.xml --exclude 'TASK_*.md' --exclude 'DEPLOY_*.md' \
  --exclude MASTER_PROMPT.md --exclude README_FIRST.md --exclude '.env.production.example' \
  ./ /opt/taopat/
sudo chown -R taopat:taopat /opt/taopat
```

(Excluded paths are protected from deletion; no `--delete` is used on purpose.) If `rsync` is missing, install it or use `sudo cp -a` for the same file set.

## Step 4 - Install dependencies

```bash
sudo -u taopat -H bash -c 'cd /opt/taopat && export PATH=/opt/taopat-node/bin:$PATH && \
  if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi'
```

`better-sqlite3` is a native module. It normally installs a prebuilt binary. If it falls back to compiling and fails, install build tools
(`sudo apt-get install -y build-essential python3` or `sudo dnf groupinstall -y "Development Tools" && sudo dnf install -y python3`) and rerun.
Verify: `sudo -u taopat /opt/taopat-node/bin/node -e "require('/opt/taopat/node_modules/better-sqlite3'); console.log('sqlite ok')"`.

## Step 5 - Environment file

```bash
sudo install -o taopat -g taopat -m 640 /dev/null /opt/taopat/.env
sudo tee /opt/taopat/.env >/dev/null <<'EOF'
PORT=3100
HOST=127.0.0.1
TRUST_PROXY=cloudflare
ALLOWED_ORIGINS=https://taopat.deni26.games
EOF
```

## Step 6 - systemd unit

Create `/etc/systemd/system/taopat.service` (check it does not exist first; if it does, stop and ask the human):

```ini
[Unit]
Description=TaoPat (Node.js + Socket.IO)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=taopat
Group=taopat
WorkingDirectory=/opt/taopat
ExecStart=/opt/taopat-node/bin/node server.js
Restart=on-failure
RestartSec=3
# Graceful stop: SIGTERM -> app saves + checkpoints + closes SQLite (3 s internal timeout).
KillSignal=SIGTERM
TimeoutStopSec=15
# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/taopat/data
# Keep a runaway process from starving the other project
MemoryMax=400M
LimitNOFILE=8192

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now taopat
sleep 2
systemctl is-active taopat                         # expect: active
journalctl -u taopat -n 30 --no-pager              # expect the "TAP CHARACTER SERVER" banner
curl -s http://127.0.0.1:3100/healthz              # expect: ok
sudo ss -ltnp | grep 3100                          # expect Local address 127.0.0.1:3100 (NOT 0.0.0.0)
```

If the banner shows a port/host different from `.env`, `config.js` is not reading `/opt/taopat/.env`: check ownership/permissions and the `WorkingDirectory`.

## Step 7 - Graceful-shutdown check (this verifies the SQLite "connection is not open" fix on the real box)

```bash
sudo systemctl restart taopat; sleep 2
journalctl -u taopat --since "-30s" --no-pager | grep -E "Saving database|Database saved|not open|Shutdown error"
```

Expect exactly one `Saving database...` and one `Database saved.`; expect NO `not open` and no `Shutdown error`.

## Step 8 - Daily backup (systemd timer)

`/etc/systemd/system/taopat-backup.service`:

```ini
[Unit]
Description=TaoPat SQLite backup

[Service]
Type=oneshot
User=taopat
Group=taopat
WorkingDirectory=/opt/taopat
ExecStart=/opt/taopat-node/bin/node scripts/backup-db.js
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/opt/taopat/data
```

`/etc/systemd/system/taopat-backup.timer`:

```ini
[Unit]
Description=Daily TaoPat SQLite backup

[Timer]
OnCalendar=*-*-* 03:30:00
RandomizedDelaySec=600
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now taopat-backup.timer
sudo systemctl start taopat-backup.service     # run once now
ls -l /opt/taopat/data/backups/                # expect one tapgame-*.db
systemctl list-timers taopat-backup.timer --no-pager
```

(Backups live on the same disk. For disaster recovery, copy `/opt/taopat/data/backups/` off the instance, e.g. to S3, later. Not required now.)

## Step 9 - OPTIONAL: bring the local database

Only if the human wants the local pat counts on the server (local data is probably test data; default is to start fresh).
On the local PC, stop the local server with Ctrl+C (graceful shutdown truncates the WAL), then copy ONLY `data/tapgame.db` to the EC2 (`scp`).
Then on the EC2:

```bash
sudo systemctl stop taopat
sudo -u taopat cp -n /opt/taopat/data/tapgame.db /opt/taopat/data/tapgame.db.bak 2>/dev/null || true
sudo install -o taopat -g taopat -m 640 ~/tapgame.db /opt/taopat/data/tapgame.db
sudo rm -f /opt/taopat/data/tapgame.db-wal /opt/taopat/data/tapgame.db-shm
sudo systemctl start taopat
```

The server runs its own additive migration on start and writes a backup in `data/backups/` first.

## Done when

`taopat` is `active`, `/healthz` returns `ok`, the listener is `127.0.0.1:APP_PORT`, restart shows one clean save, and one backup file exists.
Append to `DEPLOY_FACTS.md`: `D3: done (service=taopat, port=<APP_PORT>, node=/opt/taopat-node, backup timer on)`.
