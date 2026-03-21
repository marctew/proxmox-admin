#!/bin/bash
# Proxmox Admin Panel — host-side update watcher
# Runs on the HOST (not in Docker) and watches for update requests from the panel
# Installed via crontab: @reboot nohup bash /opt/proxmox-admin/updater.sh >> /opt/proxmox-admin/config/update.log 2>&1 &

INSTALL_DIR="/opt/proxmox-admin"
FLAG_FILE="$INSTALL_DIR/config/.update-requested"
LOG_FILE="$INSTALL_DIR/config/update.log"
MY_PID=$$

echo "[updater] Watcher started (pid $MY_PID) at $(date)" >> "$LOG_FILE"

while true; do
  if [[ -f "$FLAG_FILE" ]]; then
    rm -f "$FLAG_FILE"
    echo "[updater] Update requested at $(date)" >> "$LOG_FILE"
    # Run install in a subshell — when install.sh kills old watchers it won't kill us
    # because we pass our own PID to exclude
    bash "$INSTALL_DIR/install.sh" --update MY_PID=$MY_PID >> "$LOG_FILE" 2>&1
    echo "[updater] Update finished at $(date)" >> "$LOG_FILE"
  fi
  sleep 5
done
