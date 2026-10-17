/**
 * Test de paridad PERF-4 (lote 8): la integral simple en Uint32 produce
 * SALIDA BYTE-IDÉNTICA a la referencia Float64 en bradleyRoth y Sauvola
 * (todos los valores de la integral simple son enteros < 2³² para inputs
 * dentro del guard; en Float64 son exactos hasta 2⁵³).
 *
 * La referencia inline re-implementa la integral en Float64 con la MISMA
 * matemática del espejo del worker (detection-worker.js L452-517) — si
 * alguien cambia un umbral o la ventana, este test se rompe.
 */
import { describe, expect, test } from "bun:test";
import { bradleyRoth, sauvola } from "../src/image-modes";

function integralImageF64(
  gray: Uint8ClampedArray,
  w: number,
  h: number,
): Float64Array {
  const iw = w + 1;
  const ii = new Float64Array(iw * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowAcc = 0;
    for (let x = 0; x < w; x++) {
      rowAcc += gray[y * w + x]!;
      ii[(y + 1) * iw + x + 1] = ii[y * iw + x + 1]! + rowAcc;
    }
  }
  return ii;
}

function integralImageSqF64(
  gray: Uint8ClampedArray,
  w: number,
  h: number,
): Float64Array {
  const iw = w + 1;
  const ii = new Float64Array(iw * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowAcc = 0;
    for (let x = 0; x < w; x++) {
      const v = gray[y * w + x]!;
      rowAcc += v * v;
      ii[(y + 1) * iw + x + 1] = ii[y * iw + x + 1]! + rowAcc;
    }
  }
  return ii;
}

/** bradleyRoth de referencia (Float64 puro — replica la matemática previa). */
function bradleyRothF64(
  gray: Uint8ClampedArray,
  w: number,
  h: number,
  t = 0.15,
  windowRatio = 1 / 24,
): Uint8ClampedArray {
  const ii = integralImageF64(gray, w, h);
  const iw = w + 1;
  const raw = Math.max(8, Math.round(w * windowRatio));
  const win = raw % 2 === 0 ? raw + 1 : raw;
  const half = win >> 1;
  const out = new Uint8ClampedArray(w * h);
  const k = 1 - t;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(h - 1, y + half);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(w - 1, x + half);
      const sum =
        ii[(y1 + 1) * iw + x1 + 1]! - ii[y0 * iw + x1 + 1]! - ii[(y1 + 1) * iw + x0]! + ii[y0 * iw + x0]!;
      const count = (x1 - x0 + 1) * (y1 - y0 + 1);
      const m = sum / count;
      out[y * w + x] = gray[y * w + x]! <= m * k ? 0 : 255;
    }
  }
  return out;
}

/** sauvola de referencia (Float64 puro — replica la matemática previa). */
function sauvolaF64(
  gray: Uint8ClampedArray,
  w: number,
  h: number,
  k = 0.34,
  r = 128,
  windowRatio = 1 / 24,
): Uint8ClampedArray {
  const ii = integralImageF64(gray, w, h);
  const iiSq = integralImageSqF64(gray, w, h);
  const iw = w + 1;
  const raw = Math.max(8, Math.round(w * windowRatio));
  const win = raw % 2 === 0 ? raw + 1 : raw;
  const half = win >> 1;
  const out = new Uint8ClampedArray(w * h);
  const rr = r > 0 ? r : 1;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(h - 1, y + half);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(w - 1, x + half);
      const c0 = x0;
      const c1 = x1 + 1;
      const count = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        ii[(y1 + 1) * iw + c1]! - ii[y0 * iw + c1]! - ii[(y1 + 1) * iw + c0]! + ii[y0 * iw + c0]!;
      const sumSq =
        iiSq[(y1 + 1) * iw + c1]! - iiSq[y0 * iw + c1]! - iiSq[(y1 + 1) * iw + c0]! + iiSq[y0 * iw + c0]!;
      const m = sum / count;
      const variance = sumSq / count - m * m;
      const s = Math.sqrt(variance > 0 ? variance : 0);
      const t = m * (1 + k * (s / rr - 1));
      out[y * w + x] = gray[y * w + x]! <= t ? 0 : 255;
    }
  }
  return out;
}

function randomGray(w: number, h: number, seed = 42): Uint8ClampedArray {
  // LCG determinista (sin deps)
  let s = seed >>> 0;
  const g = new Uint8ClampedArray(w * h);
  for (let i = 0; i < g.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    g[i] = s & 0xff;
  }
  return g;
}

/** Constantes del módulo (§8): deben coincidir con los defaults usados. */
import { BW_SAUVOLA_K, BW_SAUVOLA_R, BW_T, BW_WINDOW_RATIO } from "../src/image-modes";

describe("PERF-4 — paridad integrales Uint32 vs Float64", () => {
  test("bradleyRoth: salida byte-idéntica (512×384 aleatoria)", () => {
    const w = 512, h = 384;
    const gray = randomGray(w, h);
    const got = bradleyRoth(gray, w, h, BW_T, BW_WINDOW_RATIO);
    const want = bradleyRothF64(gray, w, h, BW_T, BW_WINDOW_RATIO);
    expect(Buffer.from(got).equals(Buffer.from(want))).toBe(true);
  });

  test("sauvola: salida byte-idéntica (512×384 aleatoria, sumSq sigue Float64)", () => {
    const w = 512, h = 384;
    const gray = randomGray(w, h, 7);
    const got = sauvola(gray, w, h, BW_SAUVOLA_K, BW_SAUVOLA_R, BW_WINDOW_RATIO);
    const want = sauvolaF64(gray, w, h, BW_SAUVOLA_K, BW_SAUVOLA_R, BW_WINDOW_RATIO);
    expect(Buffer.from(got).equals(Buffer.from(want))).toBe(true);
  });

  test("caso extremo todo-255 (integral simple en el tope del guard)", () => {
    const w = 257, h = 257; // 255·257² ≈ 16,8e6 — cómodo, pero borde de ventana
    const gray = new Uint8ClampedArray(w * h).fill(255);
    const got = bradleyRoth(gray, w, h, BW_T, BW_WINDOW_RATIO);
    const want = bradleyRothF64(gray, w, h, BW_T, BW_WINDOW_RATIO);
    expect(Buffer.from(got).equals(Buffer.from(want))).toBe(true);
    const gotS = sauvola(gray, w, h, BW_SAUVOLA_K, BW_SAUVOLA_R, BW_WINDOW_RATIO);
    const wantS = sauvolaF64(gray, w, h, BW_SAUVOLA_K, BW_SAUVOLA_R, BW_WINDOW_RATIO);
    expect(Buffer.from(gotS).equals(Buffer.from(wantS))).toBe(true);
  });
});
