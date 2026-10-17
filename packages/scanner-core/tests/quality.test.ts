/**
 * LOTE 6 (BLQ-1) — tests del módulo PURO de calidad de captura (quality.ts).
 * Todo el módulo es determinista: scores con entradas numéricas y `nowMs`
 * inyectable (invariante al FPS, FIX v9). Constantes exactas del producto.
 */
import { describe, test, expect } from "bun:test";
import {
  WEIGHTS,
  SHARPNESS_NORM,
  BLUR_THRESHOLD,
  STABILITY_WINDOW_MS,
  SHUTTER_SCORE,
  SHUTTER_SPAN_MS,
  SHUTTER_SUSTAIN_MS,
  NO_DETECT_TIMEOUT_MS,
  computeSharpnessScore,
  computeExposureScore,
  computeStabilityScore,
  computeEccentricityScore,
  computeTotalScore,
  computeShutterDecision,
  shouldTriggerShutter,
  detectionTimedOut,
  lumaHistogram,
  type QuadSample,
  type ScoreSample,
} from "../src/quality";

const QUAD_OK = [
  { x: 0.3, y: 0.3 },
  { x: 0.7, y: 0.3 },
  { x: 0.7, y: 0.7 },
  { x: 0.3, y: 0.7 },
];

describe("constantes del pipeline (contrato empírico SM-A566E/iPhone)", () => {
  test("pesos del compuesto 0.4/0.3/0.3 y normalizaciones", () => {
    expect(WEIGHTS).toEqual({ sharpness: 0.4, exposure: 0.3, stability: 0.3 });
    expect(SHARPNESS_NORM).toBe(300);
    expect(BLUR_THRESHOLD).toBe(100);
    expect(STABILITY_WINDOW_MS).toBe(600);
    expect(SHUTTER_SCORE).toBe(0.8);
    expect(SHUTTER_SPAN_MS).toBe(1200);
    expect(SHUTTER_SUSTAIN_MS).toBe(400);
    expect(NO_DETECT_TIMEOUT_MS).toBe(8000);
  });
});

describe("computeSharpnessScore", () => {
  test("saturación lineal: var/300 con tope 1", () => {
    expect(computeSharpnessScore(0)).toBe(0);
    expect(computeSharpnessScore(150)).toBe(0.5);
    expect(computeSharpnessScore(300)).toBe(1);
    expect(computeSharpnessScore(900)).toBe(1); // satura
  });
  test("entradas no finitas o negativas → 0 (guard !Number.isFinite)", () => {
    expect(computeSharpnessScore(-5)).toBe(0);
    expect(computeSharpnessScore(NaN)).toBe(0);
    expect(computeSharpnessScore(Infinity)).toBe(0); // no finito → 0
  });
});

describe("computeExposureScore (histograma 256)", () => {
  const hist = (put: Record<number, number>): number[] => {
    const h = new Array<number>(256).fill(0);
    for (const [k, v] of Object.entries(put)) h[Number(k)]! = v;
    return h;
  };

  test("histograma vacío → score 0 sin aviso especular", () => {
    expect(computeExposureScore(new Array<number>(256).fill(0))).toEqual({
      score: 0,
      specularRatio: 0,
      specularWarn: false,
    });
  });

  test("todo en rango medio → score 1", () => {
    const r = computeExposureScore(hist({ 128: 100 }));
    expect(r.score).toBe(1);
    expect(r.specularWarn).toBe(false);
  });

  test("sub/sobreexpuestos penalizan: 1 − (under+over)/total", () => {
    // 50 px < 30 (under), 50 px > 225 (over), 100 px OK → score 1 − 100/200 = 0.5
    const r = computeExposureScore(hist({ 10: 50, 128: 100, 250: 50 }));
    expect(r.score).toBeCloseTo(0.5, 10);
  });

  test("specular: fracción > 248 y aviso por encima del 3 %", () => {
    const r = computeExposureScore(hist({ 128: 90, 250: 10 }));
    expect(r.specularRatio).toBeCloseTo(0.1, 10);
    expect(r.specularWarn).toBe(true);
    const ok = computeExposureScore(hist({ 128: 99, 250: 1 }));
    expect(ok.specularWarn).toBe(false);
  });
});

