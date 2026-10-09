/*
 * Service Worker del Escáner (PWA — instalable y offline).
 *
 * Estrategia anti-caché-vieja (la lección del producto: el usuario NO debe
 * tener que "borrar datos del sitio" para ver la nueva versión):
 *  · Navegación (HTML): NETWORK-FIRST — si hay red SIEMPRE va al servidor;
 *    la caché solo responde si la red falla (offline).
 *  · Assets con hash de Next (_next/static, iconos): CACHE-FIRST, son
 *    inmutables por diseño (el nombre cambia con el contenido).
 *  · Resto (worker del escáner, manifest, OpenCV): STALE-WHILE-REVALIDATE.
 *
 * Al activar una versión nueva, limpia TODAS las cachés antiguas y llama a
 * clients.claim() — la pestaña abierta salta a la nueva versión al navegar.
 */
const VERSION = "escaner-v6";
const CORE_CACHE = `${VERSION}-core`;
const STATIC_CACHE = `${VERSION}-static`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
// A6: tope de entradas del caché runtime — antes crecía sin límite (llegó a
// cachear el ZIP de descarga y cualquier GET del mismo origen).
const RUNTIME_CACHE_MAX = 80;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CORE_CACHE);
        await cache.addAll([
          "./",
          "./manifest.webmanifest",
          "./icon-192.png",
          "./icon-512.png",
          "./apple-touch-icon.png",
        ]);
      } catch {
        /* el precache es best-effort: la app funciona sin él */
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Borra cualquier caché de versiones anteriores.
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => !n.startsWith(VERSION))
          .map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  // El cliente puede pedir saltar a la nueva versión explícitamente.
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

function isImmutableAsset(url) {
  return (
    url.pathname.includes("/_next/static/") ||
    url.pathname.endsWith("/icon-192.png") ||
    url.pathname.endsWith("/icon-512.png")
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // CDN de OpenCV, etc.

  // 1) Navegación → NETWORK-FIRST (anti caché vieja).
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          // A7: solo cachear navegaciones VÁLIDAS (un 404 como fallback
          // offline dejaba la app rota sin conexión).
          if (fresh && fresh.ok) {
            const cache = await caches.open(CORE_CACHE);
            cache.put("./", fresh.clone()).catch(() => undefined);
          }
          return fresh;
        } catch {
          const cached =
            (await caches.match(req)) ||
            (await caches.match("./")) ||
            (await caches.match("./index.html"));
          return (
            cached ||
            new Response("Sin conexión", { status: 503, statusText: "Offline" })
          );
        }
      })()
    );
    return;
  }

  // 2) Assets inmutables → CACHE-FIRST.
  if (isImmutableAsset(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        const fresh = await fetch(req);
        const cache = await caches.open(STATIC_CACHE);
        cache.put(req, fresh.clone()).catch(() => undefined);
        return fresh;
      })()
    );
    return;
  }

  // 3) Resto del mismo origen → STALE-WHILE-REVALIDATE.
  // A6: /downloads/ (ZIP de varios MB) y dominios grandes NO se cachean.
  if (url.pathname.includes("/downloads/")) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((fresh) => {
          if (fresh && fresh.status === 200) {
            cache.put(req, fresh.clone()).catch(() => undefined);
            // A6: purga FIFO cuando el caché runtime supera el tope.
            cache.keys().then((keys) => {
              if (keys.length <= RUNTIME_CACHE_MAX) return;
              for (const k of keys.slice(0, keys.length - RUNTIME_CACHE_MAX)) {
                cache.delete(k).catch(() => undefined);
              }
            }).catch(() => undefined);
          }
          return fresh;
        })
        .catch(() => undefined);
      return cached || (await network) || new Response("Sin conexión", { status: 503 });
    })()
  );
});
