#!/usr/bin/env bash
# Profil Brave TVLive : pas de restauration d'onglets au redémarrage
set -euo pipefail

TVLIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/common.sh
source "$TVLIVE_DIR/scripts/common.sh"

BRAVE_PROFILE_DIR="${BRAVE_PROFILE_DIR:-$HOME/.config/tvlive-brave}"
POLICY_DIR="$BRAVE_PROFILE_DIR/policies/managed"
PREFS_DIR="$BRAVE_PROFILE_DIR/Default"

mkdir -p "$POLICY_DIR" "$PREFS_DIR"

# Politique Chromium : nouvel onglet au démarrage, jamais « continuer la session »
cat >"$POLICY_DIR/tvlive.json" <<'EOF'
{
  "RestoreOnStartup": 0,
  "RestoreOnStartupURLs": [],
  "PromptOnMultipleMatchingProfiles": false
}
EOF

# Préférences de base (écrasées partiellement par Brave au 1er lancement)
cat >"$PREFS_DIR/Preferences" <<'EOF'
{
  "session": {
    "restore_on_startup": 5,
    "startup_urls": []
  },
  "profile": {
    "exit_type": "Normal"
  },
  "browser": {
    "custom_chrome_frame": true
  }
}
EOF

echo "Profil Brave TVLive prêt : $BRAVE_PROFILE_DIR"
echo "  → Pas de sauvegarde / restauration des onglets"
