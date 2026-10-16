"use client";

/**
 * PANTALLA 1 — CÁMARA (fondo NEGRO puro) con DETECCIÓN EN VIVO REAL.
 * Clon del diseño 1 del usuario (ver design-specs.md) + pipeline de precisión:
 *  · Frame loop (port del frameLoop.ts del usuario): rVFC/rAF → ImageBitmap
 *    400px transferible → worker OpenCV → corners + métricas → score
 *    compuesto (0.4·nitidez + 0.3·exposición + 0.3·estabilidad) × eccentricidad.
 *  · Auto-captura k-de-n (K=4 de N=6 en 1200 ms, última buena) — constantes
 *    validadas del quality.ts del usuario.
 *  · Cámara sintética (port del fakeCamera.ts del usuario): canvas.captureStream
 *    con wobble sutil de "mano sostenida" — demo REAL sin hardware.
 *  · Overlay del quad con mapeo object-cover exacto (frame → visor).
 *  · Perfil de documento en caliente ({type:'config'} → selectQuad priores).
 *  · Fallbacks en cascada: cámara real → sintética → escena estática demo;
 *    worker real → simulación de estabilidad (la app NUNCA se rompe).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Camera,
  ChevronRight,
  FileDown,
  FileText,
  Flashlight,
  FlashlightOff,
  Gauge,          // ← LOTE 5.7 (restaurado con el puntuador)
  ImagePlus,
  Layers,
  LayoutGrid,
  Loader2,
  Moon,
  MoreVertical,
  Scan,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { nextId, useScannerStore } from "@jg-stevan/scanner-core/store";
import {
  defaultQuad,
  type CapturePage,
  type Quad,
} from "@jg-stevan/scanner-core/types";
import {
  detectDocumentEdges,
  evaluateQuality,
  fileToCaptureDataUrl,
  generateDemoPage,
  getScannerWorker,
  loadImage,
  PROCESSED_MAX_LONG_SIDE,
} from "@jg-stevan/scanner-core/image-processor";
import {
  CameraFrameLoop,
  SyntheticCamera,
  type FrameLoopTelemetry,
} from "@jg-stevan/scanner-core/frame-loop";
import { SHUTTER_SCORE, type ShutterHealth } from "@jg-stevan/scanner-core/quality";
import {
  clampBlobToSafeCap,
  getSensorSafeCap,
  profileSensor,
  type SensorProfile,
} from "@jg-stevan/scanner-core/sensor-profiler";
import { dataUrlBytes } from "@jg-stevan/scanner-core/format";
import { perfProbe } from "@/lib/perf-probe";
import {
  beginBackgroundJob,
  collectBurstPipeMeta,
  endBackgroundJob,
  getBurstConfig,
  isAcquisitionActive,
  makeThumbSampler,
  noteBurstPipeDataUrl,
  noteBurstPipeSniff,
  recordBurst,
  recordVideoTrackSize,
  setAcquisitionActive,
  waitForPhotoBudget,
  watchOrphanPhoto,
  type BurstExitReason,
  type BurstStats,
} from "@/lib/burst-budget";
import { readBlobLongSide } from "@/lib/image-size";

type CameraStatus = "idle" | "live" | "synthetic" | "simulated";

/** FIX v5 (5.5) — umbral de exposición (0-1, fracción de píxeles bien
 *  expuestos) por debajo del cual el modo Auto enciende el torch para el
 *  disparo. Constante local ajustable (empezar en 0.30). */
const AUTO_FLASH_EXPOSURE = 0.3;

/** FIX v5 (5.4) — modo espera: milisegundos SIN documento (corners null)
 *  Y sin interacción del usuario tras los que el análisis baja a 2 fps.
 *  El gasto real es el análisis, no el preview (el stream sigue vivo — el
 *  watchdog de salud del fix v4 4.3 vigila readyState/muted del TRACK y
 *  NO se ve afectado: solo cambia la cadencia de processFrame). */
const STANDBY_AFTER_MS = 30_000;

/* ── Lecciones de compatibilidad del producto (ARQUITECTURA §4) ──────────
 *  E3: presupuesto de píxeles — SOLO anchos/altos IDEAL, sin exact/min ni
 *      ratio (ideal nunca rechaza getUserMedia; over-constraining = fallos).
 *      DUAL PIPELINE v7: el PREVIEW pide 1280×720 (fluido, ~90% menos GPU
 *      en gama baja) y la CAPTURA va a resolución de SENSOR vía takePhoto().
 *  E4: facingMode NO es confiable en iPhone (puede ganar la frontal o
 *      ignorarse) → tras permiso se re-selecciona por LABEL + deviceId
 *      exact, con facingMode como constrain inicial únicamente.
 *  F-LENS v4 (bug v3: "no cambia nada ni el flash" — y codigo-test SÍ
 *  funciona en el MISMO teléfono): dos causas de raíz encontradas al
 *  comparar con el CameraController de codigo-test:
 *      A) v3 sondeaba las demás lentes CON el stream actual aún abierto →
 *         en muchos Android abrir una 2ª cámara con otra activa lanza
 *         NotReadableError → TODAS las sondas fallaban → nunca cambiaba
 *         de lente ni encontraba el LED. codigo-test sondea SECUENCIAL-
 *         MENTE cerrando cada cámara antes de abrir la siguiente y ANTES
 *         de abrir la definitiva (puerto exacto de probeDevice +
 *         chooseMainCamera: autofocus real → mayor resolución).
 *      B) el botón flash se deshabilitaba salvo que getCapabilities()
 *         reportara torch; hay Chrome que NO lo anuncian pero SÍ lo
 *         aplican → ahora el botón está habilitado en cámara real y la
 *         verdad se descubre APLICANDO y leyendo getSettings().torch. */
// ❌ ANTES: const IDEAL_CAPTURE_WIDTH = 3840 — forzaba el stream de la
//    vista en vivo a 4K y congelaba gama baja (el <video> continuo a 4K
//    derrocha GPU: el loop de detección solo procesa a 400 px).
// ✅ AHORA — ARQUITECTURA DUAL PIPELINE (fix v3: resolución consciente de
//    plataforma; fix v6 6.1: detección POSITIVA de Android):
// 1. PREVIEW ligero SOLO donde takePhoto() es FIABLE (Chrome/Android):
//    960×540 + 30 FPS. El loop de detección remuestrea SIEMPRE a 400 px
//    (createImageBitmap resize) → el análisis ve lo mismo desde 540p, y la
//    foto real sale del sensor vía takePhoto() (pilar 2, abajo) → ~44%
//    menos píxeles por frame, menos calor, más fluido en gama baja.
// 2. iOS/Safari: el ORIGINAL de la AUTO-CAPTURA sale del <video> (ring ZSL /
//    snapshot) — con 540p nacían originales de 0.5 MP (foto «de muy baja
//    calidad» en iPhone). El hardware de iPhone aguanta 1920×1440 sin
//    coste de fluidez apreciable → se pide ALTO. El disparo MANUAL sigue
//    por cámara nativa (input capture, 12 MP). Regla E3 intacta: SOLO
//    `ideal`, nunca `exact/min` (no rechaza).
//    FIX v6 (6.1): Safari MODERNO (iOS 17+/26) TAMBIÉN expone ImageCapture
//    (con un takePhoto() que se cuelga) — el reparto de regímenes ya NO
//    puede decidirse por «typeof ImageCapture»: se decide por UA Android
//    (la única plataforma donde takePhoto funciona de verdad). La
//    exclusión de iOS vuelve a ser automática y Android queda igual.
const IS_ANDROID =
  typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
/** takePhoto() fiable SOLO en Android (Chrome). Safari moderno expone
 *  ImageCapture pero takePhoto() se cuelga → NO usar en iOS. */
const CAN_TAKEPHOTO = IS_ANDROID && typeof ImageCapture !== "undefined";
/** LOTE 5 (F5-A) — escalera rápida de photoSettings para takePhoto en
 *  Android. Evidencia cam-lab SM-A135M 2026-10-14: el takePhoto DESNUDO
 *  (sin photoSettings) tarda ~15 s (proceso full-res del ISP) y
 *  2048×1536 tarda ~1.0 s. El desnudo queda como ÚLTIMO recurso (ningún
 *  dispositivo queda peor que hoy: cada peldaño solo se intenta si el
 *  anterior falló RÁPIDO). */
const FOTO_LADDER: Array<{ imageWidth: number; imageHeight: number }> = [
  { imageWidth: 2048, imageHeight: 1536 },
  { imageWidth: 1280, imageHeight: 960 },
];
// LOTE 5.1 — REVERT de F5-B: el preview 1920×1440 en Android ahoga el hilo
// principal en gama baja. Evidencia diag v6 SM-A135M 2026-10-14 15:55: fps
// de cámara 2, long tasks 216/133.4 s, captura→guardada 21.5 s, 0 muestras
// del sampler. El cam-lab medía los fps del STREAM crudo (26.7 @ 1440×1920),
// no el presupuesto por-frame del loop (detección 400 px + histograma 96 px
// + ring ZSL + snapshots). El preview ligero 960×540 vuelve a ser el
// régimen de Android; la foto real llega por la escalera F5-A (~1 s).
// iOS conserva 1920×1440 (allí el disparo manual es input nativo y el
// régimen alto ya es probado).
/** LOTE 5.5 — ¿esta captura va a «calidad primero»? Lee el ajuste del
 *  usuario: "calidad" fuerza el camino full-res (la página NACE a la
 *  resolución del sensor, «como antes»), "rapida" conserva la escalera
 *  2048 + upgrade silencioso (5.3/5.4), y "auto" manda a calidad SOLO a
 *  los equipos con 8+ GB (deviceMemory === 8; el A135M reporta 4).
 *  try/catch: navegador sin datos → rápido. Se lee en cada captura,
 *  NUNCA en render (cero re-renders por el ajuste). */
function isQualityFirstPhoto(): boolean {
  try {
    const mode = useScannerStore.getState().settings.photoMode ?? "auto";
    if (mode === "calidad") return true;
    if (mode === "rapida") return false;
    const dm = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    return CAN_TAKEPHOTO && dm === 8;
  } catch {
    return false;
  }
}
const IDEAL_PREVIEW_WIDTH = CAN_TAKEPHOTO ? 960 : 1920;
const IDEAL_PREVIEW_HEIGHT = CAN_TAKEPHOTO ? 540 : 1440;
/** Tope suave de FPS del preview: «ideal» NO rechaza cámaras que solo
 *  ofrecen 60, solo evita negociar 60 cuando el hardware lo permite. */
const IDEAL_PREVIEW_FPS = 30;
/** 7.2 — objetivo de resolución para la AUTO-CAPTURA en no-Android:
 *  se aplica PROGRESIVAMENTE vía applyConstraints tras abrir (ideal,
 *  E3-compliant — nunca rechaza; el SO entrega su máximo). Android NO:
 *  su foto real va por takePhoto full-sensor y el preview 540p es
 *  intencional (fluidez). */
const AUTO_CAPTURE_IDEAL_WIDTH = 4032;
const AUTO_CAPTURE_IDEAL_HEIGHT = 3024;
const STREAM_UPGRADE_DELAY_MS = 2000;

/** FIX v4 4.5 — tope de lado mayor de las copias del ring ZSL. El ring es
 *  SOLO el fallback de la auto-captura (anti tap-shock): no necesita
 *  resolución completa. Con el stream alto de iOS (1920×1440, fix v3), 8
 *  slots a resolución completa ≈ 88 MB + scratch de ~11 MB a 5 Hz — esa
 *  presión hacía que WebKit matara la capa de video (visor negro en
 *  iPhones modestos). Presupuesto resultante: ≤ 8 × (1280×960×4) ≈ 37 MB. */
const RING_MAX_LONG_SIDE = 1280;
/** 7.3 — fracción de nitidez exigida a un candidato más grande para ganar
 *  al de mayor lapVar: un 4K con ≥85 % de la nitidez del mejor 1280 gana
 *  (los píxeles mandan); por debajo, gana el nítido (anti tap-shock). */
const SHARPNESS_KEEP_RATIO = 0.85;
// 2. LA CAPTURA EN EXCELENTE RESOLUCIÓN (3840px / 12–48 MP) la hace
//    ImageCapture.takePhoto(), que NO DEPENDE de la resolución del
//    <video>: dispara directo al sensor físico a la máxima resolución
//    de la lente (4000×3000 / 3840×2160…) — ver takePhotoBlob().
const BACK_CAMERA_RE = /back|rear|environment|trasera|posterior|arri[eè]re/i;
const FRONT_CAMERA_RE = /front|delantera|anterior|face|facial|selfie/i;

/** F-FLASH v3 — diagnóstico del flash: cubre navegador sin soporte (iPhone:
 *  Safari 17.4+, Chrome/Firefox de iOS no exponen torch; WebViews in-app
 *  tampoco), cámara sin LED (gran angular/macro) y permisos WebView. */
const TORCH_HINT =
  "No se pudo controlar la linterna aquí. Causas típicas: navegador sin " +
  "soporte (en iPhone usa Safari 17.4 o posterior; Chrome/Firefox de iOS " +
  "no lo permiten), cámara abierta sin LED (gran angular o macro) o la " +
  "app corre dentro de otra app (Instagram, WhatsApp…). Cierra el " +
  "escáner y vuelve a abrirlo; si persiste, prueba en otro navegador.";

/** Resultado de sondear UNA cámara (puerto de CameraProbe de codigo-test). */
interface CameraProbeResult {
  deviceId: string;
  label: string;
  focusModes: string[];
  torch: boolean;
  maxWidth: number;
  maxHeight: number;
}

/** Modos de foco que cuentan como autofocus REAL (regla D3 de codigo-test). */
const REAL_AF_MODES = new Set(["continuous", "single-shot"]);

function hasRealAF(modes: string[]): boolean {
  return modes.some((m) => REAL_AF_MODES.has(m.toLowerCase()));
}

function readCapsNum(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Abre UNA cámara SOLO para leer sus capabilities y la CIERRA (puerto de
 *  probeDevice de codigo-test). SIN constraints de resolución en la sonda:
 *  medir el sensor real requiere abrir la cámara "pelada". Devuelve null
 *  si la cámara no se pudo abrir (queda descartada). El `finally` CIERRA
 *  el stream SIEMPRE — nunca hay dos cámaras abiertas a la vez (era la
 *  causa del bug v3: sondas con el stream vivo → NotReadableError).
 *  FIX v5 (5.3): `timeoutMs` opcional — una sonda colgada (getUserMedia
 *  que nunca resuelve, típico en algún driver Android) caduca y devuelve
 *  null; si la apertura llega TARDE, su stream se cierra igualmente para
 *  no dejar la cámara ocupada para siempre. */
async function probeCamera(
  media: MediaDevices,
  deviceId: string,
  label: string,
  timeoutMs = 0
): Promise<CameraProbeResult | null> {
  let stream: MediaStream | null = null;
  let timedOut = false;
  try {
    const opening = media.getUserMedia({
      video: { deviceId: { exact: deviceId } },
      audio: false,
    });
    if (timeoutMs > 0) {
      stream = await Promise.race([
        opening,
        new Promise<null>((resolve) => {
          window.setTimeout(() => {
            timedOut = true;
            resolve(null);
          }, timeoutMs);
        }),
      ]);
      if (timedOut || stream === null) {
        // La sonda caducó: si la apertura resuelve después, cerrarla (sin
        // esto la cámara quedaría abierta y las siguientes sondas darían
        // NotReadableError en cadena).
        void opening
          .then((s) => {
            s.getTracks().forEach((t) => t.stop());
          })
          .catch(() => undefined);
        return null;
      }
    } else {
      stream = await opening;
    }
    const track = stream.getVideoTracks()[0];
    if (!track) return null;
    const caps = (track.getCapabilities?.() ?? {}) as {
      focusMode?: string[];
      torch?: boolean;
      width?: { max?: number };
      height?: { max?: number };
    };
    return {
      deviceId,
      label: label || track.label,
      focusModes: Array.isArray(caps.focusMode) ? caps.focusMode : [],
      torch: caps.torch === true,
      maxWidth: readCapsNum(caps.width?.max),
      maxHeight: readCapsNum(caps.height?.max),
    };
  } catch {
    return null; // cámara ocupada/no accesible → descartada
  } finally {
    stream?.getTracks().forEach((t) => t.stop()); // CIERRA antes de la siguiente
  }
}

/** Elige la cámara principal (puerto de chooseMainCamera de codigo-test):
 *  · Entre traseras con AUTOFOCUS REAL gana la de MAYOR resolución de
 *    sensor (maxWidth×maxHeight) — la principal es siempre el sensor
 *    grande; el torch desempata resoluciones idénticas.
 *  · Sin AF en ninguna (típico iOS, regla D6): grupo de label más SIMPLE
 *    (sin palabras de lente), luego menos palabras, luego más resolución. */
function chooseMainProbe(probes: CameraProbeResult[]): CameraProbeResult | null {
  if (probes.length === 0) return null;
  const backs = probes.filter(
    (p) => BACK_CAMERA_RE.test(p.label) && !FRONT_CAMERA_RE.test(p.label)
  );
  const pool = backs.length > 0 ? backs : probes;
  const byRes = (a: CameraProbeResult, b: CameraProbeResult): number =>
    b.maxWidth * b.maxHeight - a.maxWidth * a.maxHeight;
  const withAf = pool.filter((p) => hasRealAF(p.focusModes));
  if (withAf.length > 0) {
    return [...withAf].sort(
      (a, b) => byRes(a, b) || (a.torch !== b.torch ? (a.torch ? -1 : 1) : 0)
    )[0];
  }
  const lensWords = /ultra|gran angular|wide|angular|tele|teleobjetivo/i;
  const wordCount = (label: string): number =>
    label.split(/\s+/).filter((w) => w.length > 0).length;
  const simples = pool.filter((p) => !lensWords.test(p.label));
  const ranked =
    simples.length > 0
      ? [...simples].sort(
          (a, b) => wordCount(a.label) - wordCount(b.label) || byRes(a, b)
        )
      : [...pool].sort(
          (a, b) => a.label.length - b.label.length || byRes(a, b)
        );
  return ranked[0];
}

/** Telemetría reducida para el UI (throttle ~100 ms). */
interface LiveUi {
  corners: Quad | null;
  score: number | null;
  fps: number;
  searching: boolean;
}

/* ── FIX v5 (5.3) — caché de la cámara principal elegida ──────────────
 *  El arranque sondeaba TODAS las cámaras una por una (abrir, medir,
 *  cerrar) antes de abrir la ganadora: en Android multi-cámara eran
 *  varios segundos de pantalla vacía. La elección se persiste en
 *  localStorage y los arranques siguientes abren la deviceId cacheada
 *  DIRECTAMENTE. Sin TTL (el hardware no cambia); invalidación SOLO por
 *  fallo de apertura (NotFound/NotReadable/…) → borrado y sondeo completo. */
const MAIN_CAMERA_CACHE_KEY = "escaner-main-camera-v1";

interface MainCameraCache {
  deviceId: string;
  label: string;
  /** score = maxWidth×maxHeight (regla D3) — solo telemetría/depuración. */
  score: number;
  at: number;
  torch: boolean;
  focusModes: string[];
  maxWidth: number;
  maxHeight: number;
}

function readMainCameraCache(): MainCameraCache | null {
  try {
    const raw = localStorage.getItem(MAIN_CAMERA_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as MainCameraCache;
    if (!c || typeof c.deviceId !== "string" || c.deviceId === "") return null;
    return c;
  } catch {
    return null; // almacenamiento corrupto/bloqueado — sondeo completo
  }
}

function writeMainCameraCache(p: CameraProbeResult): void {
  try {
    const entry: MainCameraCache = {
      deviceId: p.deviceId,
      label: p.label,
      score: p.maxWidth * p.maxHeight,
      at: Date.now(),
      torch: p.torch,
      focusModes: p.focusModes,
      maxWidth: p.maxWidth,
      maxHeight: p.maxHeight,
    };
    localStorage.setItem(MAIN_CAMERA_CACHE_KEY, JSON.stringify(entry));
  } catch {
    /* cuota llena / modo privado — solo es una caché */
  }
}

function clearMainCameraCache(): void {
  try {
    localStorage.removeItem(MAIN_CAMERA_CACHE_KEY);
  } catch {
    /* idem */
  }
}

/** FIX v5 (5.3) — plazo por sonda (ms): una cámara lenta no puede bloquear
 *  el arranque 10 s; caduca y se sigue con la siguiente. */
const PROBE_TIMEOUT_MS = 2000;

/** FIX v5 (5.2) — suelo de confianza para crear la página con el quad
 *  VIVO en vez del marco completo + re-detección. SHUTTER_SCORE (0,8) es
 *  el umbral del DISPARO automático; para el nacimiento manual basta un
 *  quad estable y visible: el usuario lo vio en el overlay y ese es el
 *  recorte que espera (WYSIWYG). Debajo de 0,6 la detección viva puede
 *  ser basura (mala luz) → más seguro re-detectar en background. */
const LIVE_QUAD_MIN_SCORE = 0.6;

/** FIX v5 (5.2) — deriva media entre dos quads normalizados (0-1), en
 *  fracción de la diagonal de la imagen (√2 normalizada). <2 % = mismo
 *  recorte dentro del ruido de detección → no reemplazar (micro-saltos). */
function quadDrift(a: Quad, b: Quad): number {
  let sum = 0;
  for (let i = 0; i < 4; i += 1) {
    sum += Math.hypot(a[i]!.x - b[i]!.x, a[i]!.y - b[i]!.y);
  }
  return sum / 4 / Math.SQRT2;
}

/** LOTE 5.7.1 (framing persistente) — el meta de perfProbe.mark solo
 *  acepta escalares: el quad viaja aplanado como q0..q7 (x0,y0,…,x3,y3,
 *  fracciones 0-1, 3 decimales). */
function quadMeta(quad: Quad): Record<string, number> {
  const out: Record<string, number> = {};
  quad.forEach((c, i) => {
    out[`q${i * 2}`] = Math.round(c.x * 1000) / 1000;
    out[`q${i * 2 + 1}`] = Math.round(c.y * 1000) / 1000;
  });
  return out;
}

/** FIX v5 (5.2) — dimensiones NATURALES de una fuente de captura (imagen
 *  o canvas). Helpers separados: el narrowing de instanceof solo es fiable
 *  sobre un parámetro fresco tipado como la unión (en el scope de captura,
 *  el CFA ya estrecha `source` a HTMLImageElement). */
function sourceNaturalWidth(src: HTMLImageElement | HTMLCanvasElement): number {
  return src instanceof HTMLImageElement ? src.naturalWidth : src.width;
}

function sourceNaturalHeight(src: HTMLImageElement | HTMLCanvasElement): number {
  return src instanceof HTMLImageElement ? src.naturalHeight : src.height;
}

/** Trapecio con jitter leve — fallback simulado mientras no hay worker. */
function jitteredQuad(): Quad {
  const j = (v: number) => Math.min(0.97, Math.max(0.03, v + (Math.random() - 0.5) * 0.02));
  const q = defaultQuad();
  return [
    { x: j(q[0].x), y: j(q[0].y) },
    { x: j(q[1].x), y: j(q[1].y) },
    { x: j(q[2].x), y: j(q[2].y) },
    { x: j(q[3].x), y: j(q[3].y) },
  ];
}

/** Reduce imágenes enormes de galería para no reventar la memoria del store.
 *  Tope técnico único 4032 px (fix v3 — antes el tope por gama del benchmark
 *  re-escalaba la foto nativa de gamas media/baja a 3200 y degradaba la
 *  FUENTE para siempre). 4032×3024 ≈ 12.2 MP decodifica y dibuja bien
 *  incluso en iOS (límite de canvas ~16.7 MP); los sensores gigantes
 *  (48/108 MP) siguen protegidos por el sensor-profiler + este downscale.
 *  Recibe el elemento YA decodificado (decode único de la captura) y devuelve
 *  null si no hace falta re-escalar. */
/** C13: ahora ASÍNCRONA con toBlob (no bloquea el hilo ~1 s con imports de
 *  48 MP — mismo patrón canvasToDataUrl de más abajo). */
async function downscaleImage(
  img: HTMLImageElement,
  max = 4032
): Promise<string | null> {
  const big = Math.max(img.naturalWidth || 0, img.naturalHeight || 0);
  if (big <= max || !big) return null;
  const scale = max / big;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  try {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.95)
    );
    if (blob && blob.size > 0) {
      return await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(new Error("FileReader falló"));
        fr.readAsDataURL(blob);
      });
    }
  } catch {
    /* respaldo abajo */
  }
  try {
    return canvas.toDataURL("image/jpeg", 0.95);
  } catch {
    return null;
  }
}

