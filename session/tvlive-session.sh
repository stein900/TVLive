#!/usr/bin/env bash
# Session X « TVLive » : l'écran devient une box TV.
# Pas de bureau, pas de panneau, curseur masqué — seulement Brave plein écran
# sur l'accueil TVLive, relancé automatiquement s'il se ferme.
#
# Installée par install-box.sh (xsession + autologin LightDM).

TVLIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export TVLIVE_DIR
# shellcheck source=../scripts/common.sh
source "$TVLIVE_DIR/scripts/common.sh"

mkdir -p "$LOG_DIR" "$STATE_DIR"
exec >>"$LOG_DIR/session.log" 2>&1
echo "=== Session TVLive : $(date '+%F %T') ==="

DESKTOP_ONCE="$STATE_DIR/desktop-once"
RUN_FLAG="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/tvlive-box-session"

start_desktop_session() {
  local cmd
  cmd="$(tvlive_desktop_session_cmd)" || cmd=""
  if [[ -z "$cmd" ]]; then
    echo "Aucune session bureau trouvée : on reste en mode box."
    return 1
  fi
  echo "Mode PC (une fois) : $cmd"
  rm -f "$RUN_FLAG"
  [[ -n "${WM_PID:-}" ]] && kill "$WM_PID" 2>/dev/null
  [[ -n "${UNCLUTTER_PID:-}" ]] && kill "$UNCLUTTER_PID" 2>/dev/null
  # shellcheck disable=SC2086
  exec $cmd
}

# « Mode PC (une fois) » demandé depuis la télécommande avant le démarrage
if [[ -f "$DESKTOP_ONCE" ]]; then
  rm -f "$DESKTOP_ONCE"
  start_desktop_session || true
fi

touch "$RUN_FLAG"
cleanup() {
  rm -f "$RUN_FLAG"
  [[ -n "${WM_PID:-}" ]] && kill "$WM_PID" 2>/dev/null
  [[ -n "${UNCLUTTER_PID:-}" ]] && kill "$UNCLUTTER_PID" 2>/dev/null
  return 0
}
trap cleanup EXIT

# Écran : jamais d'économiseur ni de mise en veille, fond noir
tvlive_disable_screensaver
command -v xsetroot &>/dev/null && xsetroot -solid '#000000' 2>/dev/null

# Curseur masqué après 1 s d'inactivité
UNCLUTTER_PID=""
if command -v unclutter &>/dev/null; then
  unclutter -idle 1 &
  UNCLUTTER_PID=$!
fi

# Gestionnaire de fenêtres léger (focus clavier, fenêtres popup)
WM_PID=""
for wm in openbox xfwm4 marco metacity; do
  if command -v "$wm" &>/dev/null; then
    "$wm" &
    WM_PID=$!
    echo "Gestionnaire de fenêtres : $wm"
    break
  fi
done

# Serveur TVLive (systemd --user si installé, sinon lancement direct)
tvlive_ensure_server || echo "Serveur non joignable pour l'instant — la page de boot patientera."

# Boucle de surveillance : le navigateur est TOUJOURS à l'écran
while true; do
  started=$(date +%s)
  bash "$TVLIVE_DIR/scripts/tv-browser.sh"
  code=$?
  echo "Navigateur terminé (code $code) à $(date '+%T')"

  if [[ -f "$DESKTOP_ONCE" ]]; then
    rm -f "$DESKTOP_ONCE"
    start_desktop_session || true
  fi

  # Relance rapide, mais sans boucle folle si le navigateur crashe aussitôt
  if (( $(date +%s) - started < 3 )); then
    sleep 3
  else
    sleep 1
  fi
done
