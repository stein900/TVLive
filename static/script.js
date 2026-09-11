/**
 * TVLive — Télécommande mobile (WebSocket + trackpad relatif + D-pad + réglages)
 */

(function () {
  "use strict";

  const SENSITIVITY = 1.2;
  const TAP_MAX_MOVE = 12;
  const TAP_MAX_MS = 280;
  const SCROLL_REPEAT_MS = 140;
  const KEY_REPEAT_DELAY_MS = 380;
  const KEY_REPEAT_MS = 110;
  const CONFIRM_MS = 4000;

  const viewHome = document.getElementById("view-home");
  const viewTrackpad = document.getElementById("view-trackpad");
  const catalogueEl = document.getElementById("catalogue-grid");
  const trackpad = document.getElementById("trackpad");
  const scrollUp = document.getElementById("scroll-up");
  const scrollDown = document.getElementById("scroll-down");
  const trackpadTitle = document.getElementById("trackpad-title");
  const btnBack = document.getElementById("btn-back");
  const btnRemoteOnly = document.getElementById("btn-remote-only");
  const btnTvHome = document.getElementById("btn-tv-home");
  const btnSettings = document.getElementById("btn-settings");
  const btnCloseBrave = document.getElementById("btn-close-brave");
  const btnKeyboardToggle = document.getElementById("btn-keyboard-toggle");
  const keyboardPanel = document.getElementById("keyboard-panel");
  const keyboardForm = document.getElementById("keyboard-form");
  const keyboardInput = document.getElementById("keyboard-input");
  const sheet = document.getElementById("sheet");
  const toastEl = document.getElementById("toast");
  const STORAGE_VIEW = "tvlive-view";

  const socket =
    typeof io !== "undefined"
      ? io({ transports: ["websocket", "polling"] })
      : { emit() {}, on() {} };

  function socketEmit(event, data) {
    socket.emit(event, data);
  }

  socket.on("connect", () => socketEmit("register", { role: "remote" }));
  socket.on("notice", (d) => {
    if (!d || !d.message) return;
    if (d.quiet) {
      toast(d.message, { ok: true, short: true });
    } else {
      toast(d.message, { ok: d.ok !== false });
    }
  });

  let lastX = null;
  let lastY = null;
  let tapStartX = 0;
  let tapStartY = 0;
  let tapStartTime = 0;

  // ——— Toast ———

  let toastTimer = null;
  function toast(message, opts) {
    const o = opts || {};
    toastEl.textContent = message;
    toastEl.classList.toggle("toast--error", o.ok === false);
    toastEl.hidden = false;
    requestAnimationFrame(() => toastEl.classList.add("on"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove("on");
      setTimeout(() => {
        if (!toastEl.classList.contains("on")) toastEl.hidden = true;
      }, 220);
    }, o.short ? 900 : 2600);
  }

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

  if (!catalogueEl) {
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

  // ——— Accueil TV (ferme les services, retour à l'écran d'accueil) ———

  function goTvHome(btn) {
    socketEmit("tv_home");
    toast("Accueil TV", { ok: true, short: true });
    if (!btn) return;
    btn.disabled = true;
    setTimeout(() => {
      btn.disabled = false;
    }, 1200);
  }

  if (btnTvHome) btnTvHome.addEventListener("click", () => goTvHome(btnTvHome));
  if (btnCloseBrave) btnCloseBrave.addEventListener("click", () => goTvHome(btnCloseBrave));

  // ——— Clavier distant ———

  function openKeyboardPanel() {
    if (!keyboardPanel) return;
    keyboardPanel.hidden = false;
    viewTrackpad.classList.add("keyboard-open");
    btnKeyboardToggle?.classList.add("active");
    btnKeyboardToggle?.setAttribute("aria-expanded", "true");
    keyboardInput?.focus();
  }

  function closeKeyboardPanel() {
    if (!keyboardPanel) return;
    keyboardPanel.hidden = true;
    viewTrackpad.classList.remove("keyboard-open");
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

  // Touches (D-pad, raccourcis clavier) : appui simple + répétition en maintenant
  function sendKey(key) {
    socketEmit("keyboard_key", { key });
  }

  function bindRepeatKey(btn, fire) {
    let delayTimer = null;
    let repeatTimer = null;
    let firedByTouch = false;

    const stop = () => {
      clearTimeout(delayTimer);
      clearInterval(repeatTimer);
      delayTimer = null;
      repeatTimer = null;
    };

    const start = (e) => {
      if (e.type === "touchstart") {
        firedByTouch = true;
        e.preventDefault();
      } else if (firedByTouch) {
        return;
      }
      fire();
      stop();
      delayTimer = setTimeout(() => {
        repeatTimer = setInterval(fire, KEY_REPEAT_MS);
      }, KEY_REPEAT_DELAY_MS);
    };

    btn.addEventListener("touchstart", start, { passive: false });
    btn.addEventListener("touchend", stop);
    btn.addEventListener("touchcancel", stop);
    btn.addEventListener("mousedown", start);
    btn.addEventListener("mouseup", stop);
    btn.addEventListener("mouseleave", stop);
  }

  document.querySelectorAll(".key-btn[data-key]").forEach((btn) => {
    const key = btn.dataset.key;
    if (btn.classList.contains("dpad-btn") && key !== "Return") {
      bindRepeatKey(btn, () => sendKey(key));
    } else {
      btn.addEventListener("click", () => sendKey(key));
    }
  });

  document.querySelectorAll(".vol-btn[data-vol]").forEach((btn) => {
    const dir = btn.dataset.vol;
    if (dir === "mute") {
      btn.addEventListener("click", () => socketEmit("volume", { dir }));
    } else {
      bindRepeatKey(btn, () => socketEmit("volume", { dir }));
    }
  });

  // ——— Réglages (feuille) ———

  async function refreshStatus() {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (!res.ok) throw new Error(res.statusText);
      const s = await res.json();
      document.getElementById("st-url").textContent = `http://${s.ip}:${s.port}`;
      document.getElementById("st-version").textContent = s.version || "—";
      document.getElementById("st-mode").textContent = s.box_mode
        ? "Box TV" + (s.browser_up ? " · écran OK" : " · écran ?")
        : "Bureau (mode PC)" + (s.browser_up ? " · écran OK" : "");
    } catch (_err) {
      document.getElementById("st-mode").textContent = "Serveur injoignable";
    }
  }

  function openSheet() {
    sheet.hidden = false;
    refreshStatus();
  }

  function closeSheet() {
    sheet.hidden = true;
    sheet.querySelectorAll(".sheet-btn.is-confirm").forEach(resetConfirm);
  }

  function resetConfirm(btn) {
    btn.classList.remove("is-confirm");
    const label = btn.querySelector(".sheet-btn-label");
    if (label && btn.dataset.label) label.textContent = btn.dataset.label;
    clearTimeout(btn._confirmTimer);
  }

  if (btnSettings) btnSettings.addEventListener("click", openSheet);
  sheet.querySelectorAll("[data-sheet-close]").forEach((b) => b.addEventListener("click", closeSheet));

  sheet.querySelectorAll(".sheet-btn[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      if (btn.hasAttribute("data-confirm") && !btn.classList.contains("is-confirm")) {
        // Premier appui : demande confirmation, le second envoie
        const label = btn.querySelector(".sheet-btn-label");
        if (label) {
          btn.dataset.label = label.textContent;
          label.textContent = "Confirmer ?";
        }
        btn.classList.add("is-confirm");
        btn._confirmTimer = setTimeout(() => resetConfirm(btn), CONFIRM_MS);
        return;
      }
      resetConfirm(btn);
      socketEmit("system_action", { action });
      btn.disabled = true;
      setTimeout(() => {
        btn.disabled = false;
      }, 1500);
      if (action === "home" || action === "restart_browser") closeSheet();
    });
  });

  // ——— Catalogue ———

  async function loadCatalogue() {
    catalogueEl.innerHTML = '<p class="grid-loading">Chargement…</p>';
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
      catalogueEl.innerHTML =
        '<p class="grid-error">Impossible de charger le catalogue.<br>Rechargez la page.</p>';
    }
  }

  function isLogoImage(url) {
    return /\.svg(\?|#|$)/i.test(url) || /logo/i.test(url);
  }

  function renderCatalogue(items) {
    catalogueEl.innerHTML = "";
    const groups = new Map();
    items.forEach((item) => {
      if (!item || !item.title) return;
      const isRemoteOnly = item.remote_only || !item.url;
      const cat = isRemoteOnly ? "" : (item.category || "Services").trim();
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(item);
    });

    groups.forEach((list, cat) => {
      const section = document.createElement("section");
      section.className = "category";
      if (cat) {
        const h = document.createElement("h2");
        h.className = "section-title";
        h.textContent = cat;
        section.appendChild(h);
      }
      const grid = document.createElement("div");
      grid.className = "grid";
      list.forEach((item) => grid.appendChild(buildCard(item)));
      section.appendChild(grid);
      catalogueEl.appendChild(section);
    });
  }

  function buildCard(item) {
    const isRemoteOnly = item.remote_only || !item.url;
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
    return card;
  }

  function openService(item) {
    if (item.remote_only || !item.url) {
      openRemoteOnly(item.title);
      return;
    }
    socketEmit("open_url", { url: item.url, title: item.title });
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
