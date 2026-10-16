"use client";

/**
 * PERF/burst-budget — Presupuesto de TIEMPO + salida por ESTABILIDAD para la
 * adquisición de la captura (tramo `capture_fired` → `capture_shot`).
 *
 * Evidencia (lote 3, qa-standard-v1.1, build 97dbe66): el gap de adquisición
 * en gama baja era ~16.8 s (A13) frente a ~0.22 s (iPhone) — superlineal
 * respecto de la CPU (3.5×). La adquisición real es una CADENA de esperas
 * (torch → carrera de takePhoto 5 s ×2 → clamp del blob → FileReader), no
 * un bucle por nº de frames: cada espera tiene su PROPIO tope y ninguna
 * cuenta el total. Este módulo impone el muro global que la cadena no tenía.
 *
 *   §A — Muro de tiempo: BURST_TIME_BUDGET_MS = 5000 desde capture_fired
 *        (reloj monotónico performance.now(); NUNCA rAF — a trompicones en
 *        gama baja con ahorro de batería). Límite DURO: al llegar, la
 *        adquisición termina con lo recogido (`time_cap`). v2-A13 Fase C:
 *        2000 → 5000 — el muro de 2 s del lote 4 cortó la carrera del
 *        takePhoto en A13 y el rescate guardó actas a 960 px (preview-res,
 *        ilegibles): con el hilo aliviado (Fase B), la foto nativa tiene
 *        hasta 5 s para llegar FULL-RES. iPhone (~0.22 s), A56 (~0.9 s) y
 *        PC (~0.25 s) NUNCA lo tocan → coste 0 en dispositivos sanos.
 *   §D — v3 «FASE D: gracia de la foto huérfana» (photoGraceMs): cuando el
 *        presupuesto corta con la foto del sensor EN VUELO, esperar una
 *        GRACIA corta a su promesa ANTES de despachar frames del preview.
 *        Evidencia del experimento de palanca (A13, 6/6 capturas, muros 5 s
 *        y 6.5 s): la foto ya está lista cuando el muro corta — su promesa
 *        resuelve ~18-42 ms después de que el bucle libere el hilo. Si
 *        llega dentro de la gracia → foto COMPLETA (~4000 px); si no →
 *        caída al camino actual de frames. `photoGraceMs: 0` = método
 *        A/B de retroceso (comportamiento exacto de antes de la Fase D).
 *   §4 — v4 «DIAGNÓSTICO del tramo opaco» (100 % instrumentación, cero
 *        cambios de comportamiento): tras el corte, el tramo
 *        recordBurst → mark capture_shot midió ~14.6 s en A13 con ~1 s de
 *        trabajo REAL dentro (sniff + FileReader). Esta capa abre un
 *        "pipe" en cada recordBurst de ruta con corte (`cutPipe`) y lo
 *        cierra en el mark: cuelga pipeSniffMs/pipeDataUrlMs/pipeToMarkMs/
 *        bgJobsAtShot del meta de capture_shot + partida de la congestión
 *        en DOS sub-ventanas (espera: fired→corte · pipe: corte→shot) que
 *        consume el informe diag v4.3. Con los datos, v5 diseña el fix.
 *   §B — Salida por estabilidad: miniatura de 64×64 del preview (señal
 *        BARATA, prohibido comparar a 4032 px); `stabilityFrames` deltas
 *        consecutivos por debajo del umbral → `stable`.
 *   §C — Techo de frames como MÁXIMO: el dispatch de respaldo ya recolecta
 *        ≤3 candidatos y el ring ZSL ≤8 (límites existentes INTACTOS).
 *
 * Config de diagnóstico (patrón `__diagTools` / `__tierTools`):
 *
 *   window.__burstTools = {
 *     set({ enabled, timeBudgetMs, photoGraceMs, stabilityFrames, stabilityThreshold }),
 *     get(),   // config vigente
 *     reset(), // vuelve a defaults
 *   }
 *
 * `enabled: false` → la captura corre el camino legacy EXACTO (A/B del dueño
 * en la misma sesión). Telemetría por captura: `window.__lastBurst` (patrón
 * `__lastShutter`) + meta aditiva en el mark `capture_shot`
 * (`burstExitReason` / `burstFrames`).
 */

