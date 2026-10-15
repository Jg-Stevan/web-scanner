"use client";

/**
 * Score de calidad de captura + máquina de disparo — PORT fiel de
 * `src/scanner/core/quality.ts` del usuario (logica-deteccion.zip).
 *
 * Módulo PURO: recibe números crudos (varianza laplaciana, histograma,
 * historial de quads con timestamps) y produce scores. Constantes intactas
 * (validadas empíricamente en SM-A566E + iPhone según la doc original):
 *  · total = (0.4·sharpness + 0.3·exposure + 0.3·stability) × eccentricity
 *  · disparo k-de-n: score > 0.8, K=4 de N=6 dentro de 1200 ms y última buena
 *  · estabilidad: ventana 600 ms POR TIMESTAMP (el descarte de frames hace
 *    que el índice mienta), varianza normalizada a 20 px² a 400-clase
 *
 * Desviación documentada: el histograma de exposición se mide sobre un
 * miniatura del frame COMPLETO (96 px) en el main thread — el worker solo
 * devuelve cropMean/cropStdDev (RawQualityInput); con papel dominante el
 * frame ≈ crop y la fórmula del usuario queda intacta.
 */

import type { Quad } from "./types";

// ─── Constantes DADAS (NO recalcular — origen: quality.ts del usuario) ──────

/** v3 §5-F2: ponderación del score compuesto. */
export const WEIGHTS = { sharpness: 0.4, exposure: 0.3, stability: 0.3 } as const;

/** Saturación de Var(Laplacian) medida sobre el crop a 400-clase. */
export const SHARPNESS_NORM = 300;

/** isBlur si la varianza cruda < 100 (compara la VARIANZA, no el score). */
export const BLUR_THRESHOLD = 100.0;

/** Píxel con valor < 30 cuenta como subexpuesto. */
export const UNDER_EXPOSED_PX = 30;

/** Píxel con valor > 225 cuenta como sobreexpuesto. */
export const OVER_EXPOSED_PX = 225;

/** Píxel con valor > 248 = especular, info IRRECUPERABLE. */
export const SPECULAR_PX = 248;

/** >3% de píxeles especulares → warning "evita el reflejo". */
export const SPECULAR_RATIO_WARN = 0.03;

/** Varianza de posiciones de quads (px²) normalizada a 400-clase. */
export const STABILITY_VAR_NORM = 20.0;

/** Ventana TEMPORAL de estabilidad en ms (por timestamp, no por índice). */
export const STABILITY_WINDOW_MS = 600;

/** Trigger de disparo: score compuesto por encima de 0.8. */
export const SHUTTER_SCORE = 0.8;

/** Ventana TEMPORAL pura del disparo (ms): se usan TODAS las muestras
 * dentro de la ventana, no un slice fijo — la decisión es invariante al
 * FPS de análisis del dispositivo (FIX v9). */
export const SHUTTER_SPAN_MS = 1200;

/** F-STAB v9 — tramo continuo bueno mínimo (ms) hacia atrás desde la
 * última muestra. FIX v9: 260 → 400. Un barrido rápido en el que el score
 * solo sea bueno ~200 ms sigue sin disparar; 400 ms es alcanzable en
 * cualquier dispositivo con fps efectivo ≥ 2 (a 2 fps basta UNA muestra
 * buena si el hueco anterior cae dentro de la tolerancia dinámica). */
export const SHUTTER_SUSTAIN_MS = 400;

/** Sin detección >8s → escape a captura manual. */
export const NO_DETECT_TIMEOUT_MS = 8000;

/** B9: máximo de avisos «No detecto el documento» por sesión (antes sonaba
 *  cada 8 s toda la sesión; con tope 2 deja de ser ruido). */
export const MAX_NO_DETECT_NOTICES = 2;

/** Cooldown post-captura anti doble-disparo (ms). */
export const CAPTURE_COOLDOWN_MS = 1500;

/** Margen de excentricidad: fracción del lado corto del frame. */
export const ECCENTRICITY_MARGIN = 0.05;

// ─── Tipos ──────────────────────────────────────────────────────────────────

/** Entrada del historial de estabilidad: timestamp + quad medido (px proceso). */
export interface QuadSample {
  t: number;
  quad: Quad;
}

/** Entrada del historial de disparo: timestamp + score compuesto. */
export interface ScoreSample {
  t: number;
  score: number;
}

