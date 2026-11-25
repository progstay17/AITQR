// AITQR service worker: offline shell, versioned cache, never swaps code mid-session.
const BUILD = "__BUILD__";
const CACHE = `aitqr-${BUILD}`;
const PRECACHE = [
  "/",
  "/index.html",
  "/styles.css",
  "/manifest.json",
  "/icon.svg",
  "/bundles/default.bundle.json",
  "/app/main.js",
  "/app/app.js",
  "/app/dom.js",
  "/app/i18n.js",
  "/app/profile.js",
  "/app/session.js",
  "/app/payload.js",
  "/app/config/load.js",
  "/app/config/verify.js",
  "/app/config/canonical.js",
  "/app/config/trustedAdminKeys.js",
  "/app/qr.js",
  "/app/db.js",
  "/app/keys.js",
  "/app/mq2.js",
  "/app/admin.js",
  "/admin.html",
  "/vendor/qrcodegen/index.js",
  "/app/types.js",
  "/vendor/metaqr/src/index.js",
  "/vendor/metaqr/src/base45.js",
  "/vendor/metaqr/src/crypto.js",
  "/vendor/metaqr/src/device.js",
  "/vendor/metaqr/src/errors.js",
  "/vendor/metaqr/src/keys.js",
  "/vendor/metaqr/src/payload.js",
  "/vendor/metaqr/src/signing.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Tolerate individual misses: a single renamed asset must not break the whole install.
      .then((cache) => Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Configuration updates must reach the network when it is available.
  if (url.pathname.startsWith("/bundles/latest")) {
    event.respondWith(fetch(request).catch(() => caches.match(request)));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match("/index.html")) ?? Response.error()),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
