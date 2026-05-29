#!/usr/bin/env bash
# Double-clic : récupère les changements GitHub et redémarre TVLive
set -euo pipefail

TVLIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$TVLIVE_DIR"

notify() {
  command -v notify-send &>/dev/null || return 0
  notify-send "$1" "$2" ${3:+-i "$3"} 2>/dev/null || true
}

if ! command -v git &>/dev/null; then
  notify "TVLive" "Git n'est pas installé." dialog-error
  exit 1
fi

if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  notify "TVLive" "Ce dossier n'est pas un dépôt git." dialog-error
  exit 1
fi

notify "TVLive" "Mise à jour en cours…" software-update-available

if git pull origin main; then
  if systemctl --user is-active tvlive.service &>/dev/null; then
    systemctl --user restart tvlive.service
    notify "TVLive" "Mise à jour terminée. Serveur redémarré." emblem-default
  else
    notify "TVLive" "Mise à jour terminée." emblem-default
  fi
else
  notify "TVLive" "Échec du pull. Vérifiez Internet et SSH GitHub." dialog-error
  exit 1
fi