/** Resultado de la métrica de exposición. */
export interface ExposureResult {
  score: number;
  specularRatio: number;
  specularWarn: boolean;
}

/** Score compuesto completo (todos los componentes 0–1). */
export interface QualityScore {
  sharpness: number;
  exposure: number;
  stability: number;
  eccentricity: number;
  specular: number;
  total: number;
  isBlur: boolean;
}

// ─── Componentes ────────────────────────────────────────────────────────────

/** Nitidez 0–1: saturación lineal de Var(Laplacian) del crop a 400-clase. */
export function computeSharpnessScore(laplacianVar: number): number {
  if (!Number.isFinite(laplacianVar) || laplacianVar <= 0) return 0;
  return Math.min(1, laplacianVar / SHARPNESS_NORM);
}

/**
 * Exposición 0–1 desde el histograma de 256 bins (fórmula exacta del
 * usuario): score = 1 − (under + over)/total; specular = fracción > 248.
 */
export function computeExposureScore(hist: number[]): ExposureResult {
  let total = 0;
  let under = 0;
  let over = 0;
  let specular = 0;
  const n = Math.min(hist.length, 256);
  for (let i = 0; i < n; i++) {
    const c = hist[i] ?? 0;
    if (!(c > 0)) continue;
    total += c;
    if (i < UNDER_EXPOSED_PX) under += c;
    else if (i > OVER_EXPOSED_PX) over += c;
    if (i > SPECULAR_PX) specular += c;
  }
  if (total <= 0) return { score: 0, specularRatio: 0, specularWarn: false };
  const specularRatio = specular / total;
  const score = Math.min(1, Math.max(0, 1 - (under + over) / total));
  return { score, specularRatio, specularWarn: specularRatio > SPECULAR_RATIO_WARN };
}

/**
 * Estabilidad 0–1: 1 − clamp(meanVar / 20). Solo entran muestras con
 * `nowMs − t` dentro de la ventana de 600 ms (POR TIMESTAMP). meanVar =
 * media de las varianzas poblacionales de las 8 coordenadas (px² a
 * 400-clase). <2 muestras en ventana → 0.
 */
export function computeStabilityScore(history: QuadSample[], nowMs: number): number {
  const inWindow = history.filter(
    (s) => nowMs - s.t >= 0 && nowMs - s.t <= STABILITY_WINDOW_MS
  );
  if (inWindow.length < 2) return 0;
  const n = inWindow.length;
  const means = new Array<number>(8).fill(0);
  for (const s of inWindow) {
    for (let i = 0; i < 4; i++) {
      means[2 * i]! += s.quad[i]!.x / n;
      means[2 * i + 1]! += s.quad[i]!.y / n;
    }
  }
  let acc = 0;
  for (const s of inWindow) {
    for (let i = 0; i < 4; i++) {
      const dx = s.quad[i]!.x - means[2 * i]!;
      const dy = s.quad[i]!.y - means[2 * i + 1]!;
      acc += (dx * dx + dy * dy) / n;
    }
  }
  const meanVar = acc / 8;
  return Math.min(1, Math.max(0, 1 - meanVar / STABILITY_VAR_NORM));
}

/**
 * Excentricidad 0–1: margin = 5% del lado corto; por esquina
 * dMin = min(x, W−x, y, H−y); score = clamp(dMin/margin). Retorno = MÍN de
 * las 4 (la peor domina). Penaliza documento pegado al borde del encuadre.
 * Entrada en fracciones 0–1 (se escala a px del frame).
 */
export function computeEccentricityScore(
  quad: Quad,
  frameW: number,
  frameH: number
): number {
  const shortSide = Math.min(frameW, frameH);
  if (!Number.isFinite(shortSide) || shortSide <= 0) return 0;
  const margin = ECCENTRICITY_MARGIN * shortSide;
  let worst = 1;
  for (let i = 0; i < 4; i++) {
    const c = quad[i]!;
    const px = c.x * frameW;
    const py = c.y * frameH;
    const dMin = Math.min(px, frameW - px, py, frameH - py);
    const s = Math.min(1, Math.max(0, dMin / margin));
    if (s < worst) worst = s;
  }
  return worst;
}

