#!/usr/bin/env python3
"""Serveur TVLive — télécommande web (téléphone) + interface TV (écran du PC).

Le navigateur (Brave) tourne en mode kiosque et affiche la page /tv.
Les services s'ouvrent dans un onglet par-dessus l'accueil via le protocole
DevTools (port local) ; « Accueil TV » referme ces onglets.
"""

import eventlet

eventlet.monkey_patch()

import json  # noqa: E402
import os  # noqa: E402
import re  # noqa: E402
import socket  # noqa: E402
import subprocess  # noqa: E402
import sys  # noqa: E402
import time  # noqa: E402
import urllib.error  # noqa: E402
import urllib.request  # noqa: E402
from pathlib import Path  # noqa: E402

from flask import Flask, jsonify, render_template, request  # noqa: E402
from flask_socketio import SocketIO, join_room  # noqa: E402

BASE_DIR = Path(__file__).resolve().parent
CATALOGUE_PATH = BASE_DIR / "catalogue.json"
CONF_PATH = BASE_DIR / "tvlive.conf"
BROWSER_SCRIPT = BASE_DIR / "scripts" / "tv-browser.sh"
LOG_DIR = BASE_DIR / "logs"
STATE_DIR = Path.home() / ".config" / "tvlive"
STATE_PATH = STATE_DIR / "state.json"
DESKTOP_ONCE_FLAG = STATE_DIR / "desktop-once"
BOX_SESSION_FLAG = Path(f"/run/user/{getattr(os, 'getuid', lambda: 0)()}") / "tvlive-box-session"
MAX_RECENT = 6


def load_conf() -> dict:
    conf = {}
    if not CONF_PATH.exists():
        return conf
    for line in CONF_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        conf[key.strip()] = value.strip().replace("$HOME", str(Path.home()))
    return conf


CONF = load_conf()
PORT = int(CONF.get("PORT", 5000))
CDP_PORT = int(CONF.get("CDP_PORT", 9222))
TV_HOME_URL = CONF.get("TV_HOME_URL") or f"http://127.0.0.1:{PORT}/tv"
CDP_BASE = f"http://127.0.0.1:{CDP_PORT}"
STARTED_AT = time.time()

app = Flask(__name__)
app.config["SECRET_KEY"] = "tvlive-local"
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

# Scroll sans échec : 1 clic molette max, intervalle minimum (PC léger)
SCROLL_COOLDOWN_SEC = 0.1
_scroll_last = 0.0
TYPE_DELAY_MS = 12
MAX_TYPE_LEN = 500
ALLOWED_KEYS = frozenset({
    "BackSpace", "Return", "Escape", "Tab", "Delete",
    "space", "Left", "Right", "Up", "Down",
    "Home", "End", "Page_Up", "Page_Down",
    "f", "m", "k", "j", "l", "F5",
    "ctrl+a", "ctrl+c", "ctrl+v",
})

# sid → rôle ("remote" téléphone / "tv" écran)
_clients: dict = {}


# ——— Utilitaires système ———

def x11_env() -> dict:
    """Variables pour que xdotool / Brave ciblent le bureau graphique actif."""
    env = os.environ.copy()
    env.setdefault("DISPLAY", ":0")
    xauth = Path.home() / ".Xauthority"
    if xauth.exists():
        env.setdefault("XAUTHORITY", str(xauth))
    return env


def brave_profile_dir() -> Path:
    raw = CONF.get("BRAVE_PROFILE_DIR", str(Path.home() / ".config/tvlive-brave"))
    return Path(raw).expanduser()


def ensure_brave_tv_profile() -> None:
    """Profil Brave dédié : onglet vierge au démarrage, pas de restauration."""
    profile = brave_profile_dir()
    policy_dir = profile / "policies" / "managed"
    policy_dir.mkdir(parents=True, exist_ok=True)
    (policy_dir / "tvlive.json").write_text(
        '{"RestoreOnStartup":0,"RestoreOnStartupURLs":[],'
        '"PromptOnMultipleMatchingProfiles":false}\n',
        encoding="utf-8",
    )
    prefs_dir = profile / "Default"
    prefs_dir.mkdir(parents=True, exist_ok=True)
    prefs_file = prefs_dir / "Preferences"
    if not prefs_file.exists():
        prefs_file.write_text(
            '{"session":{"restore_on_startup":5,"startup_urls":[]},'
            '"profile":{"exit_type":"Normal"}}\n',
            encoding="utf-8",
        )


def box_mode() -> bool:
    """Vrai quand la session X « TVLive » (mode box) est active."""
    return BOX_SESSION_FLAG.exists()


