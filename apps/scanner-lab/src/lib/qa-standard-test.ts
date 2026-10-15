"use client";

/**
 * QA — Test estándar v1.3 (modos rápido/completo — instruccion-qa-v13-modo-rapido).
 *
 * Guión AUTOMATIZADO DE USO (no de pipeline): reproduce exactamente lo que
 * haría un usuario real — con el auto-shutter nativo ENCENDIDO y SIN tocar
 * — para medir lo que un usuario viviría, incluida la demora del shutter
 * automático en gama baja (decisión del dueño 2026-10-12: la espera se
 * MIDE, no se esconde).
 *
 * Reglas de oro (verificables en el diff):
 *  · Cero lógica nueva en el pipeline: el guión SOLO observa las marcas de
 *    la sonda (__perfProbe) y dispara las rutas existentes (los mismos
 *    handlers/store-actions que usan los botones reales).
 *  · Captura 100 % intocable y 100 % nativa: NO se apaga autoCapture, NO se
 *    tocan umbrales de estabilidad, NO se simulan toques. Solo espera,
 *    cronometra y navega como el usuario («Seguir escaneando», «Revisar»).
 *  · OCR congelado (ocr.ts 0 diff) · e14 0 diff · sin dependencias nuevas.
 *  · No persiste entre sesiones: recarga = desarmado.
 *
 * Máquina de estados: armar → pasos del modo activo (v1.3: rápido 2 /
 * completo 12) → informe/abortar. La detección
 * de fin de cada paso es un ESCANEO idempotente del anillo de marcas en
 * cada tick (sin cursor incremental → inmune a lotes de marcas que llegan
 * juntas). Se comunica con las vistas vía el store reactivo de abajo
 * (forma qaTest: { armed, step, stepStartedAt, log[] } de la spec).
 */

import { useSyncExternalStore } from "react";
import { perfProbe, type PerfProbeMark } from "./perf-probe";
import { useScannerStore } from "@jg-stevan/scanner-core/store";

/* ------------------------------------------------------------------ */
/* Pasos del guión                                                      */
/* ------------------------------------------------------------------ */

export interface QaStepDef {
  id: string;
  label: string;
  /** Banner que la cámara muestra mientras el paso espera al usuario. */
  hint?: string;
  /** Pasos pesados (OCR/export): >90 s → overlay «sigue trabajando…». */
  slow?: boolean;
}

/** El guión qa-standard-v1.3: los 12 pasos del MODO COMPLETO (fuente de
 *  comparabilidad entre builds). El modo rápido usa un subconjunto — ver
 *  QA_MODE_STEPS. */
export const QA_STEPS: QaStepDef[] = [
  {
    id: "capture-1",
    label: "Captura 1/3 (auto)",
    hint: "Sostén el documento — la captura automática disparará sola",
  },
  {
    id: "capture-2",
    label: "Captura 2/3 (auto)",
    hint: "Reencuadra o voltea la página (2/3)",
  },
  {
    id: "capture-3",
    label: "Captura 3/3 (auto)",
    hint: "Reencuadra o voltea la página (3/3)",
  },
  { id: "editor-1", label: "Editor · 1ª apertura" },
  { id: "editor-2", label: "Editor · 2ª apertura (warm)" },
  { id: "filter-text", label: "Filtro «Texto claro»" },
  { id: "filter-bw", label: "Filtro «B/N adaptativo»" },
  { id: "ocr-cold", label: "OCR frío", slow: true },
  { id: "ocr-warm", label: "OCR tibio", slow: true },
  { id: "export-png", label: "Export PNG" },
  { id: "export-pdf", label: "Export PDF (3 páginas)", slow: true },
  { id: "report", label: "Informe + compartir", slow: true },
];

/* ------------------------------------------------------------------ */
/* Modos del guión (v1.3 — instruccion-qa-v13-modo-rapido)               */
/* ------------------------------------------------------------------ */

/** v1.3 — Modo del test: "quick" = lo que hace un usuario real: escanea UNA
 *  página y mira cómo quedó (capture-1 → editor-1 → fin). "full" = los 12
 *  pasos de siempre. "quick" es el DEFAULT en la UI; el completo DEBE seguir
 *  comportándose igual que hoy (comparabilidad entre builds). */
