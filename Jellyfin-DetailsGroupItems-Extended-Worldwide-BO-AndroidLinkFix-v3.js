/* Jellyfin-DetailsGroupItems-Extended-Worldwide-BO-AndroidLinkFix-v3.js */
(function () {
  "use strict";

  const OMDB_API_KEY = ""; // Insert your OMDb API key here, 1000 requests per day with the OMDb free API key
  const TMDB_API_KEY = ""; // Optional: TMDb v3 API key (used to get Worldwide box office via "revenue"). If empty, fallback is OMDb BoxOffice (Domestic).

  const SETTINGS = {
    // MOVIES
    movies: {
      enableCountry: true, // "true" or "false" - Show Movie country of origin
      enableAwards: true, // "true" or "false" - Show Movie awards information
      enableBoxOffice: true, // "true" or "false" - Show Movie box office data (Movies only)
      awardsLinkSourceMovies: "imdb", // "imdb" or "tmdb" (Movies only) - Open the IMDb or TMDb awards website on click (TMDb needs TMDb ID in Jellyfin DB)
      enableClickableLink: true, // "true" or "false" - Movies enable / disable clickable links
      rowOrder: ["country", "awards", "boxoffice"],
      // Movie Row display order, e.g ["awards", "boxoffice", "country"]; (1st placed after Studios, Writer, Director, Genres - if available; if Row not used disable to false or remove from this order list)
    },
    // TV SHOWS (only on MAIN level, not on Season or Episode level)
    tvShows: {
      enableCountry: true, // "true" or "false" - Show TV Show country of origin
      enableAwards: true, // "true" or "false" - Show TV Show awards information
      enableClickableLink: true, // "true" or "false" - TV Shows enable / disable clickable links
      rowOrder: ["country", "awards"],
      // TV Show Row display order, e.g ["awards", "country"];  (1st placed after Studios, Genres - if available; if Row not used disable to false or remove from this order list)
    },
  };

  const CACHE_TTL_MS = 1000 * 60 * 60 * 24;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Robust SPA handling
  const WATCHDOG_MS = 350; // keeps re-applying after Jellyfin re-renders the details panel
  const MAX_WAIT_MS = 12000;
  const REAPPLY_DELAY_MS = 250;

  let scheduled = null;
  let runSeq = 0;
  let lastItemId = "";
  let lastAppliedItemId = "";
  let boxObserver = null;

  function scheduleRun(delay = 0) {
    if (scheduled) clearTimeout(scheduled);
    scheduled = setTimeout(run, delay);
  }

  function isDetailsRoute() {
    const h = String(location.hash || "");
    return h.includes("/details") && (h.includes("id=") || new URL(location.href).searchParams.get("id"));
  }

  function getBaseUrl() {
    return window.location.origin;
  }

  function getItemIdFromUrl() {
    const url = new URL(window.location.href);
    const id = url.searchParams.get("id");
    if (id) return id;
    const hash = url.hash || "";
    const m = hash.match(/[?&]id=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function getAccessToken() {
    try {
      const raw = localStorage.getItem("jellyfin_credentials");
      if (!raw) return null;
      const obj = JSON.parse(raw);
      const server = obj?.Servers?.find((s) => s.AccessToken);
      return server?.AccessToken || null;
    } catch {
      return null;
    }
  }

  function cacheGet(key) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (Date.now() > obj.expires) return null;
      return obj.value;
    } catch {
      return null;
    }
  }

  function cacheSet(key, value) {
    try {
      sessionStorage.setItem(key, JSON.stringify({ value, expires: Date.now() + CACHE_TTL_MS }));
    } catch {}
  }

  async function fetchItem(itemId) {
    const token = getAccessToken();
    if (!token) return null;
    const res = await fetch(`${getBaseUrl()}/Items/${itemId}?Fields=ProviderIds`, {
      headers: { "X-Emby-Token": token },
    });
    if (!res.ok) return null;
    return res.json();
  }

  async function fetchOmdb(imdbId) {
    const cacheKey = "omdb_full_" + imdbId;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const res = await fetch(
      `https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${encodeURIComponent(OMDB_API_KEY)}`
    );
    if (!res.ok) return null;

    const data = await res.json();
    cacheSet(cacheKey, data);
    return data;
  }

  async function fetchTmdbMovie(tmdbId) {
    if (!TMDB_API_KEY || !tmdbId) return null;

    const cacheKey = "tmdb_movie_" + tmdbId;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const res = await fetch(
      `https://api.themoviedb.org/3/movie/${encodeURIComponent(tmdbId)}?api_key=${encodeURIComponent(TMDB_API_KEY)}`
    );
    if (!res.ok) return null;

    const data = await res.json();
    cacheSet(cacheKey, data);
    return data;
  }

  function normalizeValue(v) {
    if (!v) return "";
    const s = String(v).trim();
    if (!s || s.toUpperCase() === "N/A") return "";
    return s;
  }

  function formatUsdRevenue(n) {
    if (n == null) return "";
    const val =
      typeof n === "number"
        ? n
        : typeof n === "string"
        ? Number(String(n).replace(/[^\d.-]/g, ""))
        : NaN;

    if (!Number.isFinite(val) || val <= 0) return "";

    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(val);
    } catch {
      return "$" + Math.round(val).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }
  }

  function isElementVisible(el) {
    if (!el || !el.isConnected) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2) return false;
    return true;
  }

  // IMPORTANT: Jellyfin often keeps old (hidden) pages in DOM.
  // Always target the visible details group, otherwise rows get injected into a hidden page.
  function findDetailsBox() {
    const list = Array.from(document.querySelectorAll(".itemDetailsGroup"));
    if (!list.length) return null;

    let best = null;
    let bestArea = 0;

    for (const el of list) {
      if (!isElementVisible(el)) continue;
      const r = el.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) {
        bestArea = area;
        best = el;
      }
    }

    // Fallback: newest in DOM
    return best || list[list.length - 1];
  }

  function isDetailsBoxReady(box) {
    if (!box) return false;
    // Wait for Jellyfin native rows to exist in THIS (visible) box.
    return !!box.querySelector('.detailsGroupItem:not([data-omdb-row])');
  }

  function getProviderId(item, wantedKey) {
    const ids = item?.ProviderIds;
    if (!ids) return "";
    const target = String(wantedKey).toLowerCase();

    for (const k of Object.keys(ids)) {
      if (String(k).toLowerCase() === target) return String(ids[k] || "");
    }
    return "";
  }

  function uniqueOrder(order) {
    const out = [];
    const seen = new Set();

    for (const k of order || []) {
      const key = String(k).toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(key);
      }
    }
    return out;
  }

  function normalizeRowOrderForMode(modeKey, order) {
    const base = uniqueOrder(order);
    const allowed = modeKey === "movie" ? ["country", "awards", "boxoffice"] : ["country", "awards"];
    return base.filter((k) => allowed.includes(k));
  }

  function buildLinkUrl(key, ids, modeKey, modeSettings) {
    if (!modeSettings.enableClickableLink) return "";

    const imdbId = ids.imdbId;
    const tmdbId = ids.tmdbId;

    if (key === "country") {
      if (!imdbId) return "";
      return `https://www.imdb.com/title/${imdbId}/locations/`;
    }

    if (key === "awards") {
      if (modeKey === "movie" && modeSettings.awardsLinkSourceMovies === "tmdb" && tmdbId) {
        return `https://www.themoviedb.org/movie/${tmdbId}/awards`;
      }
      if (!imdbId) return "";
      return `https://www.imdb.com/title/${imdbId}/awards/`;
    }

    if (key === "boxoffice") {
      if (!imdbId) return "";
      return `https://www.boxofficemojo.com/title/${imdbId}`;
    }

    return "";
  }

  function setExternalLinkBehavior(el, url) {
    if (!el || !url) return;

    el.href = url;
    el.target = "_blank";
    el.rel = "noopener noreferrer";
    el.setAttribute("is", "emby-linkbutton");
    el.setAttribute("data-imdb-processed", "true");
  }

  function clearExternalLinkBehavior(el) {
    if (!el) return;

    el.removeAttribute("href");
    el.removeAttribute("target");
    el.removeAttribute("rel");
    el.removeAttribute("is");
    el.removeAttribute("data-imdb-processed");
  }

  function applyLinkStyling(a, enabled) {
    if (!a) return;

    if (!enabled) {
      a.style.pointerEvents = "none";
      a.style.color = "inherit";
      a.style.fontWeight = "600";
      a.style.cursor = "default";
      a.style.textDecoration = "none";
      return;
    }

    a.style.pointerEvents = "auto";
    a.style.fontWeight = "600";
    a.style.color = "inherit";
    a.style.textDecoration = "none";
    a.style.cursor = "pointer";
    a.style.display = "inline";
    a.style.whiteSpace = "normal";
    a.style.overflowWrap = "anywhere";
    a.style.wordBreak = "break-word";
    a.style.lineHeight = "1.2";
    a.style.padding = "0";
    a.style.margin = "0";

    if (!a.dataset.hoverUnderlineBound) {
      a.addEventListener("mouseenter", () => {
        a.style.textDecoration = "underline";
      });
      a.addEventListener("mouseleave", () => {
        a.style.textDecoration = "none";
      });
      a.dataset.hoverUnderlineBound = "true";
    }
  }

  function syncLinkBehavior(link, href, clickable) {
    const enabled = !!(clickable && href);

    if (enabled) {
      setExternalLinkBehavior(link, href);
    } else {
      clearExternalLinkBehavior(link);
    }

    applyLinkStyling(link, enabled);
    return enabled;
  }

  function getOrCreateRow(box, key, labelText, href, clickable) {
    const selector = `[data-omdb-row="${key}"]`;
    let row = box.querySelector(selector);
    if (row) return row;

    row = document.createElement("div");
    row.className = "detailsGroupItem";
    row.dataset.omdbRow = key;

    const label = document.createElement("div");
    label.className = "label";
    label.textContent = labelText;

    const content = document.createElement("div");
    content.className = "content focuscontainer-x";

    const link = document.createElement("a");
    link.className = "button-link emby-button";

    syncLinkBehavior(link, href, clickable);

    content.appendChild(link);
    row.appendChild(label);
    row.appendChild(content);

    return row;
  }

  function upsertRow(box, key, labelText, valueText, href, clickable) {
    const value = normalizeValue(valueText);
    const existing = box.querySelector(`[data-omdb-row="${key}"]`);

    if (!value) {
      if (existing) existing.remove();
      return null;
    }

    const row = existing || getOrCreateRow(box, key, labelText, href, clickable);
    const link = row.querySelector(".content a");

    if (link) {
      link.textContent = value;
      syncLinkBehavior(link, href, clickable);
    }

    return row;
  }

  function removeRow(box, key) {
    const row = box.querySelector(`[data-omdb-row="${key}"]`);
    if (row) row.remove();
  }

  function appendInOrder(box, rowsByKey, orderKeys) {
    for (const key of orderKeys) {
      const row = rowsByKey[key];
      if (row) box.appendChild(row);
    }
  }

  function modeFromOmdbType(type) {
    if (type === "movie") return "movie";
    if (type === "series") return "tv";
    return "";
  }

  function getModeSettings(modeKey) {
    return modeKey === "movie" ? SETTINGS.movies : SETTINGS.tvShows;
  }

  function isRowEnabled(modeKey, modeSettings, orderSet, rowKey) {
    if (!orderSet.has(rowKey)) return false;
    if (rowKey === "country") return !!modeSettings.enableCountry;
    if (rowKey === "awards") return !!modeSettings.enableAwards;
    if (rowKey === "boxoffice") return modeKey === "movie" && !!modeSettings.enableBoxOffice;
    return false;
  }

  function connectBoxObserver(box) {
    if (boxObserver) {
      try {
        boxObserver.disconnect();
      } catch {}
      boxObserver = null;
    }

    if (!box) return;

    boxObserver = new MutationObserver(() => {
      if (!isDetailsRoute()) return;

      const itemIdNow = getItemIdFromUrl() || "";
      if (!itemIdNow) return;

      const currentBox = findDetailsBox();
      if (!currentBox) return;

      const missing =
        !currentBox.querySelector('[data-omdb-row="country"]') &&
        !currentBox.querySelector('[data-omdb-row="awards"]') &&
        !currentBox.querySelector('[data-omdb-row="boxoffice"]');

      if (missing) scheduleRun(REAPPLY_DELAY_MS);
    });

    boxObserver.observe(document.body, { childList: true, subtree: true });
  }

  // Trigger points
  window.addEventListener("hashchange", () => scheduleRun(0), true);
  window.addEventListener("popstate", () => scheduleRun(0), true);

  document.addEventListener("viewshow", () => scheduleRun(0), true);
  document.addEventListener("viewbeforeshow", () => scheduleRun(0), true);

  new MutationObserver(() => {
    if (isDetailsRoute()) scheduleRun(0);
  }).observe(document.body, { childList: true, subtree: true });

  setInterval(() => {
    if (!isDetailsRoute()) return;

    const itemId = getItemIdFromUrl() || "";
    const box = findDetailsBox();

    if (itemId && itemId !== lastItemId) {
      lastItemId = itemId;
      scheduleRun(0);
      scheduleRun(350);
      scheduleRun(900);
      return;
    }

    if (itemId && box) {
      const hasAny =
        !!box.querySelector('[data-omdb-row="country"]') ||
        !!box.querySelector('[data-omdb-row="awards"]') ||
        !!box.querySelector('[data-omdb-row="boxoffice"]');

      if (!hasAny) scheduleRun(REAPPLY_DELAY_MS);
    }
  }, WATCHDOG_MS);

  async function run() {
    const mySeq = ++runSeq;

    if (!isDetailsRoute()) return;

    const itemId = getItemIdFromUrl();
    if (!itemId) return;

    const startedAt = Date.now();
    let box = null;

    while (Date.now() - startedAt < MAX_WAIT_MS) {
      if (mySeq !== runSeq) return;

      box = findDetailsBox();
      if (box && isDetailsBoxReady(box)) break;

      await sleep(120);
    }

    if (mySeq !== runSeq) return;
    if (!box) return;

    connectBoxObserver(box);

    if (lastAppliedItemId === itemId) {
      const stillThere =
        !!box.querySelector('[data-omdb-row="country"]') ||
        !!box.querySelector('[data-omdb-row="awards"]') ||
        !!box.querySelector('[data-omdb-row="boxoffice"]');

      if (stillThere) return;
    }

    const item = await fetchItem(itemId);
    if (mySeq !== runSeq) return;
    if (!item) return;

    const imdbId = getProviderId(item, "imdb");
    if (!imdbId) return;

    const tmdbId = getProviderId(item, "tmdb");
    const omdb = await fetchOmdb(imdbId);
    if (mySeq !== runSeq) return;
    if (!omdb) return;

    const modeKey = modeFromOmdbType(omdb.Type);
    if (!modeKey) return;

    const modeSettings = getModeSettings(modeKey);
    const order = normalizeRowOrderForMode(modeKey, modeSettings.rowOrder);
    const orderSet = new Set(order);
    const ids = { imdbId, tmdbId };
    const rows = {};
    const clickable = !!modeSettings.enableClickableLink;

    if (isRowEnabled(modeKey, modeSettings, orderSet, "country")) {
      rows.country = upsertRow(
        box,
        "country",
        "Country",
        omdb.Country,
        buildLinkUrl("country", ids, modeKey, modeSettings),
        clickable
      );
    } else {
      removeRow(box, "country");
    }

    if (isRowEnabled(modeKey, modeSettings, orderSet, "awards")) {
      rows.awards = upsertRow(
        box,
        "awards",
        "Awards",
        omdb.Awards,
        buildLinkUrl("awards", ids, modeKey, modeSettings),
        clickable
      );
    } else {
      removeRow(box, "awards");
    }

    if (isRowEnabled(modeKey, modeSettings, orderSet, "boxoffice")) {
      const tmdbMovie = await fetchTmdbMovie(tmdbId);
      if (mySeq !== runSeq) return;

      const worldwide = formatUsdRevenue(tmdbMovie?.revenue);

      let boxOfficeValue = "";
      if (worldwide) {
        boxOfficeValue = worldwide + " (Worldwide)";
      } else {
        const domestic = normalizeValue(omdb.BoxOffice);
        if (domestic) boxOfficeValue = domestic + " (Domestic)";
      }

      rows.boxoffice = upsertRow(
        box,
        "boxoffice",
        "Box Office",
        boxOfficeValue,
        buildLinkUrl("boxoffice", ids, modeKey, modeSettings),
        clickable
      );
    } else {
      removeRow(box, "boxoffice");
    }

    appendInOrder(box, rows, order);
    lastAppliedItemId = itemId;
  }

  scheduleRun(0);
})();