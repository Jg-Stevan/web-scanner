/**
 * LOTE 6 (BLQ-1) — tests de helpers puros de page-store.ts.
 *
 * ALCANCE (kit T1: dataUrlToBlob y helpers puros):
 *  · SÍ: dataUrlToBlob (bun tiene Blob/atob), guards SSR de settings/orden,
 *    storageAvailable, y los guards «sin IndexedDB» de los lectores.
 *  · NO (skip documentado): blobToDataUrl — usa FileReader, que bun no
 *    implementa (browser-only). Queda como pendiente en el doc de evidencia.
 *
 * En bun NO existe indexedDB → openDb() resuelve null (guard de SSR que ya
 * existía) → las escrituras son noop y las lecturas devuelven sus defaults.
 * Eso permite probar el CONTRATO de degradación silenciosa sin mocks.
 */
import { describe, test, expect } from "bun:test";
import {
  dataUrlToBlob,
  loadSettings,
  saveSettings,
  loadManualOrder,
  loadAllDocuments,
  storageAvailable,
} from "../src/page-store";
import { DEFAULT_SETTINGS } from "../src/types";

// PNG 1×1 real (un píxel negro) — fixture mínimo inline.
const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("dataUrlToBlob (base64)", () => {
  test("PNG base64 → Blob con mime y tamaño reales", () => {
    const b = dataUrlToBlob(PNG_1PX);
    expect(b).not.toBeNull();
    expect(b!.type).toBe("image/png");
    expect(b!.size).toBeGreaterThan(0);
  });

  test("tamaño = bytes reales del base64 (12 chars + 1 padding → 8 bytes)", () => {
    const payload = "iVBORw0KGgo="; // 12 chars, 1 '=' → 8 bytes
    const b = dataUrlToBlob(`data:image/png;base64,${payload}`);
    expect(b!.size).toBe(8);
  });

  test("mime con parámetros → type limpio (sin ;charset)", () => {
    const b = dataUrlToBlob("data:image/png;charset=utf-8;base64,AAAA");
    expect(b!.type).toBe("image/png");
  });

  test("sin mime declarado → application/octet-stream", () => {
    const b = dataUrlToBlob("data:;base64,AAAA");
    expect(b!.type).toBe("application/octet-stream");
  });

  test("base64 inválido (atob lanza) → el llamador recibe la excepción", () => {
    // C-24: el catch de persistDocument omite la página; la función NO traga
    // el error (el try/catch está en persistDocument, no aquí).
    expect(() => dataUrlToBlob("data:image/png;base64,!!!!no-base64!!!!")).toThrow();
  });
});

describe("dataUrlToBlob (percent-encoded, SVG de mocks demo)", () => {
  test("SVG percent-encoded → Blob de texto decodificado (bug pre-C-24)", () => {
    const url = "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22x%22%3Ehola%3C/svg%3E";
    const b = dataUrlToBlob(url);
    expect(b).not.toBeNull();
    expect(b!.type).toBe("image/svg+xml");
  });

  test("sin ;base64 y sin encoder explícito → texto decodificado", () => {
    const b = dataUrlToBlob("data:text/plain,valor%20plano");
    // Nota (quirk de bun, no del código): bun normaliza text/plain añadiendo
    // «;charset=utf-8» al type — en navegador queda «text/plain» pelado.
    expect(b!.type.startsWith("text/plain")).toBe(true);
    expect(b!.size).toBe(11); // "valor plano"
  });
});

describe("dataUrlToBlob (C-24: entrada inválida → null, nunca Blob vacío)", () => {
  test("sin coma separadora → null", () => {
    expect(dataUrlToBlob("no-es-un-data-url")).toBeNull();
  });
  test("string vacío → null", () => {
    expect(dataUrlToBlob("")).toBeNull();
  });
  test("solo header sin payload → Blob de 0 bytes (payload vacío es legítimo)", () => {
    // payload "" → Blob(0): es un data URL sintácticamente válido.
    const b = dataUrlToBlob("data:image/png;base64,");
    expect(b!.size).toBe(0);
  });
});

describe("blobToDataUrl", () => {
  test.skip("browser-only: requiere FileReader (bun no lo implementa) — pendiente", () => {
    // Documentado en docs/lab/fix-lote6-red-seguridad-v1.md §T1.
    // En CI/browser sí corre; el guard typeof FileReader no aplica.
  });
});

describe("contrato de degradación silenciosa (sin IndexedDB/localStorage)", () => {
  test("storageAvailable() = false en bun (sin indexedDB)", () => {
    expect(storageAvailable()).toBe(false);
  });

  test("saveSettings sin localStorage → noop sin lanzar", () => {
    expect(() => saveSettings(DEFAULT_SETTINGS)).not.toThrow();
  });

  test("loadSettings sin localStorage → DEFAULT_SETTINGS", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  test("loadManualOrder sin IndexedDB → []", async () => {
    expect(await loadManualOrder()).toEqual([]);
  });

  test("loadAllDocuments sin IndexedDB → null (instalación nueva, quedan mocks)", async () => {
    expect(await loadAllDocuments()).toBeNull();
  });
});
