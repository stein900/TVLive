#!/usr/bin/env bash
# Installe démarrage automatique + raccourci bureau (une fois)
set -euo pipefail

TVLIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USER_NAME="$(whoami)"
HOME_DIR="$HOME"
SYSTEMD_USER="$HOME_DIR/.config/systemd/user"
AUTOSTART_DIR="$HOME_DIR/.config/autostart"
DESKTOP_SRC="$TVLIVE_DIR/Lancer-TVLive.desktop"

echo "==> TVLive : installation démarrage automatique"

mkdir -p "$TVLIVE_DIR/logs" "$SYSTEMD_USER" "$AUTOSTART_DIR"

chmod +x "$TVLIVE_DIR/Lancer-TVLive.sh" "$TVLIVE_DIR/scripts/common.sh"

# Service systemd utilisateur (serveur toujours actif)
sed "s|/home/stein|$HOME_DIR|g" "$TVLIVE_DIR/systemd/tvlive.service" >"$SYSTEMD_USER/tvlive.service"
systemctl --user daemon-reload
systemctl --user enable tvlive.service
systemctl --user start tvlive.service || true

# Démarrage au login XFCE (serveur + mode TV plein écran)
sed "s|/home/stein|$HOME_DIR|g" "$TVLIVE_DIR/autostart/tvlive-server.desktop" >"$AUTOSTART_DIR/tvlive-server.desktop"
sed "s|/home/stein|$HOME_DIR|g" "$TVLIVE_DIR/autostart/tvlive-tv.desktop" >"$AUTOSTART_DIR/tvlive-tv.desktop"
chmod +x "$AUTOSTART_DIR/tvlive-server.desktop" "$AUTOSTART_DIR/tvlive-tv.desktop" 2>/dev/null || true

# Raccourci double-clic sur le bureau
install_desktop() {
  local dir="$1"
  [[ -d "$dir" ]] || return 0
  sed "s|/home/stein|$HOME_DIR|g" "$DESKTOP_SRC" >"$dir/TVLive — Mode TV.desktop"
  chmod +x "$dir/TVLive — Mode TV.desktop"
  gio set "$dir/TVLive — Mode TV.desktop" metadata::trusted true 2>/dev/null || true
}

install_desktop "$HOME_DIR/Desktop"
install_desktop "$HOME_DIR/Bureau"

# Linger : serveur même sans session graphique ouverte (optionnel)
if command -v loginctl &>/dev/null; then
  sudo loginctl enable-linger "$USER_NAME" 2>/dev/null || \
    echo "Note : loginctl enable-linger ignoré (sudo optionnel)."
fi

echo ""
echo "Installation terminée."
echo "  • Serveur : actif au login (systemd --user + autostart)"
echo "  • Mode TV  : Brave plein écran au login (délai 8 s)"
echo "  • Bureau   : raccourci « TVLive — Mode TV » (double-clic)"
echo ""
echo "Commandes utiles :"
echo "  systemctl --user status tvlive"
echo "  systemctl --user restart tvlive"
echo ""
systemctl --user is-active tvlive.service && echo "Serveur : en cours d'exécution." || echo "Serveur : démarrage en cours…"
