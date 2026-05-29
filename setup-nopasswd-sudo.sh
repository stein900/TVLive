#!/usr/bin/env bash
# À lancer UNE FOIS dans VOTRE terminal (mot de passe demandé une seule fois).
# Ensuite l'agent pourra installer sans interaction.
set -euo pipefail

USER_NAME="${SUDO_USER:-$USER}"
FILE="/etc/sudoers.d/99-${USER_NAME}-nopasswd"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Relancez avec : sudo bash $0"
  exit 1
fi

echo "${USER_NAME} ALL=(ALL) NOPASSWD:ALL" > "$FILE"
chmod 440 "$FILE"
visudo -cf "$FILE"
echo "OK : ${USER_NAME} peut utiliser sudo sans mot de passe."
