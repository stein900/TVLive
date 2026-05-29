#!/usr/bin/env bash
# Installation TVLive — paquets système + venv Python
set -euo pipefail

cd "$(dirname "$0")"

echo "==> Paquets système (xdotool, Python, Brave)…"
sudo apt update
sudo apt install -y \
  xdotool \
  python3 \
  python3-venv \
  python3-pip

# Brave : paquet officiel ou snap selon disponibilité
if ! command -v brave-browser >/dev/null 2>&1; then
  if apt-cache show brave-browser &>/dev/null; then
    sudo apt install -y brave-browser
  elif command -v snap >/dev/null 2>&1; then
    echo "==> Installation Brave via snap…"
    sudo snap install brave
  else
    echo "ATTENTION: Brave non installé. Ajoutez le dépôt Brave ou installez-le manuellement."
    echo "  https://brave.com/linux/"
  fi
fi

echo "==> Environnement virtuel Python…"
python3 -m venv venv
./venv/bin/pip install --upgrade pip
./venv/bin/pip install -r requirements.txt

echo ""
echo "Installation terminée."
echo "Lancer le serveur :"
echo "  cd $(pwd)"
echo "  source venv/bin/activate"
echo "  python app.py"
echo ""
echo "Sur le téléphone : http://$(hostname -I | awk '{print $1}'):5000"
