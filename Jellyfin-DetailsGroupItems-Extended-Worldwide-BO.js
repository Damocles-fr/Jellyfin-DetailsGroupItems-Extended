/* Jellyfin-DetailsGroupItems-Optimized-TMDB-Fallback.js */
(function () {
  "use strict";

  const OMDB_API_KEY = "";  // Insert your OMDb API key here, 1000 requests per day with the OMDb free API key
  const TMDB_API_KEY = ""; // Optional: TMDb v3 API key (used to get Worldwide box office via "revenue"). If empty, fallback is OMDb BoxOffice (Domestic).

  const SETTINGS = {
    movies: {
      enableCountry: false,
      enableAwards: true,
      enableBoxOffice: true,
      awardsLinkSourceMovies: "imdb",
      enableClickableLink: false,
      rowOrder: ["boxoffice", "awards"],
    },
    tvShows: {
      enableCountry: false,
      enableAwards: true,
      enableClickableLink: false,
      rowOrder: ["awards"],
    },
  };

  const CACHE_TTL_MS = 86400000;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let lastUrl = "";
  let lastItemId = "";

  function getItemIdFromUrl() {
    const url = new URL(location.href);
    return (
      url.searchParams.get("id") ||
      (url.hash.match(/[?&]id=([^&]+)/)?.[1] ?? null)
    );
  }

  function getAccessToken() {
    try {
      const obj = JSON.parse(localStorage.getItem("jellyfin_credentials"));
      return obj?.Servers?.find((s) => s.AccessToken)?.AccessToken || null;
    } catch {
      return null;
    }
  }

  function cacheGet(k) {
    try {
      const o = JSON.parse(sessionStorage.getItem(k));
      return o && Date.now() < o.expires ? o.value : null;
    } catch {
      return null;
    }
  }

  function cacheSet(k, v) {
    try {
      sessionStorage.setItem(
        k,
        JSON.stringify({ value: v, expires: Date.now() + CACHE_TTL_MS })
      );
    } catch {}
  }

  async function fetchItem(id) {
    const token = getAccessToken();
    if (!token) return null;

    const r = await fetch(`${location.origin}/Items/${id}?Fields=ProviderIds`, {
      headers: { "X-Emby-Token": token },
    });
    return r.ok ? r.json() : null;
  }

  async function fetchOmdb(id) {
    const k = "omdb_" + id;
    const c = cacheGet(k);
    if (c) return c;

    const r = await fetch(`https://www.omdbapi.com/?i=${id}&apikey=${OMDB_API_KEY}`);
    if (!r.ok) return null;

    const d = await r.json();
    cacheSet(k, d);
    return d;
  }

  async function fetchTmdb(id) {
    if (!TMDB_API_KEY || !id) return null;

    const k = "tmdb_" + id;
    const c = cacheGet(k);
    if (c) return c;

    const r = await fetch(`https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_API_KEY}`);
    if (!r.ok) return null;

    const d = await r.json();
    cacheSet(k, d);
    return d;
  }

  function normalize(v) {
    if (!v) return "";
    const s = String(v).trim();
    return s && s !== "N/A" ? s : "";
  }

  function formatUSD(v) {
    const n = Number(String(v).replace(/[^\d]/g, ""));
    if (!n) return "";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n);
  }

  function findBox() {
    return document.querySelector(".itemDetailsGroup");
  }

  function getId(obj, key) {
    const ids = obj?.ProviderIds;
    if (!ids) return "";
    return Object.entries(ids).find(([k]) => k.toLowerCase() === key)?.[1] || "";
  }

  function buildUrl(k, ids, mode, cfg) {
    if (!cfg.enableClickableLink) return "";

    if (k === "country") return `https://www.imdb.com/title/${ids.imdbId}/locations/`;
    if (k === "awards") {
      if (mode === "movie" && cfg.awardsLinkSourceMovies === "tmdb" && ids.tmdbId)
        return `https://www.themoviedb.org/movie/${ids.tmdbId}/awards`;
      return `https://www.imdb.com/title/${ids.imdbId}/awards/`;
    }
    if (k === "boxoffice") return `https://www.boxofficemojo.com/title/${ids.imdbId}`;
    return "";
  }

  function createRow(box, key, label, value, href, clickable) {
    if (!value) return;

    let row = box.querySelector(`[data-omdb-row="${key}"]`);
    if (!row) {
      row = document.createElement("div");
      row.className = "detailsGroupItem";
      row.dataset.omdbRow = key;

      row.innerHTML = `
        <div class="label">${label}</div>
        <div class="content focuscontainer-x">
          <a class="button-link emby-button"></a>
        </div>
      `;
      box.appendChild(row);
    }

    const a = row.querySelector("a");
    a.textContent = value;

    if (clickable && href) {
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.setAttribute("is", "emby-linkbutton");
    } else {
      a.removeAttribute("href");
      a.removeAttribute("target");
      a.removeAttribute("rel");
      a.removeAttribute("is");
    }
  }

  async function run() {
    const id = getItemIdFromUrl();
    if (!id || id === lastItemId) return;

    lastItemId = id;

    for (let i = 0; i < 30; i++) {
      if (findBox()) break;
      await sleep(100);
    }

    const box = findBox();
    if (!box) return;

    const item = await fetchItem(id);
    if (!item) return;

    const imdbId = getId(item, "imdb");
    if (!imdbId) return;

    const tmdbId = getId(item, "tmdb");
    const omdb = await fetchOmdb(imdbId);
    if (!omdb) return;

    const mode = omdb.Type === "movie" ? "movie" : omdb.Type === "series" ? "tv" : "";
    if (!mode) return;

    const cfg = mode === "movie" ? SETTINGS.movies : SETTINGS.tvShows;
    const clickable = !!cfg.enableClickableLink;
    const ids = { imdbId, tmdbId };

    if (cfg.enableAwards)
      createRow(box, "awards", "Awards", normalize(omdb.Awards),
        buildUrl("awards", ids, mode, cfg), clickable);

    if (cfg.enableCountry)
      createRow(box, "country", "Country", normalize(omdb.Country),
        buildUrl("country", ids, mode, cfg), clickable);

    if (mode === "movie" && cfg.enableBoxOffice) {
      const tmdb = await fetchTmdb(tmdbId);
      let val = "";

      if (tmdb?.revenue) val = formatUSD(tmdb.revenue) + " (Worldwide)";
      else if (normalize(omdb.BoxOffice)) val = normalize(omdb.BoxOffice) + " (Domestic)";

      createRow(box, "boxoffice", "Box Office", val,
        buildUrl("boxoffice", ids, mode, cfg), clickable);
    }
  }

  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(run, 200);
    }
  }).observe(document.body, { childList: true, subtree: true });

  run();
})();
