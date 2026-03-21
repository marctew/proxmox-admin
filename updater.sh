#!/bin/bash
# Proxmox Admin Panel — host-side update watcher
# Runs on the HOST (not in Docker) and watches for update requests from the panel
# Start with: nohup bash /opt/proxmox-admin/updater.sh &

INSTALL_DIR="/opt/proxmox-admin"
FLAG_FILE="$INSTALL_DIR/config/.update-requested"
LOG_FILE="$INSTALL_DIR/config/update.log"

echo "[updater] Watcher started at $(date)" >> "$LOG_FILE"

while true; do
  if [[ -f "$FLAG_FILE" ]]; then
    rm -f "$FLAG_FILE"
    echo "[updater] Update requested at $(date)" >> "$LOG_FILE"
    bash "$INSTALL_DIR/install.sh" --update >> "$LOG_FILE" 2>&1
    echo "[updater] Update finished at $(date)" >> "$LOG_FILE"
  fi
  sleep 5
done
