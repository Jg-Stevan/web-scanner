"use client";

/**
 * DIAG — Sonda de rendimiento 100 % local (solo instrumentación).
 *
 * API EXACTA de la spec §6 del PLAN A (== §7 del PLAN B — comparabilidad
 * 1:1 entre planes y con esta rama de diagnóstico; el requisito más
 * importante del encargo):
 *
 *   window.__perfProbe = {
 *     marks: [],                    // {ev, ts, meta}
 *     mark(ev, meta?)               // capture_fired | page_saved{bytes,pxLong} |
 *                                   // editor_open | editor_first_render |
 *                                   // filter_applied{ms} | save_done{ms,bytes} |
 *                                   // export_start/export_end{type,ms,bytes}
 *     memory()                      // {heapMB, limitMB, ts} de performance.memory
 *     longTasks                     // PerformanceObserver('longtask'): count+totalMs
 *                                     // v1.1: + supported (Safari no lo tiene → el
 *                                     // informe dice "no soportado", jamás "0 tareas")
 *     fpsSample(ms=3000)            // FPS durante interacción (pan/zoom editor)
 *     report()                      // JSON resumen imprimible (console.table)
 *   }
 *
 * Esta rama (diag/informe-dispositivo) AÑADE sobre esa base verbatim:
 *   · PERF_PROBE_T0 / PERF_PROBE_T0_AT — instante de carga del módulo
 *     (base de `boot_ready` y de `session.startedAt` del informe).
 *   · Los marks NUEVOS de la spec diag §5 se emiten desde las vistas con
 *     el MISMO mark(): camera_open, camera_ready, fps_camera{fps,phase},
 *     ocr_start, ocr_done{ms,chars,ok}, editor_close{durationMs},
 *     fps_auto{fps}, boot_ready{ms}. Ninguno cambia la API existente.
 *
 * Reglas: sin red, envuelta en try/catch para no romper producción si algo
 * falla, instrumenta los eventos SIN tocar lógica (solo llamadas mark()).
 */

export interface PerfProbeMark {
  ev: string;
  ts: number;
  meta?: Record<string, number | string | boolean | null>;
}

export interface PerfMemorySnapshot {
  heapMB: number | null;
  limitMB: number | null;
  ts: number;
}

export interface PerfFpsSample {
  fps: number;
  frames: number;
  durationMs: number;
}

export interface PerfLongTasks {
  count: number;
  totalMs: number;
  /** v1.1 — ¿este navegador soporta PerformanceObserver('longtask')?
   *  Safari/iOS: false → el informe reporta "no soportado", no 0. */
  supported: boolean;
}

/** v2-A13 (burst Fase A) — UNA entrada de long task con su instante:
 *  permite filtrar congestión DENTRO de ventanas (p. ej. capture_fired →
 *  capture_shot) sin duplicar el observer. `start`/`duration` en el MISMO
 *  reloj (performance.now) que los marks. */
export interface PerfLongTaskEntry {
  start: number;
  duration: number;
}

export interface PerfProbeApi {
  marks: PerfProbeMark[];
  mark(ev: string, meta?: Record<string, number | string | boolean | null>): void;
  memory(): PerfMemorySnapshot;
  longTasks: PerfLongTasks;
  /** v2-A13 (burst Fase A) — últimas long tasks con instante (ring acotado):
 *  el MISMO observer que alimenta longTasks, sin duplicar. */
  longTaskEntries: PerfLongTaskEntry[];
  fpsSample(ms?: number): Promise<PerfFpsSample | null>;
  report(): Record<string, unknown> | null;
}

/** DIAG — t0 de la sonda: performance.now() al evaluar este módulo (base
 * de boot_ready y de la duración de sesión del informe). */
export const PERF_PROBE_T0 =
  typeof performance !== "undefined" ? performance.now() : 0;

/** DIAG — el mismo instante en reloj de pared (ISO) — startedAt del informe. */
export const PERF_PROBE_T0_AT =
  typeof Date !== "undefined" ? Date.now() : 0;

/** Tope del ring de marcas (descarta la más vieja — memoria acotada). */
const MAX_MARKS = 600;

/** Tope del ring de long tasks con instante (v2-A13 — memoria acotada). */
const MAX_LONG_TASK_ENTRIES = 600;

