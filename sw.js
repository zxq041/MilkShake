// sw.js — Milk PWA Service Worker (SAFE)
// ✅ cache tylko dla GET i statycznych plików
// ✅ NIE dotyka /api/* ani /socket.io/*
// ✅ HTML network-first, reszta cache-first

const CACHE_VERSION = "milk-pwa-v13"; // <-- ZWIĘKSZAJ przy każdej publikacji

const APP_SHELL = [
  "/", // jeśli masz routing na /
  "/app.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k !== CACHE_VERSION ? caches.delete(k) : null)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // tylko same-origin
  if (url.origin !== self.location.origin) return;

  // ❗️NIGDY nie cache'ujemy nie-GET (POST/PUT/DELETE itd.)
  if (req.method !== "GET") return;

  // ❗️NIGDY nie dotykamy backendu/API ani socketów
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/socket.io/")) return;

  // HTML: network-first (żeby aktualizacje wchodziły)
  const accept = req.headers.get("accept") || "";
  const isHTML = req.mode === "navigate" || accept.includes("text/html");

  if (isHTML) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req, { cache: "no-store" });
          const cache = await caches.open(CACHE_VERSION);
          cache.put(req, fresh.clone());
          return fresh;
        } catch (e) {
          const cached = await caches.match(req);
          return cached || (await caches.match("/app.html")) || Response.error();
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
