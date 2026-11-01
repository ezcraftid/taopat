# TASK D4 - Publish `taopat.deni26.games` through Cloudflare Tunnel

Goal: route `https://taopat.deni26.games` -> `http://127.0.0.1:APP_PORT` through a Cloudflare Tunnel. No inbound port, no public IP use.
Context needed: this file + `DEPLOY_FACTS.md` (`cloudflared_case`, `APP_PORT`, `cloudflared_config_path`).

Prerequisites (human, Cloudflare dashboard):
- The zone `deni26.games` is active on the user's Cloudflare account.
- No existing DNS record named `taopat` in that zone (a leftover A/CNAME makes tunnel DNS creation fail; delete it first).

Always use `127.0.0.1` (not `localhost`) as the origin: TaoPat listens on IPv4 loopback only, and `localhost` may resolve to `::1`.

Official docs (use them if a command here differs from your installed version):
- Config file / ingress rules: https://developers.cloudflare.com/tunnel/advanced/local-management/configuration-file/
- Linux service: https://developers.cloudflare.com/tunnel/advanced/local-management/as-a-service/linux/
- Remotely-managed tunnels (token): https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/configure-tunnels/remote-management
- Downloads/install: https://developers.cloudflare.com/tunnel/downloads/

Pick the branch matching `cloudflared_case` in `DEPLOY_FACTS.md`.

---

## Case A - cloudflared already running as a remotely-managed tunnel (systemd unit has `--token`)

The hostname list lives in Cloudflare, not on the server. The agent cannot edit it without dashboard access. **Do not restart cloudflared; nothing changes on the server.**
Print this instruction block for the human and wait:

```
Cloudflare Zero Trust dashboard
  Networks > Tunnels (newer UI: Networks > Connectors > Cloudflare Tunnels)
  -> open the EXISTING tunnel (the one already used by the other project) -> Edit
  -> Published application routes / Public Hostname -> Add
       Subdomain : taopat
       Domain    : deni26.games
       Path      : (empty)
       Service   : HTTP   URL: 127.0.0.1:<APP_PORT>
  -> Save
```

Cloudflare creates the proxied DNS CNAME (`taopat` -> `<tunnel-id>.cfargotunnel.com`) automatically.
Ordering note: put the new hostname rule so it does not shadow the existing project's hostnames (rules match by hostname, so a specific hostname is safe).

## Case B - cloudflared running with a local `config.yml` (locally-managed tunnel)

1. Back up: `sudo cp -a <config path> <config path>.bak-$(date +%F-%H%M)`
2. Edit the file. Insert the new rule **above** the final catch-all (`- service: http_status:404`). A config with ingress rules MUST end with a catch-all rule.

```yaml
ingress:
  # ...existing rules for the other project stay exactly as they are...
  - hostname: taopat.deni26.games
    service: http://127.0.0.1:3100
  - service: http_status:404
```

3. Validate and test routing (these commands change nothing):

```bash
cloudflared tunnel --config <config path> ingress validate
cloudflared tunnel --config <config path> ingress rule https://taopat.deni26.games
# expect: Matched rule #N / hostname: taopat.deni26.games / service: http://127.0.0.1:3100
```

4. Create the DNS record (needs the cert from `cloudflared tunnel login`; if there is no `cert.pem`, add a CNAME `taopat` -> `<TUNNEL_ID>.cfargotunnel.com` with Proxy ON in the Cloudflare DNS dashboard instead):

```bash
cloudflared tunnel route dns <TUNNEL_NAME_OR_ID> taopat.deni26.games
```

5. **Ask the human before restarting** (this briefly interrupts the other project's traffic through the same tunnel):

```bash
sudo systemctl restart cloudflared
systemctl is-active cloudflared
journalctl -u cloudflared -n 20 --no-pager     # expect "Registered tunnel connection"
```

## Case C - cloudflared not installed

Recommended: a **remotely-managed** tunnel (a token, no credential files on disk).

1. Install cloudflared.
   Debian/Ubuntu:
   ```bash
   sudo mkdir -p --mode=0755 /usr/share/keyrings
   curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
   echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | sudo tee /etc/apt/sources.list.d/cloudflared.list
   sudo apt-get update && sudo apt-get install -y cloudflared
   ```
   Amazon Linux / RHEL family:
   ```bash
   curl -fsSL https://pkg.cloudflare.com/cloudflared.repo | sudo tee /etc/yum.repos.d/cloudflared.repo
   sudo yum install -y cloudflared
   ```
   If either fails, follow https://developers.cloudflare.com/tunnel/downloads/ (the package repo instructions may change). Check: `cloudflared --version`.

2. Human creates the tunnel (dashboard): Networks > Tunnels > Create a tunnel > Cloudflared > name it `ec2-taopat` > choose the OS > **copy the token command**.
3. Human runs the copied command on the EC2 (the token must NOT be pasted into chat, files, or `DEPLOY_FACTS.md`):
   `sudo cloudflared service install <TOKEN>`
4. Same dashboard tunnel > Public Hostname > Add: subdomain `taopat`, domain `deni26.games`, Service `HTTP`, URL `127.0.0.1:<APP_PORT>`. Save.
5. Check: `systemctl is-active cloudflared` -> `active`; `journalctl -u cloudflared -n 20 --no-pager` shows registered connections.

Alternative (locally-managed, only if the human refuses the dashboard flow): `cloudflared tunnel login` -> `cloudflared tunnel create taopat` ->
write `/etc/cloudflared/config.yml` with `tunnel: <UUID>`, `credentials-file: /etc/cloudflared/<UUID>.json` and the ingress block from Case B ->
`cloudflared tunnel route dns taopat taopat.deni26.games` -> `sudo cloudflared service install` -> `sudo systemctl start cloudflared`.

---

## Network facts to report (do NOT change them)

- Tunnels need only OUTBOUND connectivity from the EC2 (TCP/UDP 7844 and 443 to Cloudflare). No inbound security-group rule is needed for TaoPat.
- Report whether the instance's security group currently allows inbound on `APP_PORT`; it should not. The app binds to 127.0.0.1 anyway.

## Cloudflare settings to confirm (human, dashboard, hostname `taopat.deni26.games`)

- Network > WebSockets: ON (this is the default; Socket.IO needs it).
- Speed > Optimization > Rocket Loader: OFF for this hostname (it rewrites scripts and can break `socket.io.js`).
- SSL/TLS mode: any mode works for tunnels (traffic edge -> cloudflared is always encrypted).

## Done when

Case A/C: the public hostname is saved and `cloudflared` is `active`. Case B: ingress validates, DNS exists, service restarted with human approval.
Append to `DEPLOY_FACTS.md`: `D4: done (case=<A|B|C>, hostname=taopat.deni26.games -> 127.0.0.1:<APP_PORT>)`.
