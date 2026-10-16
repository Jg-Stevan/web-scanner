"use client";

/**
 * DIAG — device-profile: snapshot del dispositivo + benchmarks MEDIDOS
 * (spec diag §4). 100 % local, sin red, sin dependencias npm nuevas.
 *
 * Regla de oro (§4): el navegador no da el modelo de CPU ni sensores
 * térmicos → NO se adivinan: se miden las operaciones REALES del pipeline
 * (downscale/encode/decode/worker) porque predicen el rendimiento mejor
 * que el nombre del chip.
 *
 * · Snapshot (§4a): barato y asíncrono (UA data, GPU por WebGPU/WebGL,
 *   refresh medido por rAF, storage, batería, red, heap límite).
 * · Benchmarks (§4b): mediana de 3 corridas, try/catch INDIVIDUAL (un
 *   bench que falla = campo null, nunca excepción visible), cacheados en
 *   localStorage "scannerlab-diag-bench-v1" con TTL de 7 días.
 * · Programación: requestIdleCallback (fallback setTimeout 3000) tras el
 *   arranque, JAMÁS con la pestaña en background y nunca antes del primer
 *   render útil (lo programa scheduleDiagIdle desde page.tsx).
 * · Memoria: TODO canvas/blob/worker se libera al terminar.
 */

/* ------------------------------------------------------------------ */
/* Tipos                                                                */
/* ------------------------------------------------------------------ */

export interface DiagDeviceSnapshot {
  model: string | null;
  os: string | null;
  osVersion: string | null;
  browser: string | null;
  browserVersion: string | null;
  architecture: string | null;
  cores: number | null;
  ramGB: number | null;
  gpuRenderer: string | null;
  maxTextureSize: number | null;
  screen: {
    w: number;
    h: number;
    dpr: number;
    colorDepth: number | null;
    refreshHz: number | null;
  };
  storage: { usageMB: number | null; quotaMB: number | null } | null;
  battery: { level: number; charging: boolean } | null;
  network: {
    effectiveType: string | null;
    downlink: number | null;
    rtt: number | null;
    saveData: boolean | null;
  } | null;
  heapLimitMB: number | null;
  capturedAt: number;
}

export interface DiagBenchResults {
  cpuBenchMs: number | null;
  canvasDownscale2048Ms: number | null;
  canvasDownscale3200Ms: number | null;
  jpegEncodeMs: number | null;
  decodeMs: number | null;
  maxCanvasPx: number | null;
}

export interface DiagBenchCache {
  ts: number;
  results: DiagBenchResults;
}

/** Clave de caché de benchmarks (TTL 7 días, spec §4b). */
const BENCH_CACHE_KEY = "scannerlab-diag-bench-v1";
const BENCH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Snapshot del dispositivo (§4a)                                       */
/* ------------------------------------------------------------------ */

interface UaData {
  model: string | null;
  platform: string | null;
  platformVersion: string | null;
  architecture: string | null;
  osName: string | null;
  osVersion: string | null;
  browserName: string | null;
  browserVersion: string | null;
}

/** userAgentData.getHighEntropyValues (Android/Chrome) con fallback a
 *  parsear el userAgent clásico. Nunca lanza. */
