# TaoPat -> AWS EC2 via Cloudflare Tunnel: Agent Task Pack

Goal: run TaoPat on an EC2 instance that **already hosts another project**, exposed ONLY through
Cloudflare Tunnel at `https://taopat.deni26.games`. No inbound port is opened, the instance public IP is never used.

```
Browser --HTTPS/WSS--> Cloudflare edge --tunnel (outbound only)--> cloudflared (on EC2)
        --> http://127.0.0.1:APP_PORT --> node server.js (TaoPat, systemd, user "taopat")
```

## Fixed variables (use these exact names/values everywhere)

| Name         | Value                         | Notes                                              |
|--------------|-------------------------------|----------------------------------------------------|
| `DOMAIN`     | `taopat.deni26.games`         | Must be a hostname in a zone on the user's Cloudflare account |
| `SRC_DIR`    | current working dir (`~/taopat-src`) | Where the agent edits code and runs `npm test` |
| `APP_DIR`    | `/opt/taopat`                 | Runtime copy (owned by `taopat`)                   |
| `APP_USER`   | `taopat`                      | System user, no login shell                        |
| `SERVICE`    | `taopat`                      | systemd unit `taopat.service`                      |
| `NODE_DIR`   | `/opt/taopat-node`            | Dedicated Node 22 so the other project's Node is never touched |
| `APP_PORT`   | chosen in Task D1 (default `3100`) | First free port in 3100-3199                  |

## Rules for the agent (small-context protocol)

1. Work on ONE task file at a time, in order. Do not open other task files early.
2. Never read `repomix-output.xml`. Read only the files a task names.
3. After each task, append its results to `DEPLOY_FACTS.md` (created in D1). Later tasks read ONLY that file for context.
4. Do not modify, restart, stop or reconfigure anything belonging to the other project. Read-only inspection only.
5. Never print or store secrets: tunnel tokens, `.env` contents of other projects, process environments, `pm2 jlist`, `docker inspect`. Redact long tokens in anything you paste into `DEPLOY_FACTS.md`.
6. Do not change AWS security groups, firewall rules or system-wide config (nginx, other systemd units). Report instead.
7. Ask the human before: restarting `cloudflared` if it already serves the other project, overwriting any existing file under `/etc`, or running anything with `--delete-*`.
8. TaoPat keeps game state in memory. Run exactly ONE instance. Never use pm2 cluster mode or multiple replicas.
9. Do not claim a check passed unless you ran it and saw the output.

## Task order

1. `TASK_D1_DISCOVER_EXISTING_SERVER.md` - read-only inventory, find the other project, pick a free port
2. `TASK_D2_PREPARE_APP_FOR_PROXY.md` - small code changes in TaoPat (health check, cache headers, `.env`)
3. `TASK_D3_INSTALL_AND_RUN_SYSTEMD.md` - Node, install, systemd service, DB backup timer
4. `TASK_D4_CLOUDFLARE_TUNNEL.md` - attach `taopat.deni26.games` to a tunnel (reuse existing tunnel if present)
5. `TASK_D5_VERIFY_AND_ROLLBACK.md` - end-to-end verification, other project untouched, rollback
6. `TASK_D6_OPTIONAL_CODE_FIXES.md` - optional: finish server-authoritative stamps UI, use `CF-IPCountry`

## Human-only steps (the agent cannot do these)

- Copy the repo to the EC2 as `~/taopat-src` (no `node_modules`, no `data`, no `.env`). Example from your PC:
  `rsync -av --exclude node_modules --exclude data --exclude .env --exclude .git --exclude public1 ./ USER@EC2:~/taopat-src/`
  (use SSH/SSM the way you already reach the instance; no public app port is needed).
- Copy the three music files `music-01.mp3`, `music-02.mp3`, `music-03.mp3` into `public/assets/audio/` (only `music-01.mp3` exists in the snapshot reviewed; missing tracks are skipped silently by `music.js`).
- Cloudflare dashboard actions in D4 (create tunnel / add public hostname) unless the agent has a logged-in `cloudflared` cert.
- Optional: copy your local `data/tapgame.db` (see D3, step 9).

## Known repo facts (already verified from the code snapshot)

- Stack: Node >= 20, Express 5, Socket.IO 4, better-sqlite3 (native module), dotenv, vanilla JS front end in `public/`.
- `public1/` is a legacy copy and is NOT served. Do not deploy it.
- All env vars are read only in `config.js`: `PORT`, `HOST`, `TRUST_PROXY`, `ALLOWED_ORIGINS`, `LIMIT_*`.
- DB file: `<project>/data/tapgame.db` (WAL mode). Shutdown is idempotent and saves on SIGTERM.
- Behind Cloudflare Tunnel the correct env is `HOST=127.0.0.1`, `TRUST_PROXY=cloudflare`, `ALLOWED_ORIGINS=https://taopat.deni26.games`.