/** Por qué terminó la adquisición. Los 5 valores de la spec + `photo`
 * (extensión aditiva: la foto del sensor llegó DENTRO del presupuesto y fue
 * despachada — sin este valor no se distinguiría el camino normal del error)
 * + `photo_grace` (v3 Fase D: el presupuesto cortó, la gracia esperó a la
 * foto huérfana y esta LLEGÓ → foto completa despachada tras el corte). */
export type BurstExitReason =
  | "photo" // la foto full-sensor llegó dentro del presupuesto (camino normal)
  | "photo_grace" // §D v3 Fase D: la huérfana llegó DENTRO de la gracia tras el corte
  | "stable" // §B: N deltas consecutivos de preview < umbral → no esperar más
  | "time_cap" // §A: muro de tiempo agotado → dispatch con lo recogido
  | "frame_cap" // §C: dispatch de frames al techo de 3 candidatos (sin foto)
  | "error" // nada despachable (stream muerto / encode fallido)
  | "legacy"; // __burstTools.set({ enabled:false }) — camino exacto de antes

export interface BurstBudgetConfig {
  /** false = comportamiento legacy EXACTO (sin muro, sin sampler). */
  enabled: boolean;
  /** §A — muro global de la adquisición, en ms desde capture_fired. */
  timeBudgetMs: number;
  /** §D v3 Fase D — gracia de la foto huérfana: ms que, tras el corte del
   *  presupuesto, se espera a la promesa de takePhoto en vuelo ANTES de
   *  despachar frames del preview. 0 = sin gracia (comportamiento exacto
   *  de antes de la Fase D — palanca A/B de retroceso). En dispositivos
   *  sanos la foto gana antes del muro y la gracia JAMÁS corre. */
  photoGraceMs: number;
  /** §B — deltas consecutivos bajo umbral necesarios para salir por estable. */
  stabilityFrames: number;
  /** §B — umbral del delta (luma medio absoluto por píxel, 0-255). */
  stabilityThreshold: number;
}

const DEFAULTS: BurstBudgetConfig = {
  enabled: true,
  /** v2-A13 Fase C — 5000 (antes 2000). Dato del lote 4 (build 89fb5dc,
   *  qa-standard-v1.1, A13): con el muro a 2 s el corte llegó tarde
   *  (adquisition 11.9–17.2 s por timers deslizándose en un hilo
   *  saturado) y el rescate guardó actas a 960 px — el track del preview.
   *  Con Fase B aliviando el hilo, 5 s dan a la foto full-res del sensor
   *  (4000 px) una ventana honesta; worst case ~5-6 s por captura con
   *  acta a 4000 px, frente a 17 s a 960 px. Dispositivos sanos (foto en
   *  0.22–1 s) jamás lo tocan. */
  timeBudgetMs: 2000,
  /** v3 Fase D — 2000. Experimento de palanca del dueño (A13, build
   *  73d7be2, muros 5 s y 6.5 s): la foto huérfana llega +18-42 ms
   *  después del corte en 6/6 capturas — la gracia que la rescata cuesta
   *  decenas de ms, NO segundos; 2000 es el techo para un takePhoto
   *  VERDADERAMENTE colgado (muro + 2 s, UNA vez por captura, con
   *  telemetría visible). Subir el muro NO puede ganar la foto (corte y
   *  foto se mueven juntos); la gracia sí — gratis en dispositivos sanos. */
  photoGraceMs: 2000,
  stabilityFrames: 2,
  stabilityThreshold: 2.5,
};

/** §B — cadencia del sampler de estabilidad. 750 ms → la salida `stable`
 * más temprana es ~1.5 s tras capture_fired: la foto de iPhone (~0.22 s) y
 * A56 (~1.05 s) SIEMPRE gana antes (criterio QA «sin regresión»); solo un
 * disparo ya patológico (>1.5 s) se corta por estabilidad. */
const STABILITY_SAMPLE_INTERVAL_MS = 750;
/** Cadencia de revisión del muro/promesas (ms). */
const WATCH_TICK_MS = 100;

let config: BurstBudgetConfig = { ...DEFAULTS };

export function getBurstConfig(): BurstBudgetConfig {
  return config;
}

/** Estadísticas de UNA adquisición (telemetría QA, `window.__lastBurst`). */
/** v5 §3.2 — telemetría aditiva: sonda de heap JS durante el tramo opaco
 *  (SOLO rutas con corte). */
