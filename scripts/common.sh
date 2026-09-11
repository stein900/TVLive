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
STATE_DIR="$HOME/.config/tvlive"

if [[ -f "$CONF_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$CONF_FILE"
fi

PORT="${PORT:-5000}"
CDP_PORT="${CDP_PORT:-9222}"
BRAVE_PROFILE_DIR="${BRAVE_PROFILE_DIR:-$HOME/.config/tvlive-brave}"
TV_HOME_URL="${TV_HOME_URL:-http://127.0.0.1:${PORT}/tv}"
# Page de boot locale : logo TVLive pendant que le serveur démarre, puis bascule sur l'accueil
BOOT_PAGE="file://${TVLIVE_DIR}/session/boot.html?to=${TV_HOME_URL}"
PYTHON="$TVLIVE_DIR/venv/bin/python"
export DISPLAY="${DISPLAY:-:0}"

mkdir -p "$LOG_DIR" "$STATE_DIR"

tvlive_server_up() {
  curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:${PORT}/api/ping" 2>/dev/null
}

tvlive_ensure_server() {
  if tvlive_server_up; then
    return 0
  fi

  if systemctl --user is-active tvlive.service &>/dev/null; then
    for _ in $(seq 1 30); do
      tvlive_server_up && return 0
      sleep 0.5
    done
  fi

  if [[ -x "$PYTHON" ]]; then
    cd "$TVLIVE_DIR" || return 1
    nohup "$PYTHON" app.py >>"$LOG_DIR/server.log" 2>&1 &
    for _ in $(seq 1 40); do
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

tvlive_init_brave_profile() {
  bash "$TVLIVE_DIR/scripts/init-brave-profile.sh"
}

# Premier navigateur Chromium disponible (Brave en priorité)
tvlive_browser_bin() {
  local b
  for b in brave-browser brave-browser-stable brave chromium chromium-browser google-chrome; do
    if command -v "$b" &>/dev/null; then
      echo "$b"
      return 0
    fi
  done
  return 1
}

# Drapeaux « box TV » : kiosque plein écran, aucun bandeau, pas de trousseau,
# port DevTools local pour que le serveur ouvre / ferme les onglets.
tvlive_browser_args() {
  echo "--user-data-dir=${BRAVE_PROFILE_DIR}"
  echo "--no-first-run"
  echo "--no-default-browser-check"
  echo "--disable-session-crashed-bubble"
  echo "--hide-crash-restore-bubble"
  echo "--disable-restore-session-state"
  echo "--password-store=basic"
  echo "--remote-debugging-port=${CDP_PORT}"
  echo "--remote-allow-origins=*"
  echo "--kiosk"
  echo "--start-fullscreen"
  echo "--start-maximized"
  echo "--noerrdialogs"
  echo "--disable-infobars"
  echo "--disable-features=Translate,TranslateUI,MediaRouter"
  echo "--autoplay-policy=no-user-gesture-required"
  echo "--overscroll-history-navigation=0"
  echo "--disable-pinch"
  echo "--check-for-update-interval=31536000"
}

tvlive_close_browser() {
  export DISPLAY="${DISPLAY:-:0}"
  # Ne tuer que le Brave du profil TVLive (pas votre Brave personnel)
  pkill -f "user-data-dir=${BRAVE_PROFILE_DIR}" 2>/dev/null || true
  pkill -f "${BRAVE_PROFILE_DIR}" 2>/dev/null || true
}
# Ancien nom, conservé pour compatibilité
tvlive_close_brave() { tvlive_close_browser; }

# Lance le navigateur AU PREMIER PLAN (exec) — utilisé par scripts/tv-browser.sh
tvlive_run_browser() {
  local url="${1:-$BOOT_PAGE}"
  local bin
  bin="$(tvlive_browser_bin)" || {
    echo "Navigateur introuvable (brave-browser). Voir install.sh." >&2
    return 127
  }
  tvlive_init_brave_profile >/dev/null 2>&1 || true
  local -a args=("$bin")
  while IFS= read -r flag; do
    args+=("$flag")
  done < <(tvlive_browser_args)
  exec "${args[@]}" "$url"
}

# Mode TV depuis le bureau (double-clic) : ferme l'ancien Brave TVLive, relance l'accueil
tvlive_open_tv_mode() {
  tvlive_disable_screensaver
  tvlive_close_browser
  sleep 0.3
  bash "$TVLIVE_DIR/scripts/tv-browser.sh" "${1:-}" >>"$LOG_DIR/brave.log" 2>&1 &
}

# Commande de la session bureau classique (pour « Mode PC (une fois) »)
tvlive_desktop_session_cmd() {
  if [[ -n "${DESKTOP_SESSION_CMD:-}" ]]; then
    echo "$DESKTOP_SESSION_CMD"
    return 0
  fi
  local c
  for c in cinnamon-session-cinnamon startxfce4 mate-session startplasma-x11 gnome-session; do
    if command -v "$c" &>/dev/null; then
      echo "$c"
      return 0
    fi
  done
  local f
  for f in /usr/share/xsessions/*.desktop; do
    [[ -f "$f" ]] || continue
    [[ "$f" == *tvlive* ]] && continue
    grep -m1 '^Exec=' "$f" | cut -d= -f2-
    return 0
  done
  return 1
}
