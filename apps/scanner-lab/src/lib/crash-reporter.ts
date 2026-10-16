/**
 * EXPERIMENTO v11 — Crash reporter (SOLO observación — NO es una red de seguridad).
 *
 * Escucha `window` "error" y "unhandledrejection" para SABER qué pasa
 * cuando un dispositivo gama baja consume el dato completo (PNG ≤4032)
 * sin copia de pantalla (red de seguridad `displayUrl` APAGADA).
 *
 * ⛔ PROHIBIDO por spec (y no implementado): `preventDefault`,
 * `stopPropagation`, reintentos, resets de estado, fetch a servidores,
 * interceptar `console`. Solo observar, registrar y mostrar — el error
 * debe seguir apareciendo en consola normalmente.
 *
 * Qué hace con cada evento:
 *  1. Anillo persistente `localStorage["scannerlab_crash_ring"]` (máx 10).
 *  2. Array en memoria `window.__crashLog` (los mismos eventos).
 *  3. Banner rojo fijo arriba («toma captura de pantalla») que SOLO se
 *     oculta con su botón — sin animaciones complejas: debe renderizar
 *     incluso con la app medio muerta (por eso usa estilos inline y no
 *     clases CSS que podrían no haber cargado).
 */

type CrashEventRecord = {
  /** ISO timestamp del evento. */
  ts: string;
  type: "error" | "unhandledrejection";
  /** ≤300 chars. */
  message: string;
  source?: string;
  line?: number;
  col?: number;
  /** ≤2000 chars. */
  stack?: string;
  /** Vista activa (window.__scannerView — la sincroniza page.tsx). */
  view?: string;
  ua: string;
  deviceMemory?: number;
  hardwareConcurrency?: number;
  /** performance.memory?.usedJSHeapSize / 1048576 (si existe — Chrome). */
  heapMB?: number;
};

const RING_KEY = "scannerlab_crash_ring";
const RING_MAX = 10;
const BANNER_ID = "scannerlab-crash-banner";
/** D-04 (auditoría leaks-recursos) — tope FIFO del anillo en memoria
 *  (window.__crashLog): antes crecía sin límite toda la sesión. */
const MEMORY_LOG_MAX = 50;
/** D-04 (auditoría leaks-recursos) — el banner SOLO en modo diagnóstico:
 *  query param `?diag=1` o el opt-in persistido. En producción normal el
 *  error sigue en consola + anillo, sin banner fijo. */
const DIAG_BANNER_KEY = "escaner-diag-banner-v1";
/** D-04 (auditoría leaks-recursos) — ventana de dedup: el mismo mensaje a
 *  menos de 10 s del último record no repite banner ni persistencia. */
const DEDUP_WINDOW_MS = 10_000;

let installed = false;

/** D-04 — ¿modo diagnóstico activo? No hay mecanismo previo en el repo
 *  (verificado con grep): gate por `?diag=1` u opt-in en localStorage. */
function isDiagBannerEnabled(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get("diag") === "1") return true;
    return localStorage.getItem(DIAG_BANNER_KEY) === "1";
  } catch {
    return false;
  }
}

function memoryLog(): CrashEventRecord[] {
  const w = window as unknown as { __crashLog?: CrashEventRecord[] };
  if (!Array.isArray(w.__crashLog)) w.__crashLog = [];
  return w.__crashLog;
}

function readRing(): CrashEventRecord[] {
  try {
    const raw = localStorage.getItem(RING_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as CrashEventRecord[]) : [];
  } catch {
    return [];
  }
}

function persistRing(ring: CrashEventRecord[]): void {
  try {
    localStorage.setItem(RING_KEY, JSON.stringify(ring));
  } catch {
    // Spec: si localStorage falla, solo console.error.
    console.error(
      "[crash-reporter] localStorage no disponible — el registro queda solo en window.__crashLog"
    );
  }
}