describe("computeStabilityScore (ventana POR TIMESTAMP, 600 ms)", () => {
  const sample = (t: number, dx = 0): QuadSample => ({
    t,
    quad: QUAD_OK.map((p) => ({ x: p.x + dx, y: p.y })) as QuadSample["quad"],
  });

  test("< 2 muestras en ventana → 0", () => {
    expect(computeStabilityScore([sample(1000)], 1000)).toBe(0);
    expect(computeStabilityScore([], 1000)).toBe(0);
  });

  test("quad idéntico en ventana → 1 (piedra)", () => {
    expect(computeStabilityScore([sample(950), sample(1000)], 1000)).toBe(1);
  });

  test("movimiento grande → clamp a 0", () => {
    // meanVar = dx²/8 (solo las 4 x varían); dx=20 → meanVar=50 ≥ 20 → 0.
    expect(computeStabilityScore([sample(950, 0), sample(1000, 20)], 1000)).toBe(0);
  });

  test("muestras FUERA de la ventana (por timestamp) no cuentan", () => {
    // 700 ms antes del now: fuera de la ventana de 600 ms → solo queda 1 → 0.
    expect(computeStabilityScore([sample(300), sample(1000)], 1000)).toBe(0);
  });

  test("varianza media normalizada a 20 px² (fórmula exacta)", () => {
    // dx = ±0.5 en las 4 x → acc = Σ(dx²+dy²)/n = 1.0 → meanVar = 1.0/8 = 0.125
    // → score = 1 − 0.125/20 = 0.99375
    const hist = [sample(950, -0.5), sample(1000, 0.5)];
    expect(computeStabilityScore(hist, 1000)).toBeCloseTo(1 - 0.125 / 20, 10);
  });
});

describe("computeEccentricityScore (peor esquina domina)", () => {
  test("quad centrado → 1", () => {
    expect(computeEccentricityScore(QUAD_OK as QuadSample["quad"], 400, 300)).toBe(1);
  });

  test("esquina pegada al borde → score cae (dMin < margen 5 %)", () => {
    const stuck: QuadSample["quad"] = [
      { x: 0.01, y: 0.5 },
      { x: 0.7, y: 0.3 },
      { x: 0.7, y: 0.7 },
      { x: 0.3, y: 0.7 },
    ];
    // dMin de la esquina 0: px = 4 de 400, margen = 15 → 4/15
    const s = computeEccentricityScore(stuck, 400, 300);
    expect(s).toBeCloseTo(4 / 15, 6);
    expect(s).toBeLessThan(1);
  });

  test("frame degenerado (0 px) → 0", () => {
    expect(computeEccentricityScore(QUAD_OK as QuadSample["quad"], 0, 300)).toBe(0);
  });
});

describe("computeTotalScore (ponderado × excentricidad)", () => {
  test("base ponderada y clamp 0–1", () => {
    const r = computeTotalScore({ sharpness: 1, exposure: 1, stability: 1 }, 500);
    expect(r.total).toBe(1);
    expect(r.isBlur).toBe(false);
    const r2 = computeTotalScore({ sharpness: 0, exposure: 0, stability: 0 }, 5);
    expect(r2.total).toBe(0);
    expect(r2.isBlur).toBe(true);
  });

  test("excentricidad multiplicativa (null = sin penalización)", () => {
    const a = computeTotalScore({ sharpness: 1, exposure: 1, stability: 1, eccentricity: 0.5 }, 500);
    expect(a.total).toBe(0.5);
    const b = computeTotalScore({ sharpness: 1, exposure: 1, stability: 1, eccentricity: null }, 500);
    expect(b.total).toBe(1);
  });

  test("isBlur con el umbral exacto de Var(Laplacian)", () => {
    expect(computeTotalScore({ sharpness: 0.5, exposure: 1, stability: 1 }, 99.9).isBlur).toBe(true);
    expect(computeTotalScore({ sharpness: 0.5, exposure: 1, stability: 1 }, 100.1).isBlur).toBe(false);
  });
});

