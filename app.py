#!/usr/bin/env python3
"""Serveur télécommande web — contrôle souris + ouverture URLs streaming."""

import json
import os
import subprocess
import time
from pathlib import Path

from flask import Flask, jsonify, render_template
from flask_socketio import SocketIO

BASE_DIR = Path(__file__).resolve().parent
CATALOGUE_PATH = BASE_DIR / "catalogue.json"
CONF_PATH = BASE_DIR / "tvlive.conf"
BRAVE_CMD = "brave-browser"

BRAVE_FLAGS = [
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-session-crashed-bubble",
    "--hide-crash-restore-bubble",
    "--disable-restore-session-state",
]

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
    "ctrl+a", "ctrl+c", "ctrl+v",
})


def x11_env() -> dict:
    """Variables pour que xdotool cible le bureau graphique actif."""
    env = os.environ.copy()
    env.setdefault("DISPLAY", ":0")
    xauth = Path.home() / ".Xauthority"
    if xauth.exists():
        env["XAUTHORITY"] = str(xauth)
    return env


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


def brave_profile_dir() -> Path:
    raw = load_conf().get("BRAVE_PROFILE_DIR", str(Path.home() / ".config/tvlive-brave"))
    return Path(raw).expanduser()


def ensure_brave_tv_profile() -> None:
    """Profil Brave dédié : onglet vierge au démarrage, pas de restauration."""
    profile = brave_profile_dir()
    policy_dir = profile / "policies" / "managed"
    policy_dir.mkdir(parents=True, exist_ok=True)
    policy_file = policy_dir / "tvlive.json"
    policy_file.write_text(
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


def brave_launch_args(extra: list | None = None) -> list:
    args = [BRAVE_CMD, f"--user-data-dir={brave_profile_dir()}", *BRAVE_FLAGS]
    if extra:
        args.extend(extra)
    return args


def run_xdotool(*args: str) -> None:
    """Exécute xdotool silencieusement."""
    try:
        subprocess.run(
            ["xdotool", *args],
            check=False,
            capture_output=True,
            timeout=2,
            env=x11_env(),
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass


def open_url_in_brave(url: str) -> None:
    """Ouvre une URL dans le profil Brave TVLive (sans restaurer d'anciens onglets)."""
    ensure_brave_tv_profile()
    try:
        subprocess.Popen(
            brave_launch_args([url]),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
            env=x11_env(),
        )
    except FileNotFoundError:
        socketio.emit("error", {"message": f"Commande introuvable : {BRAVE_CMD}"})


def close_brave() -> None:
    """Ferme uniquement le Brave du profil TVLive."""
    profile = str(brave_profile_dir())
    subprocess.run(
        ["pkill", "-f", f"user-data-dir={profile}"],
        check=False,
        capture_output=True,
    )
    subprocess.run(
        ["pkill", "-f", profile],
        check=False,
        capture_output=True,
    )


def load_catalogue() -> list:
    with open(CATALOGUE_PATH, encoding="utf-8") as f:
        return json.load(f)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/catalogue")
def api_catalogue():
    return jsonify(load_catalogue())


@socketio.on("open_url")
def on_open_url(data):
    url = (data or {}).get("url", "").strip()
    if url:
        open_url_in_brave(url)


@socketio.on("close_brave")
def on_close_brave(_data=None):
    close_brave()


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
    run_xdotool(
        "type", "--clearmodifiers",
        f"--delay", str(TYPE_DELAY_MS),
        text,
    )


@socketio.on("keyboard_key")
def on_keyboard_key(data):
    key = (data or {}).get("key", "").strip()
    if key in ALLOWED_KEYS:
        run_xdotool("key", "--clearmodifiers", key)


ensure_brave_tv_profile()

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, debug=False)