function clip(s: string | undefined, max: number): string | undefined {
  if (typeof s !== "string" || s.length === 0) return undefined;
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function buildRecord(
  type: "error" | "unhandledrejection",
  ev: ErrorEvent | PromiseRejectionEvent
): CrashEventRecord {
  const w = window as unknown as { __scannerView?: string };
  const nav = navigator as Navigator & { deviceMemory?: number };
  const perf = performance as Performance & {
    memory?: { usedJSHeapSize?: number };
  };

  let message = "";
  let stack: string | undefined;
  let source: string | undefined;
  let line: number | undefined;
  let col: number | undefined;

  if (type === "error") {
    const e = ev as ErrorEvent;
    message = e.message || String(e.error ?? "Error desconocido");
    stack = e.error instanceof Error ? e.error.stack : undefined;
    if (e.filename) source = e.filename;
    if (typeof e.lineno === "number" && e.lineno > 0) line = e.lineno;
    if (typeof e.colno === "number" && e.colno > 0) col = e.colno;
  } else {
    const e = ev as PromiseRejectionEvent;
    const r: unknown = e.reason;
    if (r instanceof Error) {
      message = r.message || String(r);
      stack = r.stack;
    } else if (typeof r === "string") {
      message = r;
    } else {
      try {
        message = JSON.stringify(r) ?? String(r);
      } catch {
        message = String(r);
      }
    }
  }

  const heapMB =
    perf.memory && typeof perf.memory.usedJSHeapSize === "number"
      ? Math.round((perf.memory.usedJSHeapSize / 1048576) * 10) / 10
      : undefined;

  return {
    ts: new Date().toISOString(),
    type,
    message: clip(message, 300) ?? "Error desconocido",
    source,
    line,
    col,
    stack: clip(stack, 2000),
    view: w.__scannerView,
    ua: navigator.userAgent,
    deviceMemory:
      typeof nav.deviceMemory === "number" && nav.deviceMemory > 0
        ? nav.deviceMemory
        : undefined,
    hardwareConcurrency:
      typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : undefined,
    heapMB,
  };
}

function showBanner(rec: CrashEventRecord): void {
  // D-04 (auditoría leaks-recursos): gate de modo diagnóstico — la primera
  // excepción benigna en producción ya no pinta el banner fijo rojo.
  if (!isDiagBannerEnabled()) return;
  try {
    if (typeof document === "undefined" || !document.body) return;

    let root = document.getElementById(BANNER_ID);
    if (!root) {
      root = document.createElement("div");
      root.id = BANNER_ID;
      root.setAttribute("role", "alert");
      root.setAttribute("aria-live", "assertive");
      // Estilos INLINE a propósito (equivale a Tailwind `fixed top-0
      // inset-x-0 z-[9999] bg-red-900`): el banner debe pintar incluso
      // con la app medio muerta — sin depender de que el CSS haya cargado.
      const s = root.style;
      s.position = "fixed";
      s.top = "0";
      s.left = "0";
      s.right = "0";
      s.zIndex = "9999";
      s.boxSizing = "border-box";
      s.background = "#7f1d1d"; // bg-red-900
      s.color = "#ffffff";
      s.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
      s.fontSize = "12px";
      s.lineHeight = "1.5";
      s.padding =
        "calc(8px + env(safe-area-inset-top, 0px)) 12px 10px 12px";
      s.wordBreak = "break-word";
      document.body.appendChild(root);
    }

    // Un solo banner a la vez: si llega otro evento, REEMPLAZA el contenido.
    root.textContent = "";
    root.style.display = "block";

    const title = document.createElement("strong");
    title.style.display = "block";
    title.style.fontSize = "13px";
    title.style.marginBottom = "4px";
    title.textContent = "⛔ ERROR CAPTURADO — toma captura de pantalla";
    root.appendChild(title);

    const body = document.createElement("div");
    body.textContent = `${rec.type} · ${rec.message} · view=${rec.view ?? "?"} · ${rec.ts}`;
    root.appendChild(body);

    const meta = document.createElement("div");
    meta.style.opacity = "0.85";
    meta.style.marginTop = "2px";
    const parts: string[] = [];
    if (rec.heapMB !== undefined) parts.push(`heap≈${rec.heapMB}MB`);
    if (rec.deviceMemory !== undefined) parts.push(`deviceMemory=${rec.deviceMemory}`);
    if (rec.source) parts.push(`${rec.source}:${rec.line ?? 0}:${rec.col ?? 0}`);
    if (parts.length > 0) {
      meta.textContent = parts.join(" · ");
      root.appendChild(meta);
    }

    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Cerrar";
    const cs = close.style;
    cs.marginTop = "8px";
    cs.padding = "6px 16px";
    cs.background = "#ffffff";
    cs.color = "#7f1d1d"; // bg-red-900
    cs.border = "none";
    cs.borderRadius = "8px";
    cs.font = "inherit";
    cs.fontWeight = "600";
    cs.cursor = "pointer";
    // El botón SOLO oculta el banner — el anillo persiste.
    close.addEventListener("click", () => {
      root!.style.display = "none";
    });
    root.appendChild(close);
  } catch {
    /* Si ni el DOM responde, el anillo + window.__crashLog ya quedaron. */
  }
}

function record(rec: CrashEventRecord): void {
  const log = memoryLog();
  const last = log[log.length - 1];
  // D-04 (auditoría leaks-recursos) — dedup básico: el mismo mensaje a
  // menos de 10 s del último record solo hace push al log en memoria
  // (sin re-persistir el anillo ni repetir el banner).
  const isDup =
    last !== undefined &&
    last.message === rec.message &&
    Date.now() - Date.parse(last.ts) < DEDUP_WINDOW_MS;
  log.push(rec);
  // D-04 — cap FIFO: __crashLog acotado a los últimos 50 eventos.
  if (log.length > MEMORY_LOG_MAX) log.splice(0, log.length - MEMORY_LOG_MAX);
  if (isDup) return;
  const ring = readRing();
  ring.push(rec);
  persistRing(ring.slice(-RING_MAX));
  showBanner(rec);
}

/**
 * Instala el crash reporter (idempotente). Llamar lo más temprano
 * posible en el cliente — `page.tsx` lo hace a nivel de módulo.
 */
export function installCrashReporter(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (ev: ErrorEvent) => {
    record(buildRecord("error", ev));
  });

  window.addEventListener("unhandledrejection", (ev: PromiseRejectionEvent) => {
    record(buildRecord("unhandledrejection", ev));
  });
}
