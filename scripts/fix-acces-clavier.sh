#!/usr/bin/env bash
# Corrige l'accès clavier / mot de passe au démarrage pour TVLive
set -euo pipefail

TVLIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOME_DIR="$HOME"
USER_NAME="$(whoami)"

echo "==> TVLive : correction accès clavier / X11"

# Désactiver Onboard au login (conflit possible avec xdotool)
mkdir -p "$HOME_DIR/.config/autostart"
cp "$TVLIVE_DIR/autostart/disable-onboard.desktop" "$HOME_DIR/.config/autostart/"
# Surcharge explicite du autostart système Onboard
cat >"$HOME_DIR/.config/autostart/onboard-autostart.desktop" <<'EOF'
[Desktop Entry]
Hidden=true
X-GNOME-Autostart-enabled=false
EOF

# Ne plus lancer Brave automatiquement au boot (évite popups clé / keyring)
sed "s|/home/stein|$HOME_DIR|g" "$TVLIVE_DIR/autostart/tvlive-tv.desktop" >"$HOME_DIR/.config/autostart/tvlive-tv.desktop"

# Serveur avec DISPLAY au login
sed "s|/home/stein|$HOME_DIR|g" "$TVLIVE_DIR/autostart/tvlive-server.desktop" >"$HOME_DIR/.config/autostart/tvlive-server.desktop"

# Service systemd utilisateur (démarre après session graphique)
mkdir -p "$HOME_DIR/.config/systemd/user"
sed "s|/home/stein|$HOME_DIR|g" "$TVLIVE_DIR/systemd/tvlive.service" >"$HOME_DIR/.config/systemd/user/tvlive.service"
systemctl --user daemon-reload
systemctl --user enable tvlive.service
systemctl --user restart tvlive.service || systemctl --user start tvlive.service

# Groupe input (utile si uinput / périphériques)
sudo usermod -aG input "$USER_NAME" 2>/dev/null || true

echo ""
echo "Terminé."
echo "  • Onboard désactivé au démarrage"
echo "  • Brave ne s'ouvre plus seul au boot (double-clic « Mode TV » si besoin)"
echo "  • Serveur TVLive avec DISPLAY=:0"
echo ""
echo "Si une fenêtre demande encore un mot de passe :"
echo "  → Utilisez le mot de passe de CONNEXION Linux Mint (session),"
echo "    pas un ancien mot de passe."
echo "  → Si ça échoue : Paramètres → Connexion → Trousseau → changer le mot de passe"
echo "    du trousseau pour qu'il soit identique au login."
echo ""
echo "Redémarrez le PC pour tester."