export type QaMode = "quick" | "full";

/** QUÉ pasos espera cada modo (la máquina ya escanea marcas genéricamente:
 *  solo cambia esta lista — umbrales y detección INTACTOS, cero umbrales
 *  nuevos). */
export const QA_MODE_STEPS: Record<QaMode, string[]> = {
  quick: ["capture-1", "editor-1"],
  full: QA_STEPS.map((s) => s.id),
};

/** Etiqueta del modo para cabeceras de informe (v1.3). */
export const QA_MODE_LABEL: Record<QaMode, string> = {
  quick: "modo rápido (1 captura)",
  full: "modo completo (12 pasos)",
};

/** Defs del modo activo (en el orden del guión). */
function modeStepDefs(mode: QaMode): QaStepDef[] {
  const ids = QA_MODE_STEPS[mode] ?? QA_MODE_STEPS.full;
  const defs: QaStepDef[] = [];
  for (const id of ids) {
    const d = stepDef(id);
    if (d) defs.push(d);
  }
  return defs;
}

/** Defs del modo activo para las vistas (overlay/checklist). */
export function qaModeStepDefs(mode: QaMode): QaStepDef[] {
  return modeStepDefs(mode);
}

/** v1.3 — etiqueta de un paso según el modo. En rápido, capture-1 se
 *  muestra «Captura» (sin "/3": no hay 2ª ni 3ª); editor-1 mantiene su
 *  etiqueta. En completo, etiquetas intactas. */
export function qaStepShortLabel(id: string, mode: QaMode): string {
  if (mode === "quick" && id === "capture-1") return "Captura";
  return stepDef(id)?.label ?? id;
}

export interface QaStepLog {
  id: string;
  label: string;
  ms: number | null;
  ok: boolean;
  /** Capturas: ¿disparó el shutter automático o tocó el usuario? */
  mode?: "auto" | "manual";
  /** Capturas: espera estable→disparo (capture_fired − capture_stable). */
  waitMs?: number | null;
  /** Editor-1/editor-2 (v1.2): decode del mark editor_first_render
   *  (meta.decodeMs; null si el mark no lo trajo — p. ej. cache hit). */
  decodeMs?: number | null;
  /** Editor-1/editor-2 (v1.2): tier con el que pintó el primer render
   *  (meta.previewTier; null si el mark no lo trajo). */
  tier?: string | null;
}

export interface QaTestState {
  /** Ajustes › Diagnóstico › «Preparar test» → navega a la cámara. */
  armed: boolean;
  running: boolean;
  finished: boolean;
  aborted: boolean;
  /** Id del paso actual (null mientras la captura aterriza). */
  step: string | null;
  stepIndex: number;
  /** v1.3 — modo del guión en curso (default "quick"). */
  mode: QaMode;
  stepStartedAt: number | null;
  log: QaStepLog[];
  /** Banner del paso actual (cámara: sostén/reencuadra; fallback 60 s). */
  hint: string | null;
  /** Captura: >60 s sin disparo → pedir toque manual (no aborta jamás). */
  manualPrompt: boolean;
  /** Paso pesado >90 s → «sigue trabajando…» (no aborta jamás). */
  slow: boolean;
  startedAt: number | null;
  endedAt: number | null;
  /** Documentos «QA-estandar» creados por el guión (para Borrar datos). */
  docIds: string[];
  /** Incrementa en cada arranque → las vistas ejecutan cada paso 1 vez. */
  runId: number;
  /** Resultado del intento de compartir el informe final. */
  shareResult: "shared" | "downloaded" | "cancelled" | "failed" | null;
}

const INITIAL: QaTestState = {
  armed: false,
  running: false,
  finished: false,
  aborted: false,
  step: null,
  stepIndex: -1,
  mode: "quick",
  stepStartedAt: null,
  log: [],
  hint: null,
  manualPrompt: false,
  slow: false,
  startedAt: null,
  endedAt: null,
  docIds: [],
  runId: 0,
  shareResult: null,
};

/* ------------------------------------------------------------------ */
/* Micro-store reactivo (useSyncExternalStore — cero dependencias)      */
/* ------------------------------------------------------------------ */

let state: QaTestState = INITIAL;
const listeners = new Set<() => void>();