def run_quiet(cmd: list, timeout: float = 5, env: dict | None = None):
    try:
        return subprocess.run(
            cmd, check=False, capture_output=True, text=True, timeout=timeout, env=env,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return None


def run_xdotool(*args: str) -> None:
    run_quiet(["xdotool", *args], timeout=2, env=x11_env())


def local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


def git_version() -> str:
    r = run_quiet(["git", "-C", str(BASE_DIR), "log", "-1", "--format=%h · %cd", "--date=short"])
    if r and r.returncode == 0 and r.stdout.strip():
        return r.stdout.strip()
    return "dev"


VERSION = git_version()


# ——— État (récents) ———

def load_state() -> dict:
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_state(state: dict) -> None:
    try:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        pass


def remember_recent(url: str, title: str) -> None:
    state = load_state()
    recent = [r for r in state.get("recent", []) if r.get("url") != url]
    recent.insert(0, {"url": url, "title": title, "at": time.time()})
    state["recent"] = recent[:MAX_RECENT]
    save_state(state)


# ——— Navigateur : pilotage DevTools (CDP) ———

def cdp(path: str, method: str = "GET", timeout: float = 1.5):
    """Appel HTTP au port DevTools de Brave. None si injoignable."""
    req = urllib.request.Request(CDP_BASE + path, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
    except (urllib.error.URLError, OSError, ValueError):
        return None
    if not body:
        return {}
    try:
        return json.loads(body)
    except ValueError:
        return {"raw": body.decode(errors="replace")}


def browser_up() -> bool:
    return cdp("/json/version") is not None


def cdp_pages():
    data = cdp("/json/list")
    if not isinstance(data, list):
        return None
    return [t for t in data if t.get("type") == "page"]


def cdp_new_tab(url: str):
    # Chromium récent exige PUT ; les anciens acceptent GET.
    res = cdp(f"/json/new?{url}", method="PUT", timeout=4)
    if not isinstance(res, dict) or not res.get("id"):
        res = cdp(f"/json/new?{url}", method="GET", timeout=4)
    if isinstance(res, dict) and res.get("id"):
        return res
    return None


def is_home_url(url: str) -> bool:
    return url.startswith(TV_HOME_URL) or (url.startswith("file://") and "boot.html" in url)


def focus_browser_window() -> None:
    run_xdotool("search", "--onlyvisible", "--class", "brave|chrom", "windowactivate")


def launch_browser(url: str | None = None) -> None:
    """Lance Brave kiosque (page d'accueil TV, ou une URL précise)."""
    ensure_brave_tv_profile()
    LOG_DIR.mkdir(exist_ok=True)
    cmd = ["bash", str(BROWSER_SCRIPT)]
    if url:
        cmd.append(url)
    try:
        with open(LOG_DIR / "brave.log", "ab") as log:
            subprocess.Popen(
                cmd, stdout=log, stderr=log, start_new_session=True, env=x11_env(),
            )
    except OSError as exc:
        notify_all(f"Impossible de lancer le navigateur : {exc}")


def kill_browser() -> None:
    """Ferme uniquement le Brave du profil TVLive."""
    profile = str(brave_profile_dir())
    run_quiet(["pkill", "-f", f"user-data-dir={profile}"])
    run_quiet(["pkill", "-f", profile])


def ensure_browser(timeout: float = 15) -> bool:
    if browser_up():
        return True
    # En mode box, la session relance Brave toute seule ; sinon on le lance.
    if not box_mode():
        launch_browser()
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        socketio.sleep(0.5)
        if browser_up():
            return True
    return False


def open_service(url: str, title: str = "") -> None:
    remember_recent(url, title)
    emit_tv("tv_launch", {"title": title or url})

    def task():
        if not ensure_browser():
            launch_browser(url)  # dernier recours : Brave directement sur l'URL
            return
        tab = cdp_new_tab(url)
        if tab:
            cdp(f"/json/activate/{tab['id']}")
            focus_browser_window()
        else:
            launch_browser(url)

    socketio.start_background_task(task)


def go_home() -> None:
    """Retour à l'accueil TV : ferme les onglets services, garde/crée l'accueil."""
    pages = cdp_pages()
    if pages is None:
        # Navigateur absent ou lancé sans port DevTools → relance propre.
        kill_browser()
        if not box_mode():
            launch_browser()
        emit_tv("tv_wake")
        return
    home = [p for p in pages if is_home_url(p.get("url", ""))]
    if not home:
        tab = cdp_new_tab(TV_HOME_URL)
        if tab:
            home = [tab]
    keep = home[0]["id"] if home else None
    if keep:
        cdp(f"/json/activate/{keep}")
    for p in pages:
        if p.get("id") != keep:
            cdp(f"/json/close/{p['id']}")
    focus_browser_window()
    emit_tv("tv_wake")


# ——— Volume (PulseAudio / PipeWire, repli ALSA) ———

def current_volume():
    r = run_quiet(["pactl", "get-sink-volume", "@DEFAULT_SINK@"], timeout=3)
    if r and r.returncode == 0:
        m = re.search(r"(\d+)%", r.stdout)
        if m:
            return int(m.group(1))
    return None


def set_volume(direction: str) -> str:
    if direction == "mute":
        r = run_quiet(["pactl", "set-sink-mute", "@DEFAULT_SINK@", "toggle"], timeout=3)
        if not r or r.returncode != 0:
            run_quiet(["amixer", "-q", "sset", "Master", "toggle"], timeout=3)
        return "Muet"
    step = 5 if direction == "up" else -5
    cur = current_volume()
    if cur is not None:
        target = max(0, min(100, cur + step))
        r = run_quiet(["pactl", "set-sink-volume", "@DEFAULT_SINK@", f"{target}%"], timeout=3)
        if r and r.returncode == 0:
            return f"Volume {target}%"
    r = run_quiet(["pactl", "set-sink-volume", "@DEFAULT_SINK@", f"{step:+d}%"], timeout=3)
    if not r or r.returncode != 0:
        run_quiet(["amixer", "-q", "sset", "Master", "5%+" if step > 0 else "5%-"], timeout=3)
    return "Volume " + ("+" if step > 0 else "−")


# ——— Actions système ———

def run_privileged(*cmd: str) -> bool:
    """Essaie sans sudo (polkit), puis avec sudo -n (règle NOPASSWD)."""
    for full in ([*cmd], ["sudo", "-n", *cmd]):
        r = run_quiet(full, timeout=20)
        if r and r.returncode == 0:
            return True
    return False


def restart_self() -> None:
    r = run_quiet(["systemctl", "--user", "is-active", "--quiet", "tvlive.service"])
    if r and r.returncode == 0:
        subprocess.Popen(
            ["systemctl", "--user", "restart", "tvlive.service"], start_new_session=True,
        )
    else:
        os.execv(sys.executable, [sys.executable, *sys.argv])


def do_update() -> None:
    def task():
        notify_all("Mise à jour en cours…")
        r = run_quiet(["git", "-C", str(BASE_DIR), "pull", "--ff-only", "origin", "main"], timeout=120)
        if r is None:
            notify_all("Git introuvable ou trop lent.")
            return
        if r.returncode != 0:
            lines = (r.stderr or r.stdout).strip().splitlines() or ["erreur inconnue"]
            notify_all("Échec de la mise à jour : " + lines[-1][:120])
            return
        if "Already up to date" in r.stdout or "Déjà à jour" in r.stdout:
            notify_all("TVLive est déjà à jour.")
            return
        pip = BASE_DIR / "venv" / "bin" / "pip"
        if pip.exists():
            run_quiet([str(pip), "install", "-q", "-r", str(BASE_DIR / "requirements.txt")], timeout=300)
        notify_all("Mise à jour terminée — redémarrage du serveur…")
        socketio.sleep(0.6)
        restart_self()

    socketio.start_background_task(task)


def _relaunch_later():
    socketio.sleep(0.8)
    launch_browser()


def system_action(action: str):
    if action == "home":
        socketio.start_background_task(go_home)
        return True, "Retour à l'accueil TV"
    if action == "restart_browser":
        kill_browser()
        if not box_mode():
            socketio.start_background_task(_relaunch_later)
        return True, "Redémarrage de l'écran TV…"
    if action == "quit_browser":
        kill_browser()
        return True, "Écran TV fermé"
    if action == "desktop_once":
        if not box_mode():
            return False, "Le mode box n'est pas actif (déjà en mode PC)."
        try:
            STATE_DIR.mkdir(parents=True, exist_ok=True)
            DESKTOP_ONCE_FLAG.touch()
        except OSError as exc:
            return False, f"Impossible d'écrire le drapeau : {exc}"
        kill_browser()
        return True, "Passage en mode PC… (au prochain démarrage : box)"
    if action == "update":
        do_update()
        return True, "Mise à jour lancée"
    if action == "reboot":
        ok = run_privileged("systemctl", "reboot")
        return ok, "Redémarrage…" if ok else "Redémarrage refusé (droits). Lancez install-box.sh."
    if action == "poweroff":
        ok = run_privileged("systemctl", "poweroff")
        return ok, "Extinction…" if ok else "Extinction refusée (droits). Lancez install-box.sh."
    return False, f"Action inconnue : {action}"


# ——— Données ———

def load_catalogue() -> list:
    try:
        with open(CATALOGUE_PATH, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def status_payload() -> dict:
    return {
        "ip": local_ip(),
        "port": PORT,
        "version": VERSION,
        "started_at": STARTED_AT,
        "box_mode": box_mode(),
        "browser_up": browser_up(),
        "remotes": sum(1 for r in _clients.values() if r == "remote"),
    }


# ——— Diffusion ———

def emit_tv(event: str, data=None) -> None:
    socketio.emit(event, data or {}, to="tv")


def notify_all(message: str) -> None:
    socketio.emit("notice", {"ok": True, "message": message})


def broadcast_remotes() -> None:
    count = sum(1 for r in _clients.values() if r == "remote")
    emit_tv("remotes", {"count": count})


# ——— Routes ———

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/tv")
def tv():
    return render_template("tv.html")


@app.route("/api/catalogue")
def api_catalogue():
    return jsonify(load_catalogue())


@app.route("/api/tv")
def api_tv():
    items = [i for i in load_catalogue() if i and i.get("url") and not i.get("remote_only")]
    payload = status_payload()
    payload["items"] = items
    payload["recent"] = load_state().get("recent", [])
    return jsonify(payload)


@app.route("/api/status")
def api_status():
    return jsonify(status_payload())


@app.route("/api/ping")
def api_ping():
    # Appelé depuis la page de boot (file://) → CORS ouvert.
    resp = jsonify({"ok": True, "started_at": STARTED_AT})
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Cache-Control"] = "no-store"
    return resp


# ——— Socket.IO ———

@socketio.on("register")
def on_register(data):
    role = (data or {}).get("role", "remote")
    _clients[request.sid] = role
    if role == "tv":
        join_room("tv")
    broadcast_remotes()


@socketio.on("disconnect")
def on_disconnect(*_args):
    _clients.pop(request.sid, None)
    broadcast_remotes()


@socketio.on("open_url")
def on_open_url(data):
    data = data or {}
    url = str(data.get("url", "")).strip()
    if url.startswith(("http://", "https://")):
        open_service(url, str(data.get("title", "")).strip()[:80])


@socketio.on("tv_home")
def on_tv_home(_data=None):
    socketio.start_background_task(go_home)


@socketio.on("close_brave")
def on_close_brave(_data=None):
    socketio.start_background_task(go_home)


@socketio.on("system_action")
def on_system_action(data):
    action = str((data or {}).get("action", "")).strip()
    ok, message = system_action(action)
    socketio.emit("notice", {"ok": ok, "message": message, "action": action}, to=request.sid)


@socketio.on("volume")
def on_volume(data):
    direction = (data or {}).get("dir")
    if direction in ("up", "down", "mute"):
        label = set_volume(direction)
        socketio.emit("notice", {"ok": True, "message": label, "quiet": True}, to=request.sid)
        emit_tv("toast", {"message": label})


@socketio.on("mouse_move")
def on_mouse_move(data):
    dx = int((data or {}).get("dx", 0))
    dy = int((data or {}).get("dy", 0))
    if dx or dy:
        run_xdotool("mousemove_relative", "--", str(dx), str(dy))


@socketio.on("mouse_click")
def on_mouse_click(_data=None):
    run_xdotool("click", "1")


@socketio.on("scroll")
def on_scroll(data):
    global _scroll_last
    now = time.monotonic()
    if now - _scroll_last < SCROLL_COOLDOWN_SEC:
        return
    _scroll_last = now
    direction = (data or {}).get("dir")
    if direction == "up":
        run_xdotool("click", "--clearmodifiers", "4")
    elif direction == "down":
        run_xdotool("click", "--clearmodifiers", "5")


@socketio.on("keyboard_type")
def on_keyboard_type(data):
    text = (data or {}).get("text", "")
    if not text:
        return
    text = text[:MAX_TYPE_LEN]
    run_xdotool("type", "--clearmodifiers", "--delay", str(TYPE_DELAY_MS), text)


@socketio.on("keyboard_key")
def on_keyboard_key(data):
    key = (data or {}).get("key", "").strip()
    if key in ALLOWED_KEYS:
        run_xdotool("key", "--clearmodifiers", key)


ensure_brave_tv_profile()

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=PORT, debug=False)
