/**
 * TVLive — Télécommande mobile (WebSocket + trackpad relatif)
 */

(function () {
  "use strict";

  const SENSITIVITY = 1.2;
  const TAP_MAX_MOVE = 12;
  const TAP_MAX_MS = 280;
  const SCROLL_REPEAT_MS = 140;

  const viewHome = document.getElementById("view-home");
  const viewTrackpad = document.getElementById("view-trackpad");
  const grid = document.getElementById("catalogue-grid");
  const trackpad = document.getElementById("trackpad");
  const scrollUp = document.getElementById("scroll-up");
  const scrollDown = document.getElementById("scroll-down");
  const trackpadTitle = document.getElementById("trackpad-title");
  const btnBack = document.getElementById("btn-back");
  const btnRemoteOnly = document.getElementById("btn-remote-only");
  const STORAGE_VIEW = "tvlive-view";
  const btnCloseBrave = document.getElementById("btn-close-brave");
  const btnKeyboardToggle = document.getElementById("btn-keyboard-toggle");
  const keyboardPanel = document.getElementById("keyboard-panel");
  const keyboardForm = document.getElementById("keyboard-form");
  const keyboardInput = document.getElementById("keyboard-input");
  const viewTrackpadEl = viewTrackpad;

  const socket =
    typeof io !== "undefined"
      ? io({ transports: ["websocket", "polling"] })
      : { emit() {} };

  function socketEmit(event, data) {
    socket.emit(event, data);
  }

  let lastX = null;
  let lastY = null;
  let tapStartX = 0;
  let tapStartY = 0;
  let tapStartTime = 0;

  // ——— Navigation des vues ———

  function showView(name) {
    viewHome.classList.toggle("active", name === "home");
    viewTrackpad.classList.toggle("active", name === "trackpad");
    if (name === "trackpad") {
      sessionStorage.setItem(STORAGE_VIEW, "trackpad");
    } else {
      sessionStorage.removeItem(STORAGE_VIEW);
      sessionStorage.removeItem("tvlive-title");
    }
  }

  function openRemoteOnly(title) {
    const label = title || "Télécommande";
    sessionStorage.setItem("tvlive-title", label);
    trackpadTitle.textContent = label;
    closeKeyboardPanel();
    showView("trackpad");
    resetTrackpadState();
  }

  if (!grid) {
    console.error("TVLive: #catalogue-grid introuvable");
    return;
  }

  btnBack.addEventListener("click", () => {
    closeKeyboardPanel();
    showView("home");
  });

  if (btnRemoteOnly) {
    btnRemoteOnly.addEventListener("click", () => openRemoteOnly("Télécommande"));
  }

  if (btnCloseBrave) {
    btnCloseBrave.addEventListener("click", () => {
      socketEmit("close_brave");
      btnCloseBrave.disabled = true;
      setTimeout(() => {
        btnCloseBrave.disabled = false;
      }, 1500);
    });
  }

  // ——— Clavier distant ———

  function openKeyboardPanel() {
    if (!keyboardPanel) return;
    keyboardPanel.hidden = false;
    viewTrackpadEl.classList.add("keyboard-open");
    btnKeyboardToggle?.classList.add("active");
    btnKeyboardToggle?.setAttribute("aria-expanded", "true");
    keyboardInput?.focus();
  }

  function closeKeyboardPanel() {
    if (!keyboardPanel) return;
    keyboardPanel.hidden = true;
    viewTrackpadEl.classList.remove("keyboard-open");
    btnKeyboardToggle?.classList.remove("active");
    btnKeyboardToggle?.setAttribute("aria-expanded", "false");
    keyboardInput?.blur();
  }

  if (btnKeyboardToggle && keyboardPanel) {
    btnKeyboardToggle.addEventListener("click", () => {
      if (keyboardPanel.hidden) {
        openKeyboardPanel();
      } else {
        closeKeyboardPanel();
      }
    });
  }

  if (keyboardForm) {
    keyboardForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = keyboardInput.value;
      if (text) {
        socketEmit("keyboard_type", { text });
        keyboardInput.value = "";
      }
    });
  }

  document.querySelectorAll(".key-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      socketEmit("keyboard_key", { key: btn.dataset.key });
    });
  });

  // ——— Catalogue ———

  async function loadCatalogue() {
    grid.innerHTML = '<p class="grid-loading">Chargement…</p>';
    try {
      const res = await fetch("/api/catalogue", { cache: "no-store" });
      if (!res.ok) throw new Error(res.statusText);
      const items = await res.json();
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error("catalogue vide");
      }
      renderCatalogue(items);
    } catch (err) {
      console.error("TVLive catalogue:", err);
      grid.innerHTML =
        '<p class="grid-error">Impossible de charger le catalogue.<br>Rechargez la page.</p>';
    }
  }

  function isLogoImage(url) {
    return /\.svg(\?|#|$)/i.test(url) || /logo/i.test(url);
  }

  function renderCatalogue(items) {
    grid.innerHTML = "";
    items.forEach((item) => {
      if (!item || !item.title) return;
      const isRemoteOnly = item.remote_only || !item.url;
      if (!isRemoteOnly && !item.url) return;

      const card = document.createElement("article");
      card.className = "card";
      if (isRemoteOnly) card.classList.add("card--remote");
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");

      const visual = document.createElement("div");
      visual.className = "card-visual";

      if (isRemoteOnly) {
        visual.classList.add("card-visual--remote");
      } else if (item.image) {
        const fitLogo = item.image_fit === "contain" || isLogoImage(item.image);
        visual.classList.add(fitLogo ? "card-visual--logo" : "card-visual--photo");

        const media = document.createElement("img");
        media.className = "card-media";
        media.src = item.image;
        media.alt = "";
        media.loading = "lazy";
        media.decoding = "async";
        if (item.image_position) {
          media.style.objectPosition = item.image_position;
        }
        media.onerror = () => {
          media.remove();
          visual.classList.remove("card-visual--logo", "card-visual--photo");
          visual.classList.add("card-visual--fallback");
        };
        visual.appendChild(media);
      } else {
        visual.classList.add("card-visual--fallback");
      }

      const info = document.createElement("div");
      info.className = "card-info";
      const titleEl = document.createElement("h3");
      titleEl.className = "card-title";
      titleEl.textContent = item.title;
      info.appendChild(titleEl);

      card.appendChild(visual);
      card.appendChild(info);

      const open = () => openService(item);
      card.addEventListener("click", open);
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      });

      grid.appendChild(card);
    });
  }

  function openService(item) {
    if (item.remote_only || !item.url) {
      openRemoteOnly(item.title);
      return;
    }
    socketEmit("open_url", { url: item.url });
    openRemoteOnly(item.title);
  }

  // ——— Trackpad : mouvements relatifs ———

  function resetTrackpadState() {
    lastX = null;
    lastY = null;
    trackpad.classList.remove("active-touch");
  }

  function emitMove(dx, dy) {
    const ix = Math.round(dx * SENSITIVITY);
    const iy = Math.round(dy * SENSITIVITY);
    if (ix || iy) {
      socketEmit("mouse_move", { dx: ix, dy: iy });
    }
  }

  function scrollOnce(dir) {
    socketEmit("scroll", { dir });
  }

  function bindScrollButton(btn, dir) {
    if (!btn) return;
    let timer = null;

    const start = (e) => {
      e.preventDefault();
      scrollOnce(dir);
      timer = setInterval(() => scrollOnce(dir), SCROLL_REPEAT_MS);
    };

    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    btn.addEventListener("touchstart", start, { passive: false });
    btn.addEventListener("touchend", stop);
    btn.addEventListener("touchcancel", stop);
    btn.addEventListener("mousedown", start);
    btn.addEventListener("mouseup", stop);
    btn.addEventListener("mouseleave", stop);
  }

  bindScrollButton(scrollUp, "up");
  bindScrollButton(scrollDown, "down");

  trackpad.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      trackpad.classList.add("active-touch");
      const t = e.touches;

      if (t.length !== 1) return;

      lastX = t[0].clientX;
      lastY = t[0].clientY;
      tapStartX = lastX;
      tapStartY = lastY;
      tapStartTime = Date.now();
    },
    { passive: false }
  );

  trackpad.addEventListener(
    "touchmove",
    (e) => {
      e.preventDefault();
      const t = e.touches;

      if (t.length !== 1 || lastX === null) return;

      const x = t[0].clientX;
      const y = t[0].clientY;
      const dx = x - lastX;
      const dy = y - lastY;

      if (dx || dy) {
        emitMove(dx, dy);
      }

      lastX = x;
      lastY = y;
    },
    { passive: false }
  );

  trackpad.addEventListener(
    "touchend",
    (e) => {
      const remaining = e.touches.length;

      if (remaining === 0) {
        trackpad.classList.remove("active-touch");

        if (e.changedTouches.length === 1 && lastX !== null) {
          const t = e.changedTouches[0];
          const moved =
            Math.hypot(t.clientX - tapStartX, t.clientY - tapStartY) <
            TAP_MAX_MOVE;
          const quick = Date.now() - tapStartTime < TAP_MAX_MS;

          if (moved && quick) {
            socketEmit("mouse_click");
          }
        }

        resetTrackpadState();
      } else if (remaining === 1) {
        const t = e.touches[0];
        lastX = t.clientX;
        lastY = t.clientY;
        tapStartX = lastX;
        tapStartY = lastY;
        tapStartTime = Date.now();
      }
    },
    { passive: false }
  );

  trackpad.addEventListener("touchcancel", resetTrackpadState);

  // Souris (debug sur desktop)
  let mouseDown = false;
  trackpad.addEventListener("mousedown", (e) => {
    mouseDown = true;
    lastX = e.clientX;
    lastY = e.clientY;
    tapStartX = lastX;
    tapStartY = lastY;
    tapStartTime = Date.now();
  });

  trackpad.addEventListener("mousemove", (e) => {
    if (!mouseDown || lastX === null) return;
    emitMove(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX;
    lastY = e.clientY;
  });

  trackpad.addEventListener("mouseup", (e) => {
    if (!mouseDown) return;
    mouseDown = false;
    const moved =
      Math.hypot(e.clientX - tapStartX, e.clientY - tapStartY) < TAP_MAX_MOVE;
    const quick = Date.now() - tapStartTime < TAP_MAX_MS;
    if (moved && quick) socketEmit("mouse_click");
    resetTrackpadState();
  });

  // Plein écran sur téléphone (télécommande = tout l'écran)
  function tryFullscreen() {
    const el = document.documentElement;
    const req =
      el.requestFullscreen ||
      el.webkitRequestFullscreen ||
      el.mozRequestFullScreen;
    if (req) req.call(el).catch(() => {});
  }

  window.addEventListener("load", () => setTimeout(tryFullscreen, 400));
  document.body.addEventListener("touchstart", tryFullscreen, { once: true });

  if (sessionStorage.getItem(STORAGE_VIEW) === "trackpad") {
    openRemoteOnly(sessionStorage.getItem("tvlive-title") || "Télécommande");
  } else {
    showView("home");
  }
  loadCatalogue();
})();