function set(patch: Partial<QaTestState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Vista reactiva del guión (misma forma que la spec: qaTest.{armed,step,…}).
 *  Los selectores deben devolver valores estables (primitivos o referencias
 *  del estado — nunca objetos nuevos en línea). */
export function useQaTestStore<T>(selector: (s: QaTestState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(INITIAL)
  );
}

/** Snapshot completo (reactivo) para lecturas puntuales. */
export function useQaTestSnapshot(): QaTestState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => INITIAL
  );
}

/** Estado actual del guión para código no-React (informe, máquina). */
export function getQaTestState(): QaTestState {
  return state;
}

/* ------------------------------------------------------------------ */
/* Máquina de estados (singleton del módulo — muere con la recarga)     */
/* ------------------------------------------------------------------ */

const POLL_MS = 250;
/** Captura sin disparo tras esto → pedir toque manual (spec: 60 s). */
const MANUAL_FALLBACK_MS = 60_000;
/** Paso pesado sin completar → «sigue trabajando…» (spec: 90 s). */
const SLOW_HINT_MS = 90_000;
/** Seguro de vida del aterrizaje de una captura (no aborta, solo sigue). */
const LANDING_TIMEOUT_MS = 45_000;

let pollTimer: number | null = null;
let manualTapSeen = false;
/** Aterrizaje en vuelo: ts del capture_fired cuya page_saved se espera. */
let landingFiredTs: number | null = null;
/** ts del reopen del editor-2 (su render se mide desde aquí). */
let editor2ReopenTs: number | null = null;
let reopenTimer: number | null = null;
let pointerListener: ((e: PointerEvent) => void) | null = null;

function now(): number {
  return performance.now();
}

function stepDef(id: string): QaStepDef | null {
  return QA_STEPS.find((s) => s.id === id) ?? null;
}

/** Marca MÁS RECIENTE de un evento desde un instante (escaneo inverso). */
function findMark(
  ev: string,
  sinceTs: number,
  pred?: (m: PerfProbeMark) => boolean
): PerfProbeMark | null {
  const marks = perfProbe.marks;
  for (let i = marks.length - 1; i >= 0; i -= 1) {
    const m = marks[i]!;
    if (m.ts < sinceTs) break;
    if (m.ev === ev && (!pred || pred(m))) return m;
  }
  return null;
}

/** Marca de un evento MÁS RECIENTE con ts ≤ límite (para emparejar). */
function findMarkBefore(ev: string, beforeTs: number): PerfProbeMark | null {
  const marks = perfProbe.marks;
  let found: PerfProbeMark | null = null;
  for (const m of marks) {
    if (m.ts > beforeTs) break;
    if (m.ev === ev) found = m;
  }
  return found;
}

function stepStart(id: string, fromTs?: number): void {
  const def = stepDef(id);
  if (!def) return;
  manualTapSeen = false;
  landingFiredTs = null;
  set({
    step: id,
    stepIndex: modeStepDefs(state.mode).findIndex((s) => s.id === id),
    stepStartedAt: fromTs ?? now(),
    hint: def.hint ?? null,
    manualPrompt: false,
    slow: false,
  });
}

/** v1.2 — decode/tier del mark editor_first_render (editor-1/editor-2):
 *  se copian del meta del mark; ausentes → null (honesto, nunca 0). */
function editorRenderExtras(m: PerfProbeMark): Partial<QaStepLog> {
  const meta = m.meta ?? {};
  return {
    decodeMs: typeof meta.decodeMs === "number" ? meta.decodeMs : null,
    tier: typeof meta.previewTier === "string" ? meta.previewTier : null,
  };
}

function stepDone(def: QaStepDef, ms: number | null, extra?: Partial<QaStepLog>): void {
  set({
    log: [
      ...state.log,
      {
        id: def.id,
        label: qaStepShortLabel(def.id, state.mode),
        ms: ms === null ? null : Math.max(0, Math.round(ms)),
        ok: true,
        ...extra,
      },
    ],
  });
}

/** Paso siguiente del guión (del MODO ACTIVO — v1.3: termina al completar
 *  el último paso del modo; en rápido eso es editor-1). */
