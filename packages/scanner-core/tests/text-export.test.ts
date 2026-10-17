/**
 * LOTE 6 (BLQ-1) — tests de text-export.ts (consolidación de OCR, diag §3.5).
 * Solo exports puros: downloadOcrTxt (Blob/download) y shareOcrText
 * (navigator.share) son browser-only → fuera de alcance, documentado.
 */
import { describe, test, expect } from "bun:test";
import {
  ocrTextOfPages,
  documentOcrText,
  docHasOcrText,
  countWords,
} from "../src/text-export";
import type { ScanDocument } from "../src/types";

const doc = (pages: { ocrText?: string }[]): ScanDocument =>
  ({
    id: "d1",
    title: "t",
    pages: pages.map((p, i) => ({
      id: `p${i}`,
      original: "",
      processed: "",
      thumbnail: "",
      filter: "bw",
      quad: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
      rotation: 0,
      quality: { level: "excellent", sharpness: 90, brightness: 85, contrast: 80, label: "Excelente" },
      ocrDone: p.ocrText !== undefined,
      ...p,
    })),
    favorite: false,
    createdAt: 0,
    updatedAt: 0,
  }) as ScanDocument;

describe("ocrTextOfPages (separadores «── Página N ──»)", () => {
  test("sin texto en ninguna página → «»", () => {
    expect(ocrTextOfPages([{}, { ocrText: "   " }])).toBe("");
  });

  test("una sola página con texto → texto pelado (sin separador)", () => {
    expect(ocrTextOfPages([{ ocrText: "  FACTURA 123  " }, {}])).toBe("FACTURA 123");
  });

  test("varias páginas con texto → separadores con índice REAL (incluye vacías)", () => {
    const out = ocrTextOfPages([
      { ocrText: "uno" },
      { ocrText: "" },
      { ocrText: "tres" },
    ]);
    expect(out).toBe("── Página 1 ──\nuno\n\n── Página 3 ──\ntres");
  });

  test("recorta espacios de cada página", () => {
    expect(ocrTextOfPages([{ ocrText: "  hola " }, { ocrText: " mundo " }])).toBe(
      "── Página 1 ──\nhola\n\n── Página 2 ──\nmundo"
    );
  });
});

describe("documentOcrText + docHasOcrText", () => {
  test("consolida el OCR de un documento guardado", () => {
    expect(documentOcrText(doc([{ ocrText: "uno" }, { ocrText: "dos" }]))).toContain("Página 1");
    expect(documentOcrText(doc([{}, {}]))).toBe("");
  });

  test("docHasOcrText: true solo si alguna página tiene texto real", () => {
    expect(docHasOcrText(doc([{ ocrText: "x" }]))).toBe(true);
    expect(docHasOcrText(doc([{}, { ocrText: "  " }]))).toBe(false);
    expect(docHasOcrText(doc([]))).toBe(false);
  });
});

describe("countWords (toasts informativos)", () => {
  test("cuenta palabras colapsando espacios", () => {
    expect(countWords("hola mundo")).toBe(2);
    expect(countWords("  hola   mundo  otra  ")).toBe(3);
  });
  test("vacío → 0", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
  });
});