/** Score compuesto: base ponderada × penalización de excentricidad. */
export function computeTotalScore(
  parts: {
    sharpness: number;
    exposure: number;
    stability: number;
    eccentricity?: number | null;
  },
  sharpnessVar: number,
  specularRatio = 0
): QualityScore {
  const entries: Array<[value: number, weight: number]> = [
    [parts.sharpness, WEIGHTS.sharpness],
    [parts.exposure, WEIGHTS.exposure],
    [parts.stability, WEIGHTS.stability],
  ];
  let ecc = 1;
  if (parts.eccentricity !== undefined && parts.eccentricity !== null) {
    ecc = parts.eccentricity;
  }
  const wSum = entries.reduce((acc, [, w]) => acc + w, 0);
  const base = entries.reduce((acc, [v, w]) => acc + v * w, 0) / wSum;
  const total = base * ecc;
  return {
    sharpness: parts.sharpness,
    exposure: parts.exposure,
    stability: parts.stability,
    eccentricity: ecc,
    specular: specularRatio,
    total: Math.min(1, Math.max(0, total)),
    isBlur: sharpnessVar < BLUR_THRESHOLD,
  };
}

/** Salud de la decisión de disparo (FIX v9) — invariante al FPS: la
 * velocidad a la que llegan las muestras depende del FPS de análisis del
 * dispositivo (el throttle adaptativo F-PERF SUBE los fps en equipos
 * rápidos), NO de la velocidad del usuario. La decisión se expresa en
 * TIEMPO puro + proporción de muestras buenas, no en conteos fijos. */
export interface ShutterHealth {
  /** fps efectivo de análisis: 1000 / mediana(intervalos), clamp 1.5–60. */
  fpsEff: number;
  /** Muestras dentro de la ventana temporal (SHUTTER_SPAN_MS). */
  windowSamples: number;
  /** K dinámico exigido: max(2, ceil(windowSamples × 0.7)). */
  kRequired: number;
  /** Cuántas buenas (score > SHUTTER_SCORE) hay en la ventana. */
  goodInWindow: number;
  /** Tramo continuo bueno hacia atrás desde la última muestra (ms). */
  sustainedGoodMs: number;
  triggered: boolean;
  /** 'ok' | 'last-bad' | 'few-samples' | 'sustain' | 'not-enough-good'. */
  reason: string;
}

/**
 * FIX v9 — decisión de disparo invariante al FPS del dispositivo.
 *
 * Bug reportado: en dispositivos con video muy fluido (30 fps de análisis)
 * la compuerta F-STAB vieja (duración de las últimas 6 muestras ≥ 260 ms)
 * estaba SIEMPRE bloqueada (6 muestras a 30 fps = 200 ms < 260) — la
 * mecánica mezclaba «número de muestras» con «tiempo» y el disparo quedaba
 * cautivo del FPS del equipo. Reglas (en orden):
 *
 * 1. Última muestra buena (score > SHUTTER_SCORE) — sin cambios.
 * 2. Ventana de TIEMPO pura: TODAS las muestras de SHUTTER_SPAN_MS.
 * 3. Mínimo de datos: ≥ 2 muestras en historial y en ventana.
 * 4. K dinámico por proporción: ≥ 70 % de la ventana debe ser buena
 *    (mismo rigor relativo a 30 fps y a 3 fps).
 * 5. FPS efectivo: mediana de intervalos → clamp 1.5–60 (solo métrica).
 * 6. F-STAB v9: tramo CONTINUO bueno hacia atrás desde la última muestra,
 *    tolerando huecos ≤ max(1.6 × intervaloMedio, 350) ms (fps bajos).
 * 7. Sostenimiento: el tramo continuo debe cubrir ≥ SHUTTER_SUSTAIN_MS.
 *
 * El orden de los gates de rechazo sigue la tabla de verificación U1–U8
 * del fix (U5 «barrido rápido» reporta `sustain`, la regresión crítica:
 * el fix NO debe facilitar capturas en barridos rápidos).
 */