async function readUaData(): Promise<UaData> {
  // Limpieza: una cadena vacía del navegador se reporta como null (—).
  const clean = (s: unknown): string | null =>
    typeof s === "string" && s.length > 0 ? s : null;
  const out: UaData = {
    model: null,
    platform: null,
    platformVersion: null,
    architecture: null,
    osName: null,
    osVersion: null,
    browserName: null,
    browserVersion: null,
  };
  try {
    const nav = navigator as Navigator & {
      userAgentData?: {
        getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>;
        platform?: string;
        brands?: Array<{ brand: string; version: string }>;
      };
    };
    const uad = nav.userAgentData;
    if (uad?.getHighEntropyValues) {
      const v = await uad.getHighEntropyValues([
        "model",
        "platform",
        "platformVersion",
        "architecture",
        "fullVersionList",
      ]);
      out.model = clean(v.model);
      out.platform = clean(v.platform);
      out.platformVersion = clean(v.platformVersion);
      out.architecture = clean(v.architecture);
      out.osName = clean(v.platform);
      out.osVersion = clean(v.platformVersion);
      const list = v.fullVersionList;
      if (Array.isArray(list) && list.length > 0) {
        // La marca real (no los placeholder "Not A Brand") con su versión.
        const real = list.find(
          (b) =>
            typeof b?.brand === "string" &&
            !/not.?a.?brand/i.test(b.brand) &&
            b.brand !== "Chromium"
        );
        const chosen = real ?? list.find((b) => b?.brand === "Chromium") ?? list[0];
        if (chosen) {
          out.browserName = chosen.brand;
          out.browserVersion = chosen.version ?? null;
        }
      }
    } else {
      out.osName = uad?.platform ?? null;
    }
  } catch {
    /* sin userAgentData: queda el parse del UA clásico */
  }
  // Fallback clásico: iOS/Safari y navegadores sin UA-CH.
  try {
    const ua = navigator.userAgent;
    if (!out.osName) {
      if (/iPhone|iPad|iPod/i.test(ua)) out.osName = "iOS";
      else if (/Android/i.test(ua)) out.osName = "Android";
      else if (/Windows/i.test(ua)) out.osName = "Windows";
      else if (/Mac OS X/i.test(ua)) out.osName = "macOS";
      else if (/Linux/i.test(ua)) out.osName = "Linux";
    }
    if (!out.osVersion) {
      const m =
        /OS (\d+[_\d]*)/i.exec(ua) ??
        /Android (\d+[\d.]*)/.exec(ua) ??
        /Windows NT ([\d.]+)/.exec(ua) ??
        /Mac OS X (\d+[_\d]*)/.exec(ua);
      if (m?.[1]) out.osVersion = m[1].replace(/_/g, ".");
    }
    if (!out.browserName) {
      if (/Edg\//.test(ua)) out.browserName = "Edge";
      else if (/OPR\//.test(ua)) out.browserName = "Opera";
      else if (/Firefox\//.test(ua)) out.browserName = "Firefox";
      else if (/Chrome\//.test(ua)) out.browserName = "Chrome";
      else if (/Safari\//.test(ua)) out.browserName = "Safari";
    }
    if (!out.browserVersion) {
      const m = /(?:Version|Edg|OPR|Firefox|Chrome|CriOS|FxiOS)\/([\d.]+)/.exec(ua);
      if (m?.[1]) out.browserVersion = m[1];
    }
    if (!out.model && /iPhone|iPad|iPod|Android/i.test(ua)) {
      // Solo si el UA trae un modelo explícito (p.ej. algunos Android).
      const m = /Android[^;)]*;\s*([^;)]+?)\s+(Build|AppleWebKit)/i.exec(ua);
      if (m?.[1] && !/^android$/i.test(m[1])) out.model = m[1].trim();
    }
  } catch {
    /* best-effort */
  }
  return out;
}

/** GPU renderer + MAX_TEXTURE_SIZE: WebGPU adapter.info si existe,
 *  fallback WEBGL_debug_renderer_info. Nunca lanza. */
async function readGpu(): Promise<{ renderer: string | null; maxTextureSize: number | null }> {
  // 1) WebGPU (la API moderna — Chrome/Android).
  try {
    const nav = navigator as Navigator & {
      gpu?: {
        requestAdapter: () => Promise<
          | (unknown & {
              info?: { vendor?: string; architecture?: string; device?: string; description?: string };
              requestAdapterInfo?: () => Promise<{ vendor?: string; architecture?: string; device?: string; description?: string }>;
            })
          | null
        >;
      };
    };
    if (nav.gpu?.requestAdapter) {
      const adapter = await nav.gpu.requestAdapter();
      if (adapter) {
        const a = adapter as NonNullable<Awaited<ReturnType<typeof nav.gpu.requestAdapter>>>;
        let info = a.info;
        if (!info && typeof a.requestAdapterInfo === "function") {
          try {
            info = await a.requestAdapterInfo();
          } catch {
            info = undefined;
          }
        }
        if (info) {
          const parts = [info.vendor, info.architecture, info.device].filter(
            (p): p is string => typeof p === "string" && p.length > 0
          );
          const renderer = parts.join(" ") || info.description || null;
          if (renderer) return { renderer, maxTextureSize: null };
        }
      }
    }
  } catch {
    /* cae al fallback WebGL */
  }
  // 2) WebGL (universal).
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ??
      canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (gl) {
      let renderer: string | null = null;
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      if (dbg) {
        const unmasked = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
        if (typeof unmasked === "string" && unmasked) renderer = unmasked;
      }
      if (!renderer) {
        const plain = gl.getParameter(gl.RENDERER);
        if (typeof plain === "string" && plain) renderer = plain;
      }
      const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      canvas.width = 0;
      canvas.height = 0;
      return {
        renderer,
        maxTextureSize: typeof maxTex === "number" ? maxTex : null,
      };
    }
  } catch {
    /* sin WebGL */
  }
  return { renderer: null, maxTextureSize: null };
}

/** Refresh REAL: muestrea deltas de requestAnimationFrame ~1 s y devuelve
 *  la mediana en Hz redondeada al estándar (60/90/120/144). */
async function measureRefreshHz(): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      if (typeof requestAnimationFrame !== "function") {
        resolve(null);
        return;
      }
      const deltas: number[] = [];
      let last = performance.now();
      const deadline = last + 1000;
      const tick = () => {
        const now = performance.now();
        const d = now - last;
        last = now;
        if (d > 0.5 && d < 500) deltas.push(d); // ignora pausas del GC/tab
        if (now < deadline) {
          requestAnimationFrame(tick);
          return;
        }
        if (deltas.length < 5) {
          resolve(null);
          return;
        }
        deltas.sort((a, b) => a - b);
        const median = deltas[Math.floor(deltas.length / 2)]!;
        let hz = Math.round(1000 / median);
        const standard = [60, 90, 120, 144];
        for (const s of standard) {
          if (Math.abs(hz - s) <= 4) {
            hz = s;
            break;
          }
        }
        resolve(hz > 0 && hz <= 480 ? hz : null);
      };
      requestAnimationFrame(tick);
    } catch {
      resolve(null);
    }
  });
}

