# TVLive — le PC devient une box TV

Un PC Linux branché sur la TV, piloté depuis le téléphone. Au démarrage, l'écran
affiche **directement un accueil type box** (hero, rangées de services, horloge,
veille ambiante) — aucun bureau Linux, aucun navigateur visible.

```
   ┌──────────── TV ────────────┐          ┌──── Téléphone ────┐
   │  accueil TVLive (/tv)      │  Wi‑Fi   │  télécommande (/) │
   │  Brave kiosque plein écran │ ◄──────► │  catalogue, D‑pad │
   │  services = onglets        │          │  trackpad, volume │
   └────────────────────────────┘          └───────────────────┘
                 ▲ serveur Flask + Socket.IO (app.py), port 5000
```

## Comment ça marche

| Couche | Rôle |
|---|---|
| `session/tvlive-session.sh` | Session X dédiée : fond noir, curseur masqué (`unclutter`), WM minimal (`openbox`), serveur, puis Brave en boucle (relancé s'il se ferme). |
| `session/boot.html` | Page locale affichée pendant que le serveur démarre (logo TVLive), bascule seule sur `/tv`. |
| `templates/tv.html` + `static/tv.*` | L'accueil TV : navigation flèches / OK, hero « Reprendre », rangées par catégorie, veille après 4 min. |
| `app.py` | Serveur. Pilote Brave via son port DevTools local : un service = **un onglet par‑dessus l'accueil**, « Accueil TV » ferme les onglets. Volume (`pactl`), mise à jour, redémarrage, extinction. |
| `scripts/tv-browser.sh` | Lance Brave `--kiosk` (aucune barre, aucun onglet visible, pas de trousseau). |
| `install-box.sh` | Autologin LightDM/GDM sur la session TVLive, GRUB silencieux, splash Plymouth « TVLive », droits polkit. |

Pourquoi Brave ne « casse » pas l'illusion : en mode `--kiosk` il n'y a ni barre
d'adresse, ni onglets, ni bulles, et le serveur ouvre/ferme les pages sans que rien
d'autre ne s'affiche. Le seul moment où l'on voit une page web, c'est le service
lui‑même (Netflix, YouTube…) — exactement comme sur une box.

## Installation sur le PC Linux (une fois)

```bash
cd ~/Documents/TVLive
bash install.sh          # xdotool, Python, Brave, venv
bash install-box.sh      # mode box : autologin + session + splash (sudo demandé)
sudo reboot
```

Options : `install-box.sh --no-splash` (garde le splash de la distribution),
`--no-grub` (ne touche pas au menu de démarrage).

Après le reboot : splash TVLive → accueil TVLive plein écran. Sur le téléphone,
ouvrez `http://<IP du PC>:5000` (l'adresse est affichée en bas de l'écran TV).

## Utilisation

**Sur la TV** (clavier ou D‑pad du téléphone) : ◀ ▲ ▼ ▶ pour naviguer, OK pour
lancer, Retour/Échap pour remonter en haut. Après 4 min sans action, veille
ambiante (horloge) ; n'importe quelle touche la quitte.

**Sur le téléphone**
- Accueil : tuile → ouvre le service sur la TV, passe en mode télécommande.
- ⌂ **Accueil TV** : ferme le(s) service(s) ouvert(s), retour à l'accueil.
- Télécommande : trackpad (déplacer / tap = clic), molette, D‑pad + OK,
  ⏯ (espace), ⛶ (plein écran vidéo), 🔉 🔊 🔇, clavier.
- ⚙ **Réglages** : adresse, version, mode · Mettre à jour (git pull + redémarrage
  du serveur) · Redémarrer l'écran TV · **Mode PC (une fois)** · Redémarrer /
  Éteindre la box (double appui pour confirmer).

**Revenir au bureau Linux**
- Ponctuellement : ⚙ → *Mode PC (une fois)* → le bureau habituel s'ouvre ; au
  prochain démarrage, retour en mode box. (Ou choisir une autre session sur
  l'écran de connexion après déconnexion.)
- Définitivement : `bash uninstall-box.sh` puis reboot.

## Catalogue

`catalogue.json` — un objet par tuile :

```json
{ "title": "Netflix", "category": "Séries & Films",
  "image": "https://…/logo.svg", "url": "https://www.netflix.com" }
```

- `category` : nom de la rangée sur la TV (et de la section sur le téléphone).
- `image` : URL ou `/static/catalogue/xxx.jpg`. Les `.svg` / « logo » sont affichés
  en *contain* sur fond sombre, les photos en *cover* (`image_fit`, `image_position`
  facultatifs).
- `remote_only: true` : tuile « télécommande seule » (téléphone uniquement).

## Configuration (`tvlive.conf`)

`PORT` (5000), `CDP_PORT` (9222, port DevTools local de Brave),
`BRAVE_PROFILE_DIR`, `TV_HOME_URL`, `DESKTOP_SESSION_CMD` (session bureau pour
« Mode PC », détectée automatiquement sinon).

## Dépannage

- Logs : `logs/session.log`, `logs/brave.log`, `logs/server.log`,
  `systemctl --user status tvlive`.
- Écran noir au boot : passer en mode PC (Ctrl+Alt+F2, se connecter,
  `bash ~/Documents/TVLive/uninstall-box.sh`) ou choisir une autre session
  dans LightDM.
- Netflix / Disney+ : activer Widevine dans Brave une fois
  (`brave://settings/extensions` → « Widevine ») depuis le mode PC.
- Pas de son : vérifier la sortie HDMI par défaut (`pactl list short sinks`,
  `pactl set-default-sink <nom>`).
- Le serveur est ouvert sur le réseau local sans mot de passe : n'importe quel
  appareil du Wi‑Fi peut piloter la box (y compris l'éteindre).

## Mode bureau classique (sans box)

`install-autostart.sh` garde l'ancien fonctionnement : serveur au login + raccourci
« TVLive — Mode TV » sur le bureau, qui ouvre l'accueil TV en kiosque par‑dessus le
bureau.
