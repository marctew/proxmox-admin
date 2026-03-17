# Proxmox Admin Panel

A self-hosted web UI for managing Proxmox VE hosts, LXC containers and VMs.

**Features**
- Add multiple Proxmox hosts
- Start / stop / reboot / reset / suspend / resume guests
- Live apt update streaming for LXC containers
- Port scan guests via `ss -tlnp`
- Auto selfh.st icon lookup from container/VM names
- Passphrase + TOTP (2FA) authentication
- Accent colour and font-size theming

## Install (Ubuntu 22.04 / 24.04)

```bash
wget -qO install.sh https://raw.githubusercontent.com/marctew/proxmox-admin/main/install.sh && bash install.sh
```

Then open `http://YOUR-SERVER-IP:7320` and follow the setup screen.

## Update

```bash
wget -qO install.sh https://raw.githubusercontent.com/marctew/proxmox-admin/main/install.sh && bash install.sh --update
```

## Reset 2FA

```bash
rm /opt/proxmox-admin/config/auth.json
# Refresh browser to re-run setup
```

## Port

Default: **7320**. Change in `docker-compose.yml` if needed.
