# Proxmox Admin Panel

A self-hosted web UI for managing Proxmox VE hosts, LXC containers and VMs — with automated update checking, Home Assistant integration, and a mobile-friendly interface.

## Features

**Host & Guest Management**
- Add multiple Proxmox hosts
- Start / stop / reboot / shutdown / reset guests
- Live resource stats (CPU, RAM, disk, uptime)
- Tag-based grouping with collapsible groups
- Search and filter by type (All / VMs / LXCs / Updates pending)
- Amber dot indicator on containers with pending updates

**Update Management**
- Scheduled daily apt update checks across all LXC containers (cron-based)
- Manual "Run Check Now" with live x/y progress counter and cancel button
- Per-container update modal showing cached results — no repeated SSH checks
- One-click apt upgrade with live terminal output and completion banner
- Cache cleared automatically after a successful upgrade
- Update check history in admin (timestamp, checked, updates found, duration, outcome)
- Phased/held-back packages correctly excluded via `apt-get upgrade --dry-run`

**Home Assistant Integration**
- Connect via URL + Long-Lived Access Token (stored locally, never pushed to git)
- Sensors pushed automatically after every check
- Per-host sensors: `proxmoxadminpanel_{hostname}_containers_with_updates`, `_containers_checked`, `_last_check`
- Global sensors: `proxmoxadminpanel_total_containers_with_updates`, `_total_containers_checked`, `_last_check`, `_last_check_trigger`, `_last_check_outcome`, `_last_check_duration_seconds`

**Resource Graphs**
- Live sparkline graphs for CPU, memory and network on every running guest
- 1h / 24h / 7d timeframes
- Loads on demand when you expand a guest card
- Responsive — stacks vertically on mobile

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

## Update

```bash
wget -qO install.sh https://raw.githubusercontent.com/marctew/proxmox-admin/main/install.sh && bash install.sh --update
```

## Manual rebuild (clears cache)

```bash
cd /opt/proxmox-admin
docker compose down && docker compose build --no-cache && docker compose up -d
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
```

## Port

Default: **7320**. Change in `docker-compose.yml` if needed.

## Config files (never committed to git)

| File | Purpose |
|------|---------|
| `config/auth.json` | Passphrase hash + TOTP secret |
| `config/proxmox-hosts.json` | Proxmox host credentials |
| `config/scheduler.json` | Update check schedule + concurrency |
| `config/update-cache.json` | Latest update check results |
| `config/update-history.json` | Check run history |
| `config/ha-config.json` | Home Assistant URL + token |
| `.env` | Session secret |