function advance(fromTs?: number): void {
  const steps = modeStepDefs(state.mode);
  const nextIdx = state.stepIndex + 1;
  if (nextIdx >= steps.length) {
    finish(false);
    return;
  }
  const def = steps[nextIdx]!;
  if (def.id === "editor-2") {
    // 2ª apertura: CIERRA el editor (misma acción que el botón «atrás» en
    // sesión de captura), espera 600 ms y REABRE por la ruta del botón
    // «Revisar N» con la página 1 (misma acción que las miniaturas).
    useScannerStore.getState().setView("camera");
    if (reopenTimer !== null) window.clearTimeout(reopenTimer);
    reopenTimer = window.setTimeout(() => {
      reopenTimer = null;
      if (!state.running) return;
      const s = useScannerStore.getState();
      if (s.capturePages.length > 0) {
        s.setEditingIndex(0); // «Ir a la página 1»
        s.setView("editor"); // goToEditor: la ruta de «Revisar N»
      }
      editor2ReopenTs = now();
      set({ stepStartedAt: editor2ReopenTs });
    }, 600);
    set({
      step: "editor-2",
      stepIndex: nextIdx,
      stepStartedAt: now(),
      hint: null,
      manualPrompt: false,
      slow: false,
    });
    return;
  }
  stepStart(def.id, fromTs);
}

function finish(aborted: boolean): void {
  stopPoller();
  set({
    running: false,
    finished: true,
    aborted,
    step: null,
    hint: null,
    manualPrompt: false,
    slow: false,
    endedAt: now(),
    armed: false,
  });
}

function stopPoller(): void {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
  if (reopenTimer !== null) {
    window.clearTimeout(reopenTimer);
    reopenTimer = null;
  }
  detachPointerListener();
}

/* ── Toque manual en el shutter (detección pasiva, sin tocar CameraView) ── */

function attachPointerListener(): void {
  if (pointerListener !== null) return;
  pointerListener = (e: PointerEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && typeof t.closest === "function" && t.closest("[data-qa-shutter]")) {
      manualTapSeen = true;
    }
  };
  try {
    document.addEventListener("pointerdown", pointerListener, {
      passive: true,
      capture: true,
    });
  } catch {
    pointerListener = null;
  }
}

function detachPointerListener(): void {
  if (pointerListener !== null) {
    try {
      document.removeEventListener("pointerdown", pointerListener, {
        capture: true,
      } as EventListenerOptions);
    } catch {
      /* — */
    }
    pointerListener = null;
  }
}

/* ── Tick: escaneo idempotente de condiciones de fin de paso ── */