/** v1.1 — Batería del Battery Status API. El bug del lote 1-2 (salía null
 *  en TODO, incluido Chrome Android donde EXISTE): la llamada estaba
 *  DETACHADA del receiver (`const fn = navigator.getBattery; fn()`) →
 *  "Illegal invocation" en Chrome → catch silencioso → null. Ahora SIEMPRE
 *  se llama como método de `navigator`. Best-effort: null si no existe. */
export async function readBattery(): Promise<{
  level: number;
  charging: boolean;
} | null> {
  try {
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{ level: number; charging: boolean }>;
    };
    if (typeof nav.getBattery !== "function") return null;
    const b = await nav.getBattery();
    return {
      level: Math.round(b.level * 100),
      charging: b.charging === true,
    };
  } catch {
    return null;
  }
}

/** Snapshot completo del dispositivo (§4a). Cada campo con try/catch
 *  propio: lo que no exista queda null (— en el informe). */
export async function snapshotDevice(): Promise<DiagDeviceSnapshot> {
  const snap: DiagDeviceSnapshot = {
    model: null,
    os: null,
    osVersion: null,
    browser: null,
    browserVersion: null,
    architecture: null,
    cores: null,
    ramGB: null,
    gpuRenderer: null,
    maxTextureSize: null,
    screen: { w: 0, h: 0, dpr: 1, colorDepth: null, refreshHz: null },
    storage: null,
    battery: null,
    network: null,
    heapLimitMB: null,
    capturedAt: Date.now(),
  };
  const ua = await readUaData();
  snap.model = ua.model;
  snap.os = ua.osName;
  snap.osVersion = ua.osVersion;
  snap.browser = ua.browserName;
  snap.browserVersion = ua.browserVersion;
  snap.architecture = ua.architecture;
  try {
    snap.cores =
      typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency > 0
        ? navigator.hardwareConcurrency
        : null;
  } catch {
    /* — */
  }
  try {
    const dm = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    snap.ramGB = typeof dm === "number" && dm > 0 ? dm : null;
  } catch {
    /* iOS sin deviceMemory — */
  }
  const gpu = await readGpu();
  snap.gpuRenderer = gpu.renderer;
  snap.maxTextureSize = gpu.maxTextureSize;
  try {
    snap.screen.w = screen?.width ?? 0;
    snap.screen.h = screen?.height ?? 0;
    snap.screen.dpr = window.devicePixelRatio || 1;
    snap.screen.colorDepth = typeof screen?.colorDepth === "number" ? screen.colorDepth : null;
  } catch {
    /* — */
  }
  snap.screen.refreshHz = await measureRefreshHz();
  try {
    const est = await navigator.storage?.estimate?.();
    if (est && (typeof est.usage === "number" || typeof est.quota === "number")) {
      snap.storage = {
        usageMB:
          typeof est.usage === "number" ? Math.round((est.usage / 1048576) * 10) / 10 : null,
        quotaMB:
          typeof est.quota === "number" ? Math.round((est.quota / 1048576) * 10) / 10 : null,
      };
    }
  } catch {
    /* — */
  }
  try {
    snap.battery = await readBattery();
  } catch {
    /* — */
  }
  try {
    const c = (
      navigator as Navigator & {
        connection?: {
          effectiveType?: string;
          downlink?: number;
          rtt?: number;
          saveData?: boolean;
        };
      }
    ).connection;
    if (c) {
      snap.network = {
        effectiveType: c.effectiveType ?? null,
        downlink: typeof c.downlink === "number" ? c.downlink : null,
        rtt: typeof c.rtt === "number" ? c.rtt : null,
        saveData: typeof c.saveData === "boolean" ? c.saveData : null,
      };
    }
  } catch {
    /* — */
  }
  try {
    const m = (performance as Performance & {
      memory?: { jsHeapSizeLimit: number };
    }).memory;
    if (m && typeof m.jsHeapSizeLimit === "number") {
      snap.heapLimitMB = Math.round(m.jsHeapSizeLimit / 1048576);
    }
  } catch {
    /* — */
  }
  snap.capturedAt = Date.now();
  return snap;
}

