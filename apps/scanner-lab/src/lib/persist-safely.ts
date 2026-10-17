/**
 * BP-3 (Lote 6) — PUENTE del aviso único de fallos de persistencia (app).
 *
 * El MOTOR vive en el core (`persistSafely`/`notePersistFailure` en
 * packages/scanner-core/src/page-store.ts, donde están los catches de
 * escritura): cuenta los fallos en memoria y al TERCERO dispara UNA sola vez
 * por sesión el evento global PERSIST_FAILURE_EVENT. Este módulo de la app
 * escucha ese evento y muestra el ÚNICO toast de sonner.
 *
 * ¿Por qué dos piezas? El core no puede importar UI (regla del paquete) y la
 * app no puede envolver los catches del core: el evento global es la frontera
 * limpia sin invertir dependencias. FORT-8: esto es observación — sin red,
 * sin reintentos, sin reset de estado. Nunca alert/confirm; JAMÁS más de 1
 * toast por sesión.
 *
 * WIRING PENDIENTE (fuera de la whitelist del Lote 6 — page.tsx es zona del
 * Agente A, kit §0.1): añadir `import "@/lib/persist-safely";` en
 * apps/scanner-lab/src/app/page.tsx. La instalación es idempotente y con
 * auto-arranque al importar (guard SSR), así que la línea es suficiente.
 */

import { toast } from "sonner";
import { PERSIST_FAILURE_EVENT } from "@jg-stevan/scanner-core";

/** Texto EXACTO del kit T4 (único aviso por sesión). */
const PERSIST_TOAST_MESSAGE =
  "No se pudo guardar; tus cambios están en memoria — evita cerrar la app";

let installed = false;

/** Instala el listener del aviso único (idempotente; no-op en SSR). */
export function installPersistFailureToast(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener(PERSIST_FAILURE_EVENT, (ev) => {
    try {
      // El detalle ({site, count}) queda disponible para diagnóstico manual
      // (consola) — el toast del usuario es SIEMPRE el mismo texto.
      console.info(
        "[persist-safely] aviso único de persistencia:",
        (ev as CustomEvent).detail
      );
      toast.error(PERSIST_TOAST_MESSAGE);
    } catch {
      /* el aviso NUNCA rompe la app */
    }
  });
}

// Auto-arranque al importar (guard SSR): el wiring en page.tsx es solo el
// import — la llamada se hace sola y es idempotente.
if (typeof window !== "undefined") {
  installPersistFailureToast();
}
