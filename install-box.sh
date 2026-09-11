#!/usr/bin/env bash
# ============================================================================
#  TVLive — Mode « box TV »
#  Transforme ce PC Linux en box de streaming : au démarrage, l'écran affiche
#  directement l'accueil TVLive plein écran (pas de bureau, pas de login).
#
#  À lancer UNE FOIS, en tant que l'utilisateur de la box (sudo demandé) :
#      bash install-box.sh
#  Options :
#      --no-splash   ne pas toucher au splash de démarrage (Plymouth)
#      --no-grub     ne pas toucher à GRUB (menu de boot)
#  Retour arrière : bash uninstall-box.sh
# ============================================================================
set -euo pipefail

TVLIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
[[ -f "$TVLIVE_DIR/tvlive.conf" ]] && source "$TVLIVE_DIR/tvlive.conf"
PORT="${PORT:-5000}"
USER_NAME="$(id -un)"
HOME_DIR="$HOME"
DO_SPLASH=1
DO_GRUB=1

for arg in "$@"; do
  case "$arg" in
    --no-splash) DO_SPLASH=0 ;;
    --no-grub) DO_GRUB=0 ;;
    *) echo "Option inconnue : $arg" >&2; exit 1 ;;
  esac
done

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Lancez ce script en tant qu'utilisateur normal (pas root) : bash install-box.sh" >&2
  exit 1
fi
if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Ce script est prévu pour le PC Linux de la box." >&2
  exit 1
fi

step() { echo; echo "==> $*"; }
warn() { echo "    ATTENTION : $*" >&2; }

echo "TVLive — installation du mode box TV"
echo "  Dossier      : $TVLIVE_DIR"
echo "  Utilisateur  : $USER_NAME"
sudo -v

# ---------------------------------------------------------------- 1. paquets
step "Paquets (openbox, unclutter, xdotool, curl, pactl)…"
PKGS=(openbox unclutter x11-xserver-utils xdotool curl pulseaudio-utils)
if command -v apt-get &>/dev/null; then
  sudo apt-get update -qq || true
  sudo apt-get install -y -qq "${PKGS[@]}" || warn "certains paquets n'ont pas pu être installés (le mode box marche quand même)."
else
  warn "apt introuvable : installez manuellement ${PKGS[*]}"
fi

if ! command -v brave-browser &>/dev/null && ! command -v brave-browser-stable &>/dev/null \
   && ! command -v chromium &>/dev/null && ! command -v chromium-browser &>/dev/null; then
  warn "Brave n'est pas installé. Lancez d'abord : bash install.sh   (ou https://brave.com/linux/)"
fi

# ------------------------------------------------------------ 2. python venv
step "Environnement Python…"
if [[ ! -x "$TVLIVE_DIR/venv/bin/python" ]]; then
  python3 -m venv "$TVLIVE_DIR/venv"
  "$TVLIVE_DIR/venv/bin/pip" install -q --upgrade pip
  "$TVLIVE_DIR/venv/bin/pip" install -q -r "$TVLIVE_DIR/requirements.txt"
else
  "$TVLIVE_DIR/venv/bin/pip" install -q -r "$TVLIVE_DIR/requirements.txt" || true
fi

