#!/usr/bin/env bash
# Proxmox Admin Panel — install script
# Tested on Ubuntu 22.04 / 24.04
# Usage:
#   bash install.sh
#   bash install.sh --dir /opt/proxmox-admin  (custom install path)
set -e

INSTALL_DIR="/opt/proxmox-admin"
REPO_URL="https://github.com/marctew/proxmox-admin.git"
PORT=7320

# ── Parse args ────────────────────────────────────────────────────────────────
while [[ "$#" -gt 0 ]]; do
  case $1 in
    --dir) INSTALL_DIR="$2"; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
  shift
done

# ── Colours ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${GREEN}[✔]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
error()   { echo -e "${RED}[✘]${NC} $*"; exit 1; }
heading() { echo -e "\n${GREEN}━━━ $* ━━━${NC}"; }

# ── Root check ────────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  error "Please run as root (sudo bash install.sh)"
fi

heading "Proxmox Admin Panel Installer"
echo "Install path : $INSTALL_DIR"
echo "Port         : $PORT"
echo

# ── 1. System packages ────────────────────────────────────────────────────────
heading "Installing prerequisites"

apt-get update -qq

# Git
if ! command -v git &>/dev/null; then
  info "Installing git..."
  apt-get install -y -qq git
else
  info "git already installed"
fi

# Docker
if ! command -v docker &>/dev/null; then
  info "Installing Docker..."
  apt-get install -y -qq ca-certificates curl gnupg lsb-release

  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  echo "deb [arch=$(dpkg --print-architecture) \
    signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu \
    $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  info "Docker installed"
else
  info "Docker already installed"
fi

# Docker Compose (plugin or standalone)
if ! docker compose version &>/dev/null 2>&1; then
  if ! command -v docker-compose &>/dev/null; then
    info "Installing docker-compose-plugin..."
    apt-get install -y -qq docker-compose-plugin
  fi
fi
info "Docker Compose ready"

# openssl (for secret generation)
if ! command -v openssl &>/dev/null; then
  apt-get install -y -qq openssl
fi

# ── 2. Clone / update repo ────────────────────────────────────────────────────
heading "Fetching application"

if [[ -d "$INSTALL_DIR/.git" ]]; then
  warn "Existing installation found at $INSTALL_DIR — pulling latest..."
  git -C "$INSTALL_DIR" pull
else
  info "Cloning repo to $INSTALL_DIR..."
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

# ── 3. Generate .env if missing ───────────────────────────────────────────────
heading "Configuration"

if [[ -f "$INSTALL_DIR/.env" ]]; then
  warn ".env already exists — skipping secret generation"
else
  SECRET=$(openssl rand -hex 32)
  echo "SESSION_SECRET=$SECRET" > "$INSTALL_DIR/.env"
  info "Generated SESSION_SECRET in .env"
fi

# Ensure config dir exists
mkdir -p "$INSTALL_DIR/config"

# ── 4. Build & start ──────────────────────────────────────────────────────────
heading "Building and starting containers"

cd "$INSTALL_DIR"

# Use 'docker compose' (plugin) or fall back to 'docker-compose'
if docker compose version &>/dev/null 2>&1; then
  COMPOSE="docker compose"
else
  COMPOSE="docker-compose"
fi

$COMPOSE up -d --build

# ── 5. Done ───────────────────────────────────────────────────────────────────
heading "Installation complete"

# Try to detect the server's LAN IP
LAN_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')
if [[ -z "$LAN_IP" ]]; then
  LAN_IP="YOUR-SERVER-IP"
fi

echo
echo -e "  ${GREEN}Open your browser and go to:${NC}"
echo -e "  ${YELLOW}http://${LAN_IP}:${PORT}${NC}"
echo
echo "  Follow the setup screen to create your passphrase and scan the TOTP QR code."
echo
echo "  To view logs:"
echo "    cd $INSTALL_DIR && $COMPOSE logs -f"
echo
echo "  To reset 2FA:"
echo "    rm $INSTALL_DIR/config/auth.json && refresh browser"
echo