/* ------------------------------------------------------------------ */
/* Benchmarks (§4b) — mediana de 3, try/catch individual, cacheados      */
/* ------------------------------------------------------------------ */

/** CPU single-core en un Web Worker creado desde Blob URL (sin dep en el
 *  bundle): 5M iteraciones de aritmética entera + una pasada de string
 *  concat. Determinista y a prueba de dead-code-elimination. */
async function benchCpuWorker(): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      const src = `
self.onmessage = (e) => {
  if (e.data !== "run") return;
  const t0 = performance.now();
  let x = 0 | 0;
  for (let i = 0; i < 5000000; i++) { x = (x + i * 31 + 7) | 0; }
  let s = "";
  for (let i = 0; i < 20000; i++) { s += (i % 10).toString(); }
  const ms = performance.now() - t0;
  self.postMessage({ ms, check: x, len: s.length });
};`;
      const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      const worker = new Worker(url);
      const timeout = window.setTimeout(() => {
        try {
          worker.terminate();
        } catch {
          /* — */
        }
        URL.revokeObjectURL(url);
        resolve(null);
      }, 20_000);
      worker.onmessage = (ev: MessageEvent<{ ms?: number }>) => {
        window.clearTimeout(timeout);
        try {
          worker.terminate();
        } catch {
          /* — */
        }
        URL.revokeObjectURL(url);
        const ms = ev.data?.ms;
        resolve(typeof ms === "number" && ms > 0 ? Math.round(ms) : null);
      };
      worker.onerror = () => {
        window.clearTimeout(timeout);
        try {
          worker.terminate();
        } catch {
          /* — */
        }
        URL.revokeObjectURL(url);
        resolve(null);
      };
      worker.postMessage("run");
    } catch {
      resolve(null);
    }
  });
}

