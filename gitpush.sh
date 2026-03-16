#!/usr/bin/env bash
# gitpush.sh — commit and push with stored token
# Usage: bash gitpush.sh "commit message"
# First run will prompt for token and save it.

set -e

REPO="marctew/proxmox-admin"
TOKEN_FILE="$HOME/.proxmox-admin-token"

# ── Load or prompt for token ──────────────────────────────────────────────────
if [[ -f "$TOKEN_FILE" ]]; then
  TOKEN=$(cat "$TOKEN_FILE")
else
  echo "No token found. Enter your GitHub Personal Access Token:"
  read -rs TOKEN
  echo "$TOKEN" > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
  echo "Token saved to $TOKEN_FILE"
fi

# ── Set remote URL with token embedded ───────────────────────────────────────
git remote set-url origin "https://marctew:${TOKEN}@github.com/${REPO}.git"

# ── Commit & push ─────────────────────────────────────────────────────────────
MSG="${1:-update}"

git add -A
git commit -m "$MSG" || echo "(nothing new to commit)"
git push -u origin main

echo ""
echo "Done — pushed to github.com/${REPO}"
