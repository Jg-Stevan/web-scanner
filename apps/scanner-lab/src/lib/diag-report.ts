"use client";

/**
 * DIAG — diag-report: ensambla el INFORME DE DIAGNÓSTICO con datos 100 %
 * reales medidos en el dispositivo (sonda §6 + device-profile §4) y lo
 * expone como JSON (análisis) y TXT (compartible por WhatsApp).
 *
 * Privacidad estricta (⛔ spec): el informe NO contiene imágenes, contenido
 * de documentos, nombres de documentos ni texto OCR. Solo métricas,
 * dimensiones y tamaños. Jamás referencia blobs, data URLs ni ocrText.
 *
 * Export y compartir (§7): window.__diagTools = { snapshot(), bench(),
 * report(), txt(), download(), share(), copy() }. Sin red: todo local.
 */

import { perfProbe, PERF_PROBE_T0, PERF_PROBE_T0_AT, type PerfProbeMark } from "./perf-probe";

/** D-13 (kit limpieza-v1) — versión ÚNICA del informe: JSON (render) y TXT
 * (cabecera «Formato») deben coincidir. Antes: JSON emitía 6 y el TXT
 * decía «v5» hardcodeado. Solo diagnóstico — cero comportamiento. */
const DIAG_REPORT_VERSION = 6;
import {
  getOrphanPhotoStats,
  getVideoTrackSize,
} from "./burst-budget";
import {
  getDeviceSnapshot,
  runBenchmarks,
  getBenchCache,
  getPeakHeapMB,
  readBattery,
  type DiagDeviceSnapshot,
  type DiagBenchResults,
} from "./device-profile";
import {
  getQaTestState,
  QA_MODE_LABEL,
  type QaMode,
  type QaStepLog,
} from "./qa-standard-test";
import { useScannerStore } from "@jg-stevan/scanner-core/store";

/** Build que originó este informe (rama @ commit corto). */
export const DIAG_BUILD = "perf/lote5-foton lote5.7.1";

/** Sección QA del informe (v3 — spec diag-test-estandar-qa): solo viaja
 *  cuando el guión corrió (o se abortó a mitad). */
export interface DiagQaSection {
  standard: true;
  script: "qa-standard-v1.3";
  /** v1.3 — modo del guión que corrió (rápido 2 pasos / completo 12). */
  mode: QaMode;
  steps: Array<{
    id: string;
    label: string;
    ms: number | null;
    ok: boolean;
    mode?: "auto" | "manual";
    waitMs?: number | null;
    /** v1.2 — decode/tier del primer render (solo editor-1/editor-2). */
    decodeMs?: number | null;
    tier?: string | null;
  }>;
  aborted?: boolean;
}

/* ------------------------------------------------------------------ */
/* Tipos del informe (spec §6a)                                         */
/* ------------------------------------------------------------------ */

export interface DiagTier {
  tier: string | null;
  effectiveLongSide: number | null;
  method: string | null;
  downgradedByTiming: boolean;
  qaForced: boolean;
}

export interface DiagReport {
  format: "scannerlab-diag-report";
  /** v1 → v2 (sub-marks) → v3 (test estándar QA) → v4 (burst-budget) →
   *  v5 (burst v2-A13) → v6 (lote5-foton: camera.streamW/H +
   *  photoSettingsReq/photoOutLongSide/takePhotoMs): SOLO campos
   *  adicionales — todo campo v1 conserva nombre y significado (informes
   *  de los lotes 1-5 comparables 1:1). */
  version: typeof DIAG_REPORT_VERSION;
  generatedAt: string;
  app: { build: string };
  device: DiagDeviceSnapshot;
  tier: DiagTier | null;
  benchmarks: DiagBenchResults & { benchAgeDays: number | null };
  session: {
    startedAt: string;
    durationMs: number;
    boot: { appReadyMs: number | null };
    camera: {
      readyMs: number | null;
      fpsEarly: number | null;
      fpsLate: number | null;
      /** v3 — espera del auto-shutter por página (capture_fired −
       *  capture_stable): el dato que cuantifica la demora del shutter en
       *  gama baja, con o sin guión QA. */
      autoShutterWaitMs: number[];
      /** LOTE 5 (F5-D) v6 — resolución REAL del stream (track.getSettings),
       *  capturada en el mark camera_ready. Nullable: algunos UA tardan en
       *  exponer width/height en el primer frame. */
      streamW: number | null;
      streamH: number | null;
      /** LOTE 5 (F5-D) v6 — photoSettings pedido al takePhoto ganador
       *  (p. ej. "2048x1536" o "naked"; null si no hubo takePhoto en la
       *  captura: galería, demo, frames puros). */
      photoSettingsReq: string | null;
      /** LOTE 5 (F5-D) v6 — lado mayor del blob ganador (sniff de
       *  readBlobLongSide que dispatchPhotoBlob/takePhotoBlob ya hacen). */
      photoOutLongSide: number | null;
      /** LOTE 5 (F5-D) v6 — mediana de los intentos ganadores de la sesión. */
      takePhotoMs: number | null;
      /** LOTE 5.6 (diag-encuadre) — aspecto (origW/origH) de la ÚLTIMA
       *  página con dims conocidas; null si no hay. El del stream se deriva
       *  de streamW/H al imprimir (no se duplica). */
      photoAspect: number | null;
    };
    pages: {
      count: number;
      resolutions: number[];
      captureToSavedMs: number[];
      medianMs: number | null;
      /** v1.1 — descomposición de captura→guardada (medianas):
       *  shot→processed (decode+downscale+calidad) y processed→write
       *  (persistencia en el store). */
      segments: {
        shotToProcessedMs: number | null;
        processedToWriteMs: number | null;
      };
      /** LOTE 5.6 (diag-encuadre) — telemetría de encuadre por página (el
       *  MISMO orden de creación que resolutions): origen del quad
       *  (overlay/detect/none; "?" si la página nació antes del campo),
       *  manual/pending, quad en fracciones 0-1 (3 decimales), bbox % de
       *  la foto que cubre el quad y dims del original. Aditivo. */
      framing: Array<{
        src: "detect" | "overlay" | "none" | "?";
        manual: boolean;
        pending: boolean;
        quad: number[];
        bboxW: number | null;
        bboxH: number | null;
        origW: number | null;
        origH: number | null;
      }>;
      /** v4 (burst-budget) — adquisición bajo presupuesto: por qué terminó
       *  cada captura (meta aditiva del mark capture_shot) + gap
       *  capture_fired→shot, LA métrica del antes/después del fix (16.8 s
       *  → ≤ ~2 s en gama baja).
       *  v5 (burst v2-A13) — telemetría de la ventana: cuándo disparó el
       *  muro de verdad (wallFireMs), salud del sampler §B, resolución del
       *  track de video, congestión del hilo DENTRO de cada ventana y la
       *  foto huérfana (llegó tarde pero ¿llegó?). Solo campos nuevos:
       *  lotes 1-4 comparables 1:1. */
      burst?: {
        byReason: Record<string, number>;
        acquisitionMs: number[];
        acquisitionMsMedian: number | null;
        /** v5 — ms desde capture_fired cuando el presupuesto produjo la
         *  salida (waitedMs de recordBurst). ≈ timeBudgetMs = el muro cortó
         *  cuando debía; 6-8× = los timers seguían deslizándose. */
        wallFireMs: number[];
        /** v5 — muestras de estabilidad tomadas por captura (§B). */
        samples: number[];
        /** v5 — coste de la última muestra de cada captura (ms; objetivo
         *  < 10 ms — null cuando no se llegó a muestrear). */
        lastSampleCostMs: Array<number | null>;
        /** v5 — getSettings() del track de video al armar la cámara: la
         *  resolución REAL de la fuente del rescate (lote 4: 960 px). */
        videoTrack: { w: number; h: number } | null;
        /** v5 — long tasks (> 50 ms) que arrancaron DENTRO de cada ventana
         *  capture_fired → capture_shot: la congestión que desliza los
         *  timers del muro (lote 4: el hilo saturado ×6-8). */
        windowCongestion: Array<{ count: number; totalMs: number }>;
        /** v5 — la foto huérfana tras el corte del presupuesto: ¿llegó el
         *  blob del sensor? ¿a cuántos ms del disparo? (decide la Fase D). */
        orphanPhoto: {
          watched: number;
          arrived: number;
          pending: number;
          rejected: number;
          arrivalMs: number[];
          bytes: number[];
        };
        /** v4.2 (v3 Fase D) — gracia de la foto huérfana: cuántas capturas
         *  rescató la gracia a foto COMPLETA tras el corte, a cuántas cayó
         *  a frames tras esperarla, y el agregado de qué se despachó en
         *  TODAS las capturas presupuestadas (foto vs frames — el titular
         *  de v3: páginas a ~4000 px vs 960 px). Derivado de byReason + el
         *  campo aditivo `grace` del mark (ausente en lotes 1-5 → 0/null,
         *  informes viejos comparables). */
        grace: {
          photoGrace: number;
          framesFallback: number;
          graceWaitedMsMedian: number | null;
          dispatchSource: { photo: number; frames: number };
        };
        /** v4.3 (v4 §2.1) — tramo opaco por captura CON CORTE (recordBurst →
         *  mark capture_shot): total + sub-marks del pipe de foto (sniff /
         *  dataURL — solo camino photo) + jobs del editor al aterrizar.
         *  Cuadre §2.4: acquisitionMs ≈ burstWaitedMs(neto de gracia) +
         *  grace + pipeToMarkMs. Ausente en lotes sin cortes → arrays
         *  vacíos (informes viejos comparables). */
        pipe: {
          toMarkMs: number[];
          toMarkMsMedian: number | null;
          sniffMs: number[];
          dataUrlMs: number[];
          bgJobsAtShot: number[];
        };
        /** v4.3 (v4 §2.2) — congestión del hilo partida por el CORTE (solo
         *  capturas con corte; mismo observer de long tasks): espera
         *  (capture_fired → corte: muro + gracia) vs pipe (corte →
         *  capture_shot: el tramo opaco). Cuadre §2.4: espera + pipe ≈
         *  windowCongestion de la MISMA captura. */
        congestion: {
          cutCaptures: number;
          congestionWait: Array<{ count: number; totalMs: number }>;
          congestionPipe: Array<{ count: number; totalMs: number }>;
        };
        /** v5 §3.4 — sonda aditiva de heap JS durante el tramo opaco (solo
         *  capturas con corte; null si la plataforma no expone
         *  performance.memory). Ausente en lotes sin cortes → array vacío. */
        heapProbe: Array<{
          intervalMs: number;
          samples: number;
          minMB: number;
          maxMB: number;
          sawtoothMB: number;
          seriesMB: number[];
        } | null>;
      };
    };
    editor: {
      openMs: number | null;
      firstRenderMs: number | null;
      /** v1.1 — primer render POR APERTURA (índice = openIndex−1, cap 5;
       *  null = apertura sin render medido). Si la 2ª cae <1.5 s, el costo
       *  de la 1ª es chunk-red/compile → solución de bundle, no pipeline). */
      firstRenders: Array<number | null>;
      /** LOTE 2 (F2-G) — tier del primer render medido (meta.previewTier del
       *  mark editor_first_render con trabajo real; null = marca sin tier,
       *  builds previos al lote 2). */
      firstRenderTier: string | null;
      /** LOTE 2 (F2-G) — nº de upgrades fast→full completados en la sesión
       *  (marks editor_preview_upgraded del preview escalonado). */
      previewUpgrades: number;
      /** LOTE 3 (F3-B) — decodeMs del primer render (meta.decodeMs del
       *  último editor_first_render con cached:false que lo traiga numérico;
       *  null si ninguno — builds previos al lote 3 o fallback canvas). */
      firstRenderDecodeMs: number | null;
      fpsAuto: number | null;
      filterMedianMs: number | null;
      filterCount: number;
      /** v1.1 — mediana de filtros POR filterId (¿cuál es el caro?). */
      filters: Array<{
        filterId: string;
        count: number;
        medianMs: number;
        engines: Array<{ engine: string; count: number }>;
        cachedCount: number;
      }>;
      sessionMs: number | null;
    };
    ocr: {
      count: number;
      firstColdMs: number | null;
      medianWarmMs: number | null;
      charsTotal: number;
    };
    /** v1.1 — exports con páginas y lado largo de la fuente. */
    exports: Array<{
      type: string;
      ms: number;
      bytes: number;
      pages: number | null;
      pxLong: number | null;
    }>;
    memory: { peakHeapMB: number | null };
    longTasks: { count: number; totalMs: number; supported: boolean };
  };
  settings: { ocrEnabled: boolean };
  /** v3 — presente SOLO si el test estándar QA corrió en esta sesión. */
  qa?: DiagQaSection;
}

