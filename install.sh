#!/usr/bin/env bash
# Proxmox Admin Panel — install / update script
# Tested on Ubuntu 22.04 / 24.04
# Usage:
#   bash install.sh            — fresh install
#   bash install.sh --update   — pull latest code and rebuild
#   bash install.sh --dir /opt/proxmox-admin  (custom install path)
set -e

INSTALL_DIR="/opt/proxmox-admin"
REPO_URL="https://github.com/marctew/proxmox-admin.git"
PORT=7320
UPDATE_ONLY=false

# ── Parse args ────────────────────────────────────────────────────────────────
while [[ "$#" -gt 0 ]]; do
  case $1 in
    --update) UPDATE_ONLY=true ;;
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

# ── Compose helper ────────────────────────────────────────────────────────────
get_compose() {
  if docker compose version &>/dev/null 2>&1; then
    echo "docker compose"
  else
    echo "docker-compose"
  fi
}

# ══════════════════════════════════════════════════════════════════════════════
# UPDATE PATH
# ══════════════════════════════════════════════════════════════════════════════
if [[ "$UPDATE_ONLY" == true ]]; then
  heading "Proxmox Admin Panel — Update"

  [[ ! -d "$INSTALL_DIR/.git" ]] && error "No installation found at $INSTALL_DIR. Run without --update to install first."

  # Check if package.json changed before pulling — if so, we need --no-cache
  BEFORE_PKG=$(git -C "$INSTALL_DIR" show HEAD:backend/package.json 2>/dev/null || echo "")

  info "Pulling latest code..."
  git -C "$INSTALL_DIR" pull

  AFTER_PKG=$(cat "$INSTALL_DIR/backend/package.json" 2>/dev/null || echo "")

  COMPOSE=$(get_compose)
  cd "$INSTALL_DIR"

  if [[ "$BEFORE_PKG" != "$AFTER_PKG" ]]; then
    warn "backend/package.json changed — rebuilding without cache to pick up new dependencies..."
    heading "Rebuilding containers (no cache)"
    $COMPOSE build --no-cache
    $COMPOSE up -d
  else
    heading "Rebuilding containers"
    $COMPOSE up -d --build
  fi

  heading "Update complete"
  LAN_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')
  echo -e "\n  ${GREEN}Updated and running at:${NC} ${YELLOW}http://${LAN_IP:-YOUR-SERVER-IP}:${PORT}${NC}\n"
  exit 0
fi

# ══════════════════════════════════════════════════════════════════════════════
# FRESH INSTALL PATH
# ══════════════════════════════════════════════════════════════════════════════
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

# ── 2. Clone repo ─────────────────────────────────────────────────────────────
heading "Fetching application"

if [[ -d "$INSTALL_DIR/.git" ]]; then
  warn "Existing installation found — pulling latest instead..."
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

mkdir -p "$INSTALL_DIR/config"

# ── 4. Build & start ──────────────────────────────────────────────────────────
heading "Building and starting containers"

COMPOSE=$(get_compose)
$COMPOSE up -d --build

# ── 5. Done ───────────────────────────────────────────────────────────────────
heading "Installation complete"

LAN_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')

echo
echo -e "  ${GREEN}Open your browser and go to:${NC}"
echo -e "  ${YELLOW}http://${LAN_IP:-YOUR-SERVER-IP}:${PORT}${NC}"
echo
echo "  Follow the setup screen to create your passphrase and scan the TOTP QR code."
echo
echo "  To update in future:"
echo "    wget -qO install.sh https://raw.githubusercontent.com/marctew/proxmox-admin/main/install.sh && bash install.sh --update"
echo
echo "  To view logs:"
echo "    cd $INSTALL_DIR && $COMPOSE logs -f"
echo
echo "  To reset 2FA:"
echo "    rm $INSTALL_DIR/config/auth.json && refresh browser"
echo
