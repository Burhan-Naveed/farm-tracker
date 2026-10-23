// =========================================================
// Service worker: caches the app shell so the app opens even
// with weak or no internet. Firestore data is NOT handled here;
// Firestore has its own offline storage (enabled in app.js).
//
// When you change any app file, increase CACHE_VERSION so phones
// download the new version.
// =========================================================

const CACHE_VERSION = "farm-tracker-v7";

// Files that make up the app (relative paths, so it works on GitHub Pages).
// Every file in src/ must be listed here (a unit test checks this).
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./firebase-config.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./src/main.js",
  "./src/config.js",
  "./src/firebase.js",
  "./src/state.js",
  "./src/domain/attachments.js",
  "./src/domain/entries.js",
  "./src/domain/heads.js",
  "./src/domain/reports.js",
  "./src/domain/users.js",
  "./src/lib/csv.js",
  "./src/lib/errors.js",
  "./src/lib/format.js",
  "./src/lib/html.js",
  "./src/lib/image.js",
  "./src/services/auth.js",
  "./src/services/data.js",
  "./src/ui/chart.js",
  "./src/ui/components.js",
  "./src/ui/dom.js",
  "./src/ui/entries-page.js",
  "./src/ui/entry-form.js",
  "./src/ui/feedback.js",
  "./src/ui/heads-page.js",
  "./src/ui/navigation.js",
  "./src/ui/pwa.js",
  "./src/ui/reports-page.js",
  "./src/ui/session.js",
  "./src/ui/users-page.js",
  "./src/ui/viewer.js",
  "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js",
  "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js",
  "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js",
  "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"
];

// Other websites whose files we may cache (the libraries above)
const CACHEABLE_HOSTS = ["www.gstatic.com", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"];

/**
 * Install: download and store the app shell. "reload" skips the browser's
 * HTTP cache, so a new version never mixes new and old module files.
 */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

/** Activate: delete caches from older versions. */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/**
 * Fetch: "stale-while-revalidate" for app files and libraries.
 * Serve from cache straight away (fast, works offline), and update
 * the cache in the background when internet is available.
 * Everything else (Firebase login, Firestore) goes straight to the network.
 */
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !CACHEABLE_HOSTS.includes(url.hostname)) return;

  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: sameOrigin });
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => null);

      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      const response = await network;
      if (response) return response;
      // Offline and not cached: for page navigations show the cached app
      if (request.mode === "navigate") return cache.match("./index.html");
      return Response.error();
    })
  );
});
