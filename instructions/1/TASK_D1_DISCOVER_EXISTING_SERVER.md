# TASK D1 - Discover the existing server (READ-ONLY)

Goal: learn what already runs on this EC2 (the "other project", ports, Node, cloudflared, web server), choose a free port
for TaoPat, and record everything in `DEPLOY_FACTS.md`. **Change nothing on the system in this task.**

Context needed: only this file.

## Step 1 - Create the discovery script

Write this to `/tmp/discover.sh` (not into the repo). It never prints environment variables and redacts tokens.

```bash
#!/usr/bin/env bash
# READ-ONLY inventory. Safe to run repeatedly.
set -u
redact() { sed -E 's/(--token[ =])[^ ]+/\1***REDACTED***/Ig; s/(TUNNEL_TOKEN=)[^ ]+/\1***REDACTED***/g; s/[A-Za-z0-9+\/=_-]{40,}/***REDACTED***/g'; }

echo "## SYSTEM"
. /etc/os-release; echo "$PRETTY_NAME | arch=$(uname -m) | cpus=$(nproc) | user=$(whoami)"
free -m | awk 'NR==2{print "ram_mb total="$2" used="$3" avail="$7}'
df -h / | awk 'NR==2{print "disk_root used="$5" free="$4}'

echo; echo "## NODE ON THIS HOST"
command -v node >/dev/null && echo "node=$(node -v) path=$(command -v node)" || echo "node: not in PATH"
command -v npm  >/dev/null && echo "npm=$(npm -v)" || true
ls -d /opt/*node* /usr/local/n* "$HOME"/.nvm 2>/dev/null || true

echo; echo "## LISTENING TCP (local-address process)"
sudo ss -ltnpH | awk '{print $4"  "$6}' | sort -u

echo; echo "## LISTENER DETAILS (pid, user, cwd, cmd)"
for pid in $(sudo ss -ltnpH | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u); do
  cwd=$(sudo readlink "/proc/$pid/cwd" 2>/dev/null)
  cmd=$(ps -o args= -p "$pid" 2>/dev/null | cut -c1-140 | redact)
  echo "pid=$pid user=$(ps -o user= -p "$pid") cwd=$cwd cmd=$cmd"
done

echo; echo "## RUNNING SYSTEMD SERVICES (filtered)"
systemctl list-units --type=service --state=running --no-legend --no-pager | awk '{print $1}' \
 | grep -Ev '^(systemd|dbus|getty|serial|amazon-ssm|chrony|cron|rsyslog|sshd|polkit|snapd|udisks|unattended|multipathd|ModemManager|irqbalance|acpid|auditd|NetworkManager|network|user@|ec2|cloud-)' || true

echo; echo "## PROCESS MANAGERS / CONTAINERS (names only, no env)"
command -v pm2 >/dev/null && pm2 ls 2>/dev/null || echo "pm2: none for this user"
command -v docker >/dev/null && sudo docker ps --format '{{.Names}}  {{.Image}}  {{.Ports}}' 2>/dev/null || echo "docker: none"

echo; echo "## WEB SERVERS"
for s in nginx apache2 httpd caddy; do systemctl is-active "$s" 2>/dev/null | sed "s/^/$s: /"; done
ls /etc/nginx/conf.d /etc/nginx/sites-enabled 2>/dev/null || true

echo; echo "## CLOUDFLARED"
command -v cloudflared >/dev/null && cloudflared --version || echo "cloudflared: not installed"
systemctl list-units --all --no-legend --no-pager 'cloudflared*' 2>/dev/null
systemctl cat cloudflared 2>/dev/null | redact
echo "-- /etc/cloudflared (names)"; sudo ls -l /etc/cloudflared 2>/dev/null || echo "none"
echo "-- ~/.cloudflared (names)";   ls -l "$HOME/.cloudflared" 2>/dev/null || echo "none"
if sudo test -f /etc/cloudflared/config.yml; then echo "-- config.yml"; sudo cat /etc/cloudflared/config.yml; fi

echo; echo "## FREE PORT FOR TAOPAT (first free in 3100-3199)"
for p in $(seq 3100 3199); do
  if ! sudo ss -ltnH "sport = :$p" | grep -q .; then echo "FREE_PORT=$p"; break; fi
done

echo; echo "## EXISTING TAOPAT?"
systemctl list-unit-files --no-legend --no-pager 'taopat*' 2>/dev/null; ls -ld /opt/taopat /opt/taopat-node 2>/dev/null || echo "no taopat dirs yet"
```

Run it: `bash /tmp/discover.sh 2>&1 | tee /tmp/discover.out`

## Step 2 - Identify the other project

For every listener whose `cwd` is NOT `/`, `/usr/*`, `/var/lib/*` (i.e. an app directory):

```bash
ls -1 "<CWD>" | head -30                         # file names only
test -f "<CWD>/package.json" && node -e 'const p=require(process.argv[1]);console.log(p.name,p.version,JSON.stringify((p.scripts||{}).start||""))' "<CWD>/package.json"
```

Do NOT `cat` any `.env`, `*.pem`, `credentials*.json`, or config containing secrets. Names only.
Record: project path, language/runtime, port, who starts it (systemd unit / pm2 / docker / manual), and which hostname/proxy fronts it.

## Step 3 - Decisions to record

- `APP_PORT` = the `FREE_PORT` printed above (never reuse a listening port; also avoid ports in an nginx/Caddy config).
- Node: TaoPat gets its own Node 22 in `/opt/taopat-node` (Task D3) regardless of what exists. Reason: engines `>=20`, and the other project may need a different version.
- Cloudflared state, exactly one of:
  - **A** installed, systemd unit has `--token` or `TUNNEL_TOKEN` (remotely-managed tunnel),
  - **B** installed with `/etc/cloudflared/config.yml` (locally-managed tunnel),
  - **C** not installed.
- Does a web server (nginx/caddy) front the other project? (Informational: TaoPat does not go through it.)
- Resources: if free RAM < 300 MB or disk free < 1 GB, stop and report to the human.

## Step 4 - Write `DEPLOY_FACTS.md` in `SRC_DIR`

Use exactly this template (fill in values; no secrets):

```markdown
# DEPLOY_FACTS
- host: <os> <arch>, ram_avail_mb=<n>, disk_free=<n>
- login_user: <name>   sudo_ok: <yes/no>
- other_project: path=<...> runtime=<...> port=<...> started_by=<systemd:name|pm2|docker|manual> fronted_by=<nginx|caddy|none|cloudflared>
- node_on_host: <version/path or none>
- APP_PORT: <port>
- cloudflared_case: <A|B|C>   service_name=<name or none>   tunnel_id=<id if visible in config.yml, else unknown>
- cloudflared_config_path: <path or none>
- notes: <anything surprising>
```

Also add `DEPLOY_FACTS.md` to `.gitignore` (append one line if absent).

## Done when

`DEPLOY_FACTS.md` exists, every field is filled, and `git status`/system state shows no change other than that file and `.gitignore`.