export interface BurstHeapProbe {
  intervalMs: number; // ~200
  samples: number;
  minMB: number; // mínimo de usedJSHeapSize en el tramo
  maxMB: number; // máximo
  sawtoothMB: number; // suma de CAÍDAS consecutivas entre muestras (estimador de lo que GC liberó)
  seriesMB: number[]; // serie compacta redondeada a 0.1 MB; si samples>100, submuestrea con paso uniforme
}

const HEAP_PROBE_INTERVAL_MS = 200;

function readUsedHeapMB(): number | null {
  if (typeof window === "undefined" || typeof window.performance === "undefined") {
    return null;
  }
  const mem = (window.performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory;
  if (!mem) return null;
  const used = mem.usedJSHeapSize;
  if (typeof used !== "number" || !Number.isFinite(used)) {
    return null;
  }
  return used / 1048576;
}

export interface BurstStats {
  at: number;
  exitReason: BurstExitReason;
  /** Nº de frames que el dispatch consideró (foto = 1). */
  frames: number;
  /** ms desde capture_fired hasta la decisión de salida. */
  waitedMs: number;
  /** Bytes de la foto despachada (solo camino photo). */
  photoBytes: number | null;
  /** Muestras de estabilidad tomadas durante la espera (§B). */
  samples: number;
  /** Coste de la ÚLTIMA muestra (ms) — objetivo < 10 ms en clase A13. */
  lastSampleCostMs: number | null;
  /** v3 Fase D (v4.2) — ms que la gracia esperó a la foto huérfana tras
   *  el corte (null: la gracia no corrió — sin foto en vuelo o
   *  photoGraceMs: 0). */
  graceWaitedMs: number | null;
  /** v3 Fase D (v4.2) — qué se despachó al final del corte: foto completa
   *  ("photo") o frames del preview ("frames"). Null en las rutas que no
   *  pasaron por un corte presupuestado (foto normal, legacy, demo). */
  dispatchSource: "photo" | "frames" | null;
  /** v4 §2.1 (v4.3) — duración de readBlobLongSide dentro del tramo opaco
   *  (solo rutas con corte que despacharon foto; null: no corrió). */
  pipeSniffMs: number | null;
  /** v4 §2.1 (v4.3) — duración de blobToDataUrl (FileReader) dentro del
   *  tramo opaco (solo rutas con corte que despacharon foto; null: no
   *  corrió — p. ej. dispatch de frames). */
  pipeDataUrlMs: number | null;
  /** v4 §2.1 (v4.3) — total del tramo opaco: recordBurst → mark
   *  capture_shot (solo rutas con corte; null: sin corte). Cuadre §2.4:
   *  acquisitionMs ≈ waitedMs(neto de gracia) + graceWaitedMs +
   *  pipeToMarkMs. */
  pipeToMarkMs: number | null;
  /** v4 §2.3 (v4.3) — jobs del editor en vuelo (autoQuad/filtros/preview)
   *  al llegar al mark (solo rutas con corte; null: sin corte). */
  bgJobsAtShot: number | null;
  /** v5 §3.2 — sonda aditiva de heap JS durante el tramo opaco (SOLO rutas
   *  con corte; null: sin corte o sin performance.memory). */
  heapProbe: BurstHeapProbe | null;
}

let lastStats: BurstStats | null = null;

/** Registra la salida de una adquisición: actualiza `window.__lastBurst` y
 *  devuelve el registro (el llamador lo cuelga del mark capture_shot). */
export function recordBurst(
  exitReason: BurstExitReason,
  frames: number,
  waitedMs: number,
  extra?: {
    photoBytes?: number;
    samples?: number;
    lastSampleCostMs?: number | null;
    /** v3 Fase D (v4.2) — campos aditivos; ausentes → null. */
    graceWaitedMs?: number | null;
    dispatchSource?: "photo" | "frames" | null;
    /** v4 §2.1 (v4.3) — true SOLO en las salidas que pasaron por CORTE de
     *  presupuesto (dispatchAfterCut): abre el tramo opaco
     *  (recordBurst → mark capture_shot) para los sub-marks del pipe.
     *  Ausente/false → CIERRA cualquier tramo pendiente (las rutas sin
     *  corte no llevan campos nuevos: marks byte-a-byte con pre-v4). */
    cutPipe?: boolean;
  }
): BurstStats {
  // v4 §2.1 — el corte de ESTA salida abre (o cierra) el tramo opaco. Se
  // toma AQUÍ el instante (junto al waitedMs que se registra) para que
  // pipeToMarkMs cuadre con la aritmética del informe (§2.4).
  // v4 §2.1 / v5 §3.2 — el corte de ESTA salida abre (o cierra) el tramo opaco.
  if (pipe !== null && pipe.heapInterval !== null) {
    window.clearInterval(pipe.heapInterval);
    pipe.heapInterval = null;
  }
  let heapInterval: number | null = null;
  let heapSamples: number[] | null = null;
  if (extra?.cutPipe === true) {
    const initialMB = readUsedHeapMB();
    if (initialMB !== null) {
      heapSamples = [initialMB];
      heapInterval = window.setInterval(() => {
        const currentMB = readUsedHeapMB();
        if (currentMB !== null && heapSamples !== null) {
          // D-02 (parte 2, auditoría leaks-recursos) — tope duro de
          // muestras: si el intervalo queda huérfano (error final sin el
          // próximo recordBurst), el array no crece sin límite el resto
          // de la sesión (600 muestras ≈ 2 min a 200 ms).
          if (heapSamples.length < 600) heapSamples.push(currentMB);
        }
      }, HEAP_PROBE_INTERVAL_MS);
    }
    pipe = {
      openedAt: performance.now(),
      sniffMs: null,
      dataUrlMs: null,
      heapInterval,
      heapSamples,
    };
  } else {
    pipe = null;
  }
  lastStats = {
    at: Date.now(),
    exitReason,
    frames,
    waitedMs: Math.round(waitedMs),
    photoBytes: extra?.photoBytes ?? null,
    samples: extra?.samples ?? 0,
    lastSampleCostMs: extra?.lastSampleCostMs ?? null,
    graceWaitedMs: extra?.graceWaitedMs ?? null,
    dispatchSource: extra?.dispatchSource ?? null,
    pipeSniffMs: null,
    pipeDataUrlMs: null,
    pipeToMarkMs: null,
    bgJobsAtShot: null,
    heapProbe: null,
  };
  if (typeof window !== "undefined") {
    (window as unknown as Record<string, unknown>).__lastBurst = { ...lastStats };
  }
  return lastStats;
}

export function getLastBurst(): BurstStats | null {
  return lastStats;
}

/* ── v4 §2.1 — tramo opaco: recordBurst → mark capture_shot ─────────────── */

/** Estado del tramo opaco de la captura EN VUELO (SOLO rutas con corte:
 *  `recordBurst(..., { cutPipe: true })` lo abre). Instrumentación pura —
 *  cero cambios de comportamiento: midió 14.6 s en A13 (build c348dcd)
 *  con ~1 s de trabajo REAL dentro; con estos sub-marks (sniff/dataURL/
 *  total + jobs del editor + congestión partida) v5 diseña el fix. */
interface BurstPipeState {
  /** performance.now() del recordBurst que abrió el tramo (= instante del
   *  corte, tras la gracia). Base de pipeToMarkMs. */
  openedAt: number;
  /** Duración de readBlobLongSide (camino foto; null: no corrió). */
  sniffMs: number | null;
  /** Duración de blobToDataUrl (camino foto; null: no corrió). */
  dataUrlMs: number | null;
  /** v5 §3.2 — timer de la sonda de heap (null: sin performance.memory). */
  heapInterval: number | null;
  /** Muestras de usedJSHeapSize en MB recogidas durante el tramo. */
  heapSamples: number[] | null;
}

let pipe: BurstPipeState | null = null;

/** v4 §2.1 — duración del sniff de cabecera (readBlobLongSide) dentro del
 *  tramo opaco. No-op si el tramo no está abierto (ruta sin corte). */
export function noteBurstPipeSniff(ms: number): void {
  if (pipe === null || !Number.isFinite(ms)) return;
  pipe.sniffMs = Math.max(0, Math.round(ms));
}

/** v4 §2.1 — duración de la conversión blob→dataURL (FileReader) dentro
 *  del tramo opaco. No-op si el tramo no está abierto. */
export function noteBurstPipeDataUrl(ms: number): void {
  if (pipe === null || !Number.isFinite(ms)) return;
  pipe.dataUrlMs = Math.max(0, Math.round(ms));
}

/** Meta del tramo opaco que viaja en el mark capture_shot (v4 §2.1/§2.3).
 *  sniff/dataUrl son null cuando el pipe de foto no corrió (dispatch de
 *  frames tras corte). */
export interface BurstPipeMeta {
  pipeSniffMs: number | null;
  pipeDataUrlMs: number | null;
  pipeToMarkMs: number;
  bgJobsAtShot: number;
  heapProbe: BurstHeapProbe | null;
}

/** v4 §2.1/§2.3 — CIERRA el tramo opaco EN el mark capture_shot y devuelve
 *  sus campos (null: no había tramo abierto — ruta sin corte, meta
 *  byte-a-byte con pre-v4). Refleja los campos en `window.__lastBurst`
 *  (recordBurst escribió antes de que el pipe corriera). Idempotente. */
export function collectBurstPipeMeta(): BurstPipeMeta | null {
  if (pipe === null) return null;
  if (pipe.heapInterval !== null) {
    window.clearInterval(pipe.heapInterval);
    pipe.heapInterval = null;
  }
  let heapProbe: BurstHeapProbe | null = null;
  const raw = pipe.heapSamples;
  if (raw !== null && raw.length > 0) {
    let min = raw[0]!;
    let max = raw[0]!;
    let sawtooth = 0;
    for (let i = 0; i < raw.length; i++) {
      const v = raw[i]!;
      if (v < min) min = v;
      if (v > max) max = v;
      if (i > 0) {
        const drop = raw[i - 1]! - v;
        if (drop > 0) sawtooth += drop;
      }
    }
    const samples = raw.length;
    const seriesMB =
      samples > 100
        ? (() => {
            const targetCount = 100;
            const step = (samples - 1) / (targetCount - 1);
            const out: number[] = [];
            for (let i = 0; i < targetCount; i++) {
              const idx = Math.min(samples - 1, Math.round(i * step));
              out.push(Math.round(raw[idx]! * 10) / 10);
            }
            return out;
          })()
        : raw.map((v) => Math.round(v * 10) / 10);
    heapProbe = {
      intervalMs: HEAP_PROBE_INTERVAL_MS,
      samples,
      minMB: Math.round(min * 10) / 10,
      maxMB: Math.round(max * 10) / 10,
      sawtoothMB: Math.round(sawtooth * 10) / 10,
      seriesMB,
    };
  }
  const meta: BurstPipeMeta = {
    pipeSniffMs: pipe.sniffMs,
    pipeDataUrlMs: pipe.dataUrlMs,
    pipeToMarkMs: Math.max(0, Math.round(performance.now() - pipe.openedAt)),
    bgJobsAtShot: backgroundJobs,
    heapProbe,
  };
  pipe = null;
  if (lastStats !== null) {
    lastStats.pipeSniffMs = meta.pipeSniffMs;
    lastStats.pipeDataUrlMs = meta.pipeDataUrlMs;
    lastStats.pipeToMarkMs = meta.pipeToMarkMs;
    lastStats.bgJobsAtShot = meta.bgJobsAtShot;
    lastStats.heapProbe = meta.heapProbe;
    if (typeof window !== "undefined") {
      (window as unknown as Record<string, unknown>).__lastBurst = { ...lastStats };
    }
  }
  return meta;
}

/* ── v4 §2.3 — contador de jobs en background del editor ───────────────── */

/** Jobs del editor en vuelo (applyAutoQuad, aplicación de filtros bw/text,
 *  generación de preview procesado — los mismos que la spec v4 señala como
 *  candidato #3 del tramo opaco: trabajo solapado con la captura).
 *  Contador de módulo con begin/end pareados en try/finally; se estampa en
 *  el meta de capture_shot (bgJobsAtShot) y se lee vivo vía
 *  `__burstTools.backgroundJobs()`. Instrumentación pura. */
let backgroundJobs = 0;

/** v4 §2.3 — marca el ARRANQUE de un job en background del editor. */
export function beginBackgroundJob(): void {
  backgroundJobs += 1;
}

/** v4 §2.3 — marca el FIN de un job en background (SIEMPRE en finally). */
export function endBackgroundJob(): void {
  if (backgroundJobs > 0) backgroundJobs -= 1;
}

/** v4 §2.3 — jobs en vuelo AHORA (telemetría/E2E). */
export function getBackgroundJobs(): number {
  return backgroundJobs;
}

/* ── v2-A13 Fase A — telemetría de la ventana de adquisición (v4.1) ─────── */

/** Tamaño del track de VIDEO (preview) según `track.getSettings()` al armar
 *  la cámara. Lote 4: el rescate de A13 guardó actas a 960 px porque el
 *  track del preview ES 960 px — este campo hace visible la resolución de
 *  la fuente del rescate SIN mirar el resultado. Se registra UNA vez por
 *  stream (armado de cámara). */
let videoTrackSize: { w: number; h: number } | null = null;

export function recordVideoTrackSize(w: number, h: number): void {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
  videoTrackSize = { w: Math.round(w), h: Math.round(h) };
}

export function getVideoTrackSize(): { w: number; h: number } | null {
  return videoTrackSize ? { ...videoTrackSize } : null;
}

/** Observador de la FOTO HUÉRFANA (spec v2-A13 §3.2) — SOLO OBSERVA: cuando
 * el presupuesto corta (`time_cap`/`stable`/muro sobre la carrera), la
 * promesa CRUDA de `takePhoto` sigue en vuelo (ImageCapture no expone
 * cancelación). Este observador le cuelga un `.then()` que registra si el
 * blob llega, CUÁNDO (ms desde capture_fired) y cuántos bytes. Cero cambios
 * de comportamiento, cero escrituras al store: responde LA pregunta del
 * lote 4 — ¿la foto nativa tarda 4 s (la congestión la retrasa) o
 * realmente necesita 10-16 s? (alimenta la decisión de la Fase D). */
interface OrphanRecord {
  /** ms desde capture_fired cuando la promesa se instaló (solo llegadas). */
  arrivalMs: number | null;
  bytes: number | null;
  outcome: "pending" | "arrived" | "rejected";
  /** performance.now() del capture_fired de ESTA captura. */
  firedAt: number;
}

const orphanRecords: OrphanRecord[] = []; // ring: últimas 12
const ORPHAN_RING_CAP = 12;

export function watchOrphanPhoto(
  photo: Promise<Blob> | null | undefined,
  firedAtMs: number
): void {
  if (!photo) return; // no había foto en vuelo (torch comió el muro, iOS…)
  const rec: OrphanRecord = {
    arrivalMs: null,
    bytes: null,
    outcome: "pending",
    firedAt: firedAtMs,
  };
  orphanRecords.push(rec);
  if (orphanRecords.length > ORPHAN_RING_CAP) {
    orphanRecords.splice(0, orphanRecords.length - ORPHAN_RING_CAP);
  }
  const settle = (outcome: "arrived" | "rejected", blob?: Blob | null) => {
    rec.arrivalMs = Math.max(0, Math.round(performance.now() - rec.firedAt));
    rec.outcome = outcome;
    rec.bytes = outcome === "arrived" && blob ? blob.size : null;
  };
  try {
    void photo.then(
      (blob) => settle(blob && blob.size > 0 ? "arrived" : "rejected", blob),
      () => settle("rejected")
    );
  } catch {
    /* la observación NUNCA rompe la captura */
  }
}

export interface OrphanPhotoStats {
  /** Fotos huérfanas observadas (el presupuesto cortó con takePhoto en vuelo). */
  watched: number;
  /** Blobs que llegaron tras el corte. */
  arrived: number;
  /** Aún sin resolver al momento de leer (p. ej. al generar el informe). */
  pending: number;
  /** La promesa rechazó (foto rota, no lenta). */
  rejected: number;
  /** ms desde capture_fired de cada llegada (solo las que llegaron). */
  arrivalMs: number[];
  /** Bytes de cada llegada. */
  bytes: number[];
}

export function getOrphanPhotoStats(): OrphanPhotoStats {
  const stats: OrphanPhotoStats = {
    watched: orphanRecords.length,
    arrived: 0,
    pending: 0,
    rejected: 0,
    arrivalMs: [],
    bytes: [],
  };
  for (const r of orphanRecords) {
    if (r.outcome === "arrived") {
      stats.arrived += 1;
      stats.arrivalMs.push(r.arrivalMs ?? 0);
      stats.bytes.push(r.bytes ?? 0);
    } else if (r.outcome === "pending") {
      stats.pending += 1;
    } else {
      stats.rejected += 1;
    }
  }
  return stats;
}

/* ── v2-A13 Fase B — ventana de adquisición (fired→shot) ─────────────────── */

/** Zona sancionada de la spec v2-A13 §4: entre `capture_fired` y
 *  `capture_shot` el hilo principal pelea por la foto y CADA trabajo
 *  lateral desliza los timers del muro (lote 4: el hilo saturado ×6-8
 *  hizo que el muro de 2 s cortara a los 16 s). Esta señal abre/cierra la
 *  ventana para que los consumidores baratos se congelen:
 *  · el ring ZSL deja de medir lapVar post-fired (esa carrera solo
 *    importa PRE-tap — §4.1),
 *  · el reloj del overlay QA deja de re-renderizar (§4.2).
 *  Los PRE-fired (estabilidad del shutter, cooldown, photoSettings) y el
 *  sampler §B NO se tocan. Observable mínimo (useSyncExternalStore):
 *  cero re-renders mientras la ventana está abierta. */
let acquisitionActive = false;
const acquisitionListeners = new Set<() => void>();

export function isAcquisitionActive(): boolean {
  return acquisitionActive;
}

export function setAcquisitionActive(active: boolean): void {
  if (acquisitionActive === active) return;
  acquisitionActive = active;
  for (const listener of [...acquisitionListeners]) {
    try {
      listener();
    } catch {
      /* la señal NUNCA rompe la app */
    }
  }
}

export function subscribeAcquisition(listener: () => void): () => void {
  acquisitionListeners.add(listener);
  return () => {
    acquisitionListeners.delete(listener);
  };
}

/* ── §B — sampler de estabilidad (señal BARATA) ─────────────────────────── */

/** Miniaturas 64×64 del <video> vivo → luma; `sample()` devuelve el delta
 *  medio absoluto contra la muestra ANTERIOR (o null si no hay baseline/video).
 *  Coste objetivo: < 10 ms por muestra en hardware clase A13 (se mide y
 *  reporta). PROHIBIDO comparar frames a resolución completa. */
export interface ThumbSampler {
  /** Fija la referencia inicial (al empezar la espera de la foto). */
  baseline(): void;
  /** Delta de luma (0-255) vs la muestra anterior, o null sin referencia. */
  sample(): number | null;
}

const THUMB_SIZE = 64;

export function makeThumbSampler(
  getVideo: () => HTMLVideoElement | null
): ThumbSampler {
  let prev: Uint8Array | null = null;
  let canvas: HTMLCanvasElement | null = null;

  const grab = (): Uint8Array | null => {
    const video = getVideo();
    if (!video || video.readyState < 2 || !video.videoWidth) return null;
    try {
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.width = THUMB_SIZE;
        canvas.height = THUMB_SIZE;
      }
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, THUMB_SIZE, THUMB_SIZE);
      const d = ctx.getImageData(0, 0, THUMB_SIZE, THUMB_SIZE).data;
      const luma = new Uint8Array(THUMB_SIZE * THUMB_SIZE);
      for (let i = 0, j = 0; j < luma.length; i += 4, j++) {
        luma[j] = (d[i]! * 299 + d[i + 1]! * 587 + d[i + 2]! * 114) / 1000;
      }
      return luma;
    } catch {
      return null;
    }
  };

  return {
    baseline() {
      prev = grab();
    },
    sample(): number | null {
      const cur = grab();
      if (cur === null) return null; // sin video: conserva la referencia vieja
      if (prev === null || prev.length !== cur.length) {
        prev = cur;
        return null; // primera muestra efectiva: solo fija referencia
      }
      let sum = 0;
      for (let i = 0; i < cur.length; i++) sum += Math.abs(cur[i]! - prev[i]!);
      prev = cur;
      return sum / cur.length;
    },
  };
}

