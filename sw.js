// sw.js
const CACHE_VERSION = "milk-pwa-v12"; // <-- ZWIĘKSZAJ przy każdej publikacji
const APP_SHELL = [
  "/",               // jeśli masz routing na /
  "/app.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  self.skipWaiting(); // nowy SW od razu aktywny
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // usuń stare cache
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k !== CACHE_VERSION ? caches.delete(k) : null)));
      await self.clients.claim(); // przejmij kontrolę nad otwartymi kartami/PWA
    })()
  );
});

// Strategia: HTML zawsze z sieci (żeby aktualizacje wchodziły), reszta cache-first
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // tylko same-origin
  if (url.origin !== location.origin) return;

  // HTML: network-first (najważniejsze!)
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req, { cache: "no-store" });
          // zaktualizuj cache app shell
          const cache = await caches.open(CACHE_VERSION);
          cache.put(req, fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match(req);
          return cached || caches.match("/app.html");
        }
      })()
    );
    return;
  }

  // Pliki: cache-first, potem sieć
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) return cached;

      const fresh = await fetch(req);
      const cache = await caches.open(CACHE_VERSION);
      cache.put(req, fresh.clone());
      return fresh;
    })()
  );
});
