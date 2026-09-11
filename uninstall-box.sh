#!/usr/bin/env bash
# Retire le mode « box TV » : le PC redémarre sur son bureau Linux habituel.
# (le serveur TVLive et les raccourcis bureau restent utilisables)
set -uo pipefail

TVLIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USER_NAME="$(id -un)"

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Lancez ce script en tant qu'utilisateur normal : bash uninstall-box.sh" >&2
  exit 1
fi

echo "TVLive — désinstallation du mode box TV"
sudo -v

echo "==> Autologin / session"
sudo rm -f /etc/lightdm/lightdm.conf.d/60-tvlive.conf
sudo rm -f /usr/share/xsessions/tvlive.desktop
if [[ -f /etc/gdm3/custom.conf.tvlive.bak ]]; then
  sudo cp /etc/gdm3/custom.conf.tvlive.bak /etc/gdm3/custom.conf
  sudo rm -f /etc/gdm3/custom.conf.tvlive.bak
fi
if [[ -f "/var/lib/AccountsService/users/$USER_NAME" ]]; then
  sudo sed -i '/^X\?Session=tvlive$/d' "/var/lib/AccountsService/users/$USER_NAME"
fi
sudo gpasswd -d "$USER_NAME" autologin >/dev/null 2>&1 || true

echo "==> Droits polkit"
sudo rm -f /etc/polkit-1/rules.d/49-tvlive.rules /etc/polkit-1/localauthority/50-local.d/49-tvlive.pkla

echo "==> GRUB"
if [[ -f /etc/default/grub.tvlive.bak ]]; then
  sudo cp /etc/default/grub.tvlive.bak /etc/default/grub
  sudo rm -f /etc/default/grub.tvlive.bak
  sudo update-grub >/dev/null 2>&1 || true
fi

echo "==> Splash Plymouth"
if [[ -d /usr/share/plymouth/themes/tvlive ]]; then
  sudo update-alternatives --remove default.plymouth /usr/share/plymouth/themes/tvlive/tvlive.plymouth >/dev/null 2>&1 || true
  sudo rm -rf /usr/share/plymouth/themes/tvlive
  sudo update-initramfs -u >/dev/null 2>&1 || true
fi

rm -f "$HOME/.config/tvlive/desktop-once" "${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/tvlive-box-session"

echo
echo "Mode box retiré. Au prochain démarrage : écran de connexion / bureau habituel."
echo "Le serveur TVLive reste actif (systemctl --user status tvlive)."
echo "Redémarrez :  sudo reboot"