/* ── Espera presupuestada (§A + §B sobre la foto del sensor) ────────────── */

export interface BurstWaitOutcome {
  /** "value" = la operación terminó (resultado en `value`, puede ser null);
   *  "time_cap" | "stable" = el presupuesto cortó la espera. */
  settled: "value" | "time_cap" | "stable";
  value: unknown;
  /** Muestras de estabilidad tomadas durante la espera. */
  samples: number;
  /** Coste de la última muestra (ms) — telemetría del objetivo < 10 ms. */
  lastSampleCostMs: number | null;
}

/** Espera `start()` (la foto del sensor) bajo el presupuesto: termina cuando
 *  la operación resuelve, cuando vence el muro (`time_cap`) o cuando el
 *  preview lleva `stabilityFrames` muestras consecutivas estables (`stable`).
 *  El reloj es performance.now() (monotónico) — NUNCA rAF. */
export function waitForPhotoBudget(
  start: () => Promise<unknown>,
  opts: { deadlineAt: number; sampler: ThumbSampler }
): Promise<BurstWaitOutcome> {
  const cfg = config; // snapshot: cambios vía __burstTools aplican a la SIGUIENTE captura
  return new Promise<BurstWaitOutcome>((resolve) => {
    let settled = false;
    let samples = 0;
    let stableCount = 0;
    let lastSampleCostMs: number | null = null;
    let nextSampleAt = performance.now() + STABILITY_SAMPLE_INTERVAL_MS;

    const finish = (r: BurstWaitOutcome) => {
      if (settled) return;
      settled = true;
      window.clearInterval(iv);
      resolve(r);
    };

    // La operación puede ganar la carrera (foto a tiempo) — el ORFANO no
    // abortable queda documentado: ImageCapture no expone cancelación.
    void start().then(
      (value) => finish({ settled: "value", value, samples, lastSampleCostMs }),
      () => finish({ settled: "value", value: null, samples, lastSampleCostMs })
    );

    const iv = window.setInterval(() => {
      const now = performance.now();
      // §A — muro DURO: la adquisición termina con lo recogido.
      if (now >= opts.deadlineAt) {
        finish({ settled: "time_cap", value: null, samples, lastSampleCostMs });
        return;
      }
      if (now < nextSampleAt) return;
      nextSampleAt = now + STABILITY_SAMPLE_INTERVAL_MS;
      const t0 = performance.now();
      const delta = opts.sampler.sample();
      lastSampleCostMs = Math.round((performance.now() - t0) * 100) / 100;
      if (delta === null) return;
      samples += 1;
      // §B — deltas consecutivos bajo umbral → los frames extra no aportan.
      stableCount = delta < cfg.stabilityThreshold ? stableCount + 1 : 0;
      if (stableCount >= cfg.stabilityFrames) {
        finish({ settled: "stable", value: null, samples, lastSampleCostMs });
      }
    }, WATCH_TICK_MS);
  });
}

