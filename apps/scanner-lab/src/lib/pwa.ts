/**
 * E-04 — banner de «Nueva versión lista» (kit ws-pr3-pwa-gama-baja-v1).
 *
 * Con el SW sin skipWaiting incondicional, una versión nueva queda en
 * estado `waiting`. Este módulo detecta el worker esperando (reg.waiting +
 * updatefound → statechange "installed") y muestra un banner minimalista
 * fijo abajo: «Nueva versión lista» + «Recargar».
 *
 * · DOM directo, self-contained, sin dependencias nuevas (kit §2.1: evita
 *   acoplar el sistema de notificaciones; se monta una sola vez desde
 *   PwaRegister y sobrevive a la navegación interna de la SPA).
 * · Al pulsar Recargar: listener `controllerchange` registrado UNA vez
 *   (guard anti-doble-registro) ANTES del postMessage, con guard
 *   anti-doble-recarga; luego `reg.waiting.postMessage({ type:
 *   "SKIP_WAITING" })` — el worker esperando toma el control y la pestaña
 *   recarga limpia con la versión nueva.
 * · El botón ✕ lo oculta hasta la próxima updatefound (showBanner recrea).
 * · Accesible: role="status" + aria-live="polite"; z-index máximo pero sin
 *   bloquear gestos fuera del banner.
 * · Solo producción (https) — mismo guard que registerServiceWorker: en
 *   localhost dev no hay SW y el banner no aplica.
 */

export function setupUpdateBanner(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (window.location.protocol !== "https:") return; // GitHub Pages es https; localhost dev se salta

  const showBanner = (reg: ServiceWorkerRegistration) => {
    // Ya visible → no duplicar (waiting + updatefound pueden coincidir).
    if (document.getElementById("pwa-update-banner")) return;

    const host = document.createElement("div");
    host.id = "pwa-update-banner";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    host.style.cssText = [
      "position:fixed",
      "left:50%",
      "bottom:calc(16px + env(safe-area-inset-bottom, 0px))",
      "transform:translateX(-50%)",
      "z-index:2147483647",
      "display:flex",
      "align-items:center",
      "gap:12px",
      "background:rgba(28,28,30,0.94)",
      "color:#fff",
      "padding:10px 10px 10px 16px",
      "border-radius:14px",
      "box-shadow:0 8px 24px rgba(0,0,0,0.28)",
      "font:600 14px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif",
      "max-width:calc(100vw - 24px)",
    ].join(";");

    const label = document.createElement("span");
    label.textContent = "Nueva versión lista";

    const reload = document.createElement("button");
    reload.type = "button";
    reload.textContent = "Recargar";
    reload.setAttribute("aria-label", "Recargar para aplicar la nueva versión");
    reload.style.cssText = [
      "border:0",
      "cursor:pointer",
      "padding:8px 14px",
      "border-radius:999px",
      "background:#007aff",
      "color:#fff",
      "font:inherit",
    ].join(";");

    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "✕";
    close.setAttribute("aria-label", "Descartar aviso de actualización");
    close.style.cssText = [
      "border:0",
      "cursor:pointer",
      "padding:6px 8px",
      "border-radius:999px",
      "background:transparent",
      "color:rgba(255,255,255,0.7)",
      "font:inherit",
    ].join(";");

    // El listener se registra UNA sola vez (guard `armed`) y SIEMPRE antes
    // del postMessage; `reloaded` impide recargas dobles si el evento llega
    // repetido. No se registra al montar: un controllerchange del PRIMER
    // install (clients.claim) no debe recargar la página.
    let armed = false;
    let reloaded = false;
    reload.addEventListener("click", () => {
      if (!armed) {
        armed = true;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (reloaded) return;
          reloaded = true;
          window.location.reload();
        });
      }
      reg.waiting?.postMessage({ type: "SKIP_WAITING" });
    });
    close.addEventListener("click", () => host.remove());

    host.append(label, reload, close);
    document.body.appendChild(host);
  };

  const watch = (reg: ServiceWorkerRegistration) => {
    // Versión ya esperando al llegar (p. ej. deploy entre dos visitas).
    if (reg.waiting && navigator.serviceWorker.controller) showBanner(reg);
    reg.addEventListener("updatefound", () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener("statechange", () => {
        // `controller` no-null: hay una versión SIRVIENDO esta pestaña → la
        // nueva es una actualización (no el primer install).
        if (nw.state === "installed" && navigator.serviceWorker.controller) showBanner(reg);
      });
    });
  };

  // `ready` resuelve cuando existe una registro activo (condición necesaria
  // para que haya actualización) — evita la carrera con registerServiceWorker
  // (que registra tras el evento load) sin polling ni toques al core.
  navigator.serviceWorker.ready
    .then(watch)
    .catch(() => undefined);
}