/* ── Burst §5.4 — helpers de módulo (medición SIN encode/decode extra) ── */

/** Medidas de una candidata del burst: varianza del Laplaciano 3×3
 *  (nitidez) + exposición (fracción de píxeles usables). */
interface BurstMeasures {
  lapVar: number;
  exposure: number;
}

/** Frame de video del burst: canvas a resolución del track + medidas
 *  calculadas SOBRE ese mismo fotograma (par píxel-idéntico). */
interface BurstFrame {
  canvas: HTMLCanvasElement;
  m: BurstMeasures | null;
}

/** FIX v4 4.1 — resultado de UN intento de takePhoto: blob, error y si
 *  expiró por TIMEOUT. Un timeout = sensor colgado → NO se reintenta y se
 *  activa la lista negra temporal (takePhotoBrokenRef).
 *  PERF/burst-budget — `wallCapped`: true si la carrera la ACORTÓ el
 *  presupuesto global (raceMs < 5000): distingue «timeout orgánico de 5 s"
 *  (foto rota → camino clásico sin foto) de «corte de muro» (foto lenta →
 *  el llamador lo reclasifica como time_cap, sin toast engañoso). */
interface TakePhotoAttempt {
  blob: Blob | null;
  err: unknown;
  timedOut: boolean;
  wallCapped?: boolean;
}

/** Laplaciano 3×3 (varianza) + histograma de exposición (under < 30,
 *  over > 225) sobre la luma de un canvas de ≤ 400 px — la misma
 *  matemática del motor (quality.ts) que exige §5.4. */
function measureGray(gray: Float32Array, w: number, h: number): BurstMeasures {
  const n = w * h;
  let under = 0;
  let over = 0;
  for (let i = 0; i < n; i++) {
    const l = gray[i]!;
    if (l < 30) under += 1;
    else if (l > 225) over += 1;
  }
  const exposure = 1 - (under + over) / n;
  let lapSum = 0;
  let lapSq = 0;
  let cnt = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * gray[i]! - gray[i - 1]! - gray[i + 1]! - gray[i - w]! - gray[i + w]!;
      lapSum += lap;
      lapSq += lap * lap;
      cnt += 1;
    }
  }
  const lapVar = cnt > 0 ? lapSq / cnt - (lapSum / cnt) ** 2 : 0;
  return { lapVar, exposure };
}

/** Dibuja la fuente a 400 px de lado mayor y mide (§5.4). SIN encode ni
 *  decode: la fuente es el <video> vivo, un canvas en RAM o un bitmap. */
function measurePixels(src: CanvasImageSource, sw: number, sh: number): BurstMeasures | null {
  if (!(sw > 0) || !(sh > 0)) return null;
  const s = Math.min(1, 400 / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * s));
  const h = Math.max(1, Math.round(sh * s));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const gray = new Float32Array(w * h);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    gray[j] = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
  }
  return measureGray(gray, w, h);
}

/** R-14 — suelta YA el backing store del canvas perdedor (no espera al GC;
 *  disciplina de memoria iOS, error #22). */
function releaseFrame(f: BurstFrame | null): void {
  if (f) {
    f.canvas.width = 0;
    f.canvas.height = 0;
  }
}

/** v2-A13 Fase A — videoTrack del informe burst: `track.getSettings()` del
 *  stream al armar la cámara (una vez por stream — real, sintético o
 *  re-adopción). Lote 4: el rescate de A13 guardó actas a 960 px porque el
 *  track del preview ES 960 px; este campo hace visible la fuente. */
function noteStreamTrackSize(stream: MediaStream): void {
  try {
    const track = stream.getVideoTracks()[0];
    const st =
      track && typeof track.getSettings === "function" ? track.getSettings() : null;
    if (st && typeof st.width === "number" && typeof st.height === "number") {
      recordVideoTrackSize(st.width, st.height);
    }
  } catch {
    /* telemetría: nunca rompe */
  }
}

declare global {
  interface Window {
    /** QA: telemetría del frame loop desde la consola. */
    __cameraTelemetry?: FrameLoopTelemetry;
    /** FIX v9 QA: última decisión de disparo del obturador automático
     *  (invariante al FPS) — {fpsEff, windowSamples, kRequired,
     *  goodInWindow, sustainedGoodMs, triggered, reason}. */
    __lastShutter?: ShutterHealth | null;
  }
}