export function computeShutterDecision(history: ScoreSample[]): ShutterHealth {
  const sorted = [...history].sort((a, b) => a.t - b.t);
  const n = sorted.length;
  if (n === 0) {
    return {
      fpsEff: 0, windowSamples: 0, kRequired: 0, goodInWindow: 0,
      sustainedGoodMs: 0, triggered: false, reason: "few-samples",
    };
  }
  const now = sorted[n - 1]!.t;
  const last = sorted[n - 1]!;

  // FPS efectivo: mediana de los intervalos entre muestras consecutivas.
  let fpsEff = 0;
  let medianGapMs = 0;
  if (n >= 2) {
    const gaps: number[] = [];
    for (let i = 1; i < n; i++) gaps.push(sorted[i]!.t - sorted[i - 1]!.t);
    gaps.sort((a, b) => a - b);
    medianGapMs = gaps[Math.floor(gaps.length / 2)]!;
    fpsEff = Math.min(60, Math.max(1.5, 1000 / Math.max(medianGapMs, 1)));
  }

  // Ventana de TIEMPO pura (todas las muestras del span, sin slice fijo).
  const inSpan = sorted.filter((s) => s.t >= now - SHUTTER_SPAN_MS);
  const windowSamples = inSpan.length;

  // 1. La última muestra debe ser buena.
  if (last.score <= SHUTTER_SCORE) {
    return {
      fpsEff, windowSamples, kRequired: 0, goodInWindow: 0,
      sustainedGoodMs: 0, triggered: false, reason: "last-bad",
    };
  }
  // 3. Mínimo de datos.
  if (n < 2 || windowSamples < 2) {
    return {
      fpsEff, windowSamples, kRequired: 0, goodInWindow: 0,
      sustainedGoodMs: 0, triggered: false, reason: "few-samples",
    };
  }

  // F-STAB v9 — tramo continuo bueno hacia atrás desde la última muestra:
  // avanza mientras la muestra anterior sea buena Y el hueco con ella caiga
  // dentro de la tolerancia dinámica (1.6 × intervalo mediano, mínimo
  // 350 ms — a 3 fps el hueco normal es ~333 ms y debe pasar el corte).
  const gapTolerance = Math.max(1.6 * medianGapMs, 350);
  let stretchStart = n - 1;
  while (stretchStart > 0) {
    const prev = sorted[stretchStart - 1]!;
    const gap = sorted[stretchStart]!.t - prev.t;
    if (prev.score > SHUTTER_SCORE && gap <= gapTolerance) stretchStart--;
    else break;
  }
  const sustainedGoodMs = now - sorted[stretchStart]!.t;

  // 7. Exigencia de sostenimiento (regresión crítica U5: barrido rápido).
  if (sustainedGoodMs < SHUTTER_SUSTAIN_MS) {
    const kRequired = Math.max(2, Math.ceil(windowSamples * 0.7));
    let goodInWindow = 0;
    for (const s of inSpan) if (s.score > SHUTTER_SCORE) goodInWindow++;
    return {
      fpsEff, windowSamples, kRequired, goodInWindow,
      sustainedGoodMs, triggered: false, reason: "sustain",
    };
  }

  // 4. K dinámico por proporción: mismo rigor relativo en cualquier FPS.
  const kRequired = Math.max(2, Math.ceil(windowSamples * 0.7));
  let goodInWindow = 0;
  for (const s of inSpan) if (s.score > SHUTTER_SCORE) goodInWindow++;
  if (goodInWindow < kRequired) {
    return {
      fpsEff, windowSamples, kRequired, goodInWindow,
      sustainedGoodMs, triggered: false, reason: "not-enough-good",
    };
  }

  return {
    fpsEff, windowSamples, kRequired, goodInWindow,
    sustainedGoodMs, triggered: true, reason: "ok",
  };
}

/**
 * Disparo (wrapper booleano de computeShutterDecision, FIX v9) — misma
 * firma que siempre para no romper a los consumidores existentes.
 */
export function shouldTriggerShutter(history: ScoreSample[]): boolean {
  return computeShutterDecision(history).triggered;
}

/** Escape a manual: true si pasó más de NO_DETECT_TIMEOUT_MS desde el primer intento. */
export function detectionTimedOut(firstAttemptMs: number, nowMs: number): boolean {
  return nowMs - firstAttemptMs > NO_DETECT_TIMEOUT_MS;
}

/** Histograma de 256 bins de luma de un ImageData (para exposición). */
export function lumaHistogram(data: Uint8ClampedArray): number[] {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < data.length; i += 4) {
    const l =
      0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
    hist[Math.min(255, Math.max(0, Math.round(l)))]! += 1;
  }
  return hist;
}
