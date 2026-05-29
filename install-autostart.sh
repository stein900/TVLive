#!/usr/bin/env bash
# Installe démarrage automatique + raccourci bureau (une fois)
set -euo pipefail

TVLIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USER_NAME="$(whoami)"
HOME_DIR="$HOME"
SYSTEMD_USER="$HOME_DIR/.config/systemd/user"
AUTOSTART_DIR="$HOME_DIR/.config/autostart"
DESKTOP_SRC="$TVLIVE_DIR/Lancer-TVLive.desktop"
DESKTOP_PULL="$TVLIVE_DIR/Mettre-a-jour-TVLive.desktop"

echo "==> TVLive : installation démarrage automatique"

mkdir -p "$TVLIVE_DIR/logs" "$SYSTEMD_USER" "$AUTOSTART_DIR"

chmod +x "$TVLIVE_DIR/Lancer-TVLive.sh" "$TVLIVE_DIR/Mettre-a-jour-TVLive.sh" \
  "$TVLIVE_DIR/scripts/common.sh" "$TVLIVE_DIR/scripts/init-brave-profile.sh"
bash "$TVLIVE_DIR/scripts/init-brave-profile.sh" || true

# Service systemd utilisateur (serveur toujours actif)
sed "s|/home/stein|$HOME_DIR|g" "$TVLIVE_DIR/systemd/tvlive.service" >"$SYSTEMD_USER/tvlive.service"
systemctl --user daemon-reload
systemctl --user enable tvlive.service
systemctl --user start tvlive.service || true

# Démarrage au login XFCE (serveur + mode TV plein écran)
sed "s|/home/stein|$HOME_DIR|g" "$TVLIVE_DIR/autostart/tvlive-server.desktop" >"$AUTOSTART_DIR/tvlive-server.desktop"
sed "s|/home/stein|$HOME_DIR|g" "$TVLIVE_DIR/autostart/tvlive-tv.desktop" >"$AUTOSTART_DIR/tvlive-tv.desktop"
chmod +x "$AUTOSTART_DIR/tvlive-server.desktop" "$AUTOSTART_DIR/tvlive-tv.desktop" 2>/dev/null || true

# Raccourcis double-clic sur le bureau
install_desktop() {
  local dir="$1"
  local src="$2"
  local name="$3"
  [[ -d "$dir" ]] || return 0
  sed "s|/home/stein|$HOME_DIR|g" "$src" >"$dir/$name"
  chmod +x "$dir/$name"
  gio set "$dir/$name" metadata::trusted true 2>/dev/null || true
}

install_desktop "$HOME_DIR/Desktop" "$DESKTOP_SRC" "TVLive — Mode TV.desktop"
install_desktop "$HOME_DIR/Bureau" "$DESKTOP_SRC" "TVLive — Mode TV.desktop"
install_desktop "$HOME_DIR/Desktop" "$DESKTOP_PULL" "TVLive — Mettre à jour.desktop"
install_desktop "$HOME_DIR/Bureau" "$DESKTOP_PULL" "TVLive — Mettre à jour.desktop"

# Linger : serveur même sans session graphique ouverte (optionnel)
if command -v loginctl &>/dev/null; then
  sudo loginctl enable-linger "$USER_NAME" 2>/dev/null || \
    echo "Note : loginctl enable-linger ignoré (sudo optionnel)."
fi

echo ""
echo "Installation terminée."
echo "  • Serveur : actif au login (systemd --user + autostart)"
echo "  • Mode TV  : Brave plein écran au login (délai 8 s)"
echo "  • Bureau   : « TVLive — Mode TV » et « TVLive — Mettre à jour »"
echo ""
echo "Commandes utiles :"
echo "  systemctl --user status tvlive"
echo "  systemctl --user restart tvlive"
echo ""
systemctl --user is-active tvlive.service && echo "Serveur : en cours d'exécution." || echo "Serveur : démarrage en cours…"
