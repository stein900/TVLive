#!/usr/bin/env bash
# Fonctions partagées TVLive

_tvlive_root() {
  local src="${BASH_SOURCE[0]}"
  while [[ -L "$src" ]]; do
    src="$(readlink "$src")"
  done
  dirname "$(cd "$(dirname "$src")/.." && pwd)"
}

TVLIVE_DIR="${TVLIVE_DIR:-$(_tvlive_root)}"
CONF_FILE="$TVLIVE_DIR/tvlive.conf"
LOG_DIR="$TVLIVE_DIR/logs"

if [[ -f "$CONF_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$CONF_FILE"
fi

PORT="${PORT:-5000}"
KIOSK_URL="${KIOSK_URL:-https://anime-sama.to/}"
PYTHON="$TVLIVE_DIR/venv/bin/python"
export DISPLAY="${DISPLAY:-:0}"

mkdir -p "$LOG_DIR"

tvlive_server_up() {
  curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:${PORT}/" 2>/dev/null
}

tvlive_ensure_server() {
  if tvlive_server_up; then
    return 0
  fi

  if systemctl --user is-active tvlive.service &>/dev/null; then
    for _ in $(seq 1 20); do
      tvlive_server_up && return 0
      sleep 0.5
    done
  fi

  if [[ -x "$PYTHON" ]]; then
    cd "$TVLIVE_DIR"
    nohup "$PYTHON" app.py >>"$LOG_DIR/server.log" 2>&1 &
    for _ in $(seq 1 20); do
      tvlive_server_up && return 0
      sleep 0.5
    done
  fi

  echo "Erreur : impossible de démarrer le serveur TVLive." >&2
  return 1
}

tvlive_disable_screensaver() {
  command -v xset &>/dev/null || return 0
  xset s off 2>/dev/null || true
  xset -dpms 2>/dev/null || true
  xset s noblank 2>/dev/null || true
}

tvlive_open_tv_mode() {
  tvlive_disable_screensaver

  local brave="brave-browser"
  command -v "$brave" &>/dev/null || brave="brave-browser-stable"
  command -v "$brave" &>/dev/null || {
    echo "Brave introuvable." >&2
    return 1
  }

  # Une seule fenêtre kiosk (relance si déjà ouverte)
  pkill -f "${brave}.*--kiosk" 2>/dev/null || true
  sleep 0.3

  "$brave" \
    --kiosk \
    --start-fullscreen \
    --no-first-run \
    --disable-infobars \
    --overscroll-history-navigation=0 \
    "$KIOSK_URL" \
    >>"$LOG_DIR/brave.log" 2>&1 &
}