describe("máquina de disparo (FIX v9 — invariante al FPS)", () => {
  const good = (t: number): ScoreSample => ({ t, score: 0.9 });
  const bad = (t: number): ScoreSample => ({ t, score: 0.5 });

  test("historial vacío → few-samples, no dispara", () => {
    const d = computeShutterDecision([]);
    expect(d.triggered).toBe(false);
    expect(d.reason).toBe("few-samples");
  });

  test("última muestra mala → last-bad (gana sobre todo lo demás)", () => {
    const d = computeShutterDecision([good(0), good(100), bad(200), good(300), bad(400)]);
    expect(d.reason).toBe("last-bad");
    expect(d.triggered).toBe(false);
  });

  test("tramo bueno < 400 ms → sustain (barrido rápido U5 no dispara)", () => {
    // 5 muestras buenas cada 50 ms = 200 ms de tramo continuo.
    const d = computeShutterDecision([good(0), good(50), good(100), good(150), good(200)]);
    expect(d.reason).toBe("sustain");
    expect(d.sustainedGoodMs).toBe(200);
    expect(d.triggered).toBe(false);
  });

  test("tramo continuo ≥ 400 ms + 70 % buenas en ventana → DISPARA", () => {
    // 10 muestras buenas cada 50 ms (450 ms de tramo) → ok.
    const hist = Array.from({ length: 10 }, (_, i) => good(i * 50));
    const d = computeShutterDecision(hist);
    expect(d.reason).toBe("ok");
    expect(d.triggered).toBe(true);
    expect(d.sustainedGoodMs).toBe(450);
    expect(d.kRequired).toBe(Math.max(2, Math.ceil(10 * 0.7)));
  });

  test("proporción 70 %: muchas malas en ventana → not-enough-good", () => {
    // Tramo final bueno ≥400 ms, pero la ventana tiene 50 % de malas.
    const hist: ScoreSample[] = [
      bad(0), good(100), bad(200), good(300), bad(400), good(500), bad(600),
      good(700), good(800), good(900), good(1000), good(1100), good(1200),
    ];
    const d = computeShutterDecision(hist);
    expect(d.reason).toBe("not-enough-good");
    expect(d.triggered).toBe(false);
  });

  test("hueco grande con fps bajo se tolera (1.6× mediana, mínimo 350 ms)", () => {
    // Muestras cada 400 ms (2.5 fps): hueco 400 ≤ 1.6×400 → tramo continúa.
    const hist = [good(0), good(400), good(800), good(1200)];
    const d = computeShutterDecision(hist);
    expect(d.reason).toBe("ok");
    expect(d.triggered).toBe(true);
  });

  test("fpsEff: mediana de intervalos con clamp 1.5–60", () => {
    const d = computeShutterDecision([good(0), good(50), good(100), good(150)]);
    expect(d.fpsEff).toBe(20); // 1000/50
    const d2 = computeShutterDecision([good(0), good(2000), good(4000)]);
    expect(d2.fpsEff).toBe(1.5); // 1000/2000 = 0.5 → clamp inferior 1.5
  });

  test("shouldTriggerShutter es el wrapper booleano de la decisión", () => {
    const hist = Array.from({ length: 10 }, (_, i) => good(i * 50));
    expect(shouldTriggerShutter(hist)).toBe(true);
    expect(shouldTriggerShutter([bad(0)])).toBe(false);
  });
});

describe("escape a manual y histograma", () => {
  test("detectionTimedOut con el umbral exacto (8000 ms, estricto >)", () => {
    expect(detectionTimedOut(0, 7999)).toBe(false);
    expect(detectionTimedOut(0, 8000)).toBe(false);
    expect(detectionTimedOut(0, 8001)).toBe(true);
  });

  test("lumaHistogram: 256 bins y luma BT.601 redondeada", () => {
    // 2 píxeles: negro puro (0,0,0) y blanco puro (255,255,255).
    const data = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
    const h = lumaHistogram(data);
    expect(h).toHaveLength(256);
    expect(h[0]).toBe(1);
    expect(h[255]).toBe(1);
    const total = h.reduce((a, b) => a + b, 0);
    expect(total).toBe(2);
  });

  test("lumaHistogram: gris 50 % cae en el bin 127/128 (0.299·0.587·0.114)", () => {
    const data = new Uint8ClampedArray([128, 128, 128, 255]);
    const h = lumaHistogram(data);
    const idx = h.findIndex((c) => c > 0);
    expect([127, 128]).toContain(idx); // round(128 × 0.299+…) ≈ 128
  });
});