function onTick(): void {
  if (!state.running) return;
  const startedAt = state.stepStartedAt ?? now();

  /* Transición interna: captura disparada, esperando el aterrizaje
   * (page_saved) para volver a la cámara como haría el usuario. */
  if (state.step === null && landingFiredTs !== null) {
    const saved = findMark("page_saved", landingFiredTs);
    const timedOut = now() - landingFiredTs > LANDING_TIMEOUT_MS;
    if (saved || timedOut) {
      const pageSavedTs = saved ? saved.ts : now();
      const nextIdx = state.stepIndex + 1;
      const nextDef = modeStepDefs(state.mode)[nextIdx];
      if (nextDef && (nextDef.id === "capture-2" || nextDef.id === "capture-3")) {
        // Volver a la cámara = la acción exacta de «Seguir escaneando».
        landingFiredTs = null;
        useScannerStore.getState().setView("camera");
        stepStart(nextDef.id);
        return;
      }
      // Tras la captura 3 el editor YA está abierto (aterrizaje F-FLOW):
      // editor-1 espera el render de ESE aterrizaje (desde page_saved).
      landingFiredTs = null;
      stepStart("editor-1", pageSavedTs);
    } else {
      return; // sin aterrizaje aún: nada más que evaluar
    }
  }

  const def = state.step ? stepDef(state.step) : null;
  if (!def) return;

  switch (def.id) {
    case "capture-1":
    case "capture-2":
    case "capture-3": {
      const fired = findMark("capture_fired", startedAt);
      if (fired) {
        const mode: "auto" | "manual" =
          manualTapSeen || state.manualPrompt ? "manual" : "auto";
        const stable = findMarkBefore("capture_stable", fired.ts);
        stepDone(def, fired.ts - startedAt, {
          mode,
          waitMs: stable ? Math.max(0, fired.ts - stable.ts) : null,
        });
        // Fin del paso (spec) → transición interna de aterrizaje.
        landingFiredTs = fired.ts;
        set({ step: null, hint: null, manualPrompt: false, slow: false });
      } else if (
        !state.manualPrompt &&
        now() - startedAt > MANUAL_FALLBACK_MS
      ) {
        // Fallback honesto (spec): pedir el toque, NUNCA abortar.
        set({
          manualPrompt: true,
          hint: "El disparo automático está tardando — toca el botón de captura",
        });
      }
      break;
    }
    case "editor-1": {
      // Render del aterrizaje de la captura 3 (desde su page_saved).
      const fr = findMark("editor_first_render", startedAt);
      if (fr) {
        stepDone(def, fr.ts - startedAt, editorRenderExtras(fr));
        advance(fr.ts);
      }
      break;
    }
    case "editor-2": {
      const since = editor2ReopenTs ?? startedAt;
      const fr = findMark("editor_first_render", since);
      if (fr) {
        stepDone(def, fr.ts - since, editorRenderExtras(fr));
        advance(fr.ts);
      }
      break;
    }
    case "filter-text":
    case "filter-bw": {
      const want = def.id === "filter-text" ? "text" : "bw";
      const fa = findMark(
        "filter_applied",
        startedAt,
        (m) => m.meta?.filterId === want || m.meta?.filter === want
      );
      if (fa) {
        stepDone(def, fa.ts - startedAt);
        advance(fa.ts);
      }
      // Cache hit (preview YA procesado con este filtro → el review NO
      // reprocesa, diseño v11, y no hay mark): la obediencia del editor lo
      // detecta vía previewCache y lo notifica con noteFilterCached().
      break;
    }
    case "ocr-cold":
    case "ocr-warm": {
      const od = findMark("ocr_done", startedAt);
      if (od) {
        stepDone(def, od.ts - startedAt);
        advance(od.ts);
      }
      break;
    }
    case "export-png": {
      const ee = findMark(
        "export_end",
        startedAt,
        (m) => m.meta?.type === "png" || m.meta?.type === "jpg"
      );
      if (ee) {
        stepDone(def, ee.ts - startedAt);
        advance(ee.ts);
      }
      break;
    }
    case "export-pdf": {
      const ee = findMark(
        "export_end",
        startedAt,
        (m) => m.meta?.type === "pdf"
      );
      if (ee) {
        stepDone(def, ee.ts - startedAt);
        // El documento recién guardado pasa a llamarse «QA-estandar» y
        // queda registrado para «Borrar datos del test».
        try {
          const s = useScannerStore.getState();
          const newest = s.documents.find((d) => d.deletedAt === undefined);
          if (newest) {
            s.renameDocument(newest.id, "QA-estandar");
            if (!state.docIds.includes(newest.id)) {
              set({ docIds: [...state.docIds, newest.id] });
            }
          }
        } catch {
          /* renombrar es best-effort */
        }
        advance(ee.ts);
      }
      break;
    }
    case "report": {
      // La compartición la dispara el overlay (gesto del usuario cuando el
      // navegador lo exige) con fallback a descarga — ver runReportShare().
      break;
    }
    default:
      break;
  }

  // Paso pesado >90 s → «sigue trabajando…» (OCR ~50 s en A13 es esperado).
  const cur = state.step ? stepDef(state.step) : null;
  if (cur?.slow && !state.slow && now() - (state.stepStartedAt ?? now()) > SLOW_HINT_MS) {
    set({ slow: true });
  }
}

/* ------------------------------------------------------------------ */
/* API pública (SettingsView / QAOverlay / EditorView)                  */
/* ------------------------------------------------------------------ */

