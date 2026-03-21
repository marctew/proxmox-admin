#!/bin/bash
# Proxmox Admin Panel — host-side update watcher
# Runs on the HOST (not in Docker) and watches for update requests from the panel
# Installed via crontab: @reboot nohup bash /opt/proxmox-admin/updater.sh >> /opt/proxmox-admin/config/update.log 2>&1 &

INSTALL_DIR="/opt/proxmox-admin"
FLAG_FILE="$INSTALL_DIR/config/.update-requested"
LOG_FILE="$INSTALL_DIR/config/update.log"

# Ignore hangup signals so Docker restarts don't kill us
trap '' HUP

echo "[updater] Watcher started (pid $$) at $(date)" >> "$LOG_FILE"

while true; do
  if [[ -f "$FLAG_FILE" ]]; then
    rm -f "$FLAG_FILE"
    echo "[updater] Update requested at $(date)" >> "$LOG_FILE"
    # Run in subshell with signals ignored
    (trap '' HUP; bash "$INSTALL_DIR/install.sh" --update >> "$LOG_FILE" 2>&1)
    echo "[updater] Update finished at $(date)" >> "$LOG_FILE"
  fi
  sleep 5
done
