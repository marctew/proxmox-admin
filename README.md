# Proxmox Admin Panel

A self-hosted web UI for managing Proxmox VE hosts, LXC containers and VMs — with automated update checking, resource graphs, Home Assistant integration, and a mobile-friendly interface.

## Features

**Host & Guest Management**
- Add multiple Proxmox hosts
- Start / stop / reboot / shutdown / reset / suspend / resume guests
- Live resource stats (CPU, RAM, disk, uptime)
- Tag-based grouping with collapsible groups
- Search and filter by type (All / VMs / LXCs / Updates pending)
- Amber dot indicator on containers with pending updates
- Port scanner per guest

**Resource Graphs**
- Live sparkline graphs for CPU, memory and network on every running guest
- 1h / 24h / 7d timeframes
- Loads on demand when you expand a guest card
- Responsive — stacks vertically on mobile

**Update Management**
- Scheduled daily apt update checks across all LXC containers (cron-based)
- Manual "Run Check Now" with live x/y progress counter and cancel button
- Per-container update modal showing cached results — no repeated SSH checks
- One-click apt upgrade with live terminal output and completion banner
- Cache cleared automatically after a successful upgrade
- Update check history in admin (timestamp, checked, updates found, duration, outcome)
- Phased/held-back packages correctly excluded via `apt-get upgrade --dry-run`

**One-Click Panel Updates**
- Version check polls GitHub hourly — teal dot appears on settings cog when update is available
- "Update now" button in admin page triggers a full rebuild automatically
- Panel goes offline briefly, rebuilds from latest GitHub code, comes back up and reloads
- Powered by a host-side watcher script (`updater.sh`) that runs independently of Docker
- Watcher registered in crontab automatically — survives host reboots

**Home Assistant Integration**
- Connect via URL + Long-Lived Access Token (stored locally, never pushed to git)
- Sensors pushed automatically after every check and after individual LXC updates
- Per-host sensors: `proxmoxadminpanel_{hostname}_containers_with_updates`, `_containers_checked`, `_last_check`
- Global sensors: `proxmoxadminpanel_total_containers_with_updates`, `_total_containers_checked`, `_last_check`, `_last_check_trigger`, `_last_check_outcome`, `_last_check_duration_seconds`

**Security**
- Passphrase + TOTP (2FA) authentication with brute-force lockout
- Hostname confirmation required to delete a host
- Session-based auth with configurable timeout
- Secrets never committed to git (`.gitignore` covers all config files)

**Admin Panel**
- Accent colour and font-size theming
- Configurable update check schedule (hour + concurrency)
- Configurable SSH timeout for update terminal (60s – 15min)
- Enable/disable root SSH on LXC containers
- Home Assistant connection management
- Update check history (last 50 runs)
- One-click panel update with version tracking

**Mobile**
- Responsive layout with stacked nav on small screens
- Two-row guest cards (info + action toolbar)
- Bottom-sheet modals on mobile

---

## Install (Ubuntu 22.04 / 24.04)

```bash
wget -qO install.sh https://raw.githubusercontent.com/marctew/proxmox-admin/main/install.sh && bash install.sh
```

Then open `http://YOUR-SERVER-IP:7320` and follow the setup screen to create your passphrase and scan the TOTP QR code.

The install script automatically starts the update watcher and registers it in crontab for auto-start on reboot.

## Update via UI

When a new version is available a teal dot appears on the settings cog. Go to Admin → the update banner will show the new version. Click **Update now** — the panel will rebuild and reload automatically.

## Manual update

```bash
wget -qO install.sh https://raw.githubusercontent.com/marctew/proxmox-admin/main/install.sh && bash install.sh --update
```

## Manual rebuild (clears cache)

```bash
cd /opt/proxmox-admin
docker compose down && docker compose build --no-cache && docker compose up -d
```

## Update watcher

The update watcher runs on the host (not inside Docker) and handles panel rebuilds triggered from the UI:

```bash
# Check if watcher is running
pgrep -a -f updater.sh

# Start manually if needed
nohup bash /opt/proxmox-admin/updater.sh >> /opt/proxmox-admin/config/update.log 2>&1 &
disown

# View update log
tail -f /opt/proxmox-admin/config/update.log
```

## Reset 2FA

```bash
rm /opt/proxmox-admin/config/auth.json
# Refresh browser to re-run setup
```

## Logs

```bash
cd /opt/proxmox-admin
docker compose logs backend -f
docker compose logs frontend -f
tail -f /opt/proxmox-admin/config/update.log
```

## Port

Default: **7320**. Change in `docker-compose.yml` if needed.

## Versioning

Version is tracked in `backend/package.json`. The running panel checks GitHub hourly and shows an update notification when the remote version is newer. To release a new version, bump the version number in `backend/package.json` and push to main.

## Config files (never committed to git)

| File | Purpose |
|------|---------|
| `config/auth.json` | Passphrase hash + TOTP secret |
| `config/proxmox-hosts.json` | Proxmox host credentials |
| `config/scheduler.json` | Update check schedule + concurrency + SSH timeout |
| `config/update-cache.json` | Latest update check results |
| `config/update-history.json` | Check run history |
| `config/ha-config.json` | Home Assistant URL + token |
| `config/update.log` | Update watcher log |
| `.env` | Session secret |
