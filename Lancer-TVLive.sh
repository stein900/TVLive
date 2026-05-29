#!/usr/bin/env bash
# Double-clic : démarre le serveur + ouvre Brave en plein écran (mode TV)
set -euo pipefail

TVLIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "$TVLIVE_DIR/scripts/common.sh"

tvlive_ensure_server
tvlive_open_tv_mode

if command -v notify-send &>/dev/null; then
  notify-send "TVLive" "Mode TV activé (plein écran)" -i display 2>/dev/null || true
fi
