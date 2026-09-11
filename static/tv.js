/**
 * TVLive — écran TV : accueil type box (hero + rangées), navigation flèches/OK.
 * Les touches arrivent soit d'un clavier, soit du téléphone (xdotool).
 */

(function () {
  "use strict";

  const IDLE_AMBIENT_MS = 4 * 60 * 1000;
  const NAV_THROTTLE_MS = 70;
  const LAUNCH_HIDE_MS = 7000;
  const BOOT_MIN_MS = 700;
  const POINTER_HIDE_MS = 2500;

  const $ = (id) => document.getElementById(id);
  const el = {
    bgImg: $("bg-img"),
    hero: $("hero"),
    heroKicker: $("hero-kicker"),
    heroTitle: $("hero-title"),
    heroSub: $("hero-sub"),
    heroBtn: $("hero-btn"),
    heroBtnText: $("hero-btn-text"),
    rows: $("rows"),
    clock: $("clock"),
    remoteStatus: $("remote-status"),
    remoteText: $("remote-text"),
    footRemote: $("foot-remote"),
    launch: $("launch"),
    launchText: $("launch-text"),
    ambient: $("ambient"),
    ambientClock: $("ambient-clock"),
    ambientDate: $("ambient-date"),
    toast: $("toast"),
  };

  // rows[i] = { el, railEl|null, tiles: [{ el, item }], col, scrollX }
  let rows = [];
  let focus = { row: 0, col: 0 };
  let heroItem = null;
  let lastNav = 0;
  let idleTimer = null;
  let launchTimer = null;
  let toastTimer = null;
  let pointerTimer = null;
  let ambientOn = false;
  let hadConnection = false;
  const bootStart = performance.now();

  // ——— Socket ———

  const socket = typeof io !== "undefined"
    ? io({ transports: ["websocket", "polling"] })
    : { emit() {}, on() {} };

  socket.on("connect", () => {
    socket.emit("register", { role: "tv" });
    if (hadConnection) {
      // Le serveur a redémarré (mise à jour) → on recharge pour avoir la nouvelle version
      setTimeout(() => location.reload(), 300);
    }
    hadConnection = true;
  });
  socket.on("remotes", (d) => setRemotes((d && d.count) || 0));
  socket.on("tv_wake", () => {
    wake();
    hideLaunch();
    refresh();
  });
  socket.on("tv_launch", (d) => showLaunch((d && d.title) || ""));
  socket.on("toast", (d) => toast((d && d.message) || ""));

  // ——— Données ———

  async function refresh() {
    const res = await fetch("/api/tv", { cache: "no-store" });
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json();
    render(data);
    return data;
  }

  function isLogoImage(url) {
    return /\.svg(\?|#|$)/i.test(url) || /logo/i.test(url);
  }

  function groupByCategory(items) {
    const map = new Map();
    for (const item of items) {
      if (!item || !item.title || !item.url) continue;
      const cat = (item.category || "Services").trim();
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat).push(item);
    }
    return [...map.entries()];
  }

  function pickHero(items, recent) {
    for (const r of recent || []) {
      const found = items.find((i) => i.url === r.url);
      if (found) return { item: found, kicker: "Reprendre" };
    }
    const first = items.find((i) => i && i.url);
    return first ? { item: first, kicker: "À la une" } : null;
  }

  // ——— Rendu ———

  function render(data) {
    const items = (data.items || []).filter((i) => i && i.url && i.title);
    setRemotes(data.remotes || 0);
    el.footRemote.textContent = data.ip
      ? `Télécommande : http://${data.ip}:${data.port}`
      : "";

    const hero = pickHero(items, data.recent);
    heroItem = hero ? hero.item : null;
    renderHero(hero);

    const prev = { row: focus.row, col: focus.col };
    el.rows.innerHTML = "";
    rows = [];

    if (heroItem) {
      rows.push({ el: el.hero, railEl: null, tiles: [{ el: el.heroBtn, item: heroItem }], col: 0, scrollX: 0 });
    }

    const groups = groupByCategory(items);
    if (groups.length === 0) {
      el.rows.innerHTML = '<p class="empty">Aucun service dans le catalogue (catalogue.json).</p>';
    }

    groups.forEach(([category, list]) => {
      const rowEl = document.createElement("section");
      rowEl.className = "row";
      const title = document.createElement("h2");
      title.className = "row-title";
      title.textContent = category;
      const clip = document.createElement("div");
      clip.className = "rail-clip";
      const rail = document.createElement("div");
      rail.className = "rail";
      clip.appendChild(rail);
      rowEl.appendChild(title);
      rowEl.appendChild(clip);
      el.rows.appendChild(rowEl);

      const row = { el: rowEl, railEl: rail, tiles: [], col: 0, scrollX: 0 };
      const rowIndex = rows.length;
      list.forEach((item, colIndex) => {
        const tile = buildTile(item);
        tile.dataset.row = String(rowIndex);
        tile.dataset.col = String(colIndex);
        rail.appendChild(tile);
        row.tiles.push({ el: tile, item });
      });
      rows.push(row);
    });

    if (rows.length === 0) return;
    const r = Math.min(prev.row, rows.length - 1);
    const c = Math.min(prev.col, rows[r].tiles.length - 1);
    setFocus(r, c, { instant: true });
  }

  function renderHero(hero) {
    if (!hero) {
      el.hero.hidden = true;
      el.bgImg.classList.remove("is-visible");
      return;
    }
    el.hero.hidden = false;
    const { item, kicker } = hero;
    el.heroKicker.textContent = kicker;
    el.heroTitle.textContent = item.title;
    el.heroSub.textContent = prettyHost(item.url);
    el.heroBtnText.textContent = kicker === "Reprendre" ? "Reprendre" : "Lancer";
    setBackground(item);
  }

  function setBackground(item) {
    const url = item && item.image;
    el.bgImg.classList.remove("is-visible", "bg--logo");
    if (!url) {
      el.bgImg.style.backgroundImage = "";
      return;
    }
    const logo = item.image_fit === "contain" || isLogoImage(url);
    const img = new Image();
    img.onload = () => {
      el.bgImg.style.backgroundImage = `url("${url}")`;
      el.bgImg.classList.toggle("bg--logo", logo);
      requestAnimationFrame(() => el.bgImg.classList.add("is-visible"));
    };
    img.src = url;
  }

  function prettyHost(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (_e) {
      return "";
    }
  }

  function buildTile(item) {
    const tile = document.createElement("article");
    tile.className = "tile";

    const visual = document.createElement("div");
    visual.className = "tile-visual";

    if (item.image) {
      const logo = item.image_fit === "contain" || isLogoImage(item.image);
      visual.classList.add(logo ? "tile-visual--logo" : "tile-visual--photo");
      const img = document.createElement("img");
      img.src = item.image;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      if (item.image_position) img.style.objectPosition = item.image_position;
      img.onerror = () => {
        img.remove();
        visual.classList.remove("tile-visual--logo", "tile-visual--photo");
        markFallback(visual, item.title);
      };
      visual.appendChild(img);
    } else {
      markFallback(visual, item.title);
    }

    const title = document.createElement("h3");
    title.className = "tile-title";
    title.textContent = item.title;

    tile.appendChild(visual);
    tile.appendChild(title);

    tile.addEventListener("mousemove", () => {
      showPointer();
      const r = Number(tile.dataset.row);
      const c = Number(tile.dataset.col);
      if (r !== focus.row || c !== focus.col) setFocus(r, c);
    });
    tile.addEventListener("click", () => launch(item));
    return tile;
  }

  function markFallback(visual, title) {
    visual.classList.add("tile-visual--fallback");
    visual.dataset.initial = (title || "?").trim().charAt(0).toUpperCase();
  }

  // ——— Focus & défilement ———

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function setFocus(r, c, opts) {
    if (rows.length === 0) return;
    r = clamp(r, 0, rows.length - 1);
    const row = rows[r];
    c = clamp(c, 0, row.tiles.length - 1);

    rows.forEach((rw, i) => {
      rw.el.classList.toggle("row--focused", i === r);
      rw.tiles.forEach((t, j) => t.el.classList.toggle("focused", i === r && j === c));
    });

    focus = { row: r, col: c };
    row.col = c;
    document.body.classList.toggle("is-browsing", r > 0 || !heroItem);

    scrollRail(row, opts);
    scrollRows(r, opts);
  }

  function scrollRail(row) {
    const rail = row.railEl;
    if (!rail) return;
    const tile = row.tiles[row.col].el;
    const pad = rail.parentElement.clientWidth * 0.045;
    const viewW = rail.parentElement.clientWidth;
    const left = tile.offsetLeft;
    const right = left + tile.offsetWidth;
    let x = row.scrollX || 0;
    if (right - x > viewW - pad) x = right - viewW + pad;
    if (left - x < pad) x = left - pad;
    x = Math.max(0, x);
    row.scrollX = x;
    rail.style.transform = x ? `translateX(${-x}px)` : "";
  }

  function scrollRows(r) {
    if (r === 0 && heroItem) {
      el.rows.style.transform = "";
      return;
    }
    const first = heroItem ? 1 : 0;
    const rowEl = rows[r].el;
    const y = r <= first ? 0 : rowEl.offsetTop - rows[first].el.offsetTop;
    el.rows.style.transform = y ? `translateY(${-y}px)` : "";
  }

  function move(dr, dc) {
    if (rows.length === 0) return;
    if (dr) {
      const nr = clamp(focus.row + dr, 0, rows.length - 1);
      setFocus(nr, rows[nr].col);
    } else {
      setFocus(focus.row, focus.col + dc);
    }
  }

  function launchFocused() {
    const row = rows[focus.row];
    if (!row) return;
    const t = row.tiles[focus.col];
    if (t) launch(t.item);
  }

  function launch(item) {
    if (!item || !item.url) return;
    socket.emit("open_url", { url: item.url, title: item.title });
    showLaunch(item.title);
  }

  // ——— Clavier / pointeur ———

  document.addEventListener("keydown", (e) => {
    wake();
    const k = e.key;
    const arrows = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    if (arrows[k]) {
      e.preventDefault();
      const now = performance.now();
      if (now - lastNav < NAV_THROTTLE_MS) return;
      lastNav = now;
      move(arrows[k][0], arrows[k][1]);
      return;
    }
    if (k === "Enter" || k === " ") {
      e.preventDefault();
      launchFocused();
      return;
    }
    if (k === "Escape" || k === "Backspace" || k === "Home") {
      e.preventDefault();
      setFocus(0, 0);
    }
  });

  el.heroBtn.addEventListener("click", () => heroItem && launch(heroItem));
  el.heroBtn.addEventListener("mousemove", () => {
    showPointer();
    if (focus.row !== 0) setFocus(0, 0);
  });

  document.addEventListener("mousemove", () => {
    showPointer();
    wake();
  });

  function showPointer() {
    document.body.classList.add("is-pointer");
    clearTimeout(pointerTimer);
    pointerTimer = setTimeout(() => document.body.classList.remove("is-pointer"), POINTER_HIDE_MS);
  }

  // ——— Lancement (voile) ———

  function showLaunch(title) {
    el.launchText.textContent = title ? `Lancement de ${title}…` : "Lancement…";
    el.launch.hidden = false;
    requestAnimationFrame(() => el.launch.classList.add("on"));
    clearTimeout(launchTimer);
    launchTimer = setTimeout(hideLaunch, LAUNCH_HIDE_MS);
  }

  function hideLaunch() {
    clearTimeout(launchTimer);
    el.launch.classList.remove("on");
    setTimeout(() => {
      if (!el.launch.classList.contains("on")) el.launch.hidden = true;
    }, 320);
  }

  // ——— Toast ———

  function toast(message) {
    if (!message) return;
    el.toast.textContent = message;
    el.toast.hidden = false;
    requestAnimationFrame(() => el.toast.classList.add("on"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toast.classList.remove("on");
      setTimeout(() => {
        if (!el.toast.classList.contains("on")) el.toast.hidden = true;
      }, 300);
    }, 1800);
  }

  // ——— Horloge & veille ambiante ———

  const fmtTime = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const fmtDate = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });

  function tickClock() {
    const now = new Date();
    const t = fmtTime.format(now);
    el.clock.textContent = t;
    el.ambientClock.textContent = t;
    el.ambientDate.textContent = fmtDate.format(now);
  }

  function resetIdle() {
    clearTimeout(idleTimer);
    if (!document.hidden) idleTimer = setTimeout(enterAmbient, IDLE_AMBIENT_MS);
  }

  function enterAmbient() {
    if (ambientOn) return;
    ambientOn = true;
    hideLaunch();
    el.ambient.style.setProperty("--ax", `${30 + Math.random() * 40}%`);
    el.ambient.style.setProperty("--ay", `${30 + Math.random() * 40}%`);
    el.ambient.hidden = false;
    requestAnimationFrame(() => el.ambient.classList.add("on"));
  }

  function exitAmbient() {
    if (!ambientOn) return;
    ambientOn = false;
    el.ambient.classList.remove("on");
    setTimeout(() => {
      if (!ambientOn) el.ambient.hidden = true;
    }, 1400);
  }

  function wake() {
    if (ambientOn) exitAmbient();
    resetIdle();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearTimeout(idleTimer);
    } else {
      // Retour sur l'accueil après un service : on repart propre
      exitAmbient();
      hideLaunch();
      resetIdle();
    }
  });

  function setRemotes(count) {
    el.remoteStatus.dataset.count = String(count);
    el.remoteText.textContent = count > 0
      ? (count === 1 ? "Télécommande connectée" : `${count} télécommandes`)
      : "Télécommande";
  }

  // ——— Démarrage ———

  tickClock();
  setInterval(tickClock, 10000);
  resetIdle();

  async function boot() {
    try {
      await refresh();
    } catch (err) {
      console.error("TVLive:", err);
      setTimeout(boot, 1500);
      return;
    }
    const wait = Math.max(0, BOOT_MIN_MS - (performance.now() - bootStart));
    setTimeout(() => document.body.classList.remove("is-booting"), wait);
  }

  boot();
  window.addEventListener("resize", () => rows.length && setFocus(focus.row, focus.col));
})();
