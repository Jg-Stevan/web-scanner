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
  Sparkles,
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
  generateDemoPage,
  getScannerWorker,
  loadImage,
} from "@/lib/scanner/image-processor";
import { BLUR_THRESHOLD } from "@/lib/scanner/quality";
import {
  CameraFrameLoop,
  SyntheticCamera,
  type FrameLoopTelemetry,
} from "@/lib/scanner/frame-loop";
import { SHUTTER_SCORE } from "@/lib/scanner/quality";

type CameraStatus = "idle" | "live" | "synthetic" | "simulated";

/* ── Lecciones de compatibilidad del producto (ARQUITECTURA §4) ──────────
 *  E3: presupuesto de píxeles — SOLO ancho ideal 3840, sin alto ni ratio
 *      (el alto lo negocia el navegador; over-constraining = fallos).
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
const IDEAL_CAPTURE_WIDTH = 3840;
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
 *  la foto full-res con una sola compresión). Con el tope en la resolución
 *  completa del sensor ya no hay downscale en el flujo normal de captura;
 *  4032×3024 ≈ 12.2 MP, aún lejos del límite de canvas de iOS. */
async function downscaleDataUrl(dataUrl: string, max = 4032): Promise<string> {
  try {
    const img = await loadImage(dataUrl);
    const big = Math.max(img.width, img.height);
    if (big <= max) return dataUrl;
    const scale = max / big;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.95);
  } catch {
    return dataUrl;
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

/** Candidata del ranking §5.4: frame de video o foto ya convertida. */
interface BurstCand {
  m: BurstMeasures | null;
  frame: BurstFrame | null;
  photoUrl: string | null;
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

/** Mide el blob de la foto (takePhoto) por ruta NATIVA: createImageBitmap
 *  → 400 px → medidas → bitmap.close() INMEDIATO (R-14). El decode lo hace
 *  el navegador (sin data-URL ni <img>: la versión anterior decodificaba la
 *  foto de 12 MP DOS veces y costaba ~0.5 s por captura). Si conocemos el
 *  aspecto del track (la foto comparte el del sensor) se pide el decode YA
 *  escalado a ~400 px — escalado DCT del decoder, ~5-10× más rápido que
 *  decodificar los 12 MP completos. LapVar y exposición son invariantes a
 *  rotación/EXIF y al reescalado suave → medición equivalente a §5.4. */
async function measureBlobFast(
  blob: Blob,
  trackAspect?: number
): Promise<BurstMeasures | null> {
  try {
    if (typeof createImageBitmap !== "function") return null;
    let bitmap: ImageBitmap;
    if (trackAspect && trackAspect > 0.05) {
      // Lado mayor = 400 px, aspect del track (±delta no afecta el gate:
      // lapVar/exposición son robustas al reescalado suave).
      const w = Math.round(400 * Math.min(1, trackAspect));
      const h = Math.round(w / trackAspect);
      try {
        bitmap = await createImageBitmap(blob, {
          resizeWidth: Math.max(1, w),
          resizeHeight: Math.max(1, h),
          resizeQuality: "low",
        });
      } catch {
        bitmap = await createImageBitmap(blob);
      }
    } else {
      bitmap = await createImageBitmap(blob);
    }
    const m = measurePixels(bitmap, bitmap.width, bitmap.height);
    bitmap.close();
    return m;
  } catch {
    return null;
  }
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
  /** F-CLEAN: la auto-captura ya no vive en Ajustes — control local de la
   *  cámara (botón de la toolbar), activada por defecto en cada sesión. */
  const [autoCapture, setAutoCapture] = useState(true);
  const autoRef = useRef(true);
  /** F-FLASH: la linterna arranca APAGADA en cada sesión (el ajuste
   *  "Flash" se eliminó); el usuario la enciende con el botón. */
  const flashRef = useRef(false);
  /** F-FLASH v3: espejo de torchOn legible desde listeners sin re-render. */
  const torchOnRef = useRef(false);
  const lastTelemetryAt = useRef(0);

  const [status, setStatus] = useState<CameraStatus>("idle");
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
  /** Toast único por sesión de aviso calidad en iPhone (auto-captura = frames). */
  const iosQualityToastShownRef = useRef(false);

  autoRef.current = autoCapture;
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
      const wasOn = torchOnRef.current;
      const applied = caps?.torch === true || st.torch === true || (!on && wasOn);
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

  /** Pipeline tras obtener la imagen (FLUJO ADOBE SCAN — F-FLOW):
   *  flash → bordes → calidad → store → EDITOR DIRECTO. Tras la captura
   *  (manual o auto) se navega inmediatamente al modo revisión con el
   *  recorte automático y el filtro ya aplicados. */
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
        const dataUrl = await downscaleDataUrl(rawDataUrl);
        const [detectedQuad, quality] = await Promise.all([
          detectDocumentEdges(dataUrl),
          evaluateQuality(dataUrl),
        ]);
        const page: CapturePage = {
          id: nextId("page"),
          original: dataUrl,
          quad: detectedQuad,
          filter: "text", // default del producto: Texto claro (§8)
          rotation: 0,
          quality,
        };
        addCapturePage(page);
        // F-FLOW: directo al editor (modo revisión) — igual que Adobe Scan.
        setView("editor");
      } catch {
        toast.error("No se pudo procesar la imagen");
      } finally {
        processingRef.current = false;
        setProcessing(false);
      }
    },
    [addCapturePage, setView]
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

  /** E3b — Captura a RESOLUCIÓN DEL SENSOR como Blob (aún SIN convertir a
   *  data URL): la medición §5.4 (createImageBitmap nativo) y la conversión
   *  corren EN PARALELO — nunca en serie. Carrera de 5 s (takePhoto puede
   *  colgarse — error #29); null → el llamador cae a los frames del video.
   *  La orientación EXIF la aplica el pipeline al decodificar (loadImage). */
  const takePhotoBlob = useCallback(async (): Promise<Blob | null> => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || typeof ImageCapture === "undefined") return null;
    try {
      const capture = new ImageCapture(track);
      const blob = await Promise.race([
        capture.takePhoto(),
        new Promise<never>((_, reject) =>
          window.setTimeout(() => reject(new Error("takePhoto timeout")), 5000)
        ),
      ]);
      return blob && blob.size > 0 ? blob : null;
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
    return { canvas, m: measurePixels(canvas, canvas.width, canvas.height) };
  }, []);

  /** Captura inteligente (E3 + §5.4) — CAMINO FELIZ = velocidad v12:
   *  1. Frame A: solo píxeles + medidas (sin JPEG, sin decode extra).
   *  2. Foto hi-res (blob) → medición NATIVA ‖ data URL en PARALELO.
   *  3. La foto pasa (lapVar ≥ 100 ∧ exposure ≥ 0.5) → dispatch YA:
   *     cero encodes de frames, cero decodes extra de la foto.
   *  Solo si la foto cae o NO pasa: burst completo (A, foto, B), ranking
   *  por lapVar — ganador = photoPass ?? best (§5.4) — y se encodea
   *  ÚNICAMENTE el ganador; los perdedores se liberan al instante (R-14).
   *  Cooldown anti doble-disparo 1500 ms (§5.2). */
  const captureSmart = useCallback(async () => {
    if (processingRef.current) return;
    if (cooldownRef.current > Date.now()) return;
    loopRef.current?.notifyCaptured();
    cooldownRef.current = Date.now() + 1500;

    const EXPOSURE_MIN = 0.5;

    /** Mejor frame por lapVar → encode SOLO del ganador → dispatch. */
    const dispatchBestFrame = async (framesRaw: Array<BurstFrame | null>) => {
      const frames = framesRaw.filter((f): f is BurstFrame => f !== null);
      if (frames.length === 0) return;
      const measured = frames.filter((f) => f.m !== null);
      const winner =
        measured.length === 0
          ? frames[0]! // sin telemetría → orden de llegada (§5.4)
          : measured.reduce((a, b) => (b.m!.lapVar > a.m!.lapVar ? b : a));
      const url = await canvasToDataUrl(winner.canvas);
      for (const f of frames) releaseFrame(f);
      if (url) void handleCaptureDataUrl(url);
    };

    // §5.4 — frame A ANTES de la foto: si takePhoto cuelga 5 s y cae,
    // ya queda un candidato válido medido.
    const snapA = snapshotVideo();
    const photoBlob = canTakePhotoRef.current ? await takePhotoBlob() : null;
    if (!photoBlob) {
      await dispatchBestFrame([snapA, snapshotVideo()]);
      return;
    }

    // Bracket §5.4: frame B justo después de la foto (solo píxeles).
    const snapB = snapshotVideo();

    // Aspecto del track → decode escalado de la medición (la foto comparte
    // el aspecto del sensor; si difiere, el gate sigue siendo válido).
    const trackSettings = streamRef.current?.getVideoTracks()[0]?.getSettings();
    const trackAspect =
      trackSettings?.width && trackSettings?.height
        ? trackSettings.width / trackSettings.height
        : undefined;

    let photoM: BurstMeasures | null = null;
    let photoUrl: string | null = null;
    try {
      [photoM, photoUrl] = await Promise.all([
        measureBlobFast(photoBlob, trackAspect),
        blobToDataUrl(photoBlob),
      ]);
    } catch {
      photoUrl = null; // FileReader falló (rarísimo) → burst de frames
    }
    if (!photoUrl) {
      await dispatchBestFrame([snapA, snapB]);
      return;
    }

    const photoPass =
      photoM !== null && photoM.lapVar >= BLUR_THRESHOLD && photoM.exposure >= EXPOSURE_MIN;
    if (photoPass || photoM === null) {
      // Camino del ~95 %: la foto pasa el gate (o sin telemetría → la foto
      // full-sensor es la apuesta del producto) → dispatch INMEDIATO y
      // frames descartados (R-14). Latencia ≈ v12 (foto → editor).
      releaseFrame(snapA);
      releaseFrame(snapB);
      void handleCaptureDataUrl(photoUrl);
      return;
    }

    // La foto NO pasa (borrosa / mal expuesta) → ranking §5.4 con los tres
    // medidos; se encodea SOLO el ganador.
    const cands: BurstCand[] = [];
    if (snapA) cands.push({ m: snapA.m, frame: snapA, photoUrl: null });
    cands.push({ m: photoM, frame: null, photoUrl });
    if (snapB) cands.push({ m: snapB.m, frame: snapB, photoUrl: null });
    const measuredC = cands.filter((c) => c.m !== null);
    if (measuredC.length === 0) {
      releaseFrame(snapA);
      releaseFrame(snapB);
      void handleCaptureDataUrl(photoUrl);
      return;
    }
    const bestC = measuredC.reduce((a, b) => (b.m!.lapVar > a.m!.lapVar ? b : a));
    const url = bestC.frame ? await canvasToDataUrl(bestC.frame.canvas) : photoUrl;
    releaseFrame(snapA);
    releaseFrame(snapB);
    if (url) void handleCaptureDataUrl(url);
  }, [snapshotVideo, takePhotoBlob, canvasToDataUrl, blobToDataUrl, handleCaptureDataUrl]);

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

  const onFilePicked = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        toast.error("El archivo seleccionado no es una imagen");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => void handleCaptureDataUrl(String(reader.result ?? ""));
      reader.onerror = () => toast.error("No se pudo leer la imagen");
      reader.readAsDataURL(file);
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
      // §5.2 — Safari/iOS NO implementa ImageCapture en NINGUNA versión:
      // el shutter manual abrirá la cámara nativa y la auto-captura usará
      // frames de video (≤ 1080p). Toast único por sesión (§5.2).
      canTakePhotoRef.current = typeof ImageCapture !== "undefined";
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

    /** E3: cascada de apertura — presupuesto de píxeles (ancho ideal 3840,
     *  SIN alto ni ratio). F-LENS: el primer intento fuerza EXACT la trasera
     *  (en algunos móviles "environment" a secas negocia la gran angular);
     *  si el exact falla se relaja a ideal → {video:true}. */
    const openWithCascade = async (): Promise<MediaStream | null> => {
      const attempts: MediaStreamConstraints[] = [
        {
          video: {
            facingMode: { exact: "environment" },
            width: { ideal: IDEAL_CAPTURE_WIDTH },
          },
          audio: false,
        },
        {
          video: { facingMode: "environment", width: { ideal: IDEAL_CAPTURE_WIDTH } },
          audio: false,
        },
        { video: { facingMode: "environment" }, audio: false },
        { video: true, audio: false },
      ];
      for (const c of attempts) {
        try {
          return await media.getUserMedia(c);
        } catch {
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
     *  4) abre SOLO la ganadora con presupuesto de píxeles (3840 ideal).
     *  Devuelve el stream de la principal o null (→ cascade/sintética). */
    const openMainCamera = async (): Promise<MediaStream | null> => {
      // 1) Desbloqueo de etiquetas (F1-a de codigo-test): sin permiso previo
      //    los labels/deviceIds llegan vacíos en enumerateDevices.
      try {
        const unlock = await media.getUserMedia({ video: true, audio: false });
        unlock.getTracks().forEach((t) => t.stop());
      } catch {
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
      const attempts: MediaStreamConstraints[] = main
        ? [
            {
              video: {
                deviceId: { exact: main.deviceId },
                width: { ideal: IDEAL_CAPTURE_WIDTH },
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
        } catch {
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
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      syntheticRef.current?.stop();
      syntheticRef.current = null;
    };
  }, [applySavedTorchWithRetry]);

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
    };
  }, [precisionLive]);

  // Linterna — F-FLASH v3: botón SIEMPRE activo con cámara real; la verdad
  // se descubre al pulsar (aplicar + verificar getSettings.torch). Sin
  // ajuste persistido: cada sesión empieza con la linterna apagada.
  const toggleTorch = useCallback(async () => {
    if (status !== "live") {
      toast(TORCH_HINT, { icon: "🔦", duration: 8000 });
      return;
    }
    const next = !torchOn;
    const applied = await setTorchState(next);
    if (applied) {
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
    if (!(status === "live" && stable)) return;
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
        accept="image/*"
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
        <div className="grid grid-cols-[1fr_auto_1fr] items-center px-2 pt-3">
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
              {/* Auto-captura con botón propio en la toolbar (F-CLEAN).
                  Linterna con botón propio en la toolbar inferior (F-SWAP). */}
              <MenuRow icon={Sparkles} label="Añadir página de demo" onClick={captureDemo} />
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