/* ------------------------------------------------------------------ */
/* Utilidades sobre los marks de la sonda                               */
/* ------------------------------------------------------------------ */

function marksOf(ev: string): PerfProbeMark[] {
  try {
    return perfProbe.marks.filter((m) => m.ev === ev);
  } catch {
    return [];
  }
}

function metaNum(m: PerfProbeMark | undefined, key: string): number | null {
  const v = m?.meta?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** LOTE 5 (F5-D) — lee un meta string de un mark (simétrico a metaNum).
 *  Null si falta o no es string no vacío (campo aditivo nullable). */
function metaStr(m: PerfProbeMark | undefined, key: string): string | null {
  const v = m?.meta?.[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/** Marca más reciente con ts ≤ límite (para aparear tramos secuenciales). */
function lastBefore(marks: PerfProbeMark[], ts: number): PerfProbeMark | null {
  let found: PerfProbeMark | null = null;
  for (const m of marks) {
    if (m.ts <= ts) found = m;
    else break;
  }
  return found;
}

/** Feature-check del tier-2: en main el módulo device-tier NO existe.
 *  Cuando plan-a se rebase sobre esta rama, su sonda expone tier() y
 *  __tierTools → el campo se enciende SOLO (spec §1.9). */
function resolveTier(): DiagTier | null {
  try {
    const w = window as unknown as {
      __tierTools?: { info?: () => Record<string, unknown> | null };
      __perfProbe?: { tier?: () => Record<string, unknown> | null };
    };
    const raw = w.__tierTools?.info?.() ?? w.__perfProbe?.tier?.();
    if (!raw) return null;
    const method = typeof raw.method === "string" ? raw.method : null;
    return {
      tier: typeof raw.tier === "string" ? raw.tier : null,
      effectiveLongSide:
        typeof raw.effectiveLongSide === "number" ? raw.effectiveLongSide : null,
      method,
      downgradedByTiming: raw.downgradedByTiming === true,
      qaForced: method === "qa-forced",
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Ensamblado del informe                                               */
/* ------------------------------------------------------------------ */

/** Construye el informe completo (JSON §6a) con los datos medidos. */
export async function buildDiagReport(): Promise<DiagReport> {
  const [device, benchmarks] = await Promise.all([
    getDeviceSnapshot(),
    runBenchmarks(false), // usa la caché de 7 días si está fresca
  ]);
  const cache = getBenchCache();
  const benchAgeDays = cache
    ? Math.round(((Date.now() - cache.ts) / 86_400_000) * 10) / 10
    : 0;

  // ── Marks de la sesión ──
  const savedPages = marksOf("page_saved");
  const firedShots = marksOf("capture_fired");
  const editorOpens = marksOf("editor_open");

  // Captura → página guardada (disparo → aterrizaje en la sesión).
  const captureToSavedMs: number[] = [];
  for (const p of savedPages) {
    let lastFired: PerfProbeMark | null = null;
    for (const f of firedShots) {
      if (f.ts <= p.ts) lastFired = f;
    }
    if (lastFired) captureToSavedMs.push(Math.max(0, p.ts - lastFired.ts));
  }

  // Captura → editor (editor_open.ts − page_saved.ts — spec §5, la última).
  let editorOpenMs: number | null = null;
  for (const p of savedPages) {
    const next = editorOpens.find((e) => e.ts >= p.ts);
    if (next) editorOpenMs = Math.max(0, next.ts - p.ts);
  }

  // Primer render del editor (editor_first_render − editor_open previo).
  // Se prefiere el ÚLTIMO render con trabajo real (no cacheado): el
  // cacheado es instantáneo por construcción y escondería el costo real.
  let firstRenderMs: number | null = null;
  let firstRenderCached: number | null = null;
  for (const fr of marksOf("editor_first_render")) {
    let prevOpen: PerfProbeMark | null = null;
    for (const e of editorOpens) {
      if (e.ts <= fr.ts) prevOpen = e;
    }
    if (!prevOpen) continue;
    const delta = Math.max(0, fr.ts - prevOpen.ts);
    if (fr.meta?.cached === false) firstRenderMs = delta;
    firstRenderCached = delta;
  }
  if (firstRenderMs === null) firstRenderMs = firstRenderCached;

  // v1.1 — firstRender POR APERTURA: cada editor_first_render se asigna a
  // la apertura numerada que lo precede (openIndex del editor_open previo;
  // si la marca vieja no trae openIndex, se deriva contando aperturas).
  const firstRenders: Array<number | null> = [];
  for (const fr of marksOf("editor_first_render")) {
    let prevOpen: PerfProbeMark | null = null;
    let opensBefore = 0;
    for (const e of editorOpens) {
      if (e.ts <= fr.ts) {
        prevOpen = e;
        opensBefore += 1;
      }
    }
    if (!prevOpen) continue;
    const openIndex = metaNum(prevOpen, "openIndex") ?? opensBefore;
    if (openIndex < 1) continue;
    const delta = Math.max(0, fr.ts - prevOpen.ts);
    while (firstRenders.length < openIndex) firstRenders.push(null);
    firstRenders[openIndex - 1] = delta;
  }
  if (firstRenders.length > 5) firstRenders.length = 5; // cap 5 (spec)

  // LOTE 2 (F2-G) — tier del primer render: se toma del ÚLTIMO mark
  // editor_first_render con trabajo real (cached:false — el mismo que
  // alimenta firstRenderMs); null si ninguno trae previewTier (builds
  // previos al lote 2 o sesiones solo-cacheadas).
  let firstRenderTier: string | null = null;
  for (const fr of marksOf("editor_first_render")) {
    if (
      fr.meta?.cached === false &&
      typeof fr.meta?.previewTier === "string" &&
      fr.meta.previewTier
    ) {
      firstRenderTier = fr.meta.previewTier;
    }
  }
  // LOTE 3 (F3-B) — decode del primer render: del ÚLTIMO mark
  // editor_first_render con trabajo real (cached:false) que traiga
  // meta.decodeMs numérico (misma lógica que firstRenderTier); null si
  // ninguno (builds previos al lote 3 o fallback canvas local).
  let firstRenderDecodeMs: number | null = null;
  for (const fr of marksOf("editor_first_render")) {
    if (fr.meta?.cached === false && typeof fr.meta?.decodeMs === "number") {
      firstRenderDecodeMs = fr.meta.decodeMs;
    }
  }
  // LOTE 2 (F2-G) — upgrades fast→full completados (pasada FULL del preview
  // escalonado; descarte documentado: el cachedCount por filtro de F2-D
  // queda descontinuado — nadie escribe meta.cached en filter_applied).
  const previewUpgrades = marksOf("editor_preview_upgraded").length;

  // Cámara: ready (última sesión) + FPS early/late. v3 — esperas del
  // auto-shutter: cada capture_fired apareado con el capture_stable más
  // cercano ANTES del disparo (estable→disparo).
  const cameraReady = marksOf("camera_ready");
  let fpsEarly: number | null = null;
  let fpsLate: number | null = null;
  for (const m of marksOf("fps_camera")) {
    if (m.meta?.phase === "early" && typeof m.meta.fps === "number") fpsEarly = m.meta.fps;
    if (m.meta?.phase === "late" && typeof m.meta.fps === "number") fpsLate = m.meta.fps;
  }
  const autoShutterWaitMs: number[] = [];
  for (const f of firedShots) {
    const stable = lastBefore(marksOf("capture_stable"), f.ts);
    if (stable) autoShutterWaitMs.push(Math.max(0, f.ts - stable.ts));
  }

  // Filtros: mediana de ms + contador. v1.1 — ADEMÁS por filterId (el mark
  // viejo sin id cae en "?" — comparable con lotes 1-2).
  const filterMs = marksOf("filter_applied")
    .map((m) => metaNum(m, "ms"))
    .filter((v): v is number => v !== null);
  const filterCount = marksOf("filter_applied").length;
  const filterTimesById = new Map<string, number[]>();
  const filterEnginesById = new Map<string, Map<string, number>>();
  const filterCachedById = new Map<string, number>();

  for (const m of marksOf("filter_applied")) {
    const id =
      typeof m.meta?.filterId === "string"
        ? (m.meta.filterId as string)
        : typeof m.meta?.filter === "string"
          ? (m.meta.filter as string)
          : "?";
    const ms = metaNum(m, "ms");
    if (ms !== null) {
      const arr = filterTimesById.get(id) ?? [];
      arr.push(ms);
      filterTimesById.set(id, arr);
    }
    const engine =
      typeof m.meta?.engine === "string" && m.meta.engine
        ? (m.meta.engine as string)
        : undefined;
    if (engine) {
      const engMap = filterEnginesById.get(id) ?? new Map<string, number>();
      engMap.set(engine, (engMap.get(engine) ?? 0) + 1);
      filterEnginesById.set(id, engMap);
    }
    if (m.meta?.cached === true) {
      filterCachedById.set(id, (filterCachedById.get(id) ?? 0) + 1);
    }
  }

  const filtersByFilterId = [...filterTimesById.entries()]
    .map(([filterId, arr]) => {
      const engMap = filterEnginesById.get(filterId);
      const engines = engMap
        ? [...engMap.entries()].map(([engine, count]) => ({ engine, count }))
        : [];
      return {
        filterId,
        count: arr.length,
        medianMs: median(arr) ?? 0,
        engines,
        cachedCount: filterCachedById.get(filterId) ?? 0,
      };
    })
    .sort((a, b) => b.medianMs - a.medianMs);

  // OCR: 1ª (frío, incluye CDN del motor) vs mediana del resto (tibio).
  const ocrDones = marksOf("ocr_done");
  const ocrMs = ocrDones
    .map((m) => metaNum(m, "ms"))
    .filter((v): v is number => v !== null);
  const charsTotal = ocrDones.reduce((n, m) => n + (metaNum(m, "chars") ?? 0), 0);

  // Exports completados. v1.1 — con páginas y lado largo de la fuente.
  const exports = marksOf("export_end")
    .map((m) => ({
      type: typeof m.meta?.type === "string" ? (m.meta.type as string) : "?",
      ms: metaNum(m, "ms") ?? 0,
      bytes: metaNum(m, "bytes") ?? 0,
      pages: metaNum(m, "pages"),
      pxLong: metaNum(m, "pxLong"),
    }))
    .filter((e) => e.ms > 0);

  // v1.1 — tramos de captura: shot→processed (procesado) y
  // processed→write (escritura), medianas de la sesión.
  const shotToProcessedMs: number[] = [];
  const processedToWriteMs: number[] = [];
  const shotMarks = marksOf("capture_shot");
  const processedMarks = marksOf("capture_processed");
  const writeMarks = marksOf("capture_write");
  for (const p of processedMarks) {
    const shot = lastBefore(shotMarks, p.ts);
    if (shot) shotToProcessedMs.push(Math.max(0, p.ts - shot.ts));
    const write = writeMarks.find((w) => w.ts >= p.ts);
    if (write) processedToWriteMs.push(Math.max(0, write.ts - p.ts));
  }

  // v4 (burst-budget) — adquisición por captura: razón de salida del
  // presupuesto (meta aditiva del mark capture_shot) + gap
  // capture_fired→shot apareado con el disparo previo. Solo si ALGUNA
  // captura trajo meta burst (sesiones/ramas sin burst-budget → campo
  // ausente, informes viejos idénticos).
  // v5 (burst v2-A13) — telemetría de la ventana por captura: wallFireMs
  // (cuándo produjo la salida el presupuesto), salud del sampler §B y
  // congestión del hilo DENTRO de la ventana (long tasks con instante —
  // el MISMO observer de session.longTasks, filtrado por ventana). + los
  // globales de la sesión: videoTrack y la foto huérfana.
  const burstByReason: Record<string, number> = {};
  const burstAcquisitionMs: number[] = [];
  const burstWallFireMs: number[] = [];
  const burstSamples: number[] = [];
  const burstSampleCostMs: Array<number | null> = [];
  const burstWindowCongestion: Array<{ count: number; totalMs: number }> = [];
  // v4.2 (v3 Fase D) — grace del mark capture_shot (campo aditivo opcional:
  // ms que la gracia esperó a la huérfana; ausente = la gracia no corrió).
  const burstGraceWaitedMs: number[] = [];
  let burstGraceRan = 0;
  // v4.3 (v4 §2.1/§2.2) — tramo opaco + congestión partida por el corte:
  // SOLO capturas con corte traen pipeToMarkMs en el meta (ausente en
  // rutas sin corte → arrays alineados únicamente con cortes).
  const burstPipeToMarkMs: number[] = [];
  const burstPipeSniffMs: number[] = [];
  const burstPipeDataUrlMs: number[] = [];
  const burstPipeBgJobs: number[] = [];
  const burstCongestionWait: Array<{ count: number; totalMs: number }> = [];
  const burstCongestionPipe: Array<{ count: number; totalMs: number }> = [];
  const burstHeapProbe: Array<{
    intervalMs: number;
    samples: number;
    minMB: number;
    maxMB: number;
    sawtoothMB: number;
    seriesMB: number[];
  } | null> = [];
  const longTaskEntries = perfProbe.longTaskEntries;
  // LOTE 5 (F5-D) v6 — aditivo: photoSettings pedido, ms del attempt
  // ganador y lado mayor del blob (metas del mark capture_shot, poblados
  // arriba en CameraView.takePhotoBlob y dispatchPhotoBlob). SOLO
  // capturas con takePhoto traen el meta (galería/demo/frames puros →
  // arrays vacíos y últimos nullables, campo null sin romper nada).
  let lastPhotoSettingsReq: string | null = null;
  const takePhotoMsValues: number[] = [];
  let lastPhotoOutLongSide: number | null = null;
  for (const s of shotMarks) {
    const fired = lastBefore(firedShots, s.ts);
    if (fired) burstAcquisitionMs.push(Math.max(0, s.ts - fired.ts));
    const reason = s.meta?.burstExitReason;
    if (typeof reason === "string") {
      burstByReason[reason] = (burstByReason[reason] ?? 0) + 1;
    }
    // v5 — solo para capturas con meta burst (los viejos no traen nada).
    if (reason !== undefined) {
      const waited = s.meta?.burstWaitedMs;
      if (typeof waited === "number" && Number.isFinite(waited)) {
        burstWallFireMs.push(waited);
      }
      const samples = s.meta?.burstSamples;
      if (typeof samples === "number" && Number.isFinite(samples)) {
        burstSamples.push(samples);
      }
      const cost = s.meta?.burstSampleCostMs;
      burstSampleCostMs.push(typeof cost === "number" && Number.isFinite(cost) ? cost : null);
      // v4.2 — la gracia corrió en ESTA captura (campo `grace` presente).
      const grace = s.meta?.grace;
      if (typeof grace === "number" && Number.isFinite(grace)) {
        burstGraceRan += 1;
        burstGraceWaitedMs.push(grace);
      }
      // v4.3 — tramo opaco: SOLO capturas con corte (campo pipeToMarkMs del
      // meta, ausente en rutas sin corte — gate 3 de la spec v4).
      const pipeToMark = s.meta?.pipeToMarkMs;
      if (typeof pipeToMark === "number" && Number.isFinite(pipeToMark)) {
        burstPipeToMarkMs.push(pipeToMark);
        const sniff = s.meta?.pipeSniffMs;
        if (typeof sniff === "number" && Number.isFinite(sniff)) {
          burstPipeSniffMs.push(sniff);
        }
        const dataUrl = s.meta?.pipeDataUrlMs;
        if (typeof dataUrl === "number" && Number.isFinite(dataUrl)) {
          burstPipeDataUrlMs.push(dataUrl);
        }
        const jobs = s.meta?.bgJobsAtShot;
        if (typeof jobs === "number" && Number.isFinite(jobs)) {
          burstPipeBgJobs.push(jobs);
        }
        const hp = s.meta?.heapProbe;
        if (
          hp &&
          typeof hp === "object" &&
          typeof (hp as { samples?: unknown }).samples === "number" &&
          typeof (hp as { minMB?: unknown }).minMB === "number" &&
          typeof (hp as { maxMB?: unknown }).maxMB === "number" &&
          typeof (hp as { sawtoothMB?: unknown }).sawtoothMB === "number" &&
          Array.isArray((hp as { seriesMB?: unknown }).seriesMB)
        ) {
          burstHeapProbe.push(hp as {
            intervalMs: number;
            samples: number;
            minMB: number;
            maxMB: number;
            sawtoothMB: number;
            seriesMB: number[];
          });
        } else {
          burstHeapProbe.push(null);
        }
        if (fired) {
          // v4 §2.2 — instante del corte = mark − pipeToMarkMs (el tramo
          // abrió en el recordBurst que siguió a la gracia). MISMO criterio
          // de ventana que windowCongestion (arranque dentro), partido por
          // el corte → espera + pipe cuadran con la ventana (§2.4).
          const cutTs = Math.max(fired.ts, s.ts - pipeToMark);
          let wCount = 0;
          let wTotal = 0;
          let pCount = 0;
          let pTotal = 0;
          for (const lt of longTaskEntries) {
            if (lt.start >= fired.ts && lt.start <= s.ts) {
              if (lt.start < cutTs) {
                wCount += 1;
                wTotal += lt.duration;
              } else {
                pCount += 1;
                pTotal += lt.duration;
              }
            }
          }
          burstCongestionWait.push({ count: wCount, totalMs: wTotal });
          burstCongestionPipe.push({ count: pCount, totalMs: pTotal });
        }
      }
      if (fired) {
        let count = 0;
        let totalMs = 0;
        for (const lt of longTaskEntries) {
          if (lt.start >= fired.ts && lt.start <= s.ts) {
            count += 1;
            totalMs += lt.duration;
          }
        }
        burstWindowCongestion.push({ count, totalMs });
      }
    }
    // LOTE 5 (F5-D) v6 — aditivo: lee el meta del intento ganador de
    // takePhoto y del sniff del blob (aditivo al mark capture_shot;
    // ausente en rutas sin takePhoto → campo null, sin romper nada).
    const psr = metaStr(s, "photoSettingsReq");
    if (psr !== null) {
      lastPhotoSettingsReq = psr;
    }
    const tpMs = metaNum(s, "takePhotoMs");
    if (tpMs !== null) {
      takePhotoMsValues.push(tpMs);
    }
    const pol = metaNum(s, "photoOutLongSide");
    if (pol !== null) {
      lastPhotoOutLongSide = pol;
    }
  }
  // v4.2 (v3 Fase D) — bloque de la gracia. Derivación:
  //  · photoGrace = capturas rescatadas por la gracia (reason photo_grace).
  //  · framesFallback = la gracia corrió (campo `grace` presente) pero la
  //    foto no llegó → dispatch de frames (la cuenta de graces corridos
  //    menos los rescatados).
  //  · dispatchSource = QUÉ se despachó en las capturas presupuestadas
  //    (foto = photo + photo_grace; frames = stable/time_cap/frame_cap/
  //    error — legacy queda fuera: presupuesto apagado, no es una decisión
  //    de dispatch del presupuesto).
  const burstPhotoGrace = burstByReason["photo_grace"] ?? 0;
  const burst =
    Object.keys(burstByReason).length > 0
      ? {
          byReason: burstByReason,
          acquisitionMs: burstAcquisitionMs,
          acquisitionMsMedian: median(burstAcquisitionMs),
          wallFireMs: burstWallFireMs,
          samples: burstSamples,
          lastSampleCostMs: burstSampleCostMs,
          videoTrack: getVideoTrackSize(),
          windowCongestion: burstWindowCongestion,
          orphanPhoto: getOrphanPhotoStats(),
          grace: {
            photoGrace: burstPhotoGrace,
            framesFallback: Math.max(0, burstGraceRan - burstPhotoGrace),
            graceWaitedMsMedian:
              burstGraceWaitedMs.length > 0
                ? median(burstGraceWaitedMs)
                : null,
            dispatchSource: {
              photo: (burstByReason["photo"] ?? 0) + burstPhotoGrace,
              frames:
                (burstByReason["stable"] ?? 0) +
                (burstByReason["time_cap"] ?? 0) +
                (burstByReason["frame_cap"] ?? 0) +
                (burstByReason["error"] ?? 0),
            },
          },
          // v4.3 (v4) — tramo opaco (§2.1) + congestión partida (§2.2):
          // bloques ADITIVOS; sin cortes en la sesión → arrays vacíos y
          // cutCaptures 0 (informes pre-v4 comparables campo a campo).
          pipe: {
            toMarkMs: burstPipeToMarkMs,
            toMarkMsMedian: median(burstPipeToMarkMs),
            sniffMs: burstPipeSniffMs,
            dataUrlMs: burstPipeDataUrlMs,
            bgJobsAtShot: burstPipeBgJobs,
          },
          congestion: {
            cutCaptures: burstPipeToMarkMs.length,
            congestionWait: burstCongestionWait,
            congestionPipe: burstCongestionPipe,
          },
          heapProbe: burstHeapProbe,
        }
      : undefined;

  const lastClose = marksOf("editor_close");
  const bootMark = marksOf("boot_ready")[0];

  let ocrEnabled = false;
  try {
    ocrEnabled = useScannerStore.getState().settings.ocrEnabled === true;
  } catch {
    /* store no disponible: queda false */
  }

  // LOTE 5.6 + 5.7.1 (diag-encuadre, framing persistente) — telemetría de
  // encuadre por página. DOS fuentes unidas por pageId:
  //  (1) store vivo al exportar — verdad completa (manual/pending) para las
  //      páginas aún presentes; gana si ambas fuentes existen.
  //  (2) marks "page_framing" (born/detect) — PERSISTENTES: traen TODAS las
  //      páginas nacidas en la sesión aunque el store ya no las tenga
  //      (guardado, cierre, eliminadas en el editor). Orden: born (ts).
  //      El bbox % de la foto + el Δaspecto stream-vs-foto (camera.
  //      photoAspect) adjudican la disputa recorte-detector vs encuadre-cámara.
  let framing: DiagReport["session"]["pages"]["framing"] = [];
  let photoAspect: number | null = null;
  const entryFromQuad = (
    src: "detect" | "overlay" | "none" | "?",
    manual: boolean,
    pending: boolean,
    quad: Array<{ x: number; y: number }>,
    origW: number | null,
    origH: number | null,
  ) => {
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    // D-16 (kit limpieza-v1): quad vacío → Math.max/min de spread vacío
    // producía bboxW/bboxH = -Infinity. Guard temprano: null honesto
    // (sin bbox medible) en lugar de un número imposible. Solo diag.
    if (quad.length === 0) {
      return {
        src,
        manual,
        pending,
        quad: [],
        bboxW: null,
        bboxH: null,
        origW,
        origH,
      };
    }
    const xs = quad.map((c) => c.x);
    const ys = quad.map((c) => c.y);
    return {
      src,
      manual,
      pending,
      quad: quad.flatMap((c) => [r3(c.x), r3(c.y)]),
      bboxW: Math.round((Math.max(...xs) - Math.min(...xs)) * 1000) / 10,
      bboxH: Math.round((Math.max(...ys) - Math.min(...ys)) * 1000) / 10,
      origW,
      origH,
    };
  };
  const liveIds = new Set<string>();
  try {
    const livePages = useScannerStore.getState().capturePages;
    framing = livePages.map((p) => {
      liveIds.add(p.id);
      return entryFromQuad(
        p.quadSource ?? "?",
        p.quadManual === true,
        p.autoQuadPending === true,
        p.quad,
        p.origW ?? null,
        p.origH ?? null,
      );
    });
    for (const p of livePages) {
      if (p.origW && p.origH) photoAspect = p.origW / p.origH;
    }
  } catch {
    /* store no disponible: framing queda vacío (informe comparable) */
  }
  // LOTE 5.7.1 — marks page_framing: born + último detect por página. Solo
  // añaden páginas que ya NO están en el store vivo (las vivas conservan su
  // verdad manual/pending). El detect reemplaza quad y src del born.
  try {
    const bornById = new Map<
      string,
      {
        src: "overlay" | "none";
        origW: number | null;
        origH: number | null;
        quad: Array<{ x: number; y: number }>;
      }
    >();
    const detectById = new Map<string, Array<{ x: number; y: number }>>();
    for (const m of marksOf("page_framing")) {
      const meta = m.meta ?? {};
      const pageId = String(meta.pageId ?? "");
      if (!pageId) continue;
      const q: Array<{ x: number; y: number }> = [];
      let ok = true;
      for (let i = 0; i < 4; i += 1) {
        const x = meta[`q${i * 2}`];
        const y = meta[`q${i * 2 + 1}`];
        if (typeof x !== "number" || typeof y !== "number") {
          ok = false;
          break;
        }
        q.push({ x, y });
      }
      if (!ok) continue;
      if (meta.phase === "detect") {
        detectById.set(pageId, q);
      } else {
        bornById.set(pageId, {
          src: meta.src === "overlay" ? "overlay" : "none",
          origW: typeof meta.origW === "number" ? meta.origW : null,
          origH: typeof meta.origH === "number" ? meta.origH : null,
          quad: q,
        });
      }
    }
    for (const [pageId, b] of bornById) {
      if (liveIds.has(pageId)) continue;
      const d = detectById.get(pageId);
      framing.push(
        entryFromQuad(
          d ? "detect" : b.src,
          false,
          false,
          d ?? b.quad, // (spec traía `d.quad` — d ES el array del detect: TS2339)
          b.origW,
          b.origH,
        ),
      );
      if (b.origW && b.origH && photoAspect === null) {
        photoAspect = b.origW / b.origH;
      }
    }
  } catch {
    /* marks no disponibles: queda lo del store vivo (comportamiento 5.6) */
  }

  // v1.1 — batería FRESCA al momento del informe (el snapshot cacheado la
  // leyó al arrancar; nivel+enchufe ayudan a interpretar fpsEarly bajos).
  const freshBattery = await readBattery();
  if (freshBattery) device.battery = freshBattery;

  // v3 — sección QA: SOLO si el guión corrió (log no vacío o abortado).
  const qaState = getQaTestState();
  const qaRan = qaState.log.length > 0 || qaState.aborted;
  const qa: DiagQaSection | undefined = qaRan
    ? {
        standard: true,
        script: "qa-standard-v1.3",
        mode: qaState.mode,
        steps: qaState.log.map((l: QaStepLog) => ({
          id: l.id,
          label: l.label,
          ms: l.ms,
          ok: l.ok,
          ...(l.mode !== undefined ? { mode: l.mode } : {}),
          ...(l.waitMs !== undefined ? { waitMs: l.waitMs } : {}),
          ...(l.decodeMs !== undefined ? { decodeMs: l.decodeMs } : {}),
          ...(l.tier !== undefined ? { tier: l.tier } : {}),
        })),
        ...(qaState.aborted ? { aborted: true } : {}),
      }
    : undefined;

  return {
    format: "scannerlab-diag-report",
    version: DIAG_REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    app: { build: DIAG_BUILD },
    device,
    tier: resolveTier(),
    benchmarks: { ...benchmarks, benchAgeDays },
    session: {
      startedAt: new Date(PERF_PROBE_T0_AT).toISOString(),
      durationMs: Math.max(0, Math.round(performance.now() - PERF_PROBE_T0)),
      boot: { appReadyMs: metaNum(bootMark, "ms") },
      camera: {
        readyMs: metaNum(cameraReady[cameraReady.length - 1], "ms"),
        fpsEarly,
        fpsLate,
        autoShutterWaitMs,
        // LOTE 5 (F5-D) v6 — aditivos nullable: resolución REAL del track
        // (mark camera_ready) + telemetría del takePhoto ganador (mark
        // capture_shot). Null si el mark no trajo el meta.
        streamW: metaNum(cameraReady[cameraReady.length - 1], "streamW"),
        streamH: metaNum(cameraReady[cameraReady.length - 1], "streamH"),
        photoSettingsReq: lastPhotoSettingsReq,
        photoOutLongSide: lastPhotoOutLongSide,
        takePhotoMs: median(takePhotoMsValues),
        photoAspect,
      },
      pages: {
        count: savedPages.length,
        resolutions: savedPages
          .map((m) => metaNum(m, "pxLong"))
          .filter((v): v is number => v !== null),
        captureToSavedMs,
        medianMs: median(captureToSavedMs),
        segments: {
          shotToProcessedMs: median(shotToProcessedMs),
          processedToWriteMs: median(processedToWriteMs),
        },
        framing,
        ...(burst ? { burst } : {}),
      },
      editor: {
        openMs: editorOpenMs,
        firstRenderMs,
        firstRenders,
        firstRenderTier,
        firstRenderDecodeMs,
        previewUpgrades,
        fpsAuto: metaNum(marksOf("fps_auto").pop(), "fps"),
        filterMedianMs: median(filterMs),
        filterCount,
        filters: filtersByFilterId,
        sessionMs: metaNum(lastClose[lastClose.length - 1], "durationMs"),
      },
      ocr: {
        count: ocrDones.length,
        firstColdMs: ocrMs.length > 0 ? (ocrMs[0] as number) : null,
        medianWarmMs: ocrMs.length > 1 ? median(ocrMs.slice(1)) : null,
        charsTotal,
      },
      exports,
      memory: { peakHeapMB: getPeakHeapMB() },
      longTasks: {
        count: perfProbe.longTasks.count,
        totalMs: Math.round(perfProbe.longTasks.totalMs),
        supported: perfProbe.longTasks.supported,
      },
    },
    settings: { ocrEnabled },
    ...(qa ? { qa } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* TXT compartible (spec §6b — plantilla exacta)                        */
/* ------------------------------------------------------------------ */

/** "—" para datos que el navegador no expone. Jamás inventar valores. */
const DASH = "—";

function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return DASH;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

function fmtDur(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

function fmtMB(bytes: number): string {
  if (bytes < 1_048_576) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / 1_048_576;
  return mb >= 10 ? `${mb.toFixed(0)} MB` : `${mb.toFixed(1)} MB`;
}

/** Construye el TXT del informe (plantilla §6b). */
export function buildDiagTxt(r: DiagReport): string {
  const d = r.device;
  const b = r.benchmarks;
  const s = r.session;
  const lines: string[] = [];
  const push = (line = "") => lines.push(line);

  push("==============================================");
  push(" INFORME DE DIAGNÓSTICO · scanner-lab");
  push("==============================================");
  push(`Generado : ${new Date(r.generatedAt).toLocaleString()}`);
  push(`Build    : ${r.app.build}`);
  push(`Formato  : diag-report v${DIAG_REPORT_VERSION}`);
  if (r.qa) {
    push();
    // v1.3 — cabecera mode-aware (rápido 1 captura / completo 12 pasos).
    push(
      `TEST QA v1.3 · ${QA_MODE_LABEL[r.qa.mode] ?? QA_MODE_LABEL.full}` +
        (r.qa.aborted ? " (ABORTADO — informe parcial)" : "")
    );
    push("Protocolo: ahorro batería OFF · dispositivo");
    push("frío · captura automática nativa · mismo");
    push("documento con texto");
    // v1.2 — tabla de resultados: SOLO pasos medidos (los abortados, con
    // ms: null, no pintan fila). Etiqueta alineada a la columna de 26
    // chars del resto del informe; decode/tier solo cuando el mark los
    // trajo (editor-1/editor-2).
    for (const st of r.qa.steps) {
      if (!st.ok || st.ms === null) continue;
      let rest = fmtMs(st.ms);
      if (st.mode) rest += ` · ${st.mode}`;
      if (st.waitMs !== null && st.waitMs !== undefined) {
        rest += ` (espera ${fmtMs(st.waitMs)})`;
      }
      if (st.decodeMs !== null && st.decodeMs !== undefined) {
        rest += ` · decode ${Math.round(st.decodeMs)} ms`;
      }
      if (st.tier) rest += ` · tier ${st.tier}`;
      push(`${st.label.padEnd(26, " ")}: ${rest}`);
    }
  }
  push();
  push("-- DISPOSITIVO -------------------------------");
  push(`Modelo       : ${d.model ?? DASH}`);
  push(`SO           : ${[d.os, d.osVersion].filter(Boolean).join(" ") || DASH}`);
  push(`Navegador    : ${[d.browser, d.browserVersion].filter(Boolean).join(" ") || DASH}`);
  push(`CPU          : ${d.cores ?? DASH} núcleos · bench: ${b.cpuBenchMs ?? DASH} ms (menor = más rápido)`);
  push(`RAM          : ${d.ramGB ?? DASH} GB reportados · heap límite: ${d.heapLimitMB ?? DASH} MB`);
  push(`GPU          : ${d.gpuRenderer ?? DASH} · maxTexture ${d.maxTextureSize ?? DASH}`);
  push(`Pantalla     : ${d.screen.w || DASH}×${d.screen.h || DASH} · dpr ${d.screen.dpr || DASH} · refresh medido ${d.screen.refreshHz ?? DASH} Hz`);
  push(
    `Almacenam.   : ${d.storage?.usageMB ?? DASH} usados / ${d.storage?.quotaMB ?? DASH} cuota`
  );
  push(
    `Batería      : ${d.battery ? `${d.battery.level}% · ${d.battery.charging ? "cargando" : "descargando"}` : DASH} · ahorro datos: ${d.network?.saveData ?? DASH}`
  );
  push(
    `Red          : ${d.network?.effectiveType ?? DASH} · ~${d.network?.downlink ?? DASH} Mb/s · rtt ${d.network?.rtt ?? DASH} ms`
  );
  push();
  push("-- BENCHMARKS (medidos, no teóricos) ---------");
  push(`Downscale 4032→2048 : ${b.canvasDownscale2048Ms ?? DASH}   (operación clave del editor)`);
  push(`Downscale 4032→3200 : ${b.canvasDownscale3200Ms ?? DASH}   (operación clave del tier low)`);
  push(`JPEG encode 3200 q0.92 : ${b.jpegEncodeMs ?? DASH}`);
  push(`Decode 3200 → bitmap : ${b.decodeMs ?? DASH}`);
  push(`Canvas máx verificado : ${b.maxCanvasPx ?? DASH} px`);
  push();
  push("-- TIER ACTIVO -------------------------------");
  if (r.tier) {
    push(`Tier        : ${r.tier.tier ?? DASH} · lado efectivo: ${r.tier.effectiveLongSide ?? DASH} px`);
    push(`Método      : ${r.tier.method ?? DASH} · degradado por timing: ${r.tier.downgradedByTiming ? "sí" : "no"}`);
  } else {
    push(`Tier        : ${DASH} (no disponible en esta build)`);
  }
  push();
  push(`-- SESIÓN (iniciada ${new Date(PERF_PROBE_T0_AT).toLocaleTimeString()} · ${fmtDur(s.durationMs)}) -----`);
  push(`Arranque app → lista      : ${fmtMs(s.boot.appReadyMs)}`);
  push(`Cámara: abrir → lista     : ${fmtMs(s.camera.readyMs)}`);
  push(`FPS cámara                : ${s.camera.fpsEarly ?? DASH} · tarde: ${s.camera.fpsLate ?? DASH}`);
  // LOTE 5 (F5-D) v6 — telemetría del stream real y del takePhoto ganador.
  // Aditivo: ausente si el mark no trajo el meta (camino legacy/galería).
  push(`Stream cámara             : ${s.camera.streamW ?? DASH} × ${s.camera.streamH ?? DASH}`);
  push(`Foto: settings pedido     : ${s.camera.photoSettingsReq ?? DASH}`);
  push(`Foto: salida lado mayor   : ${s.camera.photoOutLongSide ?? DASH} px`);
  push(`Foto: takePhoto (mediana) : ${fmtMs(s.camera.takePhotoMs)}`);
  // v3 — espera del auto-shutter (estable→disparo) por página + modo del
  // guión (auto/manual/mixto — solo cuando el test QA corrió).
  if (s.camera.autoShutterWaitMs.length > 0) {
    const waits = s.camera.autoShutterWaitMs
      .slice(0, 5)
      .map((v) => `${(v / 1000).toFixed(1)} s`)
      .join(" · ");
    const med = median(s.camera.autoShutterWaitMs);
    const qaCaptures = (r.qa?.steps ?? []).filter((st) => st.mode !== undefined);
    const mode =
      qaCaptures.length === 0
        ? ""
        : qaCaptures.every((st) => st.mode === "auto")
          ? " · modo auto"
          : qaCaptures.every((st) => st.mode === "manual")
            ? " · modo manual"
            : " · modo mixto";
    push(
      `Shutter auto (estable→disparo): ${waits} (mediana ${med !== null ? `${(med / 1000).toFixed(1)} s` : DASH})${mode}`
    );
  }
  const resolutions =
    s.pages.resolutions.length > 0 ? s.pages.resolutions.join(", ") + " px" : DASH;
  push(`Páginas capturadas        : ${s.pages.count} · guardadas a ${resolutions}`);
  const savedList =
    s.pages.captureToSavedMs.length > 0
      ? s.pages.captureToSavedMs.slice(0, 8).map((v) => Math.round(v)).join(" · ") +
        (s.pages.captureToSavedMs.length > 8 ? " · …" : "")
      : DASH;
  push(`Captura → guardada (ms)   : ${savedList} (mediana ${s.pages.medianMs ?? DASH})`);
  push(`  tramos: procesado ${fmtMs(s.pages.segments.shotToProcessedMs)} · escritura ${fmtMs(s.pages.segments.processedToWriteMs)} (medianas)`);
  // v4 (burst-budget) — línea de captura con la adquisición presupuestada:
  // conteo por razón de salida + gap disparo→foto (capture_fired→shot).
  // v5 (burst v2-A13) — ventana de adquisición bajo el microscopio: muro
  // (wallFireMs), sampler, track de video, congestión por ventana y la
  // foto huérfana (el blob del sensor que llegó tarde).
  if (s.pages.burst) {
    const br = s.pages.burst.byReason;
    const reasons = [
      "photo",
      "photo_grace",
      "stable",
      "time_cap",
      "frame_cap",
      "legacy",
      "error",
    ]
      .filter((k) => (br[k] ?? 0) > 0)
      .map((k) => `${k} ${br[k]}`)
      .join(" · ");
    push(
      `  burst: ${reasons || DASH} — gap disparo→foto mediana ${fmtMs(s.pages.burst.acquisitionMsMedian)}`
    );
    const walls = s.pages.burst.wallFireMs;
    if (walls.length > 0) {
      const wallTxt = walls
        .slice(0, 5)
        .map((v) => `${(v / 1000).toFixed(1)} s`)
        .join(" · ");
      const sampTxt = s.pages.burst.samples
        .slice(0, 5)
        .map((n) => `${n}`)
        .join("/");
      const cost = s.pages.burst.lastSampleCostMs.filter(
        (v): v is number => v !== null
      );
      const costTxt =
        cost.length > 0
          ? ` · coste última ${fmtMs(Math.max(...cost))}`
          : "";
      push(`  muro por captura: ${wallTxt}${sampTxt ? ` · sampler ${sampTxt} muestras${costTxt}` : ""}`);
    }
    const vt = s.pages.burst.videoTrack;
    if (vt) {
      const cong = s.pages.burst.windowCongestion;
      const congTxt =
        cong.length > 0
          ? ` · congestión ${cong
              .slice(0, 5)
              .map((c) => `${c.count}t/${Math.round(c.totalMs)}ms`)
              .join(" · ")}`
          : "";
      push(`  track video: ${vt.w}×${vt.h} px${congTxt}`);
    }
    const orph = s.pages.burst.orphanPhoto;
    if (orph.watched > 0) {
      const arrivals = orph.arrivalMs
        .map((v, i) => `${(v / 1000).toFixed(1)} s${orph.bytes[i] ? ` (${fmtMB(orph.bytes[i]!)})` : ""}`)
        .join(" · ");
      push(
        `  foto huérfana: ${orph.watched} observada${orph.watched === 1 ? "" : "s"} · ` +
          `${orph.arrived} llegó${orph.arrived === 1 ? "" : "ron"}` +
          (orph.arrived > 0 ? ` (+${arrivals})` : "") +
          (orph.pending > 0 ? ` · ${orph.pending} pendiente${orph.pending === 1 ? "" : "s"}` : "") +
          (orph.rejected > 0 ? ` · ${orph.rejected} rota${orph.rejected === 1 ? "" : "s"}` : "")
      );
    }
    // v4.2 (v3 Fase D) — la gracia en el TXT: cuántas huérfanas rescató a
    // foto completa y a cuántas cayó a frames tras esperarla. Solo si la
    // gracia corrió en la sesión (lotes 1-5: línea ausente, TXT idéntico).
    const gr = s.pages.burst.grace;
    if (gr.photoGrace + gr.framesFallback > 0) {
      push(
        `  gracia foto: ${gr.photoGrace} rescatada${gr.photoGrace === 1 ? "" : "s"} a foto completa` +
          ` · ${gr.framesFallback} a frames` +
          ` · espera mediana ${fmtMs(gr.graceWaitedMsMedian)}`
      );
    }
    // v4.3 (v4 §2.1/§2.2) — tramo opaco + congestión partida por el corte.
    // SOLO si hubo cortes en la sesión (sin cortes: líneas ausentes, TXT
    // idéntico a pre-v4 — gate 4). Cuadre §2.4 por captura: gap
    // disparo→foto ≈ muro (neto de gracia) + gracia + tramo opaco.
    const pip = s.pages.burst.pipe;
    const cong = s.pages.burst.congestion;
    if (cong.cutCaptures > 0) {
      const toMarkTxt = pip.toMarkMs
        .slice(0, 5)
        .map((v) => `${(v / 1000).toFixed(1)} s`)
        .join(" · ");
      push(
        `  tramo opaco: ${cong.cutCaptures} corte${cong.cutCaptures === 1 ? "" : "s"} · mediana ${fmtMs(pip.toMarkMsMedian)} (${toMarkTxt})`
      );
      const sub: string[] = [];
      if (pip.sniffMs.length > 0) {
        sub.push(
          `sniff ${pip.sniffMs.slice(0, 5).map((v) => `${Math.round(v)} ms`).join(" · ")}`
        );
      }
      if (pip.dataUrlMs.length > 0) {
        sub.push(
          `dataURL ${pip.dataUrlMs.slice(0, 5).map((v) => `${(v / 1000).toFixed(2)} s`).join(" · ")}`
        );
      }
      if (pip.bgJobsAtShot.length > 0) {
        sub.push(`bgJobs@shot ${pip.bgJobsAtShot.slice(0, 5).join(" · ")}`);
      }
      if (sub.length > 0) push(`  pipe foto: ${sub.join(" · ")}`);
      const congTxt = cong.congestionWait
        .slice(0, 5)
        .map((c, i) => {
          const p = cong.congestionPipe[i];
          return `${c.count}t/${(c.totalMs / 1000).toFixed(1)}s→${p ? `${p.count}t/${(p.totalMs / 1000).toFixed(1)}s` : DASH}`;
        })
        .join(" · ");
      push(`  congestión espera→pipe: ${congTxt || DASH}`);
      const heapProbes = s.pages.burst.heapProbe ?? [];
      for (const hp of heapProbes) {
        if (hp) {
          push(
            `  sonda heap: ${hp.samples} muestras · ${hp.minMB}–${hp.maxMB} MB · sierra ${hp.sawtoothMB} MB`
          );
        }
      }
    }
  }
  // LOTE 5.6 (diag-encuadre) — sección ENCUADRE (por página): origen del
  // quad, manual/pending, bbox % de la foto que cubre el recorte y Δaspecto
  // stream-vs-foto. SOLO si hay páginas en la sesión (informes sin
  // capturas: sección ausente, TXT de lotes anteriores comparable 1:1).
  // Lectura: bbox ≈ 85-100 % con recorte visible ⇒ la foto no trajo lo
  // visto (camino cámara); bbox ≈ 55-80 % ⇒ el quad muerde (camino
  // detector).
  if (s.pages.framing.length > 0) {
    push("-- ENCUADRE (por página · lote 5.6) -----------");
    const sw = s.camera.streamW;
    const sh = s.camera.streamH;
    const sAspect = sw !== null && sh !== null && sh > 0 ? sw / sh : null;
    const lastF = [...s.pages.framing]
      .reverse()
      .find((f) => f.origW !== null && f.origH !== null);
    const fAspect = s.camera.photoAspect;
    const dAspect =
      sAspect !== null && fAspect !== null ? Math.abs(sAspect - fAspect) : null;
    push(
      `Stream ${sw ?? DASH} × ${sh ?? DASH}${sAspect !== null ? ` (aspect ${sAspect.toFixed(4)})` : ""} · foto última ${lastF ? `${lastF.origW}×${lastF.origH}` : DASH}${fAspect !== null ? ` (aspect ${fAspect.toFixed(4)})` : ""}${dAspect !== null ? ` · Δaspect ${dAspect.toFixed(4)}` : ""}`
    );
    s.pages.framing.forEach((f, i) => {
      push(
        `  #${i + 1} src=${f.src.padEnd(9)}manual=${f.manual ? "sí" : "no"}  pending=${f.pending ? "sí" : "no"}  bbox ${f.bboxW ?? DASH}%×${f.bboxH ?? DASH}%  (${f.origW ?? DASH}×${f.origH ?? DASH})`
      );
    });
    push();
  }
  const renders2 = s.editor.firstRenders[1];
  push(
    `Editor: apertura/render   : ${s.editor.openMs !== null ? `${s.editor.openMs} ms` : DASH} / ${fmtMs(s.editor.firstRenderMs)}${renders2 !== null && renders2 !== undefined ? ` · 2ª: ${fmtMs(renders2)}` : ""}`
  );
  // LOTE 2 (F2-G) — línea extra SOLO si hay datos del preview escalonado.
  if (s.editor.firstRenderTier !== null || s.editor.previewUpgrades > 0) {
    push(`Preview escalonado        : fast→full · upgrade ${s.editor.previewUpgrades}`);
  }
  // LOTE 3 (F3-B) — línea SOLO si hay dato (decode del primer render;
  // etiqueta alineada a la misma columna de 26 chars del bloque editor).
  if (s.editor.firstRenderDecodeMs !== null) {
    push(`Decode primer render      : ${Math.round(s.editor.firstRenderDecodeMs)} ms`);
  }
  push(`FPS pan/zoom (auto)       : ${s.editor.fpsAuto ?? DASH}`);
  push(`Filtros aplicados         : ${s.editor.filterCount} · mediana ${fmtMs(s.editor.filterMedianMs)}`);
  const topFilter = s.editor.filters[0];
  if (topFilter) {
    const engTxt =
      topFilter.engines && topFilter.engines.length > 0
        ? ` · engine=${topFilter.engines.map((e) => (topFilter.engines.length > 1 ? `${e.engine}(${e.count})` : e.engine)).join(",")}`
        : "";
    push(`Filtro más caro           : ${topFilter.filterId} · ${fmtMs(topFilter.medianMs)} mediana (${topFilter.count})${engTxt}`);
  }
  push(
    `OCR                       : ${s.ocr.count} págs · 1ª ${fmtMs(s.ocr.firstColdMs)} (frío) · tibio ${fmtMs(s.ocr.medianWarmMs)} · ${s.ocr.charsTotal} chars`
  );
  const exportsTxt =
    s.exports.length > 0
      ? s.exports.map((e) => `${e.type} ${fmtMs(e.ms)} (${fmtMB(e.bytes)})`).join(" · ")
      : DASH;
  push(`Exports                   : ${exportsTxt}`);
  push(`Heap pico (JS)            : ${s.memory.peakHeapMB !== null ? `${s.memory.peakHeapMB} MB` : DASH}`);
  push(
    s.longTasks.supported
      ? `Long tasks                : ${s.longTasks.count} tareas >50 ms · total ${fmtMs(s.longTasks.totalMs)}`
      : "Long tasks                : no soportado en este navegador"
  );
  push();
  push("-- PRIVACIDAD ---------------------------------");
  push("Este informe NO contiene imágenes, contenido de");
  push("documentos ni texto OCR. Solo métricas.");
  push("==============================================");
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* __diagTools (§7) — export, compartir, copiar                         */
/* ------------------------------------------------------------------ */

/** Nombre base del archivo: scannerlab-diag-{modelo}-{YYYYMMDD-HHmm}. */
function diagFileBase(model: string | null | undefined, ext: string): string {
  const clean = (model ?? "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  return `scannerlab-diag-${clean || "dispositivo"}-${stamp}.${ext}`;
}

function downloadTextFile(text: string, name: string, type: string): void {
  try {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    window.setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 1000);
  } catch {
    /* el llamador informa */
  }
}

export interface DiagTools {
  snapshot(): Promise<DiagDeviceSnapshot | null>;
  bench(force?: boolean): Promise<DiagBenchResults | null>;
  report(): Promise<DiagReport>;
  txt(): Promise<string>;
  download(): Promise<void>;
  share(): Promise<"shared" | "downloaded" | "cancelled" | "failed">;
  copy(): Promise<boolean>;
}

export const diagTools: DiagTools = {
  async snapshot() {
    try {
      return await getDeviceSnapshot();
    } catch {
      return null;
    }
  },
  async bench(force = false) {
    try {
      return await runBenchmarks(force);
    } catch {
      return null;
    }
  },
  async report() {
    return buildDiagReport();
  },
  async txt() {
    return buildDiagTxt(await buildDiagReport());
  },
  async download() {
    const report = await buildDiagReport();
    downloadTextFile(
      JSON.stringify(report, null, 2),
      diagFileBase(report.device.model, "json"),
      "application/json"
    );
  },
  async share() {
    try {
      const text = await buildDiagTxt(await buildDiagReport());
      const name = diagFileBase(
        (await getDeviceSnapshot()).model,
        "txt"
      );
      const file = new File([text], name, { type: "text/plain" });
      const nav = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
      };
      if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: "Informe de diagnóstico · scanner-lab" });
        return "shared";
      }
      // Sin Web Share (o sin soporte de archivos) → descarga el TXT para
      // adjuntarlo a mano (WhatsApp web/gallery) + el toast lo explica.
      downloadTextFile(text, name, "text/plain");
      return "downloaded";
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return "cancelled";
      // Último recurso: al menos que el informe no se pierda.
      try {
        const text = await buildDiagTxt(await buildDiagReport());
        downloadTextFile(text, diagFileBase(null, "txt"), "text/plain");
      } catch {
        /* nada más que hacer */
      }
      return "failed";
    }
  },
  async copy() {
    try {
      const text = await buildDiagTxt(await buildDiagReport());
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  },
};

declare global {
  interface Window {
    __diagTools?: DiagTools;
  }
}

if (typeof window !== "undefined") {
  try {
    window.__diagTools = diagTools;
  } catch {
    /* best-effort */
  }
}
