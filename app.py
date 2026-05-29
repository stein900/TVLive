#!/usr/bin/env python3
"""Serveur télécommande web — contrôle souris + ouverture URLs streaming."""

import json
import subprocess
import time
from pathlib import Path

from flask import Flask, jsonify, render_template
from flask_socketio import SocketIO

BASE_DIR = Path(__file__).resolve().parent
CATALOGUE_PATH = BASE_DIR / "catalogue.json"
BRAVE_CMD = "brave-browser"

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


def run_xdotool(*args: str) -> None:
    """Exécute xdotool silencieusement."""
    try:
        subprocess.run(
            ["xdotool", *args],
            check=False,
            capture_output=True,
            timeout=2,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass


def open_url_in_brave(url: str) -> None:
    """Ouvre une URL dans Brave."""
    try:
        subprocess.Popen(
            [BRAVE_CMD, url],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except FileNotFoundError:
        socketio.emit("error", {"message": f"Commande introuvable : {BRAVE_CMD}"})


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


if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, debug=False)