export const qaStandardTest = {
  /** Ajustes › Diagnóstico › «Preparar test»: arma el guión y navega a la
   *  cámara. El auto-shutter queda en su estado por defecto (activado).
   *  v1.3 — recibe el modo (default "quick": 1 captura → editor). */
  arm(mode: QaMode = "quick"): void {
    if (state.running) return;
    stopPoller();
    set({
      ...INITIAL,
      armed: true,
      runId: state.runId + 1,
      docIds: state.docIds, // los datos del test anterior se conservan hasta «Borrar»
      mode,
    });
    useScannerStore.getState().setView("camera");
  },

  /** Cámara armada › «Iniciar test» — paso 0 manual del dueño. */
  start(): void {
    if (!state.armed || state.running) return;
    set({
      running: true,
      finished: false,
      aborted: false,
      startedAt: now(),
      endedAt: null,
      log: [],
      shareResult: null,
    });
    manualTapSeen = false;
    landingFiredTs = null;
    editor2ReopenTs = null;
    attachPointerListener();
    if (pollTimer !== null) window.clearInterval(pollTimer);
    pollTimer = window.setInterval(onTick, POLL_MS);
    stepStart("capture-1");
  },

  /** Abortar SIEMPRE disponible. Deja la app usable y el informe parcial
   *  (qa.aborted) compartible desde Ajustes › Diagnóstico. */
  abort(): void {
    if (!state.running) return;
    const def = state.step ? stepDef(state.step) : null;
    if (def) {
      set({
        log: [
          ...state.log,
          { id: def.id, label: qaStepShortLabel(def.id, state.mode), ms: null, ok: false },
        ],
      });
    }
    finish(true);
  },

  /** Paso «report»: compartir el informe (fallback a descarga). Diag-report
   *  importa este módulo → import tardío para evitar el ciclo. */
  async runReportShare(): Promise<void> {
    if (!state.running || state.step !== "report") return;
    try {
      const { diagTools } = await import("./diag-report");
      const r = await diagTools.share();
      set({ shareResult: r });
    } catch {
      set({ shareResult: "failed" });
    }
    finish(false);
  },

  /** Reintentar compartir desde el overlay de fin (gesto real del usuario). */
  async shareAgain(): Promise<void> {
    try {
      const { diagTools } = await import("./diag-report");
      const r = await diagTools.share();
      set({ shareResult: r });
    } catch {
      set({ shareResult: "failed" });
    }
  },

  /** Obediencia del editor: el filtro pedido se aplicó sobre un preview YA
   *  cacheado (v11: cache hit → sin reproceso → sin filter_applied). El
   *  paso completa AHORA con la aplicación instantánea que vivió el
   *  usuario — sin esperar un mark que por diseño no va a llegar. */
  noteFilterCached(filter: "text" | "bw"): void {
    if (!state.running) return;
    const id = `filter-${filter}`;
    if (state.step !== id) return;
    if (state.log.some((l) => l.id === id)) return; // ya completado vía mark
    const def = stepDef(id);
    if (!def || state.stepStartedAt === null) return;
    stepDone(def, now() - state.stepStartedAt);
    advance();
  },

  /** Cierra el overlay del guión (el estado queda para el informe). */
  dismiss(): void {
    if (state.running) return;
    set({ armed: false });
  },

  /** «Borrar datos del test»: elimina los documentos QA-estandar creados
   *  por el guión (papelera incluida — es datos de prueba) y resetea. */
  deleteTestData(): void {
    try {
      const s = useScannerStore.getState();
      const ids = new Set<string>(state.docIds);
      for (const d of s.documents) {
        if (d.title === "QA-estandar") ids.add(d.id);
      }
      for (const id of ids) {
        try {
          s.deleteDocument(id); // papelera (persiste deletedAt)
          s.purgeDocument(id); // borrado definitivo (IndexedDB incluida)
        } catch {
          /* best-effort por documento */
        }
      }
    } catch {
      /* best-effort */
    }
    stopPoller();
    set({ ...INITIAL });
  },
};

declare global {
  interface Window {
    __qaTest?: {
      state: () => QaTestState;
      steps: () => QaStepDef[];
      arm: () => void;
      start: () => void;
      abort: () => void;
      deleteTestData: () => void;
    };
  }
}

if (typeof window !== "undefined") {
  try {
    window.__qaTest = {
      state: getQaTestState,
      steps: () => QA_STEPS,
      arm: () => qaStandardTest.arm(),
      start: () => qaStandardTest.start(),
      abort: () => qaStandardTest.abort(),
      deleteTestData: () => qaStandardTest.deleteTestData(),
    };
  } catch {
    /* best-effort */
  }
}
