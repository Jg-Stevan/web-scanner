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
 * E-04 — actualización con consentimiento: una versión nueva QUEDA EN
 * waiting (nunca skipWaiting incondicional en install). La app detecta el
 * worker esperando y muestra el banner «Nueva versión lista» (pwa.ts);
 * solo al pulsar Recargar se envía SKIP_WAITING y el SW nuevo toma el
 * control. Así la pestaña abierta sigue funcionando con SU versión hasta
 * que el usuario acepte — fin de los chunk-load-errors en cada deploy.
 *
 * Al activar una versión nueva (cuando el usuario la acepta), limpia TODAS
 * las cachés antiguas y llama a clients.claim().
 */
const VERSION = "escaner-v7";
const CORE_CACHE = `${VERSION}-core`;
const STATIC_CACHE = `${VERSION}-static`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const OCR_CACHE = `${VERSION}-ocr`;
const OCR_CACHE_MAX = 20;
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
          // PERF-1b (lote8) — motor OpenCV offline: glue (sin wasm embebido)
          // + wasm separado. Best-effort igual que el resto del precache.
          "./vendor/opencv-4.5.5-core.js",
          "./scanner/opencv-4.5.5-core.wasm",
        ]);
      } catch {
        /* el precache es best-effort: la app funciona sin él */
      }
      // E-04 — sin skipWaiting incondicional: el SW nuevo queda waiting y la
      // pestaña vieja sigue sirviéndose con el SW actual hasta que el usuario
      // pulse Recargar en el banner (que envía SKIP_WAITING al listener de
      // abajo). Saltarse la espera rompía las pestañas abiertas en cada deploy
      // (HTML viejo + chunks nuevos = chunk-load-error).
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
  // El cliente puede pedir saltar a la nueva versión explícitamente (botón
  // «Recargar» del banner de pwa.ts). Se acepta el string plano y el formato
  // { type: "SKIP_WAITING" } — el banner usa el objeto.
  if (event.data === "SKIP_WAITING" || event.data?.type === "SKIP_WAITING") self.skipWaiting();
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

  // F2-C — precache offline del OCR (Tesseract / traineddata).
  // Lote D (D-4, F-OCR-LOCAL): el motor es SELF-HOST — el match principal
  // ahora es la ruta local /vendor/ocr/ (mismo origen). El match jsdelivr
  // se conserva como DEFENSA (0 peticiones esperadas tras F-OCR-LOCAL;
  // si algún día regresa una URL remota, el cache ya la cubre).
  // ESTRATEGIA (elegida, justificada): cache-first en runtime (cache en el
  // PRIMER uso, NO precache en install) — idéntica al bloque original:
  // precachear ~12,9 MB de vendor OCR en install retrasaría el arranque
  // offline de TODA la app para usuarios que nunca abren «Texto». Con
  // cache-on-first-use, el primer OCR online llena OCR_CACHE (respeta
  // OCR_CACHE_MAX) y a partir de ahí el OCR funciona offline (D-4.5).
  if (
    // Lote D (D-4): includes() y NO startsWith("/vendor/ocr/") — el deploy
    // de Pages vive bajo basePath (/web-scanner/lab), el pathname real es
    // /web-scanner/lab/vendor/ocr/**. El literal de directorio sigue siendo
    // específico del vendor OCR (colisión improbable) y sobrevive a
    // cualquier basePath (dev="", Pages=/web-scanner/lab).
    url.pathname.includes("/vendor/ocr/") ||
    (url.hostname === "cdn.jsdelivr.net" &&
      (url.pathname.includes("tesseract.js") || url.pathname.includes("tesseract.js-data")))
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(OCR_CACHE);
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const fresh = await fetch(req);
          if (fresh && (fresh.ok || fresh.type === "opaque")) {
            cache.put(req, fresh.clone()).catch(() => undefined);
            cache.keys().then((keys) => {
              if (keys.length > OCR_CACHE_MAX) {
                cache.delete(keys[0]).catch(() => undefined);
              }
            }).catch(() => undefined);
          }
          return fresh;
        } catch {
          return cached || new Response("OCR offline no disponible", { status: 503 });
        }
      })()
    );
    return;
  }

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
        // E-04 — solo cachear respuestas VÁLIDAS: cachear un 404/error de un
        // asset inmutable lo serviría roto PARA SIEMPRE (cache-first, sin
        // revalidación). Mismo guard que la navegación (A7).
        if (fresh && fresh.ok) {
          const cache = await caches.open(STATIC_CACHE);
          cache.put(req, fresh.clone()).catch(() => undefined);
        }
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
