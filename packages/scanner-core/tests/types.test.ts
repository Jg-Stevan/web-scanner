/**
 * LOTE 6 (BLQ-1) — tests de lógica pura de types.ts.
 * Deterministas: sin red, sin timers reales, sin cámara.
 * `trashDaysLeft` recibe `now` explícito (inyección — sin reloj real).
 */
import { describe, test, expect } from "bun:test";
import {
  FILTER_PRESETS,
  PNG_FILTERS,
  TRASH_RETENTION_DAYS,
  DEFAULT_SETTINGS,
  normalizePageFilter,
  isTrashed,
  trashDaysLeft,
  capturePageKey,
  defaultQuad,
  excellentQuality,
  makeQuality,
  type Quad,
} from "../src/types";

const DAY = 86_400_000;

describe("normalizePageFilter (migración legacy §8.4)", () => {
  test("presets actuales pasan sin cambio", () => {
    expect(normalizePageFilter("original")).toBe("original");
    expect(normalizePageFilter("text")).toBe("text");
    expect(normalizePageFilter("bw")).toBe("bw");
  });

  test("legacy con mismo modo motor → text (auto/document/whiteboard)", () => {
    expect(normalizePageFilter("auto")).toBe("text");
    expect(normalizePageFilter("document")).toBe("text");
    expect(normalizePageFilter("whiteboard")).toBe("text");
  });

  test("blackwhite legacy → bw", () => {
    expect(normalizePageFilter("blackwhite")).toBe("bw");
  });

  test("legacy de color → original (natural/color/grayscale)", () => {
    expect(normalizePageFilter("natural")).toBe("original");
    expect(normalizePageFilter("color")).toBe("original");
    expect(normalizePageFilter("grayscale")).toBe("original");
  });

  test("valor desconocido → default del producto (bw)", () => {
    expect(normalizePageFilter("sepia")).toBe("bw");
    expect(normalizePageFilter("")).toBe("bw");
  });
});

describe("presets y constantes de filtro", () => {
  test("EXACTAMENTE 3 presets (§8, error #13) con ids del union", () => {
    expect(FILTER_PRESETS).toHaveLength(3);
    expect(FILTER_PRESETS.map((p) => p.id)).toEqual(["original", "text", "bw"]);
  });

  test("PNG_FILTERS cubre los 3 modos (mime PNG por modo, R-10)", () => {
    expect(PNG_FILTERS.has("original")).toBe(true);
    expect(PNG_FILTERS.has("text")).toBe(true);
    expect(PNG_FILTERS.has("bw")).toBe(true);
    expect(PNG_FILTERS.size).toBe(3);
  });
});

describe("papelera (F-TRASH)", () => {
  const doc = (deletedAt?: number) =>
    ({
      id: "d1",
      title: "t",
      pages: [],
      favorite: false,
      createdAt: 0,
      updatedAt: 0,
      deletedAt,
    }) as Parameters<typeof isTrashed>[0];

  test("TRASH_RETENTION_DAYS = 30", () => {
    expect(TRASH_RETENTION_DAYS).toBe(30);
  });

  test("isTrashed: sin deletedAt → vivo; con deletedAt numérico → papelera", () => {
    expect(isTrashed(doc(undefined))).toBe(false);
    expect(isTrashed(doc(1_000))).toBe(true);
  });

  test("trashDaysLeft sin deletedAt → retención completa", () => {
    expect(trashDaysLeft(doc(undefined), 5_000_000)).toBe(30);
  });

  test("trashDaysLeft: borrado hoy → 30 días (ceil de 0)", () => {
    expect(trashDaysLeft(doc(1_000_000), 1_000_000)).toBe(30);
  });

  test("trashDaysLeft: 10 días después → quedan 20", () => {
    expect(trashDaysLeft(doc(0), 10 * DAY)).toBe(20);
  });

  test("trashDaysLeft: fracción de día redondea hacia arriba (29.5 d → 1)", () => {
    expect(trashDaysLeft(doc(0), 29.5 * DAY)).toBe(1);
  });

  test("trashDaysLeft: nunca negativo tras la retención", () => {
    expect(trashDaysLeft(doc(0), 45 * DAY)).toBe(0);
    expect(trashDaysLeft(doc(0), 400 * DAY)).toBe(0);
  });
});

describe("capturePageKey (clave compartida editor↔store)", () => {
  const quad: Quad = [
    { x: 0.11111, y: 0.22222 },
    { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.9 },
    { x: 0.1, y: 0.9 },
  ];
  const base = { id: "p1", quad, filter: "text" as const, rotation: 90 };

  test("formato id|quad(4 pares 4 dec)|filtro|rotación", () => {
    const key = capturePageKey(base);
    expect(
      key.startsWith(
        "p1|0.1111,0.2222;0.9000,0.1000;0.9000,0.9000;0.1000,0.9000|text|90"
      )
    ).toBe(true);
  });

  test("determinista: misma entrada → misma clave", () => {
    expect(capturePageKey(base)).toBe(capturePageKey({ ...base }));
  });

  test("cada campo participa: cambiar quad/filtro/rotación/id cambia la clave", () => {
    const k0 = capturePageKey(base);
    expect(capturePageKey({ ...base, id: "p2" })).not.toBe(k0);
    expect(
      capturePageKey({
        ...base,
        quad: [{ ...quad[0]!, x: 0.2 }, quad[1]!, quad[2]!, quad[3]!],
      })
    ).not.toBe(k0);
    expect(capturePageKey({ ...base, filter: "bw" })).not.toBe(k0);
    expect(capturePageKey({ ...base, rotation: 0 })).not.toBe(k0);
  });

  test("redondeo a 4 decimales: diferencias sub-umbral no cambian la clave", () => {
    const quad2: Quad = [
      { x: 0.111110001, y: 0.22222 },
      quad[1]!,
      quad[2]!,
      quad[3]!,
    ];
    expect(capturePageKey({ ...base, quad: quad2 })).toBe(capturePageKey(base));
  });
});

describe("calidad de página", () => {
  test("makeQuality: umbrales excellent/good/fair/poor con etiqueta es", () => {
    expect(makeQuality(90, 85, 80).level).toBe("excellent"); // media 85
    expect(makeQuality(80, 70, 60).level).toBe("good"); // media 70
    expect(makeQuality(60, 50, 40).level).toBe("fair"); // media 50
    expect(makeQuality(30, 20, 10).level).toBe("poor"); // media 20
    expect(makeQuality(90, 85, 80).label).toBe("Excelente");
    expect(makeQuality(80, 70, 60).label).toBe("Buena");
    expect(makeQuality(60, 50, 40).label).toBe("Aceptable");
    expect(makeQuality(30, 20, 10).label).toBe("Baja");
  });

  test("excellentQuality: valores canónicos", () => {
    expect(excellentQuality()).toEqual({
      level: "excellent",
      sharpness: 92,
      brightness: 88,
      contrast: 84,
      label: "Excelente",
    });
  });

  test("defaultQuad: 4 esquinas en fracciones válidas", () => {
    const q = defaultQuad();
    expect(q).toHaveLength(4);
    for (const p of q) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });
});

describe("DEFAULT_SETTINGS", () => {
  test("valores de producto vigentes (F-OCR-MANUAL v6.1 + máxima + flash off)", () => {
    expect(DEFAULT_SETTINGS.ocrEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.exportQuality).toBe("máxima");
    expect(DEFAULT_SETTINGS.flashMode).toBe("off");
    expect(DEFAULT_SETTINGS.enhance).toBe(true);
    expect(DEFAULT_SETTINGS.photoMode).toBe("auto");
  });
});