/** Canvas sintético determinista 4032×3024 (gradiente + rectángulos, sin
 *  descargas) — la fuente de los benches de downscale. */
function makeSourceCanvas(): HTMLCanvasElement | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 4032;
    canvas.height = 3024;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      canvas.width = 0;
      return null;
    }
    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    grad.addColorStop(0, "#101820");
    grad.addColorStop(0.5, "#7a8b99");
    grad.addColorStop(1, "#e8e2d5");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Rectángulos deterministas (como texto/tablas de un documento).
    for (let i = 0; i < 24; i += 1) {
      const x = (i * 977) % 3600;
      const y = (i * 613) % 2400;
      ctx.fillStyle = i % 2 === 0 ? "#1c1c1e" : "#f5f5f0";
      ctx.fillRect(200 + x, 150 + y, 420, 90);
    }
    return canvas;
  } catch {
    return null;
  }
}

/** Downscale 4032→{destLong} con imageSmoothingQuality 'high' — la
 *  operación clave del editor (2048) y del futuro tier low (3200). */
async function benchDownscale(src: HTMLCanvasElement, destLong: number): Promise<number | null> {
  try {
    const t0 = performance.now();
    const dest = document.createElement("canvas");
    const scale = destLong / Math.max(src.width, src.height);
    dest.width = Math.round(src.width * scale);
    dest.height = Math.round(src.height * scale);
    const ctx = dest.getContext("2d");
    if (!ctx) {
      dest.width = 0;
      return null;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, dest.width, dest.height);
    const ms = Math.round(performance.now() - t0);
    dest.width = 0;
    dest.height = 0;
    return ms > 0 ? ms : null;
  } catch {
    return null;
  }
}

/** JPEG encode (toBlob q0.92) del canvas 3200 — coste por página guardada. */
function benchJpegEncode(canvas: HTMLCanvasElement): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      const t0 = performance.now();
      canvas.toBlob(
        (blob) => {
          const ms = Math.round(performance.now() - t0);
          if (blob && blob.size > 0 && ms > 0) {
            lastEncodeBlob = blob;
            resolve(ms);
          } else {
            resolve(null);
          }
        },
        "image/jpeg",
        0.92
      );
    } catch {
      resolve(null);
    }
  });
}

/** Decode (createImageBitmap) del blob JPEG 3200 — coste al abrir/exportar. */
async function benchDecode(blob: Blob): Promise<number | null> {
  try {
    const t0 = performance.now();
    const bmp = await createImageBitmap(blob);
    const ms = Math.round(performance.now() - t0);
    bmp.close();
    return ms > 0 ? ms : null;
  } catch {
    return null;
  }
}

/** El blob del último encode válido (entrada del bench de decode). */
let lastEncodeBlob: Blob | null = null;

/** Canvas máximo verificado: sondeo 4096→8192→16384 (crear + getContext OK). */
function benchMaxCanvas(): number | null {
  const sizes = [4096, 8192, 16384];
  let max: number | null = null;
  for (const px of sizes) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = px;
      canvas.height = px;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        canvas.width = 0;
        break;
      }
      max = px;
      canvas.width = 0;
      canvas.height = 0;
    } catch {
      break;
    }
  }
  return max;
}

/** Mediana de 3 corridas de un medidor asíncrono. */
async function medianOf3(fn: () => Promise<number | null>): Promise<number | null> {
  try {
    const runs: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const ms = await fn();
      if (ms !== null && ms > 0) runs.push(ms);
    }
    if (runs.length === 0) return null;
    runs.sort((a, b) => a - b);
    return runs[Math.floor(runs.length / 2)]!;
  } catch {
    return null;
  }
}

