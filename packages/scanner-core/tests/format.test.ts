/**
 * LOTE 6 (BLQ-1) — tests de lógica pura de format.ts.
 * Deterministas: `relativeTime` siempre recibe `now` explícito; las fechas
 * largas usan el ICU es-CO del runtime (verificado en bun y CI).
 */
import { describe, test, expect } from "bun:test";
import { relativeTime, fullDate, formatBytes, dataUrlBytes, BASE_TIME } from "../src/format";

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = 1_800_000_000_000; // fijo — nada de Date.now()

describe("relativeTime (español, now inyectado)", () => {
  test("< 60 s → «hace un momento»", () => {
    expect(relativeTime(NOW - 0, NOW)).toBe("hace un momento");
    expect(relativeTime(NOW - 59_000, NOW)).toBe("hace un momento");
  });

  test("< 60 min → «hace N min»", () => {
    expect(relativeTime(NOW - MIN, NOW)).toBe("hace 1 min");
    expect(relativeTime(NOW - 5 * MIN, NOW)).toBe("hace 5 min");
    expect(relativeTime(NOW - 59 * MIN, NOW)).toBe("hace 59 min");
  });

  test("< 24 h → «hace N h»", () => {
    expect(relativeTime(NOW - HOUR, NOW)).toBe("hace 1 h");
    expect(relativeTime(NOW - 3 * HOUR, NOW)).toBe("hace 3 h");
    expect(relativeTime(NOW - 23 * HOUR, NOW)).toBe("hace 23 h");
  });

  test("< 7 d → «hace N d»", () => {
    expect(relativeTime(NOW - DAY, NOW)).toBe("hace 1 d");
    expect(relativeTime(NOW - 6 * DAY, NOW)).toBe("hace 6 d");
  });

  test("≥ 7 d → fecha corta es-CO (día + mes abreviado)", () => {
    const s = relativeTime(BASE_TIME, BASE_TIME + 30 * DAY);
    expect(s).toContain("sept"); // 2026-09-21 → «21 de sept»
    expect(s).not.toContain("hace");
  });

  test("timestamp futuro → diff se recorta a 0 («hace un momento»)", () => {
    expect(relativeTime(NOW + 10 * DAY, NOW)).toBe("hace un momento");
  });
});

describe("fullDate (fecha larga es-CO)", () => {
  test("día + mes largo + año", () => {
    const s = fullDate(BASE_TIME);
    expect(s).toContain("septiembre");
    expect(s).toContain("2026");
  });
});

describe("formatBytes", () => {
  test("rango bytes (< 1 KB)", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });
  test("rango KB (1 decimal)", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024 - 1)).toBe("1024.0 KB");
  });
  test("rango MB (1 decimal)", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });
});

describe("dataUrlBytes (estimación base64/percent)", () => {
  test("sin coma → 0", () => {
    expect(dataUrlBytes("no-es-un-data-url")).toBe(0);
  });
  test("base64 → payload × 3/4 redondeado", () => {
    // header "data:image/png;base64" + payload de 8 chars → 6 bytes
    expect(dataUrlBytes("data:image/png;base64,iVBORw0K")).toBe(6);
  });
  test("percent-encoded (SVG de mocks) → bytes del texto decodificado", () => {
    const svg = "data:image/svg+xml;charset=utf-8,%3Csvg%3Ehola%3C/svg%3E";
    const decoded = "<svg>hola</svg>";
    expect(dataUrlBytes(svg)).toBe(new TextEncoder().encode(decoded).length);
  });
  test("percent-encoded con caracteres multibyte (á) cuenta bytes UTF-8", () => {
    const url = "data:image/svg+xml;charset=utf-8,%C3%A1"; // "á" = 2 bytes
    expect(dataUrlBytes(url)).toBe(2);
  });
  test("percent-encoded malformado → fallback longitud del payload", () => {
    expect(dataUrlBytes("data:image/svg+xml;charset=utf-8,%E0%A4%A")).toBe(8);
  });
});