# --------------------------------------------------------- 3. droits fichiers
step "Scripts exécutables + profil Brave…"
mkdir -p "$TVLIVE_DIR/logs" "$HOME_DIR/.config/tvlive"
chmod +x "$TVLIVE_DIR"/*.sh "$TVLIVE_DIR"/scripts/*.sh "$TVLIVE_DIR"/session/*.sh
bash "$TVLIVE_DIR/scripts/init-brave-profile.sh" >/dev/null || true

# ------------------------------------------------------- 4. service systemd
step "Service systemd utilisateur (serveur télécommande)…"
SYSTEMD_USER="$HOME_DIR/.config/systemd/user"
mkdir -p "$SYSTEMD_USER"
sed "s|/home/stein/Documents/TVLive|$TVLIVE_DIR|g; s|/home/stein|$HOME_DIR|g" \
  "$TVLIVE_DIR/systemd/tvlive.service" >"$SYSTEMD_USER/tvlive.service"
systemctl --user daemon-reload
systemctl --user enable tvlive.service >/dev/null 2>&1 || true
systemctl --user restart tvlive.service 2>/dev/null || systemctl --user start tvlive.service 2>/dev/null || true
# Le serveur tourne même sans session ouverte (utile après « Mode PC »)
sudo loginctl enable-linger "$USER_NAME" 2>/dev/null || true

# ------------------------------------------------------------ 5. session X
step "Session X « TVLive (box TV) »…"
sudo install -d -m 755 /usr/share/xsessions
sed "s|/home/stein/Documents/TVLive|$TVLIVE_DIR|g" "$TVLIVE_DIR/session/tvlive.desktop" \
  | sudo tee /usr/share/xsessions/tvlive.desktop >/dev/null
sudo chmod 644 /usr/share/xsessions/tvlive.desktop

# ------------------------------------------------- 6. autologin (LightDM/GDM)
step "Connexion automatique sur la session TVLive…"
if [[ -d /etc/lightdm ]]; then
  sudo install -d -m 755 /etc/lightdm/lightdm.conf.d
  sudo tee /etc/lightdm/lightdm.conf.d/60-tvlive.conf >/dev/null <<EOF
# Généré par TVLive install-box.sh — supprimé par uninstall-box.sh
[Seat:*]
autologin-user=$USER_NAME
autologin-user-timeout=0
autologin-session=tvlive
user-session=tvlive
EOF
  sudo groupadd -f autologin
  sudo gpasswd -a "$USER_NAME" autologin >/dev/null 2>&1 || true
  echo "    LightDM : autologin de $USER_NAME sur la session tvlive"
elif [[ -f /etc/gdm3/custom.conf || -d /etc/gdm3 ]]; then
  sudo install -d -m 755 /etc/gdm3
  sudo touch /etc/gdm3/custom.conf
  [[ -f /etc/gdm3/custom.conf.tvlive.bak ]] || sudo cp /etc/gdm3/custom.conf /etc/gdm3/custom.conf.tvlive.bak
  if ! grep -q '^\[daemon\]' /etc/gdm3/custom.conf; then
    echo "[daemon]" | sudo tee -a /etc/gdm3/custom.conf >/dev/null
  fi
  sudo sed -i '/^AutomaticLogin\(Enable\)\?=/d; /^WaylandEnable=/d' /etc/gdm3/custom.conf
  sudo sed -i "s|^\[daemon\]|[daemon]\nWaylandEnable=false\nAutomaticLoginEnable=true\nAutomaticLogin=$USER_NAME|" /etc/gdm3/custom.conf
  sudo install -d -m 755 /var/lib/AccountsService/users
  printf '[User]\nSession=tvlive\nXSession=tvlive\n' | sudo tee "/var/lib/AccountsService/users/$USER_NAME" >/dev/null
  echo "    GDM : autologin de $USER_NAME sur la session tvlive"
else
  warn "Gestionnaire de connexion inconnu (ni LightDM ni GDM). Configurez l'autologin sur la session « TVLive (box TV) » manuellement."
fi

# --------------------------------------------------- 7. polkit (éteindre…)
step "Droits : éteindre / redémarrer depuis la télécommande…"
if [[ -d /etc/polkit-1/rules.d ]]; then
  sed "s|__USER__|$USER_NAME|g" "$TVLIVE_DIR/box/polkit/49-tvlive.rules" \
    | sudo tee /etc/polkit-1/rules.d/49-tvlive.rules >/dev/null
fi
if [[ -d /etc/polkit-1/localauthority ]]; then
  sudo install -d -m 755 /etc/polkit-1/localauthority/50-local.d
  sed "s|__USER__|$USER_NAME|g" "$TVLIVE_DIR/box/polkit/49-tvlive.pkla" \
    | sudo tee /etc/polkit-1/localauthority/50-local.d/49-tvlive.pkla >/dev/null
fi

# ------------------------------------------------------------------ 8. GRUB
if (( DO_GRUB )) && [[ -f /etc/default/grub ]] && command -v update-grub &>/dev/null; then
  step "GRUB : menu caché, démarrage silencieux…"
  GRUB=/etc/default/grub
  [[ -f "$GRUB.tvlive.bak" ]] || sudo cp "$GRUB" "$GRUB.tvlive.bak"
  grub_set() {
    local key="$1" val="$2"
    if grep -q "^$key=" "$GRUB"; then
      sudo sed -i "s|^$key=.*|$key=$val|" "$GRUB"
    else
      echo "$key=$val" | sudo tee -a "$GRUB" >/dev/null
    fi
  }
  grub_set GRUB_TIMEOUT 0
  grub_set GRUB_TIMEOUT_STYLE hidden
  grub_set GRUB_RECORDFAIL_TIMEOUT 0
  grub_set GRUB_CMDLINE_LINUX_DEFAULT '"quiet splash loglevel=3 rd.systemd.show_status=false udev.log_level=3 vt.global_cursor_default=0"'
  sudo update-grub >/dev/null 2>&1 || warn "update-grub a échoué (non bloquant)."
  echo "    (menu GRUB : maintenir Maj/Échap au démarrage si besoin ; sauvegarde : $GRUB.tvlive.bak)"
fi

# -------------------------------------------------------------- 9. Plymouth
if (( DO_SPLASH )) && command -v plymouth &>/dev/null; then
  step "Splash de démarrage « TVLive » (Plymouth)…"
  SCRIPT_SO="$(find /usr/lib -name 'script.so' -path '*plymouth*' 2>/dev/null | head -n1 || true)"
  if [[ -z "$SCRIPT_SO" ]] && command -v apt-get &>/dev/null; then
    sudo apt-get install -y -qq plymouth-themes >/dev/null 2>&1 || true
    SCRIPT_SO="$(find /usr/lib -name 'script.so' -path '*plymouth*' 2>/dev/null | head -n1 || true)"
  fi
  if [[ -n "$SCRIPT_SO" ]]; then
    sudo install -d -m 755 /usr/share/plymouth/themes/tvlive
    sudo install -m 644 "$TVLIVE_DIR/box/plymouth/tvlive.plymouth" "$TVLIVE_DIR/box/plymouth/tvlive.script" \
      /usr/share/plymouth/themes/tvlive/
    sudo update-alternatives --install /usr/share/plymouth/themes/default.plymouth default.plymouth \
      /usr/share/plymouth/themes/tvlive/tvlive.plymouth 200 >/dev/null
    sudo update-alternatives --set default.plymouth /usr/share/plymouth/themes/tvlive/tvlive.plymouth >/dev/null
    echo "    Régénération de l'initramfs (peut prendre une minute)…"
    sudo update-initramfs -u >/dev/null 2>&1 || warn "update-initramfs a échoué : le splash restera celui de la distribution."
  else
    warn "plugin Plymouth « script » introuvable : splash inchangé."
  fi
fi

# ----------------------------------------------------------- 10. nettoyage
rm -f "$HOME_DIR/.config/tvlive/desktop-once"

cat <<EOF

============================================================
 Mode box TV installé.

 Au prochain démarrage :
   • boot silencieux + splash TVLive
   • connexion automatique → session « TVLive (box TV) »
   • Brave plein écran sur l'accueil TVLive (aucun bureau visible)

 Télécommande (téléphone) : http://$(hostname -I 2>/dev/null | awk '{print $1}'):${PORT}
   ⚙ Réglages → Mettre à jour · Mode PC (une fois) · Redémarrer · Éteindre

 Revenir au bureau :
   • depuis le téléphone : ⚙ → « Mode PC (une fois) »
   • définitivement       : bash $TVLIVE_DIR/uninstall-box.sh
============================================================
Redémarrez maintenant :  sudo reboot
EOF