/** Lee la caché de benchmarks (null si no existe o está corrupta). */
export function getBenchCache(): DiagBenchCache | null {
  try {
    const raw = localStorage.getItem(BENCH_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DiagBenchCache;
    if (typeof parsed?.ts !== "number" || !parsed.results) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeBenchCache(results: DiagBenchResults): void {
  try {
    localStorage.setItem(
      BENCH_CACHE_KEY,
      JSON.stringify({ ts: Date.now(), results } satisfies DiagBenchCache)
    );
  } catch {
    /* sin localStorage (privada): la medición vive solo en memoria */
  }
}

let benchResults: DiagBenchResults | null = null;
let benchRunning: Promise<DiagBenchResults> | null = null;

/** Ejecuta TODOS los benchmarks (§4b). Con force=false usa la caché si
 *  es fresca (<7 días); con force=true re-mide siempre (~2 s, repartido).
 *  Cada bench en try/catch individual: fallo = null, jamás excepción. */
export async function runBenchmarks(force = false): Promise<DiagBenchResults> {
  if (!force) {
    if (benchResults) return benchResults;
    const cached = getBenchCache();
    if (cached && Date.now() - cached.ts < BENCH_TTL_MS) {
      benchResults = cached.results;
      return cached.results;
    }
  }
  if (benchRunning && !force) return benchRunning;
  const task = (async (): Promise<DiagBenchResults> => {
    const results: DiagBenchResults = {
      cpuBenchMs: null,
      canvasDownscale2048Ms: null,
      canvasDownscale3200Ms: null,
      jpegEncodeMs: null,
      decodeMs: null,
      maxCanvasPx: null,
    };
    // 1) CPU single-core (worker propio, sin tocar el hilo de la app).
    results.cpuBenchMs = await medianOf3(benchCpuWorker);
    // 2-5) Pipeline de canvas: fuente 4032 sintética → downscale 2048/3200
    // → encode JPEG del 3200 → decode del blob. Todo se libera al final.
    const src = makeSourceCanvas();
    if (src) {
      results.canvasDownscale2048Ms = await medianOf3(() => benchDownscale(src, 2048));
      // El encode necesita el canvas destino 3200 en vivo: una corrida
      // dedicada que fabrica el destino, lo mide y lo libera.
      results.canvasDownscale3200Ms = await medianOf3(() => benchDownscale(src, 3200));
      const enc = await (async () => {
        try {
          const dest = document.createElement("canvas");
          const scale = 3200 / Math.max(src.width, src.height);
          dest.width = Math.round(src.width * scale);
          dest.height = Math.round(src.height * scale);
          const ctx = dest.getContext("2d");
          if (!ctx) {
            dest.width = 0;
            return null;
          }
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(src, 0, 0, dest.width, dest.height);
          const ms = await medianOf3(() => benchJpegEncode(dest));
          dest.width = 0;
          dest.height = 0;
          return ms;
        } catch {
          return null;
        }
      })();
      results.jpegEncodeMs = enc;
      if (lastEncodeBlob) {
        results.decodeMs = await medianOf3(() => benchDecode(lastEncodeBlob!));
        try {
          lastEncodeBlob = null; // libera la referencia al blob de prueba
        } catch {
          /* — */
        }
      }
      src.width = 0;
      src.height = 0;
    }
    // 6) Canvas máximo verificado.
    results.maxCanvasPx = benchMaxCanvas();
    benchResults = results;
    writeBenchCache(results);
    return results;
  })();
  if (!force) benchRunning = task;
  try {
    return await task;
  } finally {
    if (!force) benchRunning = null;
  }
}

/* ------------------------------------------------------------------ */
/* Heap pico (JS) — sampler ligero mientras la pestaña está visible      */
/* ------------------------------------------------------------------ */

let peakHeapMB: number | null = null;

function sampleHeap(): void {
  try {
    const m = (performance as Performance & {
      memory?: { usedJSHeapSize: number };
    }).memory;
    if (m && typeof m.usedJSHeapSize === "number") {
      const mb = Math.round(m.usedJSHeapSize / 1048576);
      if (peakHeapMB === null || mb > peakHeapMB) peakHeapMB = mb;
    }
  } catch {
    /* — */
  }
}

/** Heap pico observado durante la sesión (null si el navegador no expone
 *  performance.memory — p.ej. Safari). */
export function getPeakHeapMB(): number | null {
  sampleHeap();
  return peakHeapMB;
}

/* ------------------------------------------------------------------ */
/* Programación en idle (nunca bloquea el arranque)                     */
/* ------------------------------------------------------------------ */

/** Cachea el snapshot de dispositivo en memoria (lo usa el informe). */
let snapshotCache: DiagDeviceSnapshot | null = null;

/** D-11 (auditoría leaks-recursos) — estado del sampler de heap a nivel de
 *  módulo: el id del intervalo (antes se perdía — intervalo huérfano sin
 *  nadie que lo limpie) y el guard de idempotencia de scheduleDiagIdle
 *  (dos llamadas = dos intervalos + dos listeners visibilitychange). */
let diagSamplerIntervalId: number | null = null;
let diagIdleScheduled = false;

/** Snapshot cacheado en memoria; lo toma fresco si aún no existe. */
export async function getDeviceSnapshot(): Promise<DiagDeviceSnapshot> {
  if (snapshotCache) return snapshotCache;
  snapshotCache = await snapshotDevice();
  return snapshotCache;
}

/** Programa la medición completa (snapshot + benchmarks si están fríos)
 *  en idle tras el arranque. JAMÁS con la pestaña en background (el
 *  refresh Hz y los benches medirían mentiras) — en ese caso espera a
 *  que la pestaña vuelva a estar visible. Se llama desde page.tsx. */
export function scheduleDiagIdle(): void {
  if (typeof window === "undefined") return;
  // D-11 (auditoría leaks-recursos) — guard de idempotencia: una segunda
  // llamada NO agenda otro sampler/otro listener (el intervalo anterior
  // quedaba huérfano: dos intervalos + dos listeners por sesión).
  if (diagIdleScheduled || diagSamplerIntervalId !== null) return;
  diagIdleScheduled = true;
  const start = () => {
    // Sampler de heap pico: cada 5 s, solo con la pestaña visible.
    // D-11: el id se guarda en módulo (stopDiagSampler lo limpia).
    try {
      if (diagSamplerIntervalId === null) {
        diagSamplerIntervalId = window.setInterval(() => {
          if (document.visibilityState === "visible") sampleHeap();
        }, 5000);
      }
    } catch {
      /* — */
    }
    void getDeviceSnapshot().catch(() => undefined);
    void runBenchmarks(false).catch(() => undefined);
  };
  const whenVisible = () => {
    if (document.visibilityState === "visible") {
      start();
      return;
    }
    // Background: espera (una vez) a volver a visible.
    try {
      document.addEventListener(
        "visibilitychange",
        () => {
          if (document.visibilityState === "visible") start();
        },
        { once: true }
      );
    } catch {
      /* — */
    }
  };
  try {
    const ric = (window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }).requestIdleCallback;
    if (typeof ric === "function") {
      ric(whenVisible, { timeout: 4000 });
    } else {
      window.setTimeout(whenVisible, 3000);
    }
  } catch {
    window.setTimeout(whenVisible, 3000);
  }
}

/** D-11 (auditoría leaks-recursos) — detiene el sampler de heap y limpia
 *  el flag de idempotencia (permite re-programar scheduleDiagIdle).
 *  Exportado para que el host pueda liberar el intervalo cuando lo
 *  necesite (hoy nadie lo llama — igual que installCrashReporter queda
 *  disponible). */
export function stopDiagSampler(): void {
  if (diagSamplerIntervalId !== null) {
    window.clearInterval(diagSamplerIntervalId);
    diagSamplerIntervalId = null;
  }
  diagIdleScheduled = false;
}