/* ── Sonda de QA (patrón __diagTools / __sensorTools) ───────────────────── */
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__burstTools = {
    set(partial: Partial<BurstBudgetConfig>) {
      const p = partial ?? {};
      const next = { ...config };
      if (typeof p.enabled === "boolean") next.enabled = p.enabled;
      if (typeof p.timeBudgetMs === "number" && Number.isFinite(p.timeBudgetMs)) {
        next.timeBudgetMs = Math.max(0, Math.min(60_000, p.timeBudgetMs));
      }
      // v3 Fase D — gracia de la foto huérfana (mismo estilo que timeBudgetMs;
      // 0 = sin gracia, palanca A/B de retroceso byte-a-byte).
      if (typeof p.photoGraceMs === "number" && Number.isFinite(p.photoGraceMs)) {
        next.photoGraceMs = Math.max(0, Math.min(5000, p.photoGraceMs));
      }
      if (
        typeof p.stabilityFrames === "number" &&
        Number.isFinite(p.stabilityFrames)
      ) {
        next.stabilityFrames = Math.max(1, Math.min(10, Math.round(p.stabilityFrames)));
      }
      if (
        typeof p.stabilityThreshold === "number" &&
        Number.isFinite(p.stabilityThreshold)
      ) {
        next.stabilityThreshold = Math.max(0, Math.min(255, p.stabilityThreshold));
      }
      config = next;
      return { ...config };
    },
    get(): BurstBudgetConfig {
      return { ...config };
    },
    reset(): BurstBudgetConfig {
      config = { ...DEFAULTS };
      return { ...config };
    },
    // v2-A13 Fase A — inspectores de la telemetría nueva (QA/E2E):
    videoTrack(): { w: number; h: number } | null {
      return getVideoTrackSize();
    },
    orphans(): OrphanPhotoStats {
      return getOrphanPhotoStats();
    },
    // v2-A13 Fase B — ¿estamos dentro de la ventana fired→shot? (verificación
    // del congelamiento del overlay QA y del ring post-fired barato).
    acquiring(): boolean {
      return isAcquisitionActive();
    },
    // v4 §2.3 — jobs del editor en vuelo ahora (autoQuad/filtros/preview):
    // la señal que discrimina el candidato #3 del tramo opaco.
    backgroundJobs(): number {
      return getBackgroundJobs();
    },
  };
}

declare module "@/lib/perf-probe" {
  interface PerfProbeApi {
    mark(ev: string, meta?: Record<string, unknown>): void;
  }
}