function makeProbe(): PerfProbeApi {
  const marks: PerfProbeMark[] = [];
  const longTasks: PerfLongTasks = { count: 0, totalMs: 0, supported: false };
  const longTaskEntries: PerfLongTaskEntry[] = [];

  const probe: PerfProbeApi = {
    marks,
    longTasks,
    longTaskEntries,
    // BP-4 (Lote 6): anotación EXPLÍCITA de los parámetros de la
    // implementación. Con la augmentación de burst-budget.ts (overload de
    // mark() con BurstHeapProbe en meta), la contextualización tomaba el
    // ÚLTIMO overload (el ancho) y el spread de meta dejaba de caber en
    // PerfProbeMark.meta (estrecho) al activar noImplicitAny. Métodos son
    // bivariantes: la implementación anotada ESTRECHA sigue asignable a los
    // dos overloads, y los llamadores que pasan BurstHeapProbe siguen
    // usando el overload ancho. Cero cambio de runtime.
    mark(ev: string, meta?: Record<string, number | string | boolean | null>) {
      try {
        if (typeof ev !== "string" || ev.length === 0) return;
        marks.push({
          ev,
          ts: Math.round(performance.now()),
          meta: meta === undefined ? undefined : { ...meta },
        });
        if (marks.length > MAX_MARKS) marks.splice(0, marks.length - MAX_MARKS);
      } catch {
        /* la sonda NUNCA rompe la app */
      }
    },
    memory() {
      try {
        const perf = performance as Performance & {
          memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
        };
        const m = perf.memory;
        if (!m || typeof m.usedJSHeapSize !== "number") {
          return { heapMB: null, limitMB: null, ts: Date.now() };
        }
        return {
          heapMB: +(m.usedJSHeapSize / 1048576).toFixed(1),
          limitMB: +(m.jsHeapSizeLimit / 1048576).toFixed(1),
          ts: Date.now(),
        };
      } catch {
        return { heapMB: null, limitMB: null, ts: Date.now() };
      }
    },
    fpsSample(ms = 3000) {
      return new Promise<PerfFpsSample | null>((resolve) => {
        try {
          if (typeof requestAnimationFrame !== "function") {
            resolve(null);
            return;
          }
          const t0 = performance.now();
          let frames = 0;
          let raf = 0;
          const deadline = t0 + Math.max(250, ms);
          const tick = () => {
            frames += 1;
            const now = performance.now();
            if (now >= deadline || frames > 100000) {
              const durationMs = Math.round(now - t0);
              resolve({
                fps: Math.round((frames * 1000) / Math.max(1, durationMs)),
                frames,
                durationMs,
              });
              return;
            }
            raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
          // Seguro de vida: nunca colgar la promesa si rAF se congela.
          window.setTimeout(() => {
            cancelAnimationFrame(raf);
            const durationMs = Math.round(performance.now() - t0);
            resolve({
              fps: Math.round((frames * 1000) / Math.max(1, durationMs)),
              frames,
              durationMs,
            });
          }, ms + 1500);
        } catch {
          resolve(null);
        }
      });
    },
    report() {
      try {
        const byEvent = new Map<
          string,
          { ev: string; count: number; lastMs: number | null; emaMs: number | null }
        >();
        for (const m of marks) {
          const row =
            byEvent.get(m.ev) ??
            { ev: m.ev, count: 0, lastMs: null as number | null, emaMs: null as number | null };
          row.count += 1;
          const ms = typeof m.meta?.ms === "number" ? (m.meta.ms as number) : null;
          if (ms !== null) {
            row.lastMs = ms;
            // D-15 (kit limpieza-v1): esto NO es una media — es mezcla
            // exponencial (EMA) → key renombrado (cero consumidores externos
            // del key viejo; verificado con grep). Solo diagnóstico.
            row.emaMs = row.emaMs === null ? ms : +((row.emaMs + ms) / 2).toFixed(1);
          }
          byEvent.set(m.ev, row);
        }
        const summary = {
          generatedAt: new Date().toISOString(),
          totalMarks: marks.length,
          events: [...byEvent.values()],
          memory: probe.memory(),
          longTasks: { ...longTasks },
          lastMarks: marks.slice(-12),
        };
        try {
          console.table(summary.events);
        } catch {
          /* sin consola */
        }
        return summary;
      } catch {
        return null;
      }
    },
  };
  return probe;
}

/** Instancia única (los eventos se acumulan durante toda la sesión).
 *  En SSR: sonda no-op — el módulo tiene «use client» pero Next lo evalúa
 *  también en el servidor para el HTML inicial. */
const noopProbe: PerfProbeApi = {
  marks: [],
  mark: () => undefined,
  memory: () => ({ heapMB: null, limitMB: null, ts: 0 }),
  longTasks: { count: 0, totalMs: 0, supported: false },
  longTaskEntries: [],
  fpsSample: async () => null,
  report: () => null,
};

export const perfProbe: PerfProbeApi =
  typeof window !== "undefined" ? makeProbe() : noopProbe;

declare global {
  interface Window {
    __perfProbe?: PerfProbeApi;
  }
}

if (typeof window !== "undefined") {
  try {
    window.__perfProbe = perfProbe;
    // longTasks: PerformanceObserver('longtask') con buffer (Chrome/Android —
    // el dispositivo objetivo del plan). v1.1 — soporte EXPLÍCITO: Safari no
    // expone 'longtask' → supported=false y el informe dice "no soportado"
    // (antes quedaba en 0 tareas, que mentía: Safari sí tiene jank, solo
    // que no lo reporta).
    if (typeof PerformanceObserver === "function") {
      try {
        const Ctor = PerformanceObserver as typeof PerformanceObserver & {
          supportedEntryTypes?: readonly string[];
        };
        const declared = Array.isArray(Ctor.supportedEntryTypes)
          ? Ctor.supportedEntryTypes.includes("longtask")
          : null;
        if (declared === false) {
          // El navegador declara que 'longtask' NO existe (Safari moderno):
          // ni se intenta el observe.
        } else {
          const obs = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              perfProbe.longTasks.count += 1;
              perfProbe.longTasks.totalMs += entry.duration;
              // v2-A13 (burst Fase A) — la MISMA entrada, con instante, para
              // poder filtrar congestión por ventana (fired→shot) después.
              perfProbe.longTaskEntries.push({
                start: Math.round(entry.startTime),
                duration: Math.round(entry.duration),
              });
              if (perfProbe.longTaskEntries.length > MAX_LONG_TASK_ENTRIES) {
                perfProbe.longTaskEntries.splice(
                  0,
                  perfProbe.longTaskEntries.length - MAX_LONG_TASK_ENTRIES
                );
              }
            }
          });
          obs.observe({ type: "longtask", buffered: true } as PerformanceObserverInit);
          // El observe fue aceptado → la entrada existe en este navegador.
          perfProbe.longTasks.supported = true;
        }
      } catch {
        /* 'longtask' no soportado → supported queda false */
      }
    }
  } catch {
    /* la sonda NUNCA rompe la app */
  }
}
