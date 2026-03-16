# Proxmox Admin Panel

Dark terminal-aesthetic admin panel for managing Proxmox VMs and LXCs, with Termius SSH deep-link integration.

## Quick Start

```bash
git clone / copy this folder
cd proxmox-admin
docker compose up -d
```

Open: **http://your-server:7320**

---

## Features

- **Auto-scan** all nodes, VMs, and LXCs from a Proxmox host via the REST API
- **Actions** per guest: Start / Stop (force) / Shutdown (graceful) / Reboot
- **Resource bars**: CPU %, RAM %, Disk usage, Net I/O
- **SSH via Termius** — one click opens Termius directly to the right host
- **Multi-host** — add as many Proxmox servers as you like
- **Credentials stored locally** in `./config/proxmox-hosts.json` (Docker volume)
- Self-signed cert support (very common on Proxmox)

---

## Termius SSH Deep Links

The SSH button generates a `ssh://user@host:port` URI. Termius intercepts this scheme and opens the connection automatically.

**Requirements:**
- Termius must be installed on the machine you're browsing from
- On macOS/Windows, Termius registers the `ssh://` handler at install time
- On Linux, you may need to register it manually (see Termius docs)

If Termius isn't installed, the link still opens your default SSH handler (e.g. Terminal on macOS).

The SSH user/port are configured **per Proxmox host** when you add it. This connects to the **Proxmox node itself** — for connecting directly into an LXC or VM, you'd need that guest's own IP (you can customise this per-guest in future).

---

## Proxmox Auth

Use `root@pam` with your root password, or create a dedicated API user:

```bash
# On Proxmox node
pveum user add claudeadmin@pve --password yourpassword
pveum aclmod / -user claudeadmin@pve -role PVEAdmin
```

API tokens are also supported — use the token string as the "password" field and `user@realm!tokenid` as the username.

---

## Config

Credentials are persisted in `./config/proxmox-hosts.json` (auto-created). The API never returns passwords over the network — only a `hasPassword: true` flag.

Port: `7320` — change in `docker-compose.yml` if needed.

---

## Dev Mode

```bash
# Backend
cd backend && npm install && node server.js

# Frontend (separate terminal)
cd frontend && npm install && npm run dev
```

Frontend dev server proxies `/api/*` to `localhost:3001`.
