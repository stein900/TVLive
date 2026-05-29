#!/usr/bin/env bash
# Installe uniquement les deps Python sans apt (get-pip + venv si possible)
set -euo pipefail
cd "$(dirname "$0")"

if ! python3 -m venv --help &>/dev/null 2>&1; then
  echo "python3-venv manquant — lancez d'abord : sudo apt install -y python3-venv"
  exit 1
fi

python3 -m venv venv
./venv/bin/pip install --upgrade pip
./venv/bin/pip install -r requirements.txt
echo "Python OK dans ./venv"
