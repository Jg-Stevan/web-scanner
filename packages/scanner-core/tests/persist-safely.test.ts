/**
 * LOTE 6 (BP-3) — tests de persistSafely/notePersistFailure (page-store.ts).
 * Verifica el contrato del aviso único: contador en memoria, evento global
 * UNA sola vez al 3.er fallo, y nunca lanza (degradación silenciosa intacta).
 *
 * El contador es estado de MÓDULO por diseño (sesión, no reseteable — no hay
 * API de reset para no ampliar superficie): estos tests forman una SECUENCIA
 * determinista que parte del módulo fresco y cuenta cada fallo explícitamente.
 * En bun no hay IndexedDB → los sitios reales no fallan solos; el contrato se
 * prueba con persistSafely + operaciones que lanzan (mismo camino que el
 * catch de producción) y notePersistFailure directo.
 *
 * ORDEN IMPORTANTE: bun ejecuta los tests en orden de declaración dentro del
 * archivo — el «viaje» de fallos debe ejecutarse de corrido.
 */
import { describe, test, expect } from "bun:test";
import {
  persistSafely,
  notePersistFailure,
  PERSIST_FAILURE_EVENT,
} from "../src/page-store";

const falla = async () => {
  throw new Error("IndexedDB/cuota simulada rota");
};

describe("persistSafely (BP-3) — viaje secuencial de fallos", () => {
  const events: { site?: unknown; count?: unknown }[] = [];
  const listener = (ev: Event): void => {
    events.push(((ev as CustomEvent).detail ?? {}) as { site?: unknown; count?: unknown });
  };
  globalThis.addEventListener(PERSIST_FAILURE_EVENT, listener);

  test("op que resuelve → sin evento y sin lanzar", async () => {
    await expect(persistSafely("viaje-ok", async () => {})).resolves.toBeUndefined();
    expect(events).toHaveLength(0); // fallos hasta aquí: 0
  });

  test("1.er fallo (async) → NO propaga y NO avisa (umbral en 3)", async () => {
    await expect(persistSafely("viaje-1", falla)).resolves.toBeUndefined();
    expect(events).toHaveLength(0); // fallos: 1
  });

  test("op síncrona que lanza también se captura (2.º fallo)", async () => {
    await expect(
      persistSafely("viaje-2", () => {
        throw new Error("localStorage lleno");
      })
    ).resolves.toBeUndefined();
    expect(events).toHaveLength(0); // fallos: 2
  });

  test("3.er fallo → EXACTAMENTE UN evento con {site, count:3}", async () => {
    await persistSafely("viaje-3", falla);
    expect(events).toHaveLength(1);
    expect(events[0]!.count).toBe(3);
    expect(events[0]!.site).toBe("viaje-3");
  });

  test("one-shot por sesión: fallos 4, 5 y 6 NO repiten el evento", async () => {
    await persistSafely("viaje-4", falla);
    await persistSafely("viaje-5", falla);
    await persistSafely("viaje-6", falla);
    expect(events).toHaveLength(1); // sigue siendo solo el del 3.er fallo
  });

  test("notePersistFailure directo tras el aviso → tampoco repite (cap de sesión)", () => {
    expect(() => notePersistFailure("viaje-directo-7")).not.toThrow();
    expect(() => notePersistFailure("viaje-directo-8")).not.toThrow();
    expect(events).toHaveLength(1); // UNA sola vez por sesión, como manda el kit
  });
});
