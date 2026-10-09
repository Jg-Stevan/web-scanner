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
  CheckCircle2,
  ChevronRight,
  FileDown,
  FileText,
  Flashlight,
  FlashlightOff,
  Gauge,
  ImagePlus,
  Layers,
  LayoutGrid,
  Loader2,
  MoreVertical,
  Scan,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { nextId, useScannerStore } from "@/lib/scanner/store";
import {
  defaultQuad,
  type CapturePage,
  type Quad,
} from "@/lib/scanner/types";
import {
  detectDocumentEdges,
  evaluateQuality,
  fileToCaptureDataUrl,
  generateDemoPage,
  getScannerWorker,
  loadImage,
} from "@/lib/scanner/image-processor";
import {
  CameraFrameLoop,
  SyntheticCamera,
  type FrameLoopTelemetry,
} from "@/lib/scanner/frame-loop";
import { SHUTTER_SCORE } from "@/lib/scanner/quality";
import {
  buildCappedPhotoSettings,
  clampBlobToSafeCap,
  getSensorSafeCap,
  profileSensor,
  type SensorProfile,
} from "@/lib/scanner/sensor-profiler";

type CameraStatus = "idle" | "live" | "synthetic" | "simulated";

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
// ✅ AHORA — ARQUITECTURA DUAL PIPELINE (v2: preview qHD 960×540 + 30 FPS):
// 1. PREVIEW aún más ligero. Bajar de 720p a 540p NO toca ni el análisis
//    ni la foto:
//    · El loop de detección remuestrea SIEMPRE a 400 px
//      (createImageBitmap resize) → el análisis ve lo mismo desde 540p.
//    · Los frames del video (ring ZSL / snapshot) son SOLO fallback
//      cuando no existe ImageCapture → 960 px sigue siendo sobrado.
//    · La foto real sale del sensor vía takePhoto() (pilar 2, abajo).
//    Neto: ~44% menos píxeles por frame de decodificado/composición y
//    tope suave de 30 FPS (el visor no aprovecha 60) → menos calor y
//    más fluido en gama baja.
const IDEAL_PREVIEW_WIDTH = 960;
const IDEAL_PREVIEW_HEIGHT = 540;
/** Tope suave de FPS del preview: «ideal» NO rechaza cámaras que solo
 *  ofrecen 60, solo evita negociar 60 cuando el hardware lo permite. */
const IDEAL_PREVIEW_FPS = 30;
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
 *  causa del bug v3: sondas con el stream vivo → NotReadableError). */
