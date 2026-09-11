#!/usr/bin/env bash
# Lance le navigateur TV (kiosque plein écran) au premier plan.
# Usage : tv-browser.sh [URL]   — sans URL : page de boot → accueil TVLive
set -uo pipefail

TVLIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export TVLIVE_DIR
# shellcheck source=common.sh
source "$TVLIVE_DIR/scripts/common.sh"

tvlive_run_browser "${1:-}"