export default function CameraView() {
  // ── Store ──
  const setView = useScannerStore((s) => s.setView);
  const capturePages = useScannerStore((s) => s.capturePages);
  const addCapturePage = useScannerStore((s) => s.addCapturePage);
  const settings = useScannerStore((s) => s.settings);
  const updateSettings = useScannerStore((s) => s.updateSettings);

  // ── Refs y estado ──
  const captureInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const viewerRef = useRef<HTMLElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const syntheticRef = useRef<SyntheticCamera | null>(null);
  const loopRef = useRef<CameraFrameLoop | null>(null);
  const processingRef = useRef(false);
  /** FIX v4 4.2 — UN solo flujo de captura a la vez: cierra la ventana de
   *  los hasta 5 s del disparo en la que el obturador seguía activo y N
   *  toques encolaban N takePhoto() simultáneos (cascada de
   *  InvalidStateError → sensor roto). */
  const capturingRef = useRef(false);
  const cooldownRef = useRef(0);
  // F-LOCAL: auto-captura y linterna son ESTADO LOCAL de la sesión de cámara
  // (el usuario las quitó de Ajustes). Arranque: auto ON, linterna OFF.
  const [autoCapture, setAutoCapture] = useState(true);
  const [flashOn, setFlashOn] = useState(false);
  const autoRef = useRef(true);
  /** F-FLASH: preferencia de la sesión (re-aplicada al abrir cada stream). */
  const flashRef = useRef(false);
  /** F-FLASH v3: espejo de torchOn legible desde listeners sin re-render. */
  const torchOnRef = useRef(false);
  const lastTelemetryAt = useRef(0);
  // F-ZSL — buffer circular Best-Shot: los últimos 8 fotogramas medidos del
  // <video>. En captura MANUAL el ganador (mayor lapVar) entre 80 y 450 ms
  // ANTES del tap sustituye a la foto del instante del impacto (el tap shock
  // sacude mecánicamente el teléfono → foto borrosa; el frame pre-tap ya
  // está estable y nítido — patrón Zero Shutter Lag de las cámaras nativas).
  const bestShotRingRef = useRef<
    Array<{ canvas: HTMLCanvasElement; lapVar: number; timestamp: number }>
  >([]);
  const lastRingFeedAt = useRef(0);
  const ringScratchRef = useRef<HTMLCanvasElement | null>(null);

  const [status, setStatus] = useState<CameraStatus>("idle");
  // B2: aviso persistente cuando el permiso de cámara fue DENEGADO — la app
  // cae al modo simulado (como siempre), pero ahora con overlay + CTA
  // «Activar cámara» en vez de dejar al usuario creer que escanea de verdad.
  const [camNotice, setCamNotice] = useState<null | "denied">(null);
  // B3: nonce para re-arrancar el efecto de arranque cuando el track muere
  // (permiso revocado, otra app roba la cámara) — antes el preview quedaba
  // congelado sin recuperación.
  const [camRestartNonce, setCamRestartNonce] = useState(0);
  // DIAG (spec diag §5) — solo instrumentación de la sonda: t0 de apertura
  // de la sesión de cámara y guardas 1-vez (camera_ready / fps early).
  const diagCameraOpenT0Ref = useRef(0);
  const diagCameraReadyRef = useRef(false);
  /** FIX v4 4.3 — anti-bucle de recuperación: mientras corre un
   *  recoverStream no se dispara otro (el watchdog vuelve a vigilar a los
   *  4 s, cuando el nuevo stream ya está abriéndose). */
  const recoveringRef = useRef(false);
  const [stable, setStable] = useState(false); // solo fallback simulado
  const [quad, setQuad] = useState<Quad>(() => defaultQuad());
  const [processing, setProcessing] = useState(false);
  /** FIX v4 4.2 — espejo visual de capturingRef (botón deshabilitado +
   *  feedback mientras dura el disparo). */
  const [isCapturing, setIsCapturing] = useState(false);
  const [flashKey, setFlashKey] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [precisionReady, setPrecisionReady] = useState(false);
  const [live, setLive] = useState<LiveUi>({ corners: null, score: null, fps: 0, searching: true });
  /** FIX v5 (5.2): espejo por ref del último frame vivo — handleCaptureDataUrl
   *  necesita la detección EN EL INSTANTE del disparo (el estado React llega
   * tarde al closure; el ref siempre está fresco). */
  const liveRef = useRef<LiveUi>({ corners: null, score: null, fps: 0, searching: true });
  const [videoDims, setVideoDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  /** FIX v5 (5.4) — modo espera (nivel 1): visor abierto SIN documento
   *  durante 30 s y sin interacción → análisis a 2 fps (loop.setIdle) +
   *  pill «Modo espera — toca para reactivar». Sale con: toque en el
   *  visor, corners detectados de nuevo (el análisis a 2 fps sigue
   *  evaluando → reacciona en <1 s) o captura. Nivel 2 (parar el stream a
   *  los 3 min) deliberadamente NO implementado: el ahorro real ya lo da
   *  el nivel 1 y un track parado es indistinguible de un stream MUERTO
   *  para el watchdog del v4 (complejidad de recuperación > beneficio). */
  const [standby, setStandby] = useState(false);
  const standbyRef = useRef(false);
  /** Cuándo empezó la racha actual de «sin corners» (null = hay documento). */
  const searchingSinceRef = useRef<number | null>(null);
  /** Última interacción del usuario con la cámara (toque en CUALQUIER parte). */
  const lastInteractionRef = useRef(Date.now());

  /** FIX v5 (5.4) — sale del modo espera: loop a régimen normal + pill
   *  fuera. Si sigue sin documento, la ventana de 30 s se REINICIA (el
   *  usuario acaba de interactuar — no volver a dormir de inmediato).
   *  Vive AQUÍ (antes de runCaptureFlow y de los efectos) para ser
   *  referenciale en sus deps sin TDZ. */
  const exitStandby = useCallback(() => {
    if (!standbyRef.current) return;
    standbyRef.current = false;
    setStandby(false);
    loopRef.current?.setIdle(false);
    if (liveRef.current.searching) searchingSinceRef.current = Date.now();
  }, []);
  const [boxSize, setBoxSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  /** §5.2 — true SOLO en Android/Chrome (takePhoto fiable — FIX v6 6.1:
   *  detección POSITIVA de Android; Safari moderno expone ImageCapture
   *  pero su takePhoto se cuelga). En iOS es false SIEMPRE → el shutter
   *  manual abre la cámara NATIVA (input capture=environment) — HQ-iOS,
   *  error #5 — y la auto-captura usa frames del stream ALTO (1920×1440). */
  const canTakePhotoRef = useRef(false);
  /** FIX v6 (6.2) — LATIDO de frames del <video>: timestamp del ÚLTIMO
   *  frame decodificado. Un video CONGELADO sin estar muted (lo que Safari
   *  deja tras un takePhoto colgado) PASA isStreamDead() (readyState/muted
   *  sanos) pero no produce frames nuevos → el watchdog de v4 no se
   *  disparaba → negro para siempre. Lo alimentan: el bucle rVFC (primario,
   *  Safari 15.4+ y Chrome) y onFrame del loop (fallback). */
  const lastFrameAtRef = useRef(performance.now());
  /** FIX v4 4.1 — lista negra TEMPORAL de takePhoto: true tras un intento
   *  que expiró por timeout (sensor colgado: cada disparo volvería a
   *  congelar el visor 5 s). Mientras esté marcado, captureSmart va directo
   *  al fallback de frames. Se rehabilita con un stream nuevo o si un
   *  takePhoto futuro vuelve a entregar un blob válido. */
  const takePhotoBrokenRef = useRef(false);
  /** F-SENSOR-PROFILER (PASO 2): perfil del sensor de FOTO del track vivo
   *  (resolución nativa vía getPhotoCapabilities + tope técnico único
   *  4032 px — fix v3: sin tope por gama). null = aún sin sondear. */
  const sensorProfileRef = useRef<SensorProfile | null>(null);
  /** A-01 (auditoría leaks-recursos) — guard de desmontaje para awaits
   *  largos (getUserMedia en retryRealCamera): un stream que resuelve sobre
   *  un componente muerto deja tracks vivos (LED encendido) sin nadie que
   *  los pare. true en el efecto de montaje, false en su cleanup. */
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /** F-SENSOR-PROFILER: sondea el sensor del stream REAL una vez por
   *  apertura (getPhotoCapabilities → nativa + tope por gama). Falla en
   *  silencio (Safari) → takePhoto dispara a secas y el clamp post-decode
   *  protege la RAM. La Sonda de QA expone el perfil en __sensorProfile.
   *  FIX v6 (6.1): SOLO corre con CAN_TAKEPHOTO — getPhotoCapabilities en
   *  Safari es inútil (expone un ImageCapture roto) y el perfil solo
   *  sirve para dimensionar takePhoto. */
  const profileActiveSensor = useCallback((stream: MediaStream): void => {
    if (!CAN_TAKEPHOTO) return; // iOS/Safari: nada que sondear
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    void profileSensor(track).then((p) => {
      sensorProfileRef.current = p;
    });
  }, []);

  /** FIX v7 (7.2) — subida progresiva de resolución para la auto-captura:
   *  pide el máximo ideal al track YA ABIERTO (no retrasa el arranque).
   *  Guards: solo no-Android (iOS Safari/Chrome + escritorio), solo
   *  auto-captura ON, solo track vivo, solo si la API existe y el track
   *  aún no está en alto. try/catch silencioso — NUNCA un mensaje. */
  const upgradeStreamResolution = useCallback(
    (track: MediaStreamTrack | null | undefined): void => {
      if (!track) return;
      if (CAN_TAKEPHOTO) return; // Android: takePhoto manda, preview ligero 960×540 (LOTE 5.1)
      if (!autoRef.current) return;
      if (typeof track.applyConstraints !== "function") return;
      if (track.readyState !== "live") return;
      const before =
        typeof track.getSettings === "function" ? track.getSettings() : null;
      if (before?.width && before.width >= 3000) return; // ya está alto
      void track
        .applyConstraints({
          width: { ideal: AUTO_CAPTURE_IDEAL_WIDTH },
          height: { ideal: AUTO_CAPTURE_IDEAL_HEIGHT },
        })
        .then(() => {
          const after =
            typeof track.getSettings === "function" ? track.getSettings() : null;
          // Telemetría QA (misma idea que __sensorProfile) — sin toasts.
          (window as unknown as Record<string, unknown>).__streamUpgrade = {
            before: { w: before?.width, h: before?.height },
            after: { w: after?.width, h: after?.height },
            at: Date.now(),
          };
        })
        .catch(() => undefined); // el dispositivo no quiso/ pudo — queda como está
    },
    [],
  );

  autoRef.current = autoCapture;
  flashRef.current = flashOn;
  torchOnRef.current = torchOn;

  const pageCount = capturePages.length;
  const hasStream = status === "live" || status === "synthetic";
  const precisionLive = hasStream && precisionReady;

    /* ── Linterna — F-FLASH v3 ───────────────────────────────────── */

  /** Enciende/apaga el torch y VERIFICA el resultado real. La verdad se
   *  descubre APLICANDO y leyendo getSettings().torch — NO confiando en
   *  getCapabilities(): hay Chrome (el caso del usuario) que NO anuncian
   *  torch en caps pero SÍ lo aplican (por eso codigo-test funcionaba y
   *  esta app no). Nota clave: con `advanced`, un constraint no soportado
   *  NO rechaza la promesa (best-effort per spec) → sin verificación el
   *  UI mentiría "encendido". Devuelve true si el LED quedó controlado. */
  const setTorchState = useCallback(async (on: boolean): Promise<boolean> => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return false;
    try {
      const caps = track.getCapabilities?.() as { torch?: boolean } | undefined;
      if (caps?.torch) setTorchAvailable(true);
      await track.applyConstraints({
        advanced: [{ torch: on }],
      } as MediaTrackConstraints & { advanced: unknown[] });
      const st = track.getSettings() as { torch?: boolean };
      const applied = on ? st.torch === true : st.torch !== true;
      // Encender exige verificación REAL (getSettings().torch === true):
      // `advanced` es best-effort per spec — con solo caps.torch === true
      // había "flash fantasma" (toast "encendido" con LED apagado en Android
      // que acepta en silencio). Apagar: si settings ya no reporta torch,
      // el estado deseado se cumple.
      if (applied) {
        torchOnRef.current = on;
        setTorchOn(on);
      }
      if (caps?.torch || applied) setTorchAvailable(true);
      if (!applied && on) {
        // Aceptado en silencio pero sin señal verificable: deshaz para no
        // dejar un LED encendido "fantasma".
        await track
          .applyConstraints({ advanced: [{ torch: false }] } as MediaTrackConstraints & {
            advanced: unknown[];
          })
          .catch(() => undefined);
      }
      return applied;
    } catch {
      return false;
    }
  }, []);

  /** Re-aplica la preferencia persistida CON REINTENTOS (0/250/700/1500 ms):
   *  varios Android rechazan applyConstraints justo tras getUserMedia y
   *  solo lo aceptan cuando el video ya reproduce. Idempotente: si un
   *  intento verifica el encendido, los siguientes se saltan solos. */
  const applySavedTorchWithRetry = useCallback(() => {
    for (const ms of [0, 250, 700, 1500]) {
      window.setTimeout(() => {
        if (!flashRef.current || torchOnRef.current) return;
        void setTorchState(true);
      }, ms);
    }
  }, [setTorchState]);

  /* ── FIX v4 4.3 — Salud y recuperación del stream ────────────────── */

  /** ¿El stream murió EN SILENCIO? Un track puede quedar muted o dejar de
   *  producir frames con readyState "live" (takePhoto colgado, otra app se
   *  llevó el sensor) sin disparar NUNCA el evento "ended" → el efecto de
   *  apertura no se re-ejecuta, status sigue "live" (sin CTA) y el visor
   *  queda NEGRO para siempre. Esta es la condición que el watchdog vigila. */
  const isStreamDead = useCallback((): boolean => {
    const track = streamRef.current?.getVideoTracks()[0];
    const video = videoRef.current;
    return (
      !track ||
      track.readyState !== "live" ||
      track.muted ||
      !video ||
      video.readyState < 2 ||
      !video.videoWidth
    );
  }, []);

  /** Recuperación del stream muerto: para los tracks, resetea el estado y
   *  re-dispara el efecto de apertura (camRestartNonce → sondas + cascada
   *  completas — el efecto YA existe y ya maneja cascada/sintética; aquí
   *  solo se dispara). recoveringRef evita bucles; el reset a los 4 s deja
   *  al watchdog volver a vigilar tras el reinicio. */
  const recoverStream = useCallback(() => {
    if (recoveringRef.current) return;
    recoveringRef.current = true;
    toast.info("Reiniciando cámara…", { description: "El sensor dejó de responder." });
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStatus("idle");
    setCamRestartNonce((n) => n + 1); // re-ejecuta el efecto de apertura
    window.setTimeout(() => {
      recoveringRef.current = false;
    }, 4000);
  }, []);

  /* ── Captura ─────────────────────────────────────────────────────── */

  /** F-DEFER-CROP v6.2 — resuelve el quad EN BACKGROUND. Se invoca DESPUÉS
   *  de abrir el editor: la captura ya no espera al OpenCV del worker (en
   *  gama baja eran segundos mirando el spinner de la cámara). Guardas al
   *  aterrizar: la página debe seguir existiendo (Repetir/limpiar la
   *  eliminan) y el usuario NO debe haber recortado a mano (quadManual).
   *  Si la detección falla se libera el pill y queda el marco provisional
   *  (ajustable en «Recortar»). La calidad del texto NO se toca: la foto
   *  sigue siendo full-sensor y el enhance no cambia. */
  const applyAutoQuad = useCallback(
    async (pageId: string, src: HTMLImageElement | HTMLCanvasElement) => {
      const apply = (patch: Partial<CapturePage>) =>
        useScannerStore.getState().updateCapturePage(pageId, patch);
      // v4 §2.3 (v4.3) — job en background #1: la detección de bordes
      // full-res de ESTA captura puede solaparse con la SIGUIENTE (candidato
      // #3 del tramo opaco). Contador aditivo — instrumentación pura.
      beginBackgroundJob();
      try {
        const detected = await detectDocumentEdges(src);
        const page = useScannerStore
          .getState()
          .capturePages.find((p) => p.id === pageId);
        if (!page) return; // página eliminada mientras volaba → nada que hacer
        if (page.quadManual) {
          apply({ autoQuadPending: false });
          return;
        }
        // FIX v5 (5.2): micro-salto — si lo detectado full-res es
        // prácticamente el quad actual de la página (<2 % de la diagonal),
        // NO se reemplaza: el reproceso de preview cambiaría la cache por
        // un recorte visualmente idéntico (salto/parpadeo injustificado).
        if (quadDrift(page.quad, detected) < 0.02) {
          // LOTE 5.6 — la detección aterrizó (sin drift): origen = detect.
          apply({ autoQuadPending: false, quadSource: "detect" });
          // LOTE 5.7.1 — mark persistente (sin drift: detected ≈ page.quad).
          perfProbe.mark("page_framing", {
            phase: "detect",
            pageId: page.id,
            src: "detect",
            origW: page.origW ?? null,
            origH: page.origH ?? null,
            ...quadMeta(page.quad),
          });
          return;
        }
        // LOTE 5.6 — origen = detect (la página ahora recorta por el quad detectado).
        apply({ quad: detected, autoQuadPending: false, quadSource: "detect" });
        // LOTE 5.7.1 — mark persistente (el quad detectado REEMPLAZÓ al vivo).
        perfProbe.mark("page_framing", {
          phase: "detect",
          pageId: page.id,
          src: "detect",
          origW: page.origW ?? null,
          origH: page.origH ?? null,
          ...quadMeta(detected),
        });
      } catch {
        apply({ autoQuadPending: false });
      } finally {
        // v4 §2.3 — SIEMPRE libera el contador (jobs pareados).
        endBackgroundJob();
      }
    },
    []
  );

  /** PERF/burst-budget — estadísticas de la adquisición EN VUELO: se cuelgan
   *  del mark `capture_shot` (meta aditiva) cuando la imagen llega al
   *  pipeline y se limpian en cada captura nueva y en los caminos de fallo
   *  del dispatch (nada dispara capture_shot → nada que telemetrizar). */
  const pendingBurstRef = useRef<BurstStats | null>(null);

  /** LOTE 5 (F5-A/F5-D) — último intento ganador de takePhoto (photoSettings
   *  pedido + ms del intento). Lo escribe takePhotoBlob y lo lee el mark
   *  `capture_shot` para diag v6. Nullable: caminos sin takePhoto (legacy,
   *  galería, frames) lo dejan en null → meta aditivo ausente (pre-v6
   *  intacto). */
  const lastPhotoAttemptRef = useRef<{
    photoSettingsReq: string;
    takePhotoMs: number;
  } | null>(null);

  /** LOTE 5 (F5-D) — lado mayor del blob ganador (sniff de readBlobLongSide
   *  que dispatchPhotoBlob ya hace). Lo lee el mark `capture_shot`. */
  const lastPhotoBlobLongSideRef = useRef<number | null>(null);

  /** Pipeline tras obtener la imagen (FLUJO ADOBE SCAN + F-DEFER-CROP v6.2):
   *  flash → decode → downscale → calidad → store → EDITOR INMEDIATO.
   *  El editor abre con un marco provisional y la detección de bordes
   *  aterriza en background (pill «Ajustando recorte…» → preview se
   *  re-procesa solo). En gama baja esto convierte una espera de segundos
   *  frente a la cámara en una revisión instantánea. */
  const handleCaptureDataUrl = useCallback(
    async (rawDataUrl: string): Promise<string | null> => {
      if (processingRef.current) return null;
      if (!rawDataUrl) {
        toast.error("No se pudo capturar la imagen");
        return null;
      }
      processingRef.current = true;
      setProcessing(true);
      setFlashKey((k) => k + 1); // flash blanco breve
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(30);
      }
      try {
        // DIAG v1.1 (spec sub-marks) — el frame/foto del sensor YA está en
        // mano (blob→dataURL o frame→dataURL): empieza el procesado. Tramo
        // 1 de la descomposición captura→guardada.
        // PERF/burst-budget — meta ADITIVA: cómo terminó la adquisición de
        // ESTA captura (burstExitReason/burstFrames). Ausente en los caminos
        // sin burst (demo, galería, cámara nativa iOS) — marks v1/v1.1
        // intactos, solo campos nuevos.
        // v2-A13 Fase A — telemetría v4.1: cuándo produjo la salida el
        // presupuesto (burstWaitedMs = wallFireMs del informe) + salud del
        // sampler §B (muestras y coste de la última).
        const burstMeta = pendingBurstRef.current;
        // v4 §2.1/§2.3 (v4.3) — cierra el tramo opaco (recordBurst → ESTE
        // mark) AQUÍ: cuelga pipeSniffMs/pipeDataUrlMs/pipeToMarkMs/
        // bgJobsAtShot del meta. Null en rutas sin corte (foto normal,
        // legacy, galería) → meta byte-a-byte con pre-v4 (gate 3).
        const pipeMeta = burstMeta === null ? null : collectBurstPipeMeta();
        // LOTE 5 (F5-D) — meta aditivo del intento ganador de takePhoto
        // (photoSettings pedido + ms del attempt) y del sniff del blob
        // ganador (lado mayor). Refs poblados arriba en takePhotoBlob y
        // dispatchPhotoBlob. Ausentes en rutas sin takePhoto (legacy,
        // galería, frames puros) → meta idéntico al de antes (marks
        // v1/v1.1 intactos).
        const photoAttemptMeta = lastPhotoAttemptRef.current;
        const photoLongSideMeta = lastPhotoBlobLongSideRef.current;
        const hasPhotoMeta =
          photoAttemptMeta !== null || photoLongSideMeta !== null;
        perfProbe.mark(
          "capture_shot",
          burstMeta === null && !hasPhotoMeta
            ? undefined
            : {
                ...(burstMeta !== null
                  ? {
                      burstExitReason: burstMeta.exitReason,
                      burstFrames: burstMeta.frames,
                      burstWaitedMs: burstMeta.waitedMs,
                      burstSamples: burstMeta.samples,
                      burstSampleCostMs: burstMeta.lastSampleCostMs,
                      // v3 Fase D (v4.2) — campo ADITIVO OPCIONAL: ms que la gracia
                      // esperó a la foto huérfana tras el corte. Ausente cuando la
                      // gracia no corrió → meta idéntico al de antes (marks
                      // v1/v1.1 intactos, nada renombrado ni eliminado).
                      ...(burstMeta.graceWaitedMs !== null
                        ? { grace: burstMeta.graceWaitedMs }
                        : {}),
                      // v4 (v4.3) — tramo opaco, SOLO en capturas con corte:
                      // total recordBurst→mark + jobs del editor al aterrizar +
                      // sub-marks del pipe de foto (ausentes si el dispatch fue de
                      // frames). Campos aditivos opcionales — marks v1/v1.1
                      // intactos, cero nombres nuevos de mark.
                      ...(pipeMeta !== null
                        ? {
                            pipeToMarkMs: pipeMeta.pipeToMarkMs,
                            bgJobsAtShot: pipeMeta.bgJobsAtShot,
                            ...(pipeMeta.pipeSniffMs !== null
                              ? { pipeSniffMs: pipeMeta.pipeSniffMs }
                              : {}),
                            ...(pipeMeta.pipeDataUrlMs !== null
                              ? { pipeDataUrlMs: pipeMeta.pipeDataUrlMs }
                              : {}),
                            ...(pipeMeta.heapProbe
                              ? { heapProbe: pipeMeta.heapProbe }
                              : {}),
                          }
                        : {}),
                    }
                  : {}),
                ...(photoAttemptMeta !== null
                  ? {
                      photoSettingsReq: photoAttemptMeta.photoSettingsReq,
                      takePhotoMs: photoAttemptMeta.takePhotoMs,
                    }
                  : {}),
                ...(photoLongSideMeta !== null
                  ? { photoOutLongSide: photoLongSideMeta }
                  : {}),
              }
        );
        pendingBurstRef.current = null;
        // v2-A13 Fase B — la ventana fired→shot CIERRA aquí (definición
        // exacta de la zona sancionada; idempotente con el finally del flujo).
        setAcquisitionActive(false);
        // Decode ÚNICO de la captura (antes: downscale + detect + quality
        // decodificaban la misma foto de 12 MP tres veces). El elemento se
        // reutiliza en las etapas; solo se re-decodifica si hubo que
        // re-escalar una imagen de galería más grande que el sensor.
        const decoded = await loadImage(rawDataUrl);
        // FIX v3 (fix-editor-quality): el ORIGINAL se capa al tope técnico
        // ÚNICO (4032 px) — NUNCA al de una gama (antes: safeCapPx del
        // benchmark → 3200 en medium/low degradaba la FUENTE para siempre).
        // Los sensores ≤12 MP pasan intactos (4032×3024 ≈ 12.2 MP decodifica
        // bien en iOS); los gigantes siguen protegidos por las 2 capas del
        // sensor-profiler + este downscale como tercera red.
        const scaledUrl = await downscaleImage(decoded, PROCESSED_MAX_LONG_SIDE);
        const dataUrl = scaledUrl ?? rawDataUrl;
        const source: HTMLImageElement | HTMLCanvasElement = scaledUrl
          ? await loadImage(scaledUrl)
          : decoded;
        // F-DEFER-CROP v6.2: la detección de bordes SALE del camino crítico
        // (corre en background tras abrir el editor). La calidad sí se mide
        // aquí: es barata (canvas de ≤400 px) y alimenta el badge de calidad.
        const quality = await evaluateQuality(source);
        // FIX v5 (5.2) — FIN DEL «DOBLE RECORTE»: lo que se vio EN VIVO es lo
        // que llega al editor. Si al disparar había detección confiable, su
        // quad (normalizado al frame del video) se usa DIRECTAMENTE para
        // nacer la página — la re-detección full-res de applyAutoQuad podía
        // entregar OTRO recorte distinto al del overlay (distinta resolución
        // de análisis → distinto ajuste fino) y el usuario veía como si se
        // recortara dos veces. Requisito de mapeo: los corners viven en el
        // espacio del frame de ANÁLISIS del video (normalizados 0-1); la
        // captura (foto full-sensor o snapshot) debe tener el MISMO aspect
        // (±2 %) para que el mapeo directo sea fiel — si difiere (p. ej.
        // foto 16:9 de un preview 4:3), el mapeo mentiría → background.
        const t = liveRef.current;
        const iw = sourceNaturalWidth(source);   // LOTE 5.6 — hoist para origW/H
        const ih = sourceNaturalHeight(source);  // LOTE 5.6
        let bornQuad: Quad | null = null;
        if (
          t.corners &&
          t.score !== null &&
          t.score >= LIVE_QUAD_MIN_SCORE
        ) {
          const vw = videoRef.current?.videoWidth ?? 0;
          const vh = videoRef.current?.videoHeight ?? 0;
          // iw/ih ya están en scope (hoist 5.6) — el bloque sigue igual.
          if (
            vw > 0 &&
            vh > 0 &&
            iw > 0 &&
            ih > 0 &&
            Math.abs(vw / vh - iw / ih) <= 0.02
          ) {
            const c = t.corners;
            bornQuad = [
              { x: c[0]!.x, y: c[0]!.y },
              { x: c[1]!.x, y: c[1]!.y },
              { x: c[2]!.x, y: c[2]!.y },
              { x: c[3]!.x, y: c[3]!.y },
            ];
          }
        }
        const page: CapturePage = {
          id: nextId("page"),
          original: dataUrl,
          // Marco provisional (vista completa): el quad real llega en
          // background vía applyAutoQuad, sin bloquear la revisión.
          quad: bornQuad ?? defaultQuad(),
          autoQuadPending: bornQuad === null,
          quadSource: bornQuad !== null ? "overlay" : "none", // LOTE 5.6 (solo telemetría)
          origW: iw > 0 ? iw : undefined,                     // LOTE 5.6
          origH: ih > 0 ? ih : undefined,                     // LOTE 5.6
          // F-DEFAULT-BW: «Mejora automática» (Ajustes › Procesamiento) decide
          // el filtro por defecto de cada captura — ON = B/N adaptativo (lo que
          // pidió el usuario), OFF = Original puro. Cambiable en el editor.
          filter: useScannerStore.getState().settings.enhance ? "bw" : "original",
          rotation: 0,
          quality,
        };
        addCapturePage(page);
        // LOTE 5.7.1 (framing persistente) — la telemetría de encuadre viaja
        // como MARK de sesión (sobrevive al guardado/cierre), no solo como
        // lectura del store vivo. Evento "born": el quad con el que NACIÓ la
        // página (overlay nato o marco provisional) + dims del original.
        perfProbe.mark("page_framing", {
          phase: "born",
          pageId: page.id,
          src: bornQuad !== null ? "overlay" : "none",
          origW: iw > 0 ? iw : null,
          origH: ih > 0 ? ih : null,
          ...quadMeta(page.quad),
        });
        // DIAG v1.1 (spec sub-marks) — tramo 2: imagen ya decodificada,
        // capada a 4032 y medida (px y bytes FINALES que van al store).
        perfProbe.mark("capture_processed", {
          pxLong: Math.max(sourceNaturalWidth(source), sourceNaturalHeight(source)),
          bytes: dataUrlBytes(dataUrl),
        });
        // DIAG v1.1 (spec sub-marks) — tramo 3: la página quedó persistida
        // en el store de la sesión (addCapturePage resuelto).
        perfProbe.mark("capture_write");
        // DIAG (spec diag §6) — la página ATERRIZÓ en la sesión (bytes y lado
        // mayor del original persistido). Base del derivado captura→editor
        // (editor_open.ts − page_saved.ts) y de captureToSavedMs.
        perfProbe.mark("page_saved", {
          bytes: dataUrlBytes(dataUrl),
          pxLong: Math.max(sourceNaturalWidth(source), sourceNaturalHeight(source)),
        });
        // F-FLOW: directo al editor (modo revisión) — igual que Adobe Scan.
        setView("editor");
        // FIX v5 (5.2): con quad nato del overlay NO se re-detecta (era la
        // 2ª detección que cambiaba el recorte). Sin detección viva confiable
        // (o aspect distinto): la detección vuela en background como antes;
        // cuando aterrice, el preview se re-procesa solo (cambia el quad →
        // capturePageKey → cache miss) y la pill «Ajustando recorte…» cubre
        // la espera.
        if (bornQuad === null) {
          void applyAutoQuad(page.id, source);
        }
        return page.id;
      } catch (err) {
        console.error("handleCaptureDataUrl falló:", err);
        toast.error("No se pudo procesar la imagen");
        return null;
      } finally {
        processingRef.current = false;
        setProcessing(false);
      }
    },
    [addCapturePage, setView, applyAutoQuad]
  );

  /** Blob → data URL (para el takePhoto hi-res).
   *  PERF/burst-budget — `deadlineAt` opcional: el muro de la captura puede
   *  ABORTAR el FileReader a mitad (spec §3 «cancelación»: abortar promesas)
   *  y resolver null — el flujo cae al dispatch de frames. Sin deadline el
   *  comportamiento es el de siempre (rechaza si el reader falla). */
  const blobToDataUrl = useCallback(
    (blob: Blob, deadlineAt?: number) =>
      new Promise<string | null>((resolve, reject) => {
        const fr = new FileReader();
        let settled = false;
        let watch = 0;
        const done = (settle: () => void) => {
          if (settled) return;
          settled = true;
          if (watch) window.clearTimeout(watch);
          settle();
        };
        fr.onload = () => done(() => resolve(String(fr.result ?? "")));
        fr.onerror = () =>
          done(() =>
            deadlineAt === undefined
              ? reject(new Error("FileReader falló"))
              : resolve(null)
          );
        fr.onabort = () => done(() => resolve(null));
        if (deadlineAt !== undefined) {
          watch = window.setTimeout(() => {
            try {
              fr.abort();
            } catch {
              /* ya terminó */
            }
            done(() => resolve(null));
          }, Math.max(0, deadlineAt - performance.now()));
        }
        void fr.readAsDataURL(blob);
      }),
    []
  );

  /** DUAL PIPELINE (pilar 2) — Captura a RESOLUCIÓN DEL SENSOR como Blob
   *  (aún SIN convertir a data URL): takePhoto() IGNORA la resolución del
   *  <video> de 540p y dispara directo al sensor físico (12–48 MP, p.ej.
   *  4000×3000). La orientación EXIF la aplica el pipeline al decodificar
   *  (loadImage).
   *  FIX v4 4.1 — UN intento de 5 s (antes: 8 s + reintento = hasta 16 s
   *  con el visor congelado en hardware con takePhoto roto). El reintento
   *  sin photoSettings SOLO procede si el primer intento falló RÁPIDO
   *  (constraints rechazadas, InvalidStateError); un TIMEOUT = sensor
   *  colgado → no se reintenta y se marca la lista negra temporal
   *  (takePhotoBrokenRef) para que captureSmart no vuelva a colgar 5 s en
   *  cada disparo. Devuelve el blob y el flag timedOut (el llamador evalúa
   *  la salud del stream tras un timeout — fix 4.3). */
  const takePhotoBlob = useCallback(
    async (
      deadlineAt?: number,
      /** v2-A13 Fase A — recibe la promesa CRUDA de `takePhoto` (la que la
       *  carrera interna puede perder contra el muro): el llamador la cuelga
       * del observador de foto huérfana cuando el presupuesto corta. SOLO
       * observación — no altera la carrera. */
      onRawPhoto?: (photo: Promise<Blob>) => void,
      /** LOTE 5.4 (F5.4-A) — upgrade silencioso: si el ganador fue un
       *  PELDAÑO (no el desnudo), takePhotoBlob dispara YA una foto
       *  full-res del sensor (desnudo, ~15 s) y entrega la promesa al
       *  llamador. Solo entrega la promesa — corre SIEMPRE fuera del
       *  presupuesto del burst y NUNCA bloquea. */
      onFastWin?: (upgrade: Promise<Blob>) => void
    ): Promise<{ blob: Blob | null; timedOut: boolean; wallCapped?: boolean }> => {
    // FIX v6 (6.1) — guard de plataforma PRIMERO: Safari moderno expone
    // ImageCapture pero takePhoto() se cuelga (5 s de visor congelado por
    // disparo). Fuera de Android/Chrome ni se intenta.
    if (!CAN_TAKEPHOTO) return { blob: null, timedOut: false };
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return { blob: null, timedOut: false };
    try {
      const capture = new ImageCapture(track);
      // LOTE 5.3 — la resolución la manda FOTO_LADDER (2048×1536 → 1280×960 →
      // desnudo). El cap anti-gigante del profiler ya no participa en la
      // captura de Android; la Capa 2 post-decode sigue como red de seguridad.
      // (profile se conserva: alimenta la Capa 2 con safeCapPx.)
      const profile = sensorProfileRef.current;
      // LOTE 5.5 — modo «calidad primero»: UNA carrera larga contra el
      // sensor con el DESNUDO de primero (la página nace full-res). Si el
      // desnudo falla RÁPIDO, la cola cae a los peldaños (D.4). Sin
      // upgrade en segundo plano: el usuario ya pagó la espera.
      const qualityFirst = isQualityFirstPhoto();
      // LOTE 5.3 (F5.3-A): en Android la escalera es SIEMPRE el primer camino,
      // sin importar overCap. Evidencia diag v6 2026-10-14 16:57/17:03: con
      // overCap=true el profiler pedía {4032,3024} y el ISP hace la foto
      // completa igual (~15 s en A135M; gap disparo→foto 17.6 s) — el intento
      // capped NO aporta nada en los dispositivos lentos y en los rápidos el
      // peldaño 2048 ya es rápido. El desnudo sigue siendo el ÚLTIMO recurso
      // (solo si ambos peldaños fallan RÁPIDO). Evidencia cam-lab SM-A135M:
      // takePhoto 2048×1536 ≈ 1.0 s (devuelve 1920×1920) vs desnudo ≈ 15 s.
      let settings = qualityFirst ? undefined : FOTO_LADDER[0];
      // LOTE 5.4 — settings del ÚLTIMO intento disparado; se lee SOLO si
      // hubo blob ganador para decidir si corres upgrade (peldaño → sí,
      // desnudo → ya es full-res, no).
      let winnerSettings: PhotoSettings | undefined = settings;
      const attempt = async (ps?: PhotoSettings): Promise<TakePhotoAttempt> => {
        // PERF/burst-budget — cada carrera de takePhoto queda ACOTADA por el
        // presupuesto global de la captura (legacy sin deadline: 5 s exactos
        // como siempre). Si no queda presupuesto, ni se dispara la foto.
        let raceMs = 5000;
        if (deadlineAt !== undefined) {
          raceMs = Math.min(qualityFirst ? 20000 : 5000, deadlineAt - performance.now());
          if (raceMs <= 50) {
            return {
              blob: null,
              err: new Error("burst budget agotado antes de takePhoto"),
              timedOut: false,
            };
          }
        }
        try {
          // v2-A13 Fase A — la promesa cruda del sensor queda EXPUESTA al
          // llamador ANTES de la carrera: si el muro la corta, el observador
          // de la foto huérfana sigue su vuelo (¿llega? ¿cuándo? ¿bytes?).
          const photoPromise = capture.takePhoto(ps) as Promise<Blob>;
          if (onRawPhoto) {
            try {
              onRawPhoto(photoPromise);
            } catch {
              /* observación: nunca rompe la captura */
            }
          }
          const blob = await Promise.race([
            photoPromise,
            new Promise<never>((_, reject) =>
              window.setTimeout(
                () => reject(new Error(`takePhoto timeout ${Math.round(raceMs)}ms`)),
                raceMs
              )
            ),
          ]);
          return {
            blob: blob && blob.size > 0 ? blob : null,
            err: blob && blob.size > 0 ? null : new Error("takePhoto devolvió un blob vacío"),
            timedOut: false,
          };
        } catch (err) {
          return {
            blob: null,
            err,
            timedOut: err instanceof Error && err.message.includes("timeout"),
            wallCapped: raceMs < 5000,
          };
        }
      };
      // LOTE 5 (F5-D) — wrapper del intento: mide los ms del attempt y
      // deja expuesto al diag el photoSettings pedido del GANADOR. El mark
      // capture_shot (emitido abajo en handleCaptureDataUrl) lee este ref.
      const timedAttempt = async (
        ps: PhotoSettings | undefined
      ): Promise<TakePhotoAttempt> => {
        const t0 = performance.now();
        const r = await attempt(ps);
        if (r.blob) {
          lastPhotoAttemptRef.current = {
            photoSettingsReq: ps
              ? `${ps.imageWidth}x${ps.imageHeight}`
              : "naked",
            takePhotoMs: Math.round(performance.now() - t0),
          };
        }
        return r;
      };
      let res = await timedAttempt(settings);
      // LOTE 5.3 (F5.3-A) — avance de escalera ÚNICO para Android: siguiente
      // peldaño y luego desnudo. Guard intacto (fallo RÁPIDO = !res.blob &&
      // !res.timedOut && res.err && presupuesto restante > 50 ms);
      // res.timedOut corta la escalera (sensor colgado → lista negra,
      // comportamiento pre-lote5 intacto). iOS: intacto tras CAN_TAKEPHOTO.
      const retryQueue: (PhotoSettings | undefined)[] = qualityFirst
        ? [...FOTO_LADDER] // 5.5 calidad: el desnudo ya corrió de primero; los peldaños son el plan B si falló RÁPIDO
        : [...FOTO_LADDER.slice(1), undefined];
      for (let i = 0; i < retryQueue.length; i++) {
        if (res.blob || res.timedOut || !res.err) break;
        if (deadlineAt !== undefined && deadlineAt - performance.now() <= 50)
          break;
        winnerSettings = retryQueue[i]!;
        res = await timedAttempt(retryQueue[i]!);
      }
      // FIX v4 4.1 — lista negra temporal: marcar si expiró, rehabilitar si
      // respondió (un takePhoto que vuelve a funcionar vuelve a usarse).
      if (res.blob) takePhotoBrokenRef.current = false;
      else if (res.timedOut) takePhotoBrokenRef.current = true;
      // LOTE 5.4 (F5.4-A) — el upgrade solo tiene sentido si lo que ganó
      // fue un PELDAÑO (2048/1280): si ganó el desnudo ya es full-res.
      // Fire-and-forget: la promesa NUNCA se espera aquí (el desnudo tarda
      // ~15 s); su catch vive en el runner del llamador. Sin timedAttempt
      // (no debe tocar lastPhotoAttemptRef ni el meta del ganador) y SIN
      // tocar takePhotoBrokenRef (un desnudo lento/roto NO lista-negrea la
      // escalera, que ya entregó la foto del flujo).
      if (res.blob && winnerSettings !== undefined && onFastWin) {
        try {
          onFastWin(capture.takePhoto(undefined));
        } catch {
          /* throw sincrónico raro del sensor: nunca rompe la captura */
        }
      }
      if (!res.blob) {
        return {
          blob: null,
          timedOut: res.timedOut,
          ...(res.wallCapped ? { wallCapped: true } : {}),
        };
      }
      // Capa 2 — red de seguridad post-decode (solo recorta si el blob
      // excede el tope; si no, el blob original pasa intacto).
      // PERF/burst-budget — con presupuesto, el tope se lee de la CABECERA
      // (readBlobLongSide, ~192 KB): el createImageBitmap de 12 MP que había
      // aquí era un decode completo SOLO para leer width/height — segundos
      // enteros en gama baja DENTRO del tramo captura→guardada. Blob dentro
      // del tope → clamp saltado (intacto); desconocido o gigante → clamp
      // íntegro como siempre. Legacy sin deadline: camino exacto de antes.
      const capPx = profile?.safeCapPx ?? getSensorSafeCap();
      let clamped: Blob;
      if (deadlineAt !== undefined) {
        const sniffed = await readBlobLongSide(res.blob);
        // LOTE 5 (F5-D) — el sniff del blob ganador (lado mayor) queda
        // expuesto al diag via ref: el mark capture_shot lo lee para
        // camera.photoOutLongSide. Solo en camino con presupuesto (donde
        // el sniff ya corre); el camino legacy lo deja en null (campo
        // nullable, sin romper nada).
        lastPhotoBlobLongSideRef.current = sniffed;
        clamped =
          sniffed !== null && sniffed <= capPx
            ? res.blob
            : await clampBlobToSafeCap(res.blob, capPx);
      } else {
        clamped = await clampBlobToSafeCap(res.blob, capPx);
      }
      return { blob: clamped, timedOut: false };
    } catch {
      return { blob: null, timedOut: false };
    }
  }, []);

  /** Canvas → data URL JPEG 0.92 (E5: toBlob — NUNCA toDataURL en canvas
   *  grande, error #22 — con toDataURL de respaldo si toBlob falla). Se
   *  llama PEREZOSAMENTE: solo cuando ese frame GANA el burst §5.4. */
  const canvasToDataUrl = useCallback(
    async (canvas: HTMLCanvasElement): Promise<string | null> => {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92)
      );
      if (blob && blob.size > 0) {
        try {
          return await blobToDataUrl(blob);
        } catch {
          /* cae al toDataURL de abajo */
        }
      }
      try {
        return canvas.toDataURL("image/jpeg", 0.92);
      } catch {
        return null;
      }
    },
    [blobToDataUrl]
  );

  /** F-ZSL — Buffer circular ZSL en CameraView: copia el fotograma al ring
   *  (máx 8) y suelta YA el backing store del expulsado (no espera al GC;
   *  disciplina de memoria iOS, error #22).
   *  FIX v4 4.5 — la copia se dibuja ESCALADA para que su lado mayor sea
   *  ≤ RING_MAX_LONG_SIDE (1280 px): a resolución completa (stream alto de
   *  iOS 1920×1440) 8 slots ≈ 88 MB y esa presión de memoria hacía que
   *  WebKit matara la capa de video (visor negro). El ring es SOLO el
   *  fallback: no necesita resolución completa. */
  const pushRingFrame = useCallback(
    (canvas: HTMLCanvasElement, lapVar: number) => {
      const ring = bestShotRingRef.current;
      const srcLong = Math.max(canvas.width, canvas.height);
      const scale = srcLong > RING_MAX_LONG_SIDE ? RING_MAX_LONG_SIDE / srcLong : 1;
      const copy = document.createElement("canvas");
      copy.width = Math.max(1, Math.round(canvas.width * scale));
      copy.height = Math.max(1, Math.round(canvas.height * scale));
      copy.getContext("2d")?.drawImage(canvas, 0, 0, copy.width, copy.height);
      ring.push({ canvas: copy, lapVar, timestamp: performance.now() });
      if (ring.length > 8) {
        const old = ring.shift();
        if (old) {
          old.canvas.width = 0;
          old.canvas.height = 0;
        }
      }
    },
    []
  );

  /** F-ZSL — alimenta el ring desde el <video> vivo a ~5 Hz (mín 200 ms
   *  entre feeds): garantiza que el buffer SIEMPRE cubra la ventana pre-tap
   *  de 80–450 ms. Se invoca desde onFrame del loop (ya throttleado por el
   *  control de cadencia adaptativo de frame-loop.ts — no reintroduce el
   *  stuttering de gama baja). Reutiliza UN scratch canvas: coste por feed
   *  ≈ 1 drawImage + 1 copia + 1 medición a 400 px.
   *  v2-A13 Fase B (§4.1) — ring post-fired BARATO: tras capture_fired la
   *  carrera de lapVar por frame SOLO consume hilo (el ganador anti
   *  tap-shock se decide con frames PRE-tap — ESA lógica no se toca; y en
   *  un preview oscuro el frame más RUIDOSO es el que gana, lote 4).
   *  Durante la ventana fired→shot el ring SIGUE recolectando frames pero
   *  SIN análisis (lapVar 0); el rescate se apoya en snapA/snapshotVideo,
   *  que SÍ se miden (los candidatos del dispatch). */
  const feedRingFromVideo = useCallback((): void => {
    const now = performance.now();
    if (now - lastRingFeedAt.current < 200) return;
    lastRingFeedAt.current = now;
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) return;
    if (!ringScratchRef.current) ringScratchRef.current = document.createElement("canvas");
    const scratch = ringScratchRef.current;
    // FIX v4 4.5 — el scratch se dimensiona a la medida ESCALADA (lado mayor
    // ≤ 1280 px), no a la resolución del track: el ring no necesita más y la
    // medición (measurePixels remuestrea a 400 px) es idéntica.
    const srcLong = Math.max(video.videoWidth, video.videoHeight);
    const scale = srcLong > RING_MAX_LONG_SIDE ? RING_MAX_LONG_SIDE / srcLong : 1;
    const dw = Math.max(1, Math.round(video.videoWidth * scale));
    const dh = Math.max(1, Math.round(video.videoHeight * scale));
    if (scratch.width !== dw || scratch.height !== dh) {
      scratch.width = dw;
      scratch.height = dh;
    }
    const ctx = scratch.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, dw, dh);
    const m = isAcquisitionActive() ? null : measurePixels(scratch, dw, dh);
    pushRingFrame(scratch, m?.lapVar ?? 0);
  }, [pushRingFrame]);

  /** Instantánea del <video> a resolución del track + medidas §5.4 sobre
   *  ESA MISMA imagen (par píxel-idéntico). Sincronónica (~10 ms) y SIN
   *  encodear JPEG: el encode solo ocurre si el frame gana el burst. */
  const snapshotVideo = useCallback((): BurstFrame | null => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    const m = measurePixels(canvas, canvas.width, canvas.height);
    // F-ZSL: alimenta el buffer Best-Shot con este fotograma medido.
    pushRingFrame(canvas, m?.lapVar ?? 0);
    return { canvas, m };
  }, [pushRingFrame]);

  /** Captura inteligente (E3 + DUAL PIPELINE + F-RES-PRIORITY v6.1) —
   *  la FOTO FULL-SENSOR MANDA (12–48 MP vía takePhoto, independiente
   *  del preview de 540p):
   *  1. Frame A: solo píxeles + medidas (respaldo sin coste).
   *  2. Foto hi-res del sensor (takePhoto, carrera ≤5 s ACOTADA por el
   *     presupuesto global de burst-budget — PERF) → data URL.
   *  3. Si hay foto → dispatch YA (los frames se descartan, R-14).
   *  Fallback premium si takePhoto no existe o cuelga: el ganador ZSL
   *  pre-tap (80–450 ms antes del disparo, anti tap-shock) del buffer
   *  Best-Shot compite por lapVar con snapA/snapB — antes el fallback
   *  era un frame capturado EN el instante del tap (sacudido).
   *  Nunca un frame reemplaza una foto existente (el gate de nitidez de
   *  v5 hacía que un 720p «nítido» sustituyera a una foto de 3264 px →
   *  texto ilegible). Cooldown anti doble-disparo 1500 ms (§5.2). */
  /** FIX v4 4.2 — flujo COMPLETO de captura (helpers ZSL + burst + foto).
   *  Vive aparte para que captureSmart sea un wrapper fino con el guard
   *  anti doble-disparo (capturingRef) y un try/finally SIMÉTRICO que
   *  SIEMPRE libera el obturador. */
  const runCaptureFlow = useCallback(async () => {
    if (processingRef.current) return;
    if (cooldownRef.current > Date.now()) return;
    loopRef.current?.notifyCaptured();
    cooldownRef.current = Date.now() + 1500;
    // DIAG (spec diag §6) — instrumentación de la sonda local (sin tocar
    // lógica): el disparo salió (manual o auto).
    perfProbe.mark("capture_fired");
    // v2-A13 Fase B — la ventana fired→shot ABRE aquí: mientras el hilo
    // pelea por la foto, los consumidores baratos se congelan (ring sin
    // lapVar post-fired, overlay QA sin re-renders). Zona sancionada §4:
    // NADA pre-fired se toca.
    setAcquisitionActive(true);
    // FIX v5 (5.4): la captura despierta el análisis (salir del modo espera
    // si estaba dormido — el disparo es interacción explícita).
    exitStandby();

    /* PERF/burst-budget — presupuesto de la adquisición (spec §2.7: este
     *  tramo ES el fix). El muro se cronometra desde capture_fired con
     *  performance.now() (monotónico, NUNCA rAF). Legacy (enabled:false) =
     *  cadena de esperas EXACTA de antes (race de 5 s propia del takePhoto,
     *  clamp incondicional, FileReader sin abort). */
    const burstCfg = getBurstConfig();
    const burstT0 = performance.now();
    const burstDeadline = burstCfg.enabled
      ? burstT0 + burstCfg.timeBudgetMs
      : undefined;
    pendingBurstRef.current = null; // captura nueva: sin meta heredada

    /** F-ZSL — recupera el ganador pre-tap del buffer Best-Shot (mayor
     *  lapVar entre 80 y 450 ms antes del disparo: el impacto del dedo
     *  sacude mecánicamente el teléfono, el frame PRE-tap ya está
     *  estable) y VACÍA el ring. Frame listo para el burst o null. */
    const takeZslFallback = (): BurstFrame | null => {
      const nowMs = performance.now();
      const inWindow = bestShotRingRef.current.filter((f) => {
        const age = nowMs - f.timestamp;
        return age >= 80 && age <= 450;
      });
      const winner =
        inWindow.length > 0
          ? inWindow.reduce((a, b) => (b.lapVar > a.lapVar ? b : a))
          : null;
      // El disparo se atiende: libera el ring (disciplina RAM) EXCEPTO el
      // canvas del ganador — su propiedad pasa al burst (releaseFrame lo
      // suelta al terminar el dispatch). Ponerlo a 0 aquí rompería el
      // encode (canvas 0×0 → toBlob null / toDataURL InvalidStateError).
      for (const f of bestShotRingRef.current) {
        if (f === winner) continue;
        f.canvas.width = 0;
        f.canvas.height = 0;
      }
      bestShotRingRef.current = [];
      if (!winner) return null;
      // El canvas del ring ya es una copia dedicada: entrega directo.
      return { canvas: winner.canvas, m: { lapVar: winner.lapVar, exposure: 0 } };
    };

    /** Mejor frame por lapVar → encode SOLO del ganador → dispatch.
     *  PERF/burst-budget — devuelve si despachó (para telemetría) y limpia
     *  la meta pendiente en los caminos de fallo (nada dispara
     *  capture_shot → nada que telemetrizar). */
    const dispatchBestFrame = async (
      framesRaw: Array<BurstFrame | null>
    ): Promise<boolean> => {
      const frames = framesRaw.filter((f): f is BurstFrame => f !== null);
      if (frames.length === 0) {
        // FIX v4 4.4 — burst 100 % nulo: si el stream está MUERTO, recuperar
        // la cámara (antes: solo el toast → el editor jamás abría y el visor
        // quedaba negro para siempre — exactamente el final del síntoma
        // reportado por el propietario).
        if (isStreamDead()) {
          recoverStream();
          pendingBurstRef.current = null;
          return false; // el toast de recoverStream ya informa al usuario
        }
        // B8: el disparo no debe perderse en silencio (stream vivo, frames
        // vacíos por otra causa).
        toast.error("No se pudo capturar", { description: "Inténtalo de nuevo." });
        pendingBurstRef.current = null;
        return false;
      }
      const measured = frames.filter((f) => f.m !== null);
      let winner: BurstFrame;
      if (measured.length === 0) {
        winner = frames[0]!; // sin telemetría → orden de llegada (§5.4)
      } else {
        // FIX v7 (7.3) — antes el lapVar PURO hacía que un frame del ring
        // (1280 px, capado por RAM) le ganara al snapshot full-res del
        // stream: la auto-captura entregaba SIEMPRE 1280 px aunque el stream
        // subiera de resolución (7.2). Puerta de nitidez → gana resolución.
        const bestLap = Math.max(...measured.map((f) => f.m!.lapVar));
        const pool = measured.filter(
          (f) => f.m!.lapVar >= SHARPNESS_KEEP_RATIO * bestLap,
        );
        // Entre los suficientemente nítidos gana el de MAYOR resolución
        // (área); desempate por lapVar (paridad exacta).
        winner = pool.reduce((a, b) => {
          const areaA = a.canvas.width * a.canvas.height;
          const areaB = b.canvas.width * b.canvas.height;
          if (areaB !== areaA) return areaB > areaA ? b : a;
          return b.m!.lapVar > a.m!.lapVar ? b : a;
        });
      }
      const url = await canvasToDataUrl(winner.canvas);
      for (const f of frames) releaseFrame(f);
      if (url) {
        void handleCaptureDataUrl(url);
        return true;
      } else {
        // B8: encode falló → feedback en vez de descartar el disparo.
        toast.error("No se pudo capturar", { description: "Inténtalo de nuevo." });
        pendingBurstRef.current = null;
        return false;
      }
    };

    // §5.4 — frame A ANTES de la foto: si takePhoto cuelga y cae (5 s),
    // ya queda un candidato válido medido.
    // FIX v5 (5.5): frame A SIRVE ADEMÁS de medición FRESCA de exposición
    // para el flash Auto (misma escala que la telemetría del loop:
    // 1 − (under+over)/total) — resuelve el caso «duda entre el frame y el
    // disparo >1 s» re-midiendo EN el instante del disparo.
    const snapA = snapshotVideo();

    /* FIX v5 (5.5) — flash por captura: «on» fuerza torch para el disparo;
     * «auto» decide con la exposición de snapA (fresca, pre-torch) o, si no
     * hubo frame, la del último frame del loop; «off» nunca. El torch
     * MANUAL (linterna de sesión) MANDA: si ya está ON no se toca — y por
     * tanto tampoco se apaga al terminar. flashAppliedByUs marca lo que
     * NOSOTROS encendimos (→ retirar tras obtener blob/frames). */
    const flashMode = useScannerStore.getState().settings.flashMode;
    let flashWanted = false;
    if (flashMode === "on") {
      flashWanted = true;
    } else if (flashMode === "auto") {
      const exp = snapA?.m?.exposure ?? window.__cameraTelemetry?.score?.exposure;
      flashWanted = typeof exp === "number" && exp < AUTO_FLASH_EXPOSURE;
    }
    const flashAppliedByUs =
      flashWanted && !torchOnRef.current ? await setTorchState(true) : false;
    try {
    // FIX v4 4.1 — lista negra temporal: si un takePhoto ya expiró en este
    // stream, NO se vuelve a intentar (cada disparo volvería a congelar el
    // visor 5 s) — directo al fallback de frames hasta un stream nuevo.
    /* PERF/burst-budget — LA ADQUISICIÓN BAJO PRESUPUESTO. Principio (spec
     *  §3): la adquisición termina cuando (a) la foto llega, (b) el preview
     *  lleva `stabilityFrames` muestras estables (§B — señal barata 64×64),
     *  o (c) se agota el muro global (§A) — lo primero que ocurra. Cancelación
     *  (§3): el takePhoto huérfano no es abortable (ImageCapture no expone
     *  cancelación — documentado en el PR): su carrera interna muere con el
     *  deadline compartido y su blob, si llega, no se referencia; el
     *  FileReader de la conversión SÍ se aborta de verdad. Cooldown,
     *  estabilidad del shutter y photoSettings: INTACTOS. */
    const canPhoto = canTakePhotoRef.current && !takePhotoBrokenRef.current;
    // LOTE 5.5 — modo de ESTA captura, leído una vez.
    const qualityFirstCapture = isQualityFirstPhoto();
    let shot: { blob: Blob | null; timedOut: boolean; wallCapped?: boolean } | null =
      null;
    let bail: "time_cap" | "stable" | null = null;
    let burstSamples = 0;
    let burstSampleCost: number | null = null;
    // v2-A13 Fase A — promesa CRUDA del takePhoto en vuelo (el último
    // intento): si el presupuesto corta, el observador de la foto huérfana
    // sigue su rastro SIN tocar la captura (cero escrituras al store).
    let rawPhotoPromise: Promise<Blob> | null = null;
    let upgradePromise: Promise<Blob> | null = null;
    /** LOTE 5.4 (F5.4-B) — upgrade silencioso de la página: cuando la foto
     *  full-res del sensor aterrice (~15-18 s), reemplaza el ORIGINAL de la
     *  página creada por este disparo (1920 → 4032) y re-detecta el quad.
     *  Todo el trabajo vive FUERA del flujo crítico (el usuario ya está en
     *  el editor). Fallos silenciosos: si no llega o llega roto, la página
     *  queda como está (1920). Telemetría gratuita vía watchOrphanPhoto. */
    const runSilentUpgrade = async (
      upgrade: Promise<Blob> | null,
      pageId: string | null,
      firedAtMs: number
    ): Promise<void> => {
      if (!upgrade || !pageId) return;
      // LOTE 5.5 — pill del editor mientras el upgrade vuela.
      useScannerStore.getState().updateCapturePage(pageId, { upgrading: true });
      watchOrphanPhoto(
        upgrade.then(
          (b) => b ?? new Blob(),
          () => new Blob()
        ),
        firedAtMs
      );
      try {
        const blob = await upgrade;
        if (!blob || blob.size === 0) return;
        // ¿Sigue existiendo la página? (el usuario pudo borrarla)
        const alive = useScannerStore
          .getState()
          .capturePages.some((pg) => pg.id === pageId);
        if (!alive) return;
        // Solo SUBE: si el lado mayor no supera claramente al del peldaño
        // (1920), la página no se toca.
        const longSide = await readBlobLongSide(blob);
        if (longSide === null || longSide < 2048) return;
        const rawUrl = await blobToDataUrl(blob);
        // LOTE 5.4 — guard mínimo de tipos (blobToDataUrl resuelve null si
        // el FileReader cae): sin URL no hay upgrade (silencioso, como todo
        // el runner).
        if (!rawUrl) return;
        const decoded = await loadImage(rawUrl);
        // Mismo tratamiento que el camino de siempre: tope técnico 4032.
        const scaledUrl = await downscaleImage(decoded, PROCESSED_MAX_LONG_SIDE);
        const finalUrl = scaledUrl ?? rawUrl;
        const source = scaledUrl ? await loadImage(scaledUrl) : decoded;
        useScannerStore.getState().updateCapturePage(pageId, {
          original: finalUrl,
          autoQuadPending: true,
          quality: await evaluateQuality(source),
          upgrading: false,
        });
        // Re-detección del quad sobre la foto nueva (FOV 4:3 ≠ peldaño 1:1):
        // la pill «Ajustando recorte…» del editor cubre la espera.
        void applyAutoQuad(pageId, source);
      } catch {
        /* silencioso: el upgrade JAMÁS rompe nada */
      } finally {
        // LOTE 5.5 — la pill se retira SIEMPRE (éxito, early-return o
        // fallo). Sobre una página borrada = no-op (id inexistente).
        useScannerStore.getState().updateCapturePage(pageId, { upgrading: false });
      }
    };
    if (qualityFirstCapture && canPhoto) {
      // LOTE 5.5 — calidad primero: UNA carrera de 20 s contra el sensor,
      // sin muro del burst ni sampler (la espera es del ISP; burstSamples
      // queda 0/null — campos nullable, recordBurst los tolera). Si expira
      // → timedOut → lista negra + frame fallback de siempre (comportamiento
      // pre-5.3 conocido).
      shot = await takePhotoBlob(performance.now() + 20000, (p) => {
        rawPhotoPromise = p;
      });
    } else if (burstDeadline !== undefined) {
      if (performance.now() >= burstDeadline) {
        // El torch/flash (applyConstraints no abortable) consumió el muro
        // ENTERO: la foto ni se dispara — frames YA, sin toast engañoso.
        bail = "time_cap";
      } else {
        const sampler = makeThumbSampler(() => videoRef.current);
        sampler.baseline();
        const w = await waitForPhotoBudget(
          () =>
            canPhoto
              ? takePhotoBlob(
                  burstDeadline,
                  (p) => {
                    rawPhotoPromise = p;
                  },
                  (p) => {
                    upgradePromise = p;
                  }
                )
              : Promise.resolve({ blob: null, timedOut: false }),
          { deadlineAt: burstDeadline, sampler }
        );
        burstSamples = w.samples;
        burstSampleCost = w.lastSampleCostMs;
        if (w.settled === "value") {
          shot =
            (w.value as
              | { blob: Blob | null; timedOut: boolean; wallCapped?: boolean }
              | null) ?? { blob: null, timedOut: false };
        } else {
          bail = w.settled;
        }
      }
    } else {
      shot = canPhoto
        ? await takePhotoBlob(
            qualityFirstCapture ? performance.now() + 20000 : undefined,
            undefined,
            qualityFirstCapture
              ? undefined
              : (p) => {
                  upgradePromise = p;
                }
          )
        : null;
    }
    const burstExtra = {
      samples: burstSamples,
      lastSampleCostMs: burstSampleCost,
    };

    /** v3 Fase D §2.4 — camino UNIFICADO `blob → página` para la foto de
     *  gracia: la MISMA secuencia que recorre una foto ganada por carrera
     *  (capa 2 de takePhotoBlob → FileReader → handleCaptureDataUrl), cero
     *  lógica paralela. La huérfana es el blob CRUDO del sensor (nunca pasó
     *  por el clamp) → MISMO tratamiento: sniff de cabecera (~192 KB, salta
     *  el decode de 12 MP si ya está dentro del tope) + clamp al tope
     *  seguro del profiler + conversión SIN deadline (el muro ya cortó; el
     *  usuario espera ESTA foto). Devuelve true si el mark capture_shot se
     *  emitió (handleCaptureDataUrl consumió la meta colgada por el
     *  llamador ANTES de llamar aquí — orden obligatorio). */
    const dispatchPhotoBlob = async (blob: Blob): Promise<boolean> => {
      try {
        const capPx =
          sensorProfileRef.current?.safeCapPx ?? getSensorSafeCap();
        // v4 §2.1 (v4.3) — sub-marks del TRAMO OPACO (reloj monotónico):
        // cuánto de los ~14.6 s post-corte es sniff real (~192 KB), cuánto
        // FileReader (3.5 MB → base64 4.7 MB) y cuánto NADA medible (la
        // congestión que v5 debe atacar). Solo rutas con corte — el tramo
        // está abierto por recordBurst({cutPipe}); en el resto son no-ops.
        const sniffT0 = performance.now();
        const sniffed = await readBlobLongSide(blob);
        noteBurstPipeSniff(performance.now() - sniffT0);
        // LOTE 5 (F5-D) — lado mayor del blob de gracia (el sniff que ya
        // hace dispatchPhotoBlob) expuesto al diag via ref: el mark
        // capture_shot lo lee para camera.photoOutLongSide.
        lastPhotoBlobLongSideRef.current = sniffed;
        const clamped =
          sniffed !== null && sniffed <= capPx
            ? blob
            : await clampBlobToSafeCap(blob, capPx);
        const urlT0 = performance.now();
        const url = await blobToDataUrl(clamped);
        noteBurstPipeDataUrl(performance.now() - urlT0);
        if (!url) return false;
        await handleCaptureDataUrl(url);
        return true;
      } catch {
        return false; // FileReader del camino de foto falló (rarísimo)
      }
    };

    /** v3 Fase D §2.2-2.3 — CORTE DEL PRESUPUESTO CON GRACIA DE LA FOTO
     *  HUÉRFANA. Unifica las DOS zonas de corte (bail ≠ null y el muro sobre
     *  la carrera interna del takePhoto — antes duplicadas). ANTES de armar
     *  candidatos: si hay foto en vuelo y photoGraceMs > 0, correr la
     *  gracia — el hilo YA está libre (el bucle del presupuesto hizo
     *  clearInterval) y la promesa encolada resuelve en decenas de ms
     *  (evidencia 6/6 del experimento de palanca: huérfana − corte
     *  = +18-42 ms, sin importar la duración del muro). Si llega → foto
     *  COMPLETA por el camino de siempre; si no → el dispatch de frames
     *  EXACTO de antes (con la huérfana OBSERVADA por la Fase A). */
    const dispatchAfterCut = async (reason: BurstExitReason): Promise<void> => {
      // §2.1 — lectura de la gracia EN el corte (la palanca __burstTools
      // aplica aquí, no en capture_fired).
      const graceMs = getBurstConfig().photoGraceMs;
      let gracePhoto: Blob | null = null;
      let graceWaitedMs: number | null = null;
      if (rawPhotoPromise && graceMs > 0) {
        const t0 = performance.now();
        // Reloj monotónico + setTimeout (fiable AQUÍ: el hilo quedó libre al
        // cortar el bucle). PROHIBIDO rAF. Rechazo/mono vacío → null YA,
        // sin esperar la gracia completa (el race lo hace).
        const winner = await Promise.race([
          rawPhotoPromise.then(
            (b) => (b && b.size > 0 ? { blob: b } : null),
            () => null
          ),
          new Promise<null>((r) => window.setTimeout(() => r(null), graceMs)),
        ]).catch(() => null);
        graceWaitedMs = Math.round(performance.now() - t0);
        gracePhoto = winner?.blob ?? null;
      }
      if (gracePhoto) {
        // §2.5 — el sensor ENTREGÓ (tarde, pero entregó): NO es takePhoto
        // roto → desactivar la lista negra que pudo marcar el timeout de
        // la carrera interna (cierra el Hallazgo A de la auditoría).
        // PROHIBIDO blacklistear por wallCapped: corte ≠ sensor roto.
        takePhotoBrokenRef.current = false;
        pendingBurstRef.current = recordBurst(
          "photo_grace",
          0,
          performance.now() - burstT0,
          {
            ...burstExtra,
            photoBytes: gracePhoto.size,
            graceWaitedMs,
            dispatchSource: "photo",
            // v4 §2.1 — ruta con corte: abre el tramo opaco que el mark
            // capture_shot cerrará (pipeToMarkMs + sub-marks del pipe).
            cutPipe: true,
          }
        );
        if (await dispatchPhotoBlob(gracePhoto)) return;
        // Conversión del camino de foto falló (rarísimo): la meta se
        // SOBREESCRIBE abajo con la razón verdadera y cae a frames.
      }
      // Fallback: exactamente el código de antes de la Fase D (frames del
      // preview) — el ring se drena, la huérfana queda OBSERVADA (Fase A).
      watchOrphanPhoto(rawPhotoPromise, burstT0);
      const cands = [takeZslFallback(), snapA, snapshotVideo()];
      const n = cands.filter((f): f is BurstFrame => f !== null).length;
      pendingBurstRef.current = recordBurst(
        reason,
        n,
        performance.now() - burstT0,
        // v4 §2.1 — ruta con corte (dispatch de frames): abre el tramo
        // opaco para pipeToMarkMs (sniff/dataUrl quedan null — no corrieron).
        { ...burstExtra, graceWaitedMs, dispatchSource: "frames", cutPipe: true }
      );
      // D-02 (parte 1) — sin cutPipe: un error final no abre el tramo
      // opaco (el intervalo de la sonda heap queda huérfano hasta el
      // PRÓXIMO recordBurst; tras un error nadie lo cierra). Alineado con
      // los otros dos error-paths (L2071/L2131) que llaman sin cutPipe.
      if (!(await dispatchBestFrame(cands))) {
        pendingBurstRef.current = recordBurst("error", 0, performance.now() - burstT0, burstExtra);
      }
    };

    if (bail !== null) {
      // §A/§B — el presupuesto cortó la espera. v3 Fase D: ANTES de armar
      // candidatos, la gracia de la foto huérfana (si la foto del sensor
      // está en vuelo, resuelve en decenas de ms con el hilo ya libre —
      // se despacha la foto COMPLETA en vez de frames de 960 px).
      await dispatchAfterCut(bail);
      return;
    }

    const photoBlob = shot?.blob ?? null;
    if (!photoBlob) {
      // PERF/burst-budget — si la carrera del takePhoto la cortó el MURO
      // (wallCapped: raceMs < 5000, no un timeout orgánico de 5 s), es un
      // corte de presupuesto: mismo dispatch de frames PERO con razón
      // time_cap y SIN el toast «la foto no respondió» (no falló: llegó
      // tarde). Determinista: gane la carrera interna o el interval del
      // muro, el resultado es SIEMPRE time_cap.
      if (burstDeadline !== undefined && shot?.timedOut === true && shot.wallCapped === true) {
        // v2-A13 Fase A — muro sobre la carrera interna: misma foto huérfana
        // en vuelo. v3 Fase D — MISMO helper de gracia que la zona bail ≠
        // null (unifica ambas zonas de corte: gracia → foto completa o el
        // dispatch de frames de siempre).
        await dispatchAfterCut("time_cap");
        return;
      }
      // FIX v4 4.3 — chequeo post-timeout: un takePhoto colgado puede dejar
      // el track muted/en silencio (readyState "live", sin frames). Si el
      // stream murió, recuperar YA — no disparamos el burst contra un video
      // muerto (el editor abriría sin imagen o nada).
      // FIX v6 (6.2): MISMA comprobación de FRESCURA — un takePhoto colgado
      // puede dejar el video CONGELADO sin mutearlo (isStreamDead pasa):
      // si el latido está viejo, el stream está igual de muerto.
      if (
        shot?.timedOut &&
        (isStreamDead() || performance.now() - lastFrameAtRef.current > 4000)
      ) {
        recoverStream();
        return;
      }
      // DUAL PIPELINE — fallback: el ganador ZSL pre-tap (estable, anti
      // tap-shock) compite por lapVar con snapA y el frame actual.
      // PERF/burst-budget — §C: este dispatch ya recolecta ≤3 candidatos
      // (techo de frames como MÁXIMO, nunca requisito) → `frame_cap`.
      const zsl = takeZslFallback();
      const cands = [zsl, snapA, snapshotVideo()];
      const n = cands.filter((f): f is BurstFrame => f !== null).length;
      pendingBurstRef.current = recordBurst(
        burstDeadline !== undefined ? "frame_cap" : "legacy",
        n,
        performance.now() - burstT0,
        burstExtra
      );
      if (!(await dispatchBestFrame(cands))) {
        pendingBurstRef.current = recordBurst("error", 0, performance.now() - burstT0, burstExtra);
      }
      return;
    }

    // Bracket §5.4: frame B justo después de la foto (solo píxeles).
    const snapB = snapshotVideo();

    // F-RES-PRIORITY v6.1 — la foto full-sensor SIEMPRE gana. Antes, si la
    // foto no pasaba el gate de nitidez (óptica blanda + ruido en gama
    // baja), el ranking del burst podía preferir un frame de preview MÁS
    // NÍTIDO pero de 720p/1080p → texto ilegible. La resolución es
    // intocable: una foto algo blanda a 3264 px siempre supera a un frame
    // perfecto de 720p (el enhance afina; retomar cuesta un toque).
    let photoUrl: string | null = null;
    // LOTE 5.5.1 — en calidad-primero el presupuesto de la captura es la
    // carrera de 20 s: la foto puede volver legalmente tarde (el clamp de
    // un 12 MP cuesta ~4.5 s en gama baja). El muro del auto-shutter NO la
    // corta. Evidencia diag 2026-10-14 20:22-20:27 SM-A135M modo calidad:
    // naked ganó a 1.17 s (4080 px) pero el retorno a ~5.7 s vencía el muro
    // → la foto full-res se descartaba por frames de 960 (time_cap ×5).
    if (burstDeadline !== undefined && !qualityFirstCapture) {
      if (burstDeadline - performance.now() <= 50) {
        // Foto en mano pero SIN presupuesto para el FileReader (un 12 MP
        // cuesta 1–3 s en gama baja): el muro se respeta → frames YA.
        photoUrl = null;
      } else {
        photoUrl = await blobToDataUrl(photoBlob, burstDeadline);
      }
    } else {
      try {
        photoUrl = await blobToDataUrl(photoBlob);
      } catch {
        photoUrl = null; // FileReader falló (rarísimo) → burst de frames
      }
    }
    if (photoUrl) {
      releaseFrame(snapA);
      releaseFrame(snapB);
      pendingBurstRef.current = recordBurst(
        burstDeadline !== undefined ? "photo" : "legacy",
        1,
        performance.now() - burstT0,
        { ...burstExtra, photoBytes: photoBlob.size }
      );
      const upgradePageId = await handleCaptureDataUrl(photoUrl);
      if (upgradePromise) {
        void runSilentUpgrade(upgradePromise, upgradePageId, burstT0);
      }
      return;
    }
    if (burstDeadline !== undefined) {
      // El muro abortó la conversión (o el reader cayó) con la foto en mano
      // → dispatch de frames: ganador ZSL + bracket snapA/snapB.
      const exit: BurstExitReason =
        performance.now() >= burstDeadline ? "time_cap" : "error";
      const cands = [takeZslFallback(), snapA, snapB];
      const n = cands.filter((f): f is BurstFrame => f !== null).length;
      pendingBurstRef.current = recordBurst(exit, n, performance.now() - burstT0, burstExtra);
      if (!(await dispatchBestFrame(cands))) {
        pendingBurstRef.current = recordBurst("error", 0, performance.now() - burstT0, burstExtra);
      }
      return;
    }
    await dispatchBestFrame([snapA, snapB]);
    } finally {
      // FIX v5 (5.5): retirar el torch que NOSOTROS encendimos para ESTE
      // disparo (foto/frames ya en memoria). El torch MANUAL del usuario
      // no se apaga nunca aquí (flashAppliedByUs solo es true si partía
      // de OFF y el modo lo pidió).
      // v2-A13 Fase B — cierre de seguridad de la ventana fired→shot para
      // los caminos que NUNCA llegan a capture_shot (dispatch fallido,
      // stream muerto, torch que comió el muro): el ring y el overlay QA
      // no pueden quedar congelados para siempre (idempotente).
      setAcquisitionActive(false);
      if (flashAppliedByUs) void setTorchState(false);
      // A-08 (auditoría leaks-recursos) — liberar snapA en TODOS los
      // caminos: los returns tempranos (bail/wallCap/stream muerto) salían
      // sin releaseFrame y el snapshot full-res (1-11 MP) quedaba al GC.
      // Idempotente (doble release inofensivo) y SOLO snapA: snapB se
      // declara después de esos returns (TDZ si se toca aquí).
      releaseFrame(snapA);
    }
  }, [snapshotVideo, takePhotoBlob, canvasToDataUrl, blobToDataUrl, handleCaptureDataUrl, status, isStreamDead, recoverStream, setTorchState, exitStandby]);

  /** Captura inteligente con el obturador BLOQUEADO durante TODO el
   *  disparo (FIX v4 4.2). Antes solo processingRef protegía — y se activa
   *  DESPUÉS del burst/takePhoto — así que en los hasta 5-16 s del disparo
   *  el botón seguía activo: N toques encolaban N takePhoto() simultáneos
   *  → cascada de InvalidStateError y el sensor terminaba roto (feed del
   *  negro permanente). capturingRef + isCapturing cierran esa ventana:
   *  un solo flujo de captura, feedback visual y finally SIEMPRE libera. */
  const captureSmart = useCallback(async () => {
    if (capturingRef.current) return;
    capturingRef.current = true;
    setIsCapturing(true);
    try {
      await runCaptureFlow();
    } finally {
      capturingRef.current = false;
      setIsCapturing(false);
    }
  }, [runCaptureFlow]);

  const captureSmartRef = useRef(captureSmart);
  captureSmartRef.current = captureSmart;

  /** Página de demo (factura) para probar sin cámara ni stream. */
  const captureDemo = useCallback(() => {
    setMenuOpen(false);
    void handleCaptureDataUrl(generateDemoPage(pageCount + 1));
  }, [handleCaptureDataUrl, pageCount]);

  /** Escena estática para la vista simulada sin stream (último recurso). */
  const demoPreview = useMemo(
    () => (status === "simulated" ? generateDemoPage(1) : ""),
    [status]
  );

  /** Shutter — ruta POR PLATAFORMA (§5.2, HQ-iOS — error #5):
   *  · Stream real + ImageCapture (Chrome/Android) → captureSmart() con
   *    revalidación de burst (foto full-res del sensor).
   *  · Stream real SIN ImageCapture (Safari/iOS) → cámara NATIVA del
   *    sistema vía input capture=environment (foto 12–48 MP). El click del
   *    shutter ES el gesto de usuario que iOS exige para abrir la cámara.
   *  · Stream sintético (QA sin hardware) → frames del stream.
   *  · Escena estática → demo. Sin stream → galería. */
  const onShutter = useCallback(() => {
    // FIX v4 4.2 — además del guard de captureSmart, corta aquí el click
    // para no encolar nada mientras dura un disparo en curso.
    if (capturingRef.current || processingRef.current) return;
    if (hasStream && videoRef.current && videoRef.current.readyState >= 2) {
      if (canTakePhotoRef.current || status !== "live") {
        void captureSmart();
      } else {
        captureInputRef.current?.click(); // HQ-iOS: cámara nativa
      }
      return;
    }
    if (status === "simulated") {
      captureDemo();
      return;
    }
    captureInputRef.current?.click();
  }, [hasStream, status, captureSmart, captureDemo]);

  // F-IMPORT (robusto) + F-HEIC: el File se decodifica con la cascada nativa
  // (createImageBitmap con EXIF → <img>) y, si el navegador no abre el formato
  // (HEIC en Android/Chrome, o «.jpg» con contenido HEIC), se convierte con
  // libheif (heic2any) dentro de fileToCaptureDataUrl. La conversión puede
  // tardar unos segundos en fotos de 12 MP → toast de progreso.
  const onFilePicked = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      const looksImage = file.type.startsWith("image/") || /\.(heic|heif|jpe?g|png|webp|bmp|gif|avif)$/i.test(file.name);
      if (!looksImage) {
        toast.error("El archivo seleccionado no es una imagen");
        return;
      }
      const looksHeic = /heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
      // Heurística: los «.jpg» de iPhone transportados por apps pueden traer
      // contenido HEIC; si la decodificación nativa falla también irán al
      // rescate, pero no podemos saberlo de antemano → toast solo si es HEIC.
      const toastId = looksHeic
        ? toast.loading("Convirtiendo HEIC… (puede tardar unos segundos)")
        : undefined;
      void (async () => {
        try {
          const dataUrl = await fileToCaptureDataUrl(file);
          if (toastId !== undefined) toast.success("Imagen lista", { id: toastId, duration: 1500 });
          await handleCaptureDataUrl(dataUrl);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "";
          if (toastId !== undefined) toast.dismiss(toastId);
          if (/heic|heif/i.test(msg)) {
            toast.error("No se pudo convertir el HEIC", { description: "El archivo parece dañado o protegido. Prueba con otro." });
          } else {
            toast.error("No se pudo procesar la imagen", { description: "El archivo puede estar corrupto o ser un formato no soportado." });
          }
        }
      })();
    },
    [handleCaptureDataUrl]
  );

  /** F-NOVIEW: cierre de la cámara (X). En modo documento (Añadir página
   *  desde un doc guardado) fusiona lo capturado con su documento antes de
   *  salir — auto-guardado patrón Adobe Scan. Sesión de captura normal:
   *  vuelve sin guardar (el editor decide cuándo guardar). */
  const closeToLibrary = useCallback(() => {
    const s = useScannerStore.getState();
    if (s.reviewDocId) {
      if (s.capturePages.length > 0) {
        void s.saveSessionToDocument();
      } else {
        // Sesión vacía (p. ej. Repetir de la última página y se arrepintió):
        // restaura el documento tal cual — nada que fusionar.
        useScannerStore.setState({ capturePages: [], editingIndex: 0, reviewDocId: null });
      }
    }
    setView("library");
  }, [setView]);

  const goToEditor = useCallback(() => {
    if (pageCount === 0) {
      toast("Captura primero una página");
      return;
    }
    setView("editor");
  }, [pageCount, setView]);

  /* ── Arranque de cámara: real → sintética → estática ─────────────── */

  useEffect(() => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return;
    // DIAG (spec diag §5) — sesión de cámara: apertura del visor (t0).
    // SOLO instrumentación (el timer de FPS tarde vive en su propio efecto
    // con cleanup, para cubrir también el return temprano de abajo).
    diagCameraOpenT0Ref.current = performance.now();
    diagCameraReadyRef.current = false;
    perfProbe.mark("camera_open");
    let cancelled = false;
    const media = navigator.mediaDevices;
    if (!media || typeof media.getUserMedia !== "function" || !window.isSecureContext) {
      void startSynthetic();
      return;
    }

    const applyStream = (stream: MediaStream) => {
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      setStatus("live");
      setCamNotice(null); // B2: si había aviso de permiso, ya no aplica
      // v2-A13 Fase A — videoTrack del informe burst (una vez por stream).
      noteStreamTrackSize(stream);
      // B3: si el track muere (permiso revocado a mitad de sesión, otra app
      // roba la cámara, desconexión de webcam) → re-arranca el flujo completo
      // (sondas incluidas) en vez de dejar el preview negro/congelado.
      // NOTA: track.stop() NO dispara "ended" — no hay bucle con el cleanup.
      const endedTrack = stream.getVideoTracks()[0];
      if (endedTrack) {
        endedTrack.onended = () => {
          if (cancelled) return;
          toast.error("Se perdió la cámara", {
            description: "Reconectando…",
            duration: 4000,
          });
          setCamRestartNonce((n) => n + 1);
        };
      }
      // §5.2 + FIX v6 (6.1) — régimen por PLATAFORMA, no por API: Safari
      // moderno (iOS 17+/26) expone ImageCapture con un takePhoto() que se
      // cuelga → canTakePhotoRef SOLO es true en Android/Chrome. En iOS el
      // shutter manual abre la cámara nativa y la auto-captura usa frames
      // del stream ALTO (1920×1440, fix v3). Toast único por sesión (§5.2).
      canTakePhotoRef.current = CAN_TAKEPHOTO;
      // FIX v4 4.1 — stream nuevo = nueva oportunidad para takePhoto: la
      // lista negra temporal era del stream anterior (sensor colgado).
      takePhotoBrokenRef.current = false;
      // F-SENSOR-PROFILER (PASO 2): mide la nativa de FOTO del sensor y
      // fija el tope técnico único (4032 px) para takePhotoBlob.
      profileActiveSensor(stream);
      // Linterna — F-FLASH v3: cámara real → el botón se habilita SIEMPRE
      // (la verdad del torch se verifica al pulsar, aplicando y leyendo
      // getSettings); si el usuario dejó el flash ON, se re-aplica con
      // reintentos hasta que el track lo acepte.
      setTorchAvailable(true);
      if (flashRef.current) applySavedTorchWithRetry();
      // FIX v7 (7.2) — subida progresiva: 2 s tras abrir para no tocar el
      // arranque rápido (5.3). El guard `cancelled` del cierre evita tocar
      // un track ya liberado.
      window.setTimeout(() => {
        if (cancelled) return;
        upgradeStreamResolution(stream.getVideoTracks()[0]);
      }, STREAM_UPGRADE_DELAY_MS);
    };

    /** B2: ¿el error es de PERMISO denegado (a diferencia de “no hay
     *  cámara” NotFoundError u “ocupada” NotReadableError)? */
    const isPermError = (e: unknown): boolean =>
      e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
    let permissionDenied = false;

    /** E3 + DUAL PIPELINE: cascada de apertura — el PREVIEW pide 960×540
     *  ideal + 30 FPS (fluido en gama baja; la captura hi-res va por
     *  takePhoto al sensor). F-LENS: el primer intento fuerza EXACT la
     *  trasera (en algunos móviles "environment" a secas negocia la gran
     *  angular);
     *  si el exact falla se relaja a ideal → {video:true}. */
    const openWithCascade = async (): Promise<MediaStream | null> => {
      const attempts: MediaStreamConstraints[] = [
        {
          video: {
            facingMode: { exact: "environment" },
            width: { ideal: IDEAL_PREVIEW_WIDTH },
            height: { ideal: IDEAL_PREVIEW_HEIGHT },
            frameRate: { ideal: IDEAL_PREVIEW_FPS },
          },
          audio: false,
        },
        {
          video: {
            facingMode: "environment",
            width: { ideal: IDEAL_PREVIEW_WIDTH },
            height: { ideal: IDEAL_PREVIEW_HEIGHT },
            frameRate: { ideal: IDEAL_PREVIEW_FPS },
          },
          audio: false,
        },
        { video: { facingMode: "environment" }, audio: false },
        { video: true, audio: false },
      ];
      for (const c of attempts) {
        try {
          return await media.getUserMedia(c);
        } catch (err) {
          if (isPermError(err)) permissionDenied = true;
          /* siguiente nivel */
        }
      }
      return null;
    };

    /** F-LENS v4 — arranque estilo codigo-test (donde el flash SÍ funciona):
     *  0) FIX v5 (5.3) — CACHÉ: deviceId guardada → apertura DIRECTA con las
     *     constraints del preview ideal (sin desbloqueo/sondeos/elección).
     *     Falla → caché borrada y camino completo.
     *  1) desbloquea labels con un stream genérico que se cierra al instante;
     *  2) sondea TODAS las cámaras UNA POR UNA cerrando cada una antes de
     *     abrir la siguiente (v3 las sondeaba con el stream vivo → en muchos
     *     Android la 2ª apertura lanza NotReadableError y NADA cambiaba);
     *     FIX v5 (5.3): cada sonda con plazo de 2 s (una cámara lenta no
     *     puede bloquear el arranque);
     *  3) elige la principal con la regla D3/D6 (autofocus real → mayor
     *     resolución; torch desempata; sin AF → label más simple);
     *  4) abre SOLO la ganadora con el preview ligero (960×540 ideal —
     *     DUAL PIPELINE; la captura hi-res va por takePhoto al sensor) y
     *     persiste la elección para el próximo arranque rápido.
     *  Devuelve el stream de la principal o null (→ cascade/sintética). */
    const openMainCamera = async (): Promise<MediaStream | null> => {
      /** FIX v5 (5.3): post-procesado común a cualquier apertura exitosa —
       *  corrección de zoom (vía zoom < 1 → 1) y telemetría de QA. */
      const polishStream = async (
        stream: MediaStream,
        info: { label: string; torch: boolean; focusModes: string[] } | null,
        probes: CameraProbeResult[],
        cacheHit: boolean
      ): Promise<MediaStream> => {
        // Vía zoom: si el track abrió con zoom < 1 (equivalente 0.5× del
        // MISMO track), súbelo a 1 para el FOV de la principal.
        try {
          const track = stream.getVideoTracks()[0];
          const zcaps = track?.getCapabilities?.() as
            | { zoom?: { min?: number; max?: number } }
            | undefined;
          const zst = track?.getSettings?.() as { zoom?: number } | undefined;
          if (
            zcaps?.zoom &&
            typeof zcaps.zoom.min === "number" &&
            zcaps.zoom.min < 1 &&
            typeof zst?.zoom === "number" &&
            zst.zoom < 1
          ) {
            await track
              ?.applyConstraints({
                advanced: [{ zoom: 1 }],
              } as MediaTrackConstraints & { advanced: unknown[] })
              .catch(() => undefined);
          }
        } catch {
          /* sin soporte de zoom */
        }
        // Telemetría de QA (window.__cameraChoice): qué lente quedó abierta
        // y qué se midió en las sondas — útil para depurar remotamente.
        try {
          const track = stream.getVideoTracks()[0];
          const st = track?.getSettings?.() as {
            width?: number;
            height?: number;
          } | undefined;
          (window as unknown as { __cameraChoice?: unknown }).__cameraChoice = {
            elegida: info?.label ?? track?.label ?? "",
            torch: info?.torch ?? false,
            focusModes: info?.focusModes ?? [],
            width: st?.width ?? 0,
            height: st?.height ?? 0,
            cache: cacheHit,
            sondas: probes.map((p) => ({
              label: p.label,
              torch: p.torch,
              af: p.focusModes,
              max: `${p.maxWidth}x${p.maxHeight}`,
            })),
          };
        } catch {
          /* solo telemetría */
        }
        return stream;
      };

      // 0) FIX v5 (5.3) — vía rápida: abrir la deviceId cacheada con las
      //    MISMAS constraints de preview ideal del camino completo.
      const cached = readMainCameraCache();
      if (cached) {
        try {
          const stream = await media.getUserMedia({
            video: {
              deviceId: { exact: cached.deviceId },
              width: { ideal: IDEAL_PREVIEW_WIDTH },
              height: { ideal: IDEAL_PREVIEW_HEIGHT },
              frameRate: { ideal: IDEAL_PREVIEW_FPS },
            },
            audio: false,
          });
          return await polishStream(
            stream,
            { label: cached.label, torch: cached.torch, focusModes: cached.focusModes },
            [],
            true
          );
        } catch (err) {
          // Invalidación SOLO por fallo (sin TTL): NotFound/NotReadable/
          // permiso revocado → borrar y sondear completo como antes.
          clearMainCameraCache();
          if (isPermError(err)) permissionDenied = true;
        }
      }
      // 1) Desbloqueo de etiquetas (F1-a de codigo-test): sin permiso previo
      //    los labels/deviceIds llegan vacíos en enumerateDevices.
      try {
        const unlock = await media.getUserMedia({ video: true, audio: false });
        unlock.getTracks().forEach((t) => t.stop());
      } catch (err) {
        if (isPermError(err)) permissionDenied = true;
        /* sin permiso: los probes fallarán y se cae al cascade */
      }
      // 2) Sondeo secuencial: cada cámara se ABRE, se MIDE y se CIERRA.
      //    FIX v5 (5.3): plazo de 2 s por sonda.
      let devices: MediaDeviceInfo[] = [];
      try {
        devices = (await media.enumerateDevices()).filter(
          (d) => d.kind === "videoinput" && d.deviceId
        );
      } catch {
        devices = [];
      }
      const probes: CameraProbeResult[] = [];
      for (const d of devices) {
        const p = await probeCamera(media, d.deviceId, d.label, PROBE_TIMEOUT_MS);
        if (p) probes.push(p);
      }
      // 3) Elección de la principal (D3: AF real → mayor resolución).
      const main = chooseMainProbe(probes);
      // 4) Apertura SOLO de la ganadora (con fallbacks en cascada).
      // DUAL PIPELINE: preview 540p en vivo; el sensor completo solo
      // despierta en el instante de la captura (takePhoto).
      const attempts: MediaStreamConstraints[] = main
        ? [
            {
              video: {
                deviceId: { exact: main.deviceId },
                width: { ideal: IDEAL_PREVIEW_WIDTH }, // 540p en vivo
                height: { ideal: IDEAL_PREVIEW_HEIGHT },
                frameRate: { ideal: IDEAL_PREVIEW_FPS }, // tope suave: menos ISP/GPU
              },
              audio: false,
            },
            { video: { deviceId: { exact: main.deviceId } }, audio: false },
          ]
        : [];
      attempts.push({ video: true, audio: false }); // último recurso
      for (let ai = 0; ai < attempts.length; ai += 1) {
        try {
          const stream = await media.getUserMedia(attempts[ai]!);
          // FIX v5 (5.3): persistir la elección SOLO si el stream abrió con
          // la deviceId de la ganadora (los 2 primeros intentos la fijan;
          // el "último recurso" {video:true} puede abrir OTRA cámara).
          if (main && ai <= 1) writeMainCameraCache(main);
          return await polishStream(stream, main, probes, false);
        } catch (err) {
          if (isPermError(err)) permissionDenied = true;
          /* siguiente nivel */
        }
      }
      return null;
    };

    void (async () => {
      // F-LENS v4: primero el camino de codigo-test (sondas secuenciales +
      // principal por resolución/AF); cascade facingMode como red de seguridad.
      let stream = await openMainCamera();
      if (!stream) stream = await openWithCascade();
      if (!stream) {
        // B2: permiso denegado explícitamente → aviso con CTA (el modo
        // simulado sigue activo debajo para no dejar la pantalla muerta).
        if (!cancelled && permissionDenied) setCamNotice("denied");
        if (!cancelled) void startSynthetic();
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      applyStream(stream);
    })();

    async function startSynthetic(): Promise<void> {
      const cam = new SyntheticCamera();
      const stream = await cam.start();
      if (cancelled || !stream) {
        cam.stop();
        if (!cancelled) setStatus("simulated");
        return;
      }
      syntheticRef.current = cam;
      streamRef.current = stream;
      setStatus("synthetic");
      // v2-A13 Fase A — videoTrack del informe burst (streams sintéticos
      // incluidos: hace verificable E2E el campo del informe).
      noteStreamTrackSize(stream);
    }

    return () => {
      cancelled = true;
      // B3: desuscribir el listener del track antes de pararlo (stop() no
      // dispara "ended", pero evitamos cualquier callback rezagado).
      const t = streamRef.current?.getVideoTracks()[0];
      if (t) t.onended = null;
      streamRef.current?.getTracks().forEach((st) => st.stop());
      streamRef.current = null;
      syntheticRef.current?.stop();
      syntheticRef.current = null;
    };
  }, [applySavedTorchWithRetry, camRestartNonce, upgradeStreamResolution]);

  // DIAG (spec diag §5 · v1.1) — 2ª muestra de FPS de la vista de cámara a
  // los 10 s de sesión (frío vs caliente dentro de una MISMA sesión). Antes
  // eran 30 s: el iPhone cerraba la cámara antes y perdía el sample tardío
  // (lote 2). Su propio efecto con cleanup: nunca dispara tras cerrar.
  useEffect(() => {
    const diagLateFpsTimer = window.setTimeout(() => {
      void perfProbe.fpsSample(3000).then((s) => {
        if (s) perfProbe.mark("fps_camera", { fps: s.fps, phase: "late" });
      });
    }, 10_000);
    return () => window.clearTimeout(diagLateFpsTimer);
  }, []);

  // Asigna el stream al <video> (real o sintético)
  useEffect(() => {
    if (!hasStream) return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
    // F-FLASH v3: reintento por evento — algunos Android no aceptan el
    // torch hasta que el video REALMENTE reproduce. Si al disparar
    // "playing" la preferencia sigue pendiente, se vuelve a aplicar.
    const onPlaying = () => {
      if (flashRef.current && !torchOnRef.current) applySavedTorchWithRetry();
      // DIAG (spec diag §5) — primer frame decodificado: cámara lista (ms
      // desde camera_open) + 1ª muestra de FPS de la vista de cámara
      // (phase "early"). UNA vez por sesión de cámara.
      if (!diagCameraReadyRef.current) {
        diagCameraReadyRef.current = true;
        // LOTE 5 (F5-D) — resolución REAL del track (track.getSettings),
        // capturada en el mark camera_ready para diag v6 (camera.streamW/H).
        // Solo si getSettings expone width/height (algunos UA tardan); si no,
        // los campos quedan null (aditivos, sin romper nada).
        const camSettings = streamRef.current?.getVideoTracks()[0]?.getSettings();
        perfProbe.mark("camera_ready", {
          ms: Math.max(
            0,
            Math.round(performance.now() - diagCameraOpenT0Ref.current)
          ),
          ...(typeof camSettings?.width === "number"
            ? { streamW: camSettings.width }
            : {}),
          ...(typeof camSettings?.height === "number"
            ? { streamH: camSettings.height }
            : {}),
        });
        void perfProbe.fpsSample(3000).then((s) => {
          if (s) perfProbe.mark("fps_camera", { fps: s.fps, phase: "early" });
        });
      }
    };
    video.addEventListener("playing", onPlaying);
    // FIX v6 (6.2) — LATIDO de frames: bucle rVFC que actualiza
    // lastFrameAtRef en CADA frame decodificado (Safari 15.4+ y Chrome;
    // si rVFC no existiera, el fallback es el onFrame del loop). El
    // watchdog (abajo) usa este latido para detectar video congelado
    // SIN estar muted — el hueco que v4 4.3 dejaba abierto.
    lastFrameAtRef.current = performance.now(); // stream nuevo = latido fresco
    let vfcHandle = 0;
    const beat = () => {
      lastFrameAtRef.current = performance.now();
      vfcHandle = video.requestVideoFrameCallback(beat);
    };
    if (typeof video.requestVideoFrameCallback === "function") {
      vfcHandle = video.requestVideoFrameCallback(beat);
    }
    // Al volver de background iOS reanuda el video (pausado = sin frames
    // es NORMAL, no una muerte): reset del latido (gracia) + play() para
    // que el watchdog no dispare una recuperación espuria.
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        lastFrameAtRef.current = performance.now();
        if (video.paused) void video.play().catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      video.removeEventListener("playing", onPlaying);
      document.removeEventListener("visibilitychange", onVisibility);
      if (vfcHandle && video.cancelVideoFrameCallback) {
        video.cancelVideoFrameCallback(vfcHandle);
      }
    };
  }, [hasStream, status, applySavedTorchWithRetry]);

  // FIX v4 4.3 — WATCHDOG de salud del stream: mientras está "live", vigila
  // cada 2 s la MISMA condición de isStreamDead. Un track roto EN SILENCIO
  // (muted / sin frames con readyState "live") NUNCA dispara "ended" → sin
  // esto el efecto de apertura no se re-ejecutaba y el visor quedaba NEGRO
  // para siempre (la causa raíz del bug reportado). Requiere 2 strikes
  // CONSECUTIVOS (un frame perdido no cuenta), con 8 s de gracia tras abrir
  // (el video tarda en empezar a reproducir) y sin contar strikes durante
  // un disparo (el sensor puede pausar el preview al hacer la foto) ni
  // mientras corre una recuperación.
  // FIX v6 (6.2) — FRESCURA de frames: la condición pasa a ser
  // isStreamDead() || latido viejo (>4 s). Un video congelado SIN estar
  // muted (lo que Safari deja tras un takePhoto colgado) pasa los checks
  // de v4 pero no entrega frames → el latido lo delata. Solo se evalúa
  // con la app EN PRIMER PLANO (en background iOS pausa el video → sin
  // frames es lo esperado). Interacción con 5.4 (modo espera): el latido
  // es de VIDEO — el stream sigue reproduciéndose aunque el análisis
  // baje a 2 fps → NO hay falso positivo.
  useEffect(() => {
    if (status !== "live") return;
    const startedAt = Date.now();
    let strikes = 0;
    const iv = window.setInterval(() => {
      if (recoveringRef.current || capturingRef.current) {
        strikes = 0;
        return;
      }
      if (Date.now() - startedAt < 8000) return; // gracia de arranque
      const inForeground =
        typeof document === "undefined" || document.visibilityState === "visible";
      const stale = inForeground && performance.now() - lastFrameAtRef.current > 4000;
      // A-13 (auditoría leaks-recursos) — isStreamDead() también bajo guard
      // de foreground: en background los strikes acumulaban y a los ~4 s
      // disparaban recoverStream() espurio (toast «Reiniciando cámara…»
      // al volver).
      const dead = inForeground && isStreamDead();
      strikes = dead || stale ? strikes + 1 : 0;
      if (strikes >= 2) {
        strikes = 0;
        recoverStream();
      }
    }, 2000);
    return () => window.clearInterval(iv);
  }, [status, isStreamDead, recoverStream]);

  // B2 — CTA «Activar cámara»: reintenta getUserMedia; si el usuario concedió
  // el permiso en ajustes del navegador, adopta el stream real en caliente
  // (mismas transiciones que applyStream: status live + torch + canvas).
  const retryRealCamera = useCallback(async () => {
    const media = navigator.mediaDevices;
    if (!media || typeof media.getUserMedia !== "function") return;
    try {
      const stream = await media.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: IDEAL_PREVIEW_WIDTH }, // DUAL PIPELINE: preview 540p
          height: { ideal: IDEAL_PREVIEW_HEIGHT },
          frameRate: { ideal: IDEAL_PREVIEW_FPS },
        },
        audio: false,
      });
      // A-01 — el prompt de permiso puede sobrevivir al componente: si el
      // usuario salió de la vista mientras esperaba, el stream resuelve
      // sobre un montaje muerto → pararlo YA (mismo patrón `cancelled` del
      // efecto de apertura) para no dejar el LED encendido ni romper el
      // próximo montaje (NotReadableError / modo simulado).
      if (!isMountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      syntheticRef.current?.stop();
      syntheticRef.current = null;
      const endedTrack = stream.getVideoTracks()[0];
      if (endedTrack) {
        endedTrack.onended = () => setCamRestartNonce((n) => n + 1);
      }
      streamRef.current = stream;
      setCamNotice(null);
      setStatus("live");
      // v2-A13 Fase A — videoTrack del informe burst (re-adopción en caliente).
      noteStreamTrackSize(stream);
      canTakePhotoRef.current = CAN_TAKEPHOTO; // FIX v6 (6.1): solo Android
      takePhotoBrokenRef.current = false; // FIX v4 4.1: stream nuevo, takePhoto rehabilitado
      profileActiveSensor(stream); // F-SENSOR-PROFILER: tope 4032/3200 px
      setTorchAvailable(true);
      if (flashRef.current) applySavedTorchWithRetry();
      // FIX v7 (7.2) — subida progresiva también al recuperar la cámara:
      // mismo delay para no entrometerse con la re-adopción del stream.
      // Guard local: si en esos 2 s el stream fue reemplazado, no tocar.
      window.setTimeout(() => {
        if (streamRef.current !== stream) return;
        upgradeStreamResolution(stream.getVideoTracks()[0]);
      }, STREAM_UPGRADE_DELAY_MS);
    } catch {
      toast.error("Sigue sin permiso", {
        description:
          "Toca el candado 🔒 en la barra de direcciones › Permisos › Cámara › Permitir, y vuelve a intentar.",
        duration: 9000,
      });
    }
  }, [applySavedTorchWithRetry, upgradeStreamResolution]);

  // Dimensiones del video (para el mapeo object-cover del overlay)
  const onVideoMeta = useCallback(() => {
    const v = videoRef.current;
    if (v?.videoWidth) setVideoDims({ w: v.videoWidth, h: v.videoHeight });
  }, []);

  // Tamaño del visor (ResizeObserver — para el mapeo del overlay)
  useEffect(() => {
    const el = viewerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setBoxSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ── Readiness del pipeline de precisión (worker + OpenCV) ───────── */

  useEffect(() => {
    let stop = false;
    const check = () => {
      const c = getScannerWorker();
      if (c?.isReady) {
        if (!stop) setPrecisionReady(true);
        return true;
      }
      if (c && !c.isDead) {
        void c.waitReady().then((ok) => {
          if (ok && !stop) setPrecisionReady(true);
        });
      }
      return false;
    };
    check();
    const iv = window.setInterval(() => {
      if (check()) window.clearInterval(iv);
    }, 1000);
    return () => {
      stop = true;
      window.clearInterval(iv);
    };
  }, []);

  /* ── FRAME LOOP REAL: detección en vivo + k-de-n ─────────────────── */

  useEffect(() => {
    if (!precisionLive) return;
    const video = videoRef.current;
    if (!video) return;
    const loop = new CameraFrameLoop();
    loopRef.current = loop;
    // FIX v5 (5.4): cada sesión de loop arranca ACTIVA (sin espera heredada
    // de un stream anterior).
    standbyRef.current = false;
    setStandby(false);
    searchingSinceRef.current = null;
    loop.start(video, {
      onFrame: (t) => {
        // FIX v6 (6.2) — fallback del LATIDO: actualiza lastFrameAtRef en
        // cada frame procesado (cubriría navegadores sin rVFC). Con el
        // análisis en modo espera (2 fps) el intervalo (~500 ms) queda MUY
        // por debajo del umbral del watchdog (4 s) → sin falsos positivos.
        lastFrameAtRef.current = performance.now();
        window.__cameraTelemetry = t;
        // FIX v9 QA: salud del disparo (fpsEff / K dinámico / tramo
        // continuo) — telemetría silenciosa, sin UI.
        window.__lastShutter = loop.lastShutterHealth;
        // F-ZSL: alimenta el buffer Best-Shot (~5 Hz) — cubre la ventana
        // pre-tap de 80–450 ms para la captura manual sin tap shock.
        feedRingFromVideo();
        const now = performance.now();
        if (now - lastTelemetryAt.current < 100) return; // throttle UI ~10 Hz
        lastTelemetryAt.current = now;
        const next: LiveUi = {
          corners: t.corners,
          score: t.score ? t.score.total : null,
          fps: t.fps,
          searching: t.corners === null,
        };
        liveRef.current = next; // FIX v5 (5.2): fresco para el instante del disparo
        setLive(next);
      },
      onTrigger: () => {
        if (!autoRef.current) return;
        if (processingRef.current) return;
        if (cooldownRef.current > Date.now()) return;
        void captureSmartRef.current();
      },
      onNoDetectTimeout: () => {
        toast("No detecto el documento · acércalo más al encuadre", {
          icon: "🔍",
        });
      },
    });
    return () => {
      loop.stop();
      loopRef.current = null;
      // F-ZSL: libera el buffer Best-Shot al cerrar la sesión de cámara.
      for (const f of bestShotRingRef.current) {
        f.canvas.width = 0;
        f.canvas.height = 0;
      }
      bestShotRingRef.current = [];
    };
  }, [precisionLive, feedRingFromVideo]);

  /* ── FIX v5 (5.4) — MODO ESPERA (nivel 1) ────────────────────────────
   *  Entrada: sin corners (live.searching) de forma continua durante 30 s
   *  Y sin interacción del usuario → loop.setIdle(true) (análisis a 2 fps,
   *  stream intacto) + pill persistente.
   *  Salida: corners detectados de nuevo (efecto de abajo — el análisis a
   *  2 fps sigue evaluando y reacciona en <1 s), toque en el visor
   *  (onPointerDownCapture de la raíz) o captura (runCaptureFlow).
   *  ⛔ Convivencia con el watchdog v4 4.3: la espera NO toca el video —
   *  isStreamDead vigila readyState/muted del TRACK y el track sigue
   *  "live" con frames → el watchdog nunca confunde espera con muerte. */
  useEffect(() => {
    if (!precisionLive) return;
    if (live.searching) {
      if (searchingSinceRef.current === null) {
        searchingSinceRef.current = Date.now();
      }
    } else {
      // Documento a la vista: corta la racha y reactiva si estaba dormido.
      searchingSinceRef.current = null;
      exitStandby();
    }
  }, [live.searching, precisionLive, exitStandby]);

  useEffect(() => {
    if (!precisionLive) return;
    const iv = window.setInterval(() => {
      if (standbyRef.current) return;
      const since = searchingSinceRef.current;
      const now = Date.now();
      if (
        since !== null &&
        now - since >= STANDBY_AFTER_MS &&
        now - lastInteractionRef.current >= STANDBY_AFTER_MS
      ) {
        standbyRef.current = true;
        setStandby(true);
        loopRef.current?.setIdle(true);
      }
    }, 1000);
    return () => window.clearInterval(iv);
  }, [precisionLive]);

  // Linterna — F-FLASH v3: botón SIEMPRE activo con cámara real; la verdad
  // se descubre al pulsar (aplicar + verificar getSettings.torch). El deseo
  // vive en estado local de la sesión (flashOn).
  const toggleTorch = useCallback(async () => {
    if (status !== "live") {
      toast(TORCH_HINT, { icon: "🔦", duration: 8000 });
      return;
    }
    const next = !torchOn;
    const applied = await setTorchState(next);
    if (applied) {
      setFlashOn(next);
    } else {
      // Verificación falló: nada cambió físicamente; sincroniza y explica.
      setTorchOn((v) => v);
      toast(TORCH_HINT, { icon: "🔦", duration: 8000 });
    }
  }, [torchOn, status, setTorchState]);

  /* ── Fallback simulado (sin worker): estabilidad + jitter ─────────── */

  useEffect(() => {
    if (status !== "simulated" && !(hasStream && !precisionReady)) {
      setStable(false);
      return;
    }
    let cancelled = false;
    const timers: number[] = [];
    const schedule = (fn: () => void, ms: number) => {
      timers.push(
        window.setTimeout(() => {
          if (!cancelled) fn();
        }, ms)
      );
    };
    const runCycle = () => {
      schedule(() => setStable(true), 2600);
      schedule(() => {
        setStable(false);
        runCycle();
      }, 9800);
    };
    runCycle();
    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [status, hasStream, precisionReady]);

  useEffect(() => {
    if (precisionLive) return; // el quad real manda
    if (status === "idle" || stable) {
      setQuad(defaultQuad());
      return;
    }
    const id = window.setInterval(() => setQuad(jitteredQuad()), 700);
    return () => window.clearInterval(id);
  }, [status, stable, precisionLive]);

  // Auto-captura del fallback simulado (sin pipeline real)
  useEffect(() => {
    if (precisionLive || !autoCapture) return;
    // Dispara en TODOS los modos con estabilidad del fallback (live sin
    // worker, sintético y simulado) — antes solo "live" y el modo sintético
    // prometía auto-captura que nunca llegaba.
    if (status === "idle" || !stable) return;
    if (cooldownRef.current > Date.now()) return;
    const t = window.setTimeout(() => {
      cooldownRef.current = Date.now() + 7000;
      setStable(false);
      void captureSmartRef.current();
    }, 1500);
    return () => window.clearTimeout(t);
  }, [precisionLive, status, stable, autoCapture]);

  // Cierra el menú ⋮ con Escape
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  /* ── Overlay: quad REAL con mapeo object-cover ───────────────────── */

  /** Mapea fracciones del FRAME → % del visor visible (object-cover). */
  const mapPoint = useCallback(
    (p: { x: number; y: number }) => {
      if (!boxSize.w || !videoDims.w) return { x: p.x * 100, y: p.y * 100 };
      const scale = Math.max(boxSize.w / videoDims.w, boxSize.h / videoDims.h);
      const dw = videoDims.w * scale;
      const dh = videoDims.h * scale;
      const ox = (boxSize.w - dw) / 2;
      const oy = (boxSize.h - dh) / 2;
      return {
        x: ((ox + p.x * dw) / boxSize.w) * 100,
        y: ((oy + p.y * dh) / boxSize.h) * 100,
      };
    },
    [boxSize, videoDims]
  );

  const overlayQuad = precisionLive ? live.corners : hasStream || status === "simulated" ? quad : null;
  const quadPoints = overlayQuad
    ?.map((p) => {
      const m = mapPoint(p);
      return `${m.x.toFixed(2)} ${m.y.toFixed(2)}`;
    })
    .join(" L ");
  const overlayStable = precisionLive
    ? (live.score ?? 0) > SHUTTER_SCORE
    : stable;
  const scorePct =
    live.score !== null ? Math.round(live.score * 100) : null; // LOTE 5.7 — puntuador

  // QA (spec test estándar v1.1 · marca nueva) — capture_stable: el overlay
  // de estabilidad APARECIÓ para el encuadre actual (flanco de subida de
  // overlayStable, el mismo estado que ve el shutter). Con capture_fired
  // mide la espera del auto-shutter (estable→disparo). Pura instrumentación:
  // cero cambios en estabilidad, shutter, ZSL o burst.
  const prevOverlayStableRef = useRef(false);
  useEffect(() => {
    if (overlayStable && !prevOverlayStableRef.current) {
      perfProbe.mark("capture_stable");
    }
    prevOverlayStableRef.current = overlayStable;
  }, [overlayStable]);

  return (
    <div
      className="relative flex h-full w-full flex-col bg-black"
      /* FIX v5 (5.4): cualquier toque en la cámara cuenta como interacción
       *  (reset de la ventana de espera) Y despierta el análisis si estaba
       *  en modo espera — captura de fase: llega desde botones, visor y
       *  overlays por igual. */
      onPointerDownCapture={() => {
        lastInteractionRef.current = Date.now();
        exitStandby();
      }}
    >
      {/* Inputs de captura ocultos (método PRIMARIO: cámara nativa en móvil) */}
      <input
        ref={captureInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onFilePicked}
        className="hidden"
        aria-hidden="true"
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*,.heic,.heif"
        onChange={onFilePicked}
        className="hidden"
        aria-hidden="true"
      />

      {/* ── Top bar ── */}
      <header className="relative z-20 flex shrink-0 items-center justify-between gap-1 px-4 pb-3 pt-safe">
        <button
          type="button"
          aria-label="Cerrar cámara y volver a la biblioteca"
          onClick={closeToLibrary}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/30 backdrop-blur-md transition-transform duration-150 active:scale-90"
        >
          <X className="h-5 w-5 text-white" strokeWidth={2.2} />
        </button>

        {/* Pill IA · AUTO — punto azul pulsante al rastrear (diseño del usuario) */}
        <div className="flex h-9 items-center gap-2 rounded-full bg-black/40 px-3.5 backdrop-blur-md">
          <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[4px] bg-white text-[9px] font-bold tracking-tight text-black">
            IA
          </span>
          <LayoutGrid className="h-3.5 w-3.5 text-white" strokeWidth={2.4} aria-hidden="true" />
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full bg-[#007aff]",
              precisionLive && !overlayStable && "animate-pulse"
            )}
            aria-hidden="true"
          />
          <span className="text-[13px] font-semibold tracking-wide text-white">AUTO</span>
        </div>

        {/* F-SWAP (feedback del usuario): la CAPTURA AUTOMÁTICA sube aquí
            con icono de encuadre (Scan) — el rayo anterior (Zap) se
            confundía con el símbolo del flash. La linterna baja a la
            toolbar inferior, junto al disparador. */}
        <div className="flex shrink-0 items-center gap-0.5">
          {/* FIX v5 (5.5) — Flash de captura (preferencia): cicla
              Apagado → Auto → Encendido. Mismo estilo del selector de
              captura automática; la «A» distingue Auto de Encendido
              (rayo relleno). Persistido en Ajustes › Procesamiento. */}
          <button
            type="button"
            aria-label={`Flash de captura: ${
              settings.flashMode === "off"
                ? "Apagado"
                : settings.flashMode === "auto"
                  ? "Auto"
                  : "Encendido"
            }`}
            title="Flash de captura (Apagado · Auto · Encendido)"
            onClick={() => {
              const order = ["off", "auto", "on"] as const;
              const cur = useScannerStore.getState().settings.flashMode;
              const next = order[(order.indexOf(cur) + 1) % order.length]!;
              updateSettings({ flashMode: next });
              toast(
                next === "off"
                  ? "Flash: Apagado"
                  : next === "auto"
                    ? "Flash: Auto · solo en escenas oscuras"
                    : "Flash: Encendido",
                { icon: "⚡", duration: 1400 }
              );
            }}
            className={cn(
              "relative flex h-9 w-9 items-center justify-center rounded-full backdrop-blur-md transition-all duration-150 active:scale-90",
              settings.flashMode !== "off"
                ? "bg-[#ffd60a]/18 ring-1 ring-[#ffd60a]/60"
                : "bg-black/30"
            )}
          >
            <Zap
              className={cn(
                "h-5 w-5",
                settings.flashMode !== "off" ? "text-[#ffd60a]" : "text-white/70"
              )}
              strokeWidth={2.2}
              fill={settings.flashMode === "on" ? "currentColor" : "none"}
              aria-hidden="true"
            />
            {settings.flashMode === "auto" && (
              <span
                className="absolute -right-0.5 -top-0.5 flex h-[13px] w-[13px] items-center justify-center rounded-[4px] bg-[#ffd60a] text-[8px] font-bold leading-none text-black"
                aria-hidden="true"
              >
                A
              </span>
            )}
          </button>
          <button
            type="button"
            aria-label={`Captura automática: ${autoCapture ? "activada" : "desactivada"}`}
            aria-pressed={autoCapture}
            title="Captura automática (recorte y disparo al detectar el documento)"
            onClick={() => {
              const next = !autoCapture;
              setAutoCapture(next);
              // FIX v7-b — autoRef se sincroniza en render (~731); si llamamos
              // upgradeStreamResolution AHORA (antes del re-render), su guard
              // `!autoRef.current` vería el valor VIEJO y abortaría. Sincronizar
              // el ref YA (el render lo re-fijará con el mismo valor).
              autoRef.current = next;
              if (next) {
                upgradeStreamResolution(streamRef.current?.getVideoTracks()[0]);
              }
            }}
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-full backdrop-blur-md transition-all duration-150 active:scale-90",
              autoCapture
                ? "bg-[#ffd60a]/18 ring-1 ring-[#ffd60a]/60"
                : "bg-black/30"
            )}
          >
            <Scan
              className={cn(
                "h-5 w-5",
                autoCapture ? "text-[#ffd60a]" : "text-white/70"
              )}
              strokeWidth={2.2}
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            aria-label="Más opciones"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-full transition-transform duration-150 active:scale-90"
          >
            <MoreVertical className="h-5 w-5 text-white" strokeWidth={2.2} />
          </button>
        </div>
      </header>

      {/* ── Visor central ── */}
      <section
        ref={viewerRef}
        className="relative min-h-0 flex-1 overflow-hidden"
        aria-label="Visor de cámara"
      >
        {hasStream && (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            disablePictureInPicture
            onLoadedMetadata={onVideoMeta}
            aria-label="Vista previa de la cámara"
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}

        {/* Escena estática (sin stream ni sintética): documento sobre escritorio */}
        {status === "simulated" && demoPreview && (
          <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
            <div
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(165deg, #57493c 0%, #443729 42%, #2f251c 100%)",
              }}
            />
            <div
              className="absolute inset-0 backdrop-blur-[3px]"
              style={{ background: "rgba(18,14,10,0.42)" }}
            />
            <motion.img
              src={demoPreview}
              alt=""
              initial={{ opacity: 0, scale: 1.04 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="absolute left-1/2 top-1/2 w-[76%] -translate-x-1/2 -translate-y-[52%] rounded-[5px] shadow-[0_22px_60px_rgba(0,0,0,0.6)]"
              style={{ rotate: "-2.5deg" }}
            />
            <div
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(130% 95% at 50% 42%, transparent 42%, rgba(0,0,0,0.5) 100%)",
              }}
            />
          </div>
        )}

        {/* Marco de detección: quad REAL (o fallback) mapeado al visor */}
        {quadPoints && (
          <div
            className={cn("absolute inset-0", overlayStable && "animate-doc-stable")}
            aria-hidden="true"
          >
            <svg
              className="absolute inset-0 h-full w-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              <path
                d={`M 0 0 L 100 0 L 100 100 L 0 100 Z M ${quadPoints} Z`}
                fill="rgba(0,0,0,0.32)"
                fillRule="evenodd"
              />
              <path
                d={`M ${quadPoints} Z`}
                fill="none"
                stroke="#007aff"
                strokeWidth={2}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {overlayQuad?.map((p, i) => {
              const m = mapPoint(p);
              return (
                <span
                  key={i}
                  className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_1.5px_rgba(0,122,255,0.9),0_1px_4px_rgba(0,0,0,0.5)]"
                  style={{ left: `${m.x}%`, top: `${m.y}%` }}
                />
              );
            })}
          </div>
        )}

        {/* Estado: iniciando cámara */}
        {status === "idle" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <Loader2
              className="h-7 w-7 animate-spin text-white/50"
              strokeWidth={2}
              aria-hidden="true"
            />
            <p className="text-[13px] text-white/50">Iniciando cámara…</p>
          </div>
        )}

        {/* FIX v5 (5.4) — pill del MODO ESPERA: análisis a 2 fps (ahorro de
            batería/CPU con el visor abierto sin documento). Tocarla (o
            cualquier parte de la cámara) reactiva; acercar un documento
            también (el análisis a 2 fps lo ve en <1 s). */}
        <AnimatePresence>
          {standby && (
            <motion.button
              key="standby-pill"
              type="button"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.2 }}
              onClick={exitStandby}
              aria-label="Salir del modo espera y reactivar la detección"
              className="absolute inset-x-0 top-5 z-30 mx-auto flex w-fit items-center gap-2 rounded-full bg-black/60 px-3.5 py-1.5 backdrop-blur-sm transition-transform active:scale-95"
            >
              <Moon className="h-3.5 w-3.5 text-[#ffd60a]" aria-hidden="true" />
              <span className="text-[12px] font-medium text-white/85">
                Modo espera — toca para reactivar
              </span>
            </motion.button>
          )}
        </AnimatePresence>

        {/* B2 — aviso de permiso de cámara denegado (modo simulado debajo) */}
        <AnimatePresence>
          {camNotice === "denied" && (
            <motion.div
              key="cam-denied"
              initial={{ opacity: 0, y: -12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.97 }}
              transition={{ duration: 0.22 }}
              role="alert"
              className="absolute inset-x-4 top-[calc(env(safe-area-inset-top)+60px)] z-40 rounded-2xl bg-[#1c1c1e]/95 p-4 shadow-[0_8px_32px_rgba(0,0,0,0.45)] ring-1 ring-white/10 backdrop-blur-md"
            >
              <div className="flex items-start gap-3">
                <span aria-hidden="true" className="text-[22px] leading-none">📷</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-white">
                    Sin acceso a la cámara
                  </p>
                  <p className="mt-1 text-[13px] leading-snug text-white/70">
                    Permiso denegado: lo que ves es un modo simulado. Toca el candado
                    🔒 en la barra de direcciones › Permisos › Cámara › Permitir.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void retryRealCamera()}
                      className="flex h-9 items-center justify-center rounded-full bg-[#007aff] px-4 text-[13.5px] font-semibold text-white transition-all active:scale-95"
                    >
                      Activar cámara
                    </button>
                    <button
                      type="button"
                      onClick={() => setCamNotice(null)}
                      className="flex h-9 items-center justify-center rounded-full bg-white/10 px-4 text-[13.5px] font-semibold text-white/80 ring-1 ring-inset ring-white/15 transition-all active:scale-95"
                    >
                      Ocultar
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* LOTE 5.7 — Puntuador de encuadre EN VIVO (restaurado del pre-5.3):
            esquina inferior izquierda, compacto, pointer-events-none (no tapa
            el visor ni captura toques). Verde al superar el umbral del shutter. */}
        <AnimatePresence>
          {precisionLive && scorePct !== null && (
            <motion.div
              key="score-meter"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.22 }}
              className="pointer-events-none absolute bottom-9 left-3 z-20"
              role="status"
              aria-label={`Calidad de encuadre ${scorePct} por ciento`}
            >
              <div className="flex h-8 items-center gap-2.5 rounded-full bg-black/55 px-3 shadow-[0_4px_14px_rgba(0,0,0,0.35)] backdrop-blur-md">
                <Gauge
                  className={cn(
                    "h-3.5 w-3.5",
                    scorePct > SHUTTER_SCORE * 100 ? "text-[#34c759]" : "text-white/80"
                  )}
                  strokeWidth={2.2}
                  aria-hidden="true"
                />
                <div className="h-1 w-14 overflow-hidden rounded-full bg-white/20">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-300 ease-out",
                      scorePct > SHUTTER_SCORE * 100
                        ? "bg-gradient-to-r from-[#30d158] to-[#34c759]"
                        : scorePct > 55
                          ? "bg-gradient-to-r from-[#007aff] to-[#4da2ff]"
                          : "bg-white/50"
                    )}
                    style={{ width: `${Math.min(100, Math.max(4, scorePct))}%` }}
                  />
                </div>
                <span
                  className={cn(
                    "min-w-7 text-right text-[11px] font-semibold tabular-nums",
                    scorePct > SHUTTER_SCORE * 100 ? "text-[#34c759]" : "text-white/85"
                  )}
                >
                  {scorePct}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Pista sutil de vista demo (sintética o estática) */}
        {(status === "synthetic" || status === "simulated") && !processing && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center">
            <span className="rounded-full bg-black/40 px-3 py-1 text-[11px] font-medium text-white/55 backdrop-blur-sm">
              {status === "synthetic"
                ? "Demo en vivo · IA detectando de verdad"
                : "Vista de demostración · obturador para capturar"}
            </span>
          </div>
        )}

        {/* Procesando captura — F-FLOW: overlay a pantalla completa estilo
            Adobe Scan ("Capturando, un momento…") mientras se detectan bordes
            y se evalúa la calidad; después se navega al editor. */}
        <AnimatePresence>
          {processing && (
            <motion.div
              key="processing-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-black/72 backdrop-blur-[3px]"
              role="status"
              aria-live="polite"
            >
              <div className="relative flex h-14 w-14 items-center justify-center">
                <span className="absolute inset-0 rounded-full border-[3px] border-white/15" />
                <span className="absolute inset-0 animate-spin rounded-full border-[3px] border-transparent border-t-[#007aff]" />
                <FileText className="h-5 w-5 text-white/85" strokeWidth={2} aria-hidden="true" />
              </div>
              <p className="text-[15px] font-medium text-white">
                Capturando, un momento…
              </p>
              <p className="text-[12px] text-white/55">Detectando bordes del documento</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Botón flotante: Revisar N páginas — F-FLOW lo hace innecesario
            (tras capturar se navega directo al editor), pero sigue siendo
            útil cuando el usuario vuelve de "Seguir escaneando". Se muestra
            solo cuando NO estamos procesando. */}
        <AnimatePresence>
          {pageCount > 0 && !processing && (
            <motion.button
              key="review-pages"
              type="button"
              onClick={goToEditor}
              initial={{ opacity: 0, y: 12, x: "-50%" }}
              animate={{ opacity: 1, y: 0, x: "-50%" }}
              exit={{ opacity: 0, y: 12, x: "-50%" }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="absolute bottom-9 left-1/2 z-30 flex items-center gap-1.5 rounded-full bg-[#007aff] py-2 pl-4 pr-3 text-[13px] font-semibold text-white shadow-[0_6px_20px_rgba(0,122,255,0.45)]"
            >
              Revisar {pageCount}
              <ChevronRight className="h-4 w-4" strokeWidth={2.4} aria-hidden="true" />
            </motion.button>
          )}
        </AnimatePresence>
      </section>

      {/* ── Bottom bar ── */}
      <footer className="ios-blur-bar relative z-20 shrink-0 pb-safe">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center px-2 pt-2">
          {/* Zona izquierda: Importar · Páginas */}
          <div className="flex items-center justify-around">
            <button
              type="button"
              aria-label="Importar imagen desde la galería"
              onClick={() => galleryInputRef.current?.click()}
              className="flex flex-col items-center gap-1.5 rounded-xl px-2 py-1 transition-opacity active:opacity-60"
            >
              <FileDown className="h-6 w-6 text-white" strokeWidth={1.8} aria-hidden="true" />
              <span className="text-[11px] font-medium text-[#8e8e93]">Importar</span>
            </button>
            <button
              type="button"
              aria-label={`Ver ${pageCount} ${pageCount === 1 ? "página capturada" : "páginas capturadas"}`}
              onClick={goToEditor}
              className="flex flex-col items-center gap-1.5 rounded-xl px-2 py-1 transition-opacity active:opacity-60"
            >
              <span className="relative">
                <Layers className="h-6 w-6 text-white" strokeWidth={1.8} aria-hidden="true" />
                {pageCount > 0 && (
                  <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#007aff] px-1 text-[10px] font-bold leading-none text-white">
                    {pageCount}
                  </span>
                )}
              </span>
              <span className="text-[11px] font-medium text-white">
                {pageCount === 1 ? "1 página" : `${pageCount} páginas`}
              </span>
            </button>
          </div>

          {/* SHUTTER central elevado -20px */}
          <button
            type="button"
            aria-label="Capturar página"
            data-qa-shutter
            onClick={onShutter}
            disabled={processing || isCapturing}
            className={cn(
              "relative -mt-[20px] flex h-[72px] w-[72px] items-center justify-center rounded-full border-4 border-white bg-white/10",
              "shadow-[0_6px_20px_rgba(0,0,0,0.4)] transition-all duration-150",
              processing || isCapturing ? "opacity-60" : "active:scale-90"
            )}
          >
            <FileText className="h-8 w-8 text-white" strokeWidth={2} aria-hidden="true" />
          </button>

          {/* Zona derecha: Flash (linterna) — F-SWAP: baja desde la top bar
              para dejar su sitio a la captura automática. Sin disabled para
              que el toast de "no disponible" pueda mostrarse al tocarlo. */}
          <div className="flex justify-center">
            <button
              type="button"
              aria-label={
                torchAvailable
                  ? torchOn
                    ? "Apagar el flash"
                    : "Encender el flash"
                  : "Flash no disponible — toca para ver el motivo"
              }
              aria-pressed={torchOn}
              onClick={() => {
                if (!torchAvailable) {
                  toast(TORCH_HINT, { icon: "🔦", duration: 8000 });
                  return;
                }
                void toggleTorch();
              }}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-xl px-2 py-1 transition-opacity active:opacity-60",
                !torchAvailable && "opacity-40"
              )}
            >
              {torchOn ? (
                <Flashlight className="h-6 w-6 text-[#ffd60a]" strokeWidth={1.8} aria-hidden="true" />
              ) : (
                <FlashlightOff
                  className={cn(
                    "h-6 w-6",
                    torchAvailable ? "text-white" : "text-white/70"
                  )}
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
              )}
              <span
                className={cn(
                  "text-[11px] font-medium",
                  torchOn ? "text-[#ffd60a]" : "text-[#8e8e93]"
                )}
              >
                Flash
              </span>
            </button>
          </div>
        </div>

        <div className="home-indicator mb-2 mt-1.5" aria-hidden="true" />
      </footer>

      {/* ── Menú ⋮ ── */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            key="camera-menu-layer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 z-40"
          >
            <button
              type="button"
              aria-label="Cerrar menú"
              className="absolute inset-0 cursor-default"
              onClick={() => setMenuOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -4 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
              style={{ top: "calc(max(env(safe-area-inset-top), 12px) + 56px)" }}
              className="absolute right-3 max-h-[70%] w-64 overflow-y-auto rounded-2xl border border-white/10 bg-[#1c1c1e]/95 shadow-[0_12px_40px_rgba(0,0,0,0.55)] backdrop-blur-xl divide-y divide-white/[0.08]"
              role="menu"
            >
              <MenuRow
                icon={Scan}
                label="Auto-captura"
                value={autoCapture ? "Sí" : "No"}
                onClick={() => {
                  const next = !autoCapture;
                  setAutoCapture(next);
                  // FIX v7-b — sincronizar autoRef YA (mismo patrón que el
                  // toggle de la toolbar): sin esto, el guard del helper lee
                  // el valor VIEJO y aborta la subida.
                  autoRef.current = next;
                  if (next) {
                    upgradeStreamResolution(streamRef.current?.getVideoTracks()[0]);
                  }
                }}
              />
              {/* Linterna con botón propio en la toolbar inferior (F-SWAP). */}
              <MenuRow
                icon={Camera}
                label="Escanear con cámara"
                onClick={() => {
                  setMenuOpen(false);
                  captureInputRef.current?.click();
                }}
              />
              <MenuRow
                icon={ImagePlus}
                label="Importar desde galería"
                onClick={() => {
                  setMenuOpen(false);
                  galleryInputRef.current?.click();
                }}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Flash blanco de captura */}
      {flashKey > 0 && (
        <div
          key={flashKey}
          className="animate-capture-flash pointer-events-none absolute inset-0 z-50 bg-white"
          aria-hidden="true"
        />
      )}
    </div>
  );
}

/** Fila del menú ⋮ estilo iOS. */
function MenuRow({
  icon: Icon,
  label,
  sublabel,
  value,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  sublabel?: string;
  value?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5 active:bg-white/10"
    >
      <Icon className="h-[18px] w-[18px] text-[#8e8e93]" strokeWidth={1.8} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-white">{label}</span>
        {sublabel && (
          <span className="block truncate text-[11px] text-[#8e8e93]">{sublabel}</span>
        )}
      </span>
      {value && (
        <span
          className={cn(
            "text-[13px] font-semibold",
            value === "Sí" || value === "✓" || value === "Encendida"
              ? "text-[#007aff]"
              : "text-[#8e8e93]"
          )}
        >
          {value}
        </span>
      )}
    </button>
  );
}
