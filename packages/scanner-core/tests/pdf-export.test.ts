/**
 * LOTE 6 (BLQ-1) — tests de los EXPORTS PUROS de pdf-export.ts.
 *
 * ALCANCE (decisión documentada, kit T1.4):
 *  · SÍ: attemptsFor() (escalera §8), sanitizeFileName(), PDF_LONG_SIDE_MM.
 *  · NO: toJpegAt/toJpeg/buildDocPdf/downloadPdf — requieren canvas 2D +
 *    FileReader (browser-only; bun no tiene DOM) y jsPDF en runtime.
 *    Probarlos exigiría un polyfill de canvas (dep nueva de testing —
 *    prohibida). Queda documentado en el doc de evidencia del lote.
 */
import { describe, test, expect } from "bun:test";
import {
  attemptsFor,
  sanitizeFileName,
  PDF_LONG_SIDE_MM,
  type ExportAttempt,
} from "../src/pdf-export";

describe("attemptsFor (escalera de re-encode §8)", () => {
  test("máxima: 4 intentos, calidad descendente 0.95→0.78", () => {
    const a = attemptsFor("máxima");
    expect(a).toHaveLength(4);
    expect(a.map((x) => x.quality)).toEqual([0.95, 0.9, 0.82, 0.78]);
  });

  test("máxima: longSide exactos {0,0,2600,2200} (full-size primero, luego degrada)", () => {
    const a = attemptsFor("máxima");
    expect(a.map((x) => x.longSide)).toEqual([0, 0, 2600, 2200]);
    expect(a[a.length - 1]).toEqual({ longSide: 2200, quality: 0.78 });
  });

  test("alta: 3 intentos partiendo de full-size q0.9", () => {
    const a = attemptsFor("alta");
    expect(a).toHaveLength(3);
    expect(a[0]).toEqual({ longSide: 0, quality: 0.9 });
    expect(a[a.length - 1]).toEqual({ longSide: 2200, quality: 0.78 });
  });

  test("standard: 3 intentos partiendo de TAMAÑO COMPLETO (FIX v3: sin recorte de serie)", () => {
    const a = attemptsFor("standard");
    expect(a).toHaveLength(3);
    expect(a[0]).toEqual({ longSide: 0, quality: 0.9 });
    // La escalera de respaldo es la misma que alta.
    expect(a.slice(1)).toEqual(attemptsFor("alta").slice(1));
  });

  test("cada intento de respaldo degrada bytes (lado o calidad bajan)", () => {
    for (const q of ["máxima", "alta", "standard"] as const) {
      const ladder = attemptsFor(q);
      for (let i = 1; i < ladder.length; i++) {
        const prev = ladder[i - 1]!;
        const cur = ladder[i]!;
        const degrades = cur.longSide < prev.longSide || cur.quality < prev.quality;
        expect(degrades).toBe(true);
      }
    }
  });
});

describe("sanitizeFileName (nombre de archivo seguro)", () => {
  test("elimina caracteres prohibidos \\/:*?\"<>|", () => {
    expect(sanitizeFileName('Factura: "enero" 2026?')).toBe("Factura enero 2026");
    expect(sanitizeFileName("a/b\\c:d*e?f\"g<h>i|j")).toBe("abcdefghij");
  });
  test("recorta espacios resultantes", () => {
    expect(sanitizeFileName("  título  ")).toBe("título");
  });
  test("vacío tras limpiar → «documento»", () => {
    expect(sanitizeFileName("")).toBe("documento");
    expect(sanitizeFileName("///***???")).toBe("documento");
    expect(sanitizeFileName("   ")).toBe("documento");
  });
  test("conserva acentos y ñ (UTF-8 válido en nombres)", () => {
    expect(sanitizeFileName("Escáner — página nº1")).toBe("Escáner — página nº1");
  });
});

describe("constantes de página PDF", () => {
  test("PDF_LONG_SIDE_MM = 297 (A4 vertical, largo)", () => {
    expect(PDF_LONG_SIDE_MM).toBe(297);
  });
});