async function probeCamera(
  media: MediaDevices,
  deviceId: string,
  label: string
): Promise<CameraProbeResult | null> {
  let stream: MediaStream | null = null;
  try {
    stream = await media.getUserMedia({
      video: { deviceId: { exact: deviceId } },
      audio: false,
    });
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
 *  4032 (bug v3 de CALIDAD: estaba en 3400 y re-escalaba la foto nativa del
 *  iPhone de 4032px, añadiendo un re-encode JPEG extra — codigo-test guarda
 *  la foto full-res con una sola compresión). Con el Dual Pipeline ya no hay
 *  downscale en capturas de GAMAS ALTAS (4032×3024 ≈ 12.2 MP, lejos del
 *  límite de canvas de iOS); en media/baja el F-SENSOR-PROFILER pide 3200 px
 *  al sensor y ESTE tope es la segunda red de seguridad (imports incluidos).
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

declare global {
  interface Window {
    /** QA: telemetría del frame loop desde la consola. */
    __cameraTelemetry?: FrameLoopTelemetry;
  }
}

export default function CameraView() {
  // ── Store ──
  const setView = useScannerStore((s) => s.setView);
  const capturePages = useScannerStore((s) => s.capturePages);
  const addCapturePage = useScannerStore((s) => s.addCapturePage);
  const settings = useScannerStore((s) => s.settings);
  const batchSavedCount = useScannerStore((s) => s.batchSavedCount);

  // ── Refs y estado ──
  const captureInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const viewerRef = useRef<HTMLElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const syntheticRef = useRef<SyntheticCamera | null>(null);
  const loopRef = useRef<CameraFrameLoop | null>(null);
  const processingRef = useRef(false);
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
  const [stable, setStable] = useState(false); // solo fallback simulado
  const [quad, setQuad] = useState<Quad>(() => defaultQuad());
  const [processing, setProcessing] = useState(false);
  const [flashKey, setFlashKey] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [precisionReady, setPrecisionReady] = useState(false);
  const [live, setLive] = useState<LiveUi>({ corners: null, score: null, fps: 0, searching: true });
  const [videoDims, setVideoDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [boxSize, setBoxSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  /** §5.2 — true solo si el navegador implementa ImageCapture (Chrome/
   *  Android). En Safari/iOS es false SIEMPRE → el shutter manual abre la
   *  cámara NATIVA (input capture=environment) — HQ-iOS, error #5. */
  const canTakePhotoRef = useRef(false);
  /** F-SENSOR-PROFILER (PASO 2): perfil del sensor de FOTO del track vivo
   *  (resolución nativa vía getPhotoCapabilities + tope seguro 4032/3200 px
   *  según la gama medida). null = aún sin sondear. */
  const sensorProfileRef = useRef<SensorProfile | null>(null);
  /** Toast único por sesión de aviso calidad en iPhone (auto-captura = frames). */
  const iosQualityToastShownRef = useRef(false);

  /** F-SENSOR-PROFILER: sondea el sensor del stream REAL una vez por
   *  apertura (getPhotoCapabilities → nativa + tope por gama). Falla en
   *  silencio (Safari) → takePhoto dispara a secas y el clamp post-decode
   *  protege la RAM. La Sonda de QA expone el perfil en __sensorProfile. */
  const profileActiveSensor = useCallback((stream: MediaStream): void => {
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    void profileSensor(track).then((p) => {
      sensorProfileRef.current = p;
    });
  }, []);

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
        apply({ quad: detected, autoQuadPending: false });
      } catch {
        apply({ autoQuadPending: false });
      }
    },
    []
  );

  /** Pipeline tras obtener la imagen (FLUJO ADOBE SCAN + F-DEFER-CROP v6.2):
   *  flash → decode → downscale → calidad → store → EDITOR INMEDIATO.
   *  El editor abre con un marco provisional y la detección de bordes
   *  aterriza en background (pill «Ajustando recorte…» → preview se
   *  re-procesa solo). En gama baja esto convierte una espera de segundos
   *  frente a la cámara en una revisión instantánea. */
  const handleCaptureDataUrl = useCallback(
    async (rawDataUrl: string) => {
      if (processingRef.current) return;
      if (!rawDataUrl) {
        toast.error("No se pudo capturar la imagen");
        return;
      }
      processingRef.current = true;
      setProcessing(true);
      setFlashKey((k) => k + 1); // flash blanco breve
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(30);
      }
      try {
        // Decode ÚNICO de la captura (antes: downscale + detect + quality
        // decodificaban la misma foto de 12 MP tres veces). El elemento se
        // reutiliza en las etapas; solo se re-decodifica si hubo que
        // re-escalar una imagen de galería más grande que el sensor.
        const decoded = await loadImage(rawDataUrl);
        // F-SENSOR-PROFILER: el tope del downscale sigue la GAMA medida
        // (4032 alta / 3200 media-baja) — segunda red de seguridad por si
        // la foto llegó por encima del tope (photoSettings no aplicado).
        const scaledUrl = await downscaleImage(
          decoded,
          sensorProfileRef.current?.safeCapPx ?? getSensorSafeCap()
        );
        const dataUrl = scaledUrl ?? rawDataUrl;
        const source: HTMLImageElement | HTMLCanvasElement = scaledUrl
          ? await loadImage(scaledUrl)
          : decoded;
        // F-DEFER-CROP v6.2: la detección de bordes SALE del camino crítico
        // (corre en background tras abrir el editor). La calidad sí se mide
        // aquí: es barata (canvas de ≤400 px) y alimenta el badge de calidad.
        const quality = await evaluateQuality(source);
        const page: CapturePage = {
          id: nextId("page"),
          original: dataUrl,
          // Marco provisional (vista completa): el quad real llega en
          // background vía applyAutoQuad, sin bloquear la revisión.
          quad: defaultQuad(),
          autoQuadPending: true,
          // F-DEFAULT-BW: «Mejora automática» (Ajustes › Procesamiento) decide
          // el filtro por defecto de cada captura — ON = B/N adaptativo (lo que
          // pidió el usuario), OFF = Original puro. Cambiable en el editor.
          filter: useScannerStore.getState().settings.enhance ? "bw" : "original",
          rotation: 0,
          quality,
        };
        addCapturePage(page);
        // F-FLOW: directo al editor (modo revisión) — igual que Adobe Scan.
        setView("editor");
        // La detección vuela en background; cuando aterrice, el preview se
        // re-procesa solo (cambia el quad → capturePageKey → cache miss).
        void applyAutoQuad(page.id, source);
      } catch (err) {
        console.error("handleCaptureDataUrl falló:", err);
        toast.error("No se pudo procesar la imagen");
      } finally {
        processingRef.current = false;
        setProcessing(false);
      }
    },
    [addCapturePage, setView, applyAutoQuad]
  );

  /** Blob → data URL (para el takePhoto hi-res). */
  const blobToDataUrl = useCallback(
    (blob: Blob) =>
      new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result ?? ""));
        fr.onerror = () => reject(new Error("FileReader falló"));
        fr.readAsDataURL(blob);
      }),
    []
  );

  /** DUAL PIPELINE (pilar 2) — Captura a RESOLUCIÓN DEL SENSOR como Blob
   *  (aún SIN convertir a data URL): takePhoto() IGNORA la resolución del
   *  <video> de 540p y dispara directo al sensor físico (12–48 MP, p.ej.
   *  4000×3000). La medición §5.4 (createImageBitmap nativo) y la
   *  conversión corren EN PARALELO — nunca en serie. Carrera de 8 s
   *  (takePhoto puede colgarse — error #29); null → el llamador cae al
   *  fallback ZSL pre-tap y a los frames del video. La orientación EXIF
   *  la aplica el pipeline al decodificar (loadImage). */
  const takePhotoBlob = useCallback(async (): Promise<Blob | null> => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || typeof ImageCapture === "undefined") return null;
    try {
      const capture = new ImageCapture(track);
      // Dispara a resolución completa del hardware (4000×3000 / 3840×2160):
      // sin photoConstraints — el sensor manda, el preview no limita...
      // EXCEPTO cuando el sensor excede el tope seguro (48/108 MP): el
      // F-SENSOR-PROFILER pide al ISP una foto dentro del tope EN la captura
      // (capa 1) y el blob del gigante jamás llega a decodificarse.
      const profile = sensorProfileRef.current;
      const settings = profile ? buildCappedPhotoSettings(profile) : undefined;
      const attempt = async (ps?: PhotoSettings): Promise<Blob | null> => {
        try {
          const blob = await Promise.race([
            capture.takePhoto(ps),
            new Promise<never>((_, reject) =>
              window.setTimeout(() => reject(new Error("takePhoto timeout 8s")), 8000)
            ),
          ]);
          return blob && blob.size > 0 ? blob : null;
        } catch {
          return null;
        }
      };
      let blob = await attempt(settings);
      // Reintento sin photoSettings si el ajuste del profiler fue rechazado
      // (hardware exótico): mejor foto sin tope que perder la captura.
      if (!blob && settings) blob = await attempt(undefined);
      if (!blob) return null;
      // Capa 2 — red de seguridad post-decode (solo recorta si el blob
      // excede el tope; si no, el blob original pasa intacto).
      return await clampBlobToSafeCap(blob, profile?.safeCapPx ?? getSensorSafeCap());
    } catch {
      return null;
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
   *  disciplina de memoria iOS, error #22). */
  const pushRingFrame = useCallback(
    (canvas: HTMLCanvasElement, lapVar: number) => {
      const ring = bestShotRingRef.current;
      const copy = document.createElement("canvas");
      copy.width = canvas.width;
      copy.height = canvas.height;
      copy.getContext("2d")?.drawImage(canvas, 0, 0);
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
   *  ≈ 1 drawImage + 1 copia + 1 medición a 400 px. */
  const feedRingFromVideo = useCallback((): void => {
    const now = performance.now();
    if (now - lastRingFeedAt.current < 200) return;
    lastRingFeedAt.current = now;
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) return;
    if (!ringScratchRef.current) ringScratchRef.current = document.createElement("canvas");
    const scratch = ringScratchRef.current;
    if (scratch.width !== video.videoWidth || scratch.height !== video.videoHeight) {
      scratch.width = video.videoWidth;
      scratch.height = video.videoHeight;
    }
    const ctx = scratch.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const m = measurePixels(scratch, scratch.width, scratch.height);
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
   *  2. Foto hi-res del sensor (takePhoto, carrera de 8 s) → data URL.
   *  3. Si hay foto → dispatch YA (los frames se descartan, R-14).
   *  Fallback premium si takePhoto no existe o cuelga: el ganador ZSL
   *  pre-tap (80–450 ms antes del disparo, anti tap-shock) del buffer
   *  Best-Shot compite por lapVar con snapA/snapB — antes el fallback
   *  era un frame capturado EN el instante del tap (sacudido).
   *  Nunca un frame reemplaza una foto existente (el gate de nitidez de
   *  v5 hacía que un 720p «nítido» sustituyera a una foto de 3264 px →
   *  texto ilegible). Cooldown anti doble-disparo 1500 ms (§5.2). */
  const captureSmart = useCallback(async () => {
    if (processingRef.current) return;
    if (cooldownRef.current > Date.now()) return;
    loopRef.current?.notifyCaptured();
    cooldownRef.current = Date.now() + 1500;

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

    /** Mejor frame por lapVar → encode SOLO del ganador → dispatch. */
    const dispatchBestFrame = async (framesRaw: Array<BurstFrame | null>) => {
      const frames = framesRaw.filter((f): f is BurstFrame => f !== null);
      if (frames.length === 0) {
        // B8: el disparo no debe perderse en silencio.
        toast.error("No se pudo capturar", { description: "Inténtalo de nuevo." });
        return;
      }
      const measured = frames.filter((f) => f.m !== null);
      const winner =
        measured.length === 0
          ? frames[0]! // sin telemetría → orden de llegada (§5.4)
          : measured.reduce((a, b) => (b.m!.lapVar > a.m!.lapVar ? b : a));
      const url = await canvasToDataUrl(winner.canvas);
      for (const f of frames) releaseFrame(f);
      if (url) {
        void handleCaptureDataUrl(url);
      } else {
        // B8: encode falló → feedback en vez de descartar el disparo.
        toast.error("No se pudo capturar", { description: "Inténtalo de nuevo." });
      }
    };

    // §5.4 — frame A ANTES de la foto: si takePhoto cuelga y cae (8 s),
    // ya queda un candidato válido medido.
    const snapA = snapshotVideo();
    const photoBlob = canTakePhotoRef.current ? await takePhotoBlob() : null;
    if (!photoBlob) {
      // takePhoto colgó (> 8 s) o no existe: avisamos solo con stream real —
      // el fotograma de preview (540p/720p) es un recurso, no el estándar.
      if (status === "live") {
        toast.warning("Cámara lenta: baja resolución esta vez", {
          description:
            "La foto de alta resolución no respondió; se guardó el fotograma de vista previa.",
        });
      }
      // DUAL PIPELINE — fallback: el ganador ZSL pre-tap (estable, anti
      // tap-shock) compite por lapVar con snapA y el frame actual.
      const zsl = takeZslFallback();
      await dispatchBestFrame([zsl, snapA, snapshotVideo()]);
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
    try {
      photoUrl = await blobToDataUrl(photoBlob);
    } catch {
      photoUrl = null; // FileReader falló (rarísimo) → burst de frames
    }
    if (photoUrl) {
      releaseFrame(snapA);
      releaseFrame(snapB);
      void handleCaptureDataUrl(photoUrl);
      return;
    }
    await dispatchBestFrame([snapA, snapB]);
  }, [snapshotVideo, takePhotoBlob, canvasToDataUrl, blobToDataUrl, handleCaptureDataUrl, status]);

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
    if (processingRef.current) return;
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
      // §5.2 — Safari/iOS NO implementa ImageCapture en NINGUNA versión:
      // el shutter manual abrirá la cámara nativa y la auto-captura usará
      // frames de video (≤ 1080p). Toast único por sesión (§5.2).
      canTakePhotoRef.current = typeof ImageCapture !== "undefined";
      // F-SENSOR-PROFILER (PASO 2): mide la nativa de FOTO del sensor y
      // fija el tope seguro (4032/3200 px) para takePhotoBlob.
      profileActiveSensor(stream);
      if (!canTakePhotoRef.current && autoRef.current && !iosQualityToastShownRef.current) {
        iosQualityToastShownRef.current = true;
        toast("En iPhone: para máxima calidad dispara manualmente (foto nativa)", {
          duration: 6000,
        });
      }
      // Linterna — F-FLASH v3: cámara real → el botón se habilita SIEMPRE
      // (la verdad del torch se verifica al pulsar, aplicando y leyendo
      // getSettings); si el usuario dejó el flash ON, se re-aplica con
      // reintentos hasta que el track lo acepte.
      setTorchAvailable(true);
      if (flashRef.current) applySavedTorchWithRetry();
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
     *  1) desbloquea labels con un stream genérico que se cierra al instante;
     *  2) sondea TODAS las cámaras UNA POR UNA cerrando cada una antes de
     *     abrir la siguiente (v3 las sondeaba con el stream vivo → en muchos
     *     Android la 2ª apertura lanza NotReadableError y NADA cambiaba);
     *  3) elige la principal con la regla D3/D6 (autofocus real → mayor
     *     resolución; torch desempata; sin AF → label más simple);
     *  4) abre SOLO la ganadora con el preview ligero (960×540 ideal —
     *     DUAL PIPELINE; la captura hi-res va por takePhoto al sensor).
     *  Devuelve el stream de la principal o null (→ cascade/sintética). */
    const openMainCamera = async (): Promise<MediaStream | null> => {
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
        const p = await probeCamera(media, d.deviceId, d.label);
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
      for (const c of attempts) {
        try {
          const stream = await media.getUserMedia(c);
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
              elegida: main?.label ?? track?.label ?? "",
              torch: main?.torch ?? false,
              focusModes: main?.focusModes ?? [],
              width: st?.width ?? 0,
              height: st?.height ?? 0,
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
  }, [applySavedTorchWithRetry, camRestartNonce]);

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
    };
    video.addEventListener("playing", onPlaying);
    return () => video.removeEventListener("playing", onPlaying);
  }, [hasStream, status, applySavedTorchWithRetry]);

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
      canTakePhotoRef.current = typeof ImageCapture !== "undefined";
      profileActiveSensor(stream); // F-SENSOR-PROFILER: tope 4032/3200 px
      setTorchAvailable(true);
      if (flashRef.current) applySavedTorchWithRetry();
    } catch {
      toast.error("Sigue sin permiso", {
        description:
          "Toca el candado 🔒 en la barra de direcciones › Permisos › Cámara › Permitir, y vuelve a intentar.",
        duration: 9000,
      });
    }
  }, [applySavedTorchWithRetry]);

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
    loop.start(video, {
      onFrame: (t) => {
        window.__cameraTelemetry = t;
        // F-ZSL: alimenta el buffer Best-Shot (~5 Hz) — cubre la ventana
        // pre-tap de 80–450 ms para la captura manual sin tap shock.
        feedRingFromVideo();
        const now = performance.now();
        if (now - lastTelemetryAt.current < 100) return; // throttle UI ~10 Hz
        lastTelemetryAt.current = now;
        setLive({
          corners: t.corners,
          score: t.score ? t.score.total : null,
          fps: t.fps,
          searching: t.corners === null,
        });
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
      if (next) toast.success("Flash encendido", { duration: 1200 });
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
  const scorePct = live.score !== null ? Math.round(live.score * 100) : null;

  return (
    <div className="relative flex h-full w-full flex-col bg-black">
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
          <button
            type="button"
            aria-label={`Captura automática: ${autoCapture ? "activada" : "desactivada"}`}
            aria-pressed={autoCapture}
            title="Captura automática (recorte y disparo al detectar el documento)"
            onClick={() => setAutoCapture((v) => !v)}
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

      {/* ── Chip de lote: documentos guardados en cadena durante esta sesión ── */}
      <AnimatePresence>
        {batchSavedCount > 0 && (
          <motion.div
            key="batch-chip"
            initial={{ opacity: 0, y: -10, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 420, damping: 28 }}
            className="pointer-events-none absolute left-1/2 top-[calc(env(safe-area-inset-top,0px)+58px)] z-20 -translate-x-1/2"
            role="status"
          >
            <div className="flex items-center gap-1.5 rounded-full bg-[#34c759]/18 px-3 py-1.5 ring-1 ring-inset ring-[#34c759]/40 backdrop-blur-md">
              <CheckCircle2
                className="h-3.5 w-3.5 text-[#34c759]"
                strokeWidth={2.4}
                aria-hidden="true"
              />
              <span className="text-[12px] font-semibold tracking-tight text-white">
                Lote · {batchSavedCount} {batchSavedCount === 1 ? "documento guardado" : "documentos guardados"}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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

        {/* IA calentando / buscando documento */}
        <AnimatePresence>
          {precisionLive && live.searching && !processing && (
            <motion.div
              key="searching-pill"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.2 }}
              className="pointer-events-none absolute inset-x-0 top-5 z-30 flex justify-center px-6"
            >
              <div className="flex items-center gap-2 rounded-full bg-black/60 px-3.5 py-1.5 backdrop-blur-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#007aff]" aria-hidden="true" />
                <p className="text-[12px] font-medium text-white/85">Buscando documento…</p>
              </div>
            </motion.div>
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

        {/* Toast flotante: documento estable / listo para auto-captura */}
        <AnimatePresence>
          {autoCapture && overlayStable && !processing && (precisionLive || hasStream || status === "simulated") && (
            <motion.div
              key="stable-toast"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.2 }}
              className="pointer-events-none absolute inset-x-0 top-[42%] z-30 flex justify-center px-6"
            >
              <div className="flex items-center gap-2.5 rounded-[20px] bg-black/75 px-4 py-2.5 shadow-[0_4px_12px_rgba(0,0,0,0.3)] backdrop-blur-sm">
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    precisionLive ? "bg-[#007aff]" : "animate-pulse bg-[#007aff]"
                  )}
                  aria-hidden="true"
                />
                <p className="text-[14px] font-medium text-white">
                  Mantén inmóvil el dispositivo…
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Meter de calidad EN VIVO (pipeline real) */}
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
            onClick={onShutter}
            disabled={processing}
            className={cn(
              "relative -mt-[20px] flex h-[72px] w-[72px] items-center justify-center rounded-full border-4 border-white bg-white/10",
              "shadow-[0_6px_20px_rgba(0,0,0,0.4)] transition-all duration-150 active:scale-90",
              processing && "opacity-50"
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
                onClick={() => setAutoCapture((v) => !v)}
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
