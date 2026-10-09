"use client";

/**
 * ESCANEAR (§7.1) — marco con corner brackets, retícula central, botón
 * disparo, ghost IMPORTAR y PANEL DE SIMULACIÓN para forzar el resultado.
 * FASE LÓGICA L2 (§7): chips de FUENTE (SIMULACIÓN · CÁMARA · IMPORTAR);
 * IMPORTAR IMAGEN real (input file → setArchivoPendiente → análisis);
 * warmUp del worker OpenCV al montar (§9).
 *
 * FASE LÓGICA L3 (§7 rev.3 — interfaz de escaneo del lab COPIADA de
 * apps/scanner-lab/src/components/scanner/CameraView.tsx y re-vestida con la
 * estética Precision Monitor, con CERO dependencias nuevas: solo las que ya
 * tiene e14 + funciones puras del core):
 *  · <video> en el marco existente + CameraFrameLoop del core (detección en
 *    vivo OpenCV, score compuesto, k-de-n, isDeviceStable).
 *  · HUD "CALIDAD 82%" + "ACTA DETECTADA / NO DETECTADA" (font-data).
 *  · Pill "BUSCANDO ACTA…" superior centrada (lab L1737-1753) mientras
 *    corners === null.
 *  · Quad overlay SVG en vivo (lab L1693-1711) en ok-tint con mapeo
 *    object-cover exacto (mapPoint).
 *  · Pill "IA · AUTO / IA · MANUAL" (lab L1553-1566) con punto pulsante verde.
 *  · Toggle AUTO — default OFF (D22 del spec → D24 aquí): el gate del CORE
 *    dispara onTrigger (k-de-n, cooldown 1500 ms, re-arme, quietud); el
 *    componente solo filtra if (!autoArmado || procesando) (lab L1380-1385).
 *  · Flash F-FLASH v3 (lab L486-555 + L1404-1416): applyConstraints +
 *    verificación getSettings().torch + flashRef con reintentos.
 *  · ZSL best-shot ring (lab L779-805 + L1395-1400): el disparo manual NO
 *    usa el frame del instante del tap — ganador por lapVar de 80-450 ms
 *    ANTES del disparo; ring liberado al desmontar.
 *  · Ruta iOS (lab L902-925): con ImageCapture → captureSmart (foto
 *    full-res del sensor); iOS/Safari sin ImageCapture → cámara NATIVA vía
 *    <input capture="environment">; último recurso → grab del video vivo
 *    (frameActual del bridge).
 *  · Destello blanco ~120 ms al capturar (lab L569, flashKey).
 *  · onNoDetectTimeout → toast "NO DETECTO EL ACTA · ACÉRCALA AL ENCUADRE".
 *  · Permiso denegado / sin HTTPS / sin getUserMedia → toast warn + vuelta
 *    automática a SIMULACIÓN (spec §7).
 *
 * FIDELIDAD AL LAB (fix/e14-fidelidad-lab — SPEC-auditoria-copias.md):
 *  · F-LENS v4 COMPLETO (H1): sondas secuenciales cerrando cada cámara +
 *    chooseMainProbe (autofocus real → mayor resolución) + fix zoom +
 *    telemetría window.__cameraChoice — la cascada facingMode quedó como red
 *    de seguridad (lab L116-223 + L1095-1207).
 *  · F-SENSOR-PROFILER (H2): perfilado del track + takePhotoBlob con capa 1
 *    (photoSettings al ISP) y capa 2 (clampBlobToSafeCap) + capa 3 (decode
 *    único + downscaleImage por GAMA) en el punto de entrada del pipeline —
 *    CÁMARA, IMPORTAR y cámara nativa iOS reciben el tope ANTES del bridge.
 *  · captureSmart §5.4 (H3): snapA ANTES del disparo; TORCH_HINT verbatim
 *    (H4); accept .heic/.heif + guard F-IMPORT/HEIC (H5).
 * Fuera de alcance (spec): "Revisar N" + contador multi-página (1 acta = 1
 * captura). En SIMULACIÓN/IMPORTAR la vista queda EXACTAMENTE como en L2.
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { warmUpScannerWorker } from "@jg-stevan/scanner-core/detector-client";
// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L61-L67
// (imports del sensor-profiler — el core YA exporta todo: cero cambios en el core).
import {
  buildCappedPhotoSettings,
  clampBlobToSafeCap,
  getSensorSafeCap,
  profileSensor,
  type SensorProfile,
} from "@jg-stevan/scanner-core/sensor-profiler";
// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L48-L54
// (loadImage/fileToCaptureDataUrl) — la capa 3 del dispatch decodifica UNA
// vez antes de que la foto entre al pipeline del bridge.
import { fileToCaptureDataUrl, loadImage } from "@jg-stevan/scanner-core/image-processor";
import { CameraFrameLoop, type FrameLoopTelemetry } from "@jg-stevan/scanner-core/frame-loop";
import { SHUTTER_SCORE } from "@jg-stevan/scanner-core/quality";
import type { Quad } from "@jg-stevan/scanner-core/types";
import { useE14Store } from "@/lib/e14/store";
import type { Forzado } from "@/lib/e14/bridge";
import type { FuenteCaptura } from "@/lib/e14/types";
import { FlashIcon, ImportIcon, ScanFrameIcon } from "../icons";

const CHIPS: { valor: Forzado; label: string }[] = [
  { valor: "ALEATORIO", label: "ALEATORIO" },
  { valor: "OPTIMA", label: "ÓPTIMA" },
  { valor: "ADVERTENCIA", label: "ADVERTENCIA" },
  { valor: "RECHAZADA", label: "RECHAZADA" },
];

const FUENTES: { valor: FuenteCaptura; label: string }[] = [
  { valor: "SIMULACION", label: "SIMULACIÓN" },
  { valor: "CAMARA", label: "CÁMARA" },
  { valor: "ARCHIVO", label: "IMPORTAR" },
];

/* ── Constantes de cámara (lab CameraView.tsx, adaptadas al task §2) ─────── */

/** Preview ideal 1920×1080 (task L3); la captura full-res va por takePhoto. */
const IDEAL_PREVIEW_WIDTH = 1920;
const IDEAL_PREVIEW_HEIGHT = 1080;
/** Cooldown anti doble-disparo (lab §5.2 — CAPTURE_COOLDOWN_MS del core). */
const COOLDOWN_MS = 1500;
/** F-ZSL: ventana pre-tap 80–450 ms (anti tap-shock) + ring de máx 8 frames. */
const ZSL_DESDE_MS = 80;
const ZSL_HASTA_MS = 450;
const RING_MAX = 8;
/** Feed del ring desde el video a ~5 Hz (lab L735-737). */
const RING_FEED_MS = 200;
/** Throttle de la telemetría que va al UI (lab L1371). */
const TELEMETRIA_UI_MS = 100;
/** Destello de captura ~120 ms (spec §7 — duración en globals.css) + margen
 *  antes de navegar a ANALIZANDO (el visor se desmonta). */
const NAVEGACION_TRAS_MS = 260;
/** takePhoto puede colgarse (lab error #29): carrera de 8 s. */
const TAKEPHOTO_TIMEOUT_MS = 8000;

// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L119-L127
// (TORCH_HINT verbatim — remediación H4: es copy de UX de campo; el operador
//  electoral necesita el diagnóstico completo, no la versión corta).
/** F-FLASH v3 — diagnóstico del flash: cubre navegador sin soporte (iPhone:
 *  Safari 17.4+, Chrome/Firefox de iOS no exponen torch; WebViews in-app
 *  tampoco), cámara sin LED (gran angular/macro) y permisos WebView. */
const TORCH_HINT =
  "No se pudo controlar la linterna aquí. Causas típicas: navegador sin " +
  "soporte (en iPhone usa Safari 17.4 o posterior; Chrome/Firefox de iOS " +
  "no lo permiten), cámara abierta sin LED (gran angular o macro) o la " +
  "app corre dentro de otra app (Instagram, WhatsApp…). Cierra el " +
  "escáner y vuelve a abrirlo; si persiste, prueba en otro navegador.";

/** QA/diagnóstico: telemetría viva del loop + lente elegida (F-LENS v4)
 *  desde la consola. */
declare global {
  interface Window {
    __e14Telemetria?: FrameLoopTelemetry;
    __cameraChoice?: unknown;
  }
}

/* ── F-LENS v4 — selección de la cámara PRINCIPAL (puerto EXACTO del lab) ────
 *  Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L76-L92
 *  (comentario E4/F-LENS v4) + L116-L223 (código). Remedición H1 del
 *  SPEC-auditoria-copias.md: la fase lógica dejó solo la cascada
 *  facingMode (la red de seguridad del lab) y el bug visible en producción
 *  fue la GRAN ANGULAR en vez de la principal 50MP. */

// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L76-L92 (E4/F-LENS v4):
// E4: facingMode NO es confiable en iPhone (puede ganar la frontal o
//     ignorarse) → tras permiso se re-selecciona por LABEL + deviceId
//     exact, con facingMode como constrain inicial únicamente.
// F-LENS v4 (bug v3: "no cambia nada ni el flash" — y codigo-test SÍ
// funciona en el MISMO teléfono): dos causas de raíz encontradas al
// comparar con el CameraController de codigo-test:
//     A) v3 sondeaba las demás lentes CON el stream actual aún abierto →
//        en muchos Android abrir una 2ª cámara con otra activa lanza
//        NotReadableError → TODAS las sondas fallaban → nunca cambiaba
//        de lente ni encontraba el LED. codigo-test sondea SECUENCIAL-
//        MENTE cerrando cada cámara antes de abrir la siguiente y ANTES
//        de abrir la definitiva (puerto exacto de probeDevice +
//        chooseMainCamera: autofocus real → mayor resolución).
//     B) el botón flash se deshabilitaba salvo que getCapabilities()
//        reportara torch; hay Chrome que NO lo anuncian pero SÍ lo
//        aplican → ahora el botón está habilitado en cámara real y la
//        verdad se descubre APLICANDO y leyendo getSettings().torch.

// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L116-L117
const BACK_CAMERA_RE = /back|rear|environment|trasera|posterior|arri[eè]re/i;
const FRONT_CAMERA_RE = /front|delantera|anterior|face|facial|selfie/i;

// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L129-L137
/** Resultado de sondear UNA cámara (puerto de CameraProbe de codigo-test). */
interface CameraProbeResult {
  deviceId: string;
  label: string;
  focusModes: string[];
  torch: boolean;
  maxWidth: number;
  maxHeight: number;
}

// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L139-L144
/** Modos de foco que cuentan como autofocus REAL (regla D3 de codigo-test). */
const REAL_AF_MODES = new Set(["continuous", "single-shot"]);

function hasRealAF(modes: string[]): boolean {
  return modes.some((m) => REAL_AF_MODES.has(m.toLowerCase()));
}

// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L146-L148
function readCapsNum(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L150-L188
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

// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L190-L223
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


// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L245-L290
// (downscaleImage — función de módulo del lab, canvas puro. NO existe en el
// core → se COPIA, regla de oro 6 del SPEC-auditoria-copias.md; remediación H2.)
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

/* ── ZSL §5.4 del lab — medidas SIN encode/decode extra (L311-356) ───────── */

/** Medidas de una candidata del burst: varianza Laplaciano + exposición. */
interface Medidas {
  lapVar: number;
  exposure: number;
}

/** Laplaciano 3×3 (varianza) + histograma de exposición sobre la luma de un
 *  canvas ≤ 400 px (misma matemática del quality.ts del core). */
function medirGris(gray: Float32Array, w: number, h: number): Medidas {
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

/** Dibuja la fuente a 400 px de lado mayor y mide. SIN encode ni decode. */
function medirPixeles(src: CanvasImageSource, sw: number, sh: number): Medidas | null {
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
  return medirGris(gray, w, h);
}

// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L927-L948
// (F-IMPORT robusto + F-HEIC — el MISMO onFilePicked del lab sirve a sus dos
//  inputs, galería y cámara nativa iOS; aquí igual, remediación H5).
/** ¿El archivo es una imagen visible en el picker? (el picker filtra por
 *  accept, pero en desktop se puede elegir «todos los archivos»). */
function pareceImagen(archivo: File): boolean {
  return (
    archivo.type.startsWith("image/") ||
    /\.(heic|heif|jpe?g|png|webp|bmp|gif|avif)$/i.test(archivo.name)
  );
}

/** ¿Parece HEIC? Heurística del lab: los «.jpg» de iPhone transportados por
 *  apps pueden traer contenido HEIC; si la decodificación nativa falla
 *  también irán al rescate (F-HEIC del core), pero no se puede saber de
 *  antemano → aviso solo si es HEIC explícito. */
function esHeic(archivo: File): boolean {
  return /heic|heif/i.test(archivo.type) || /\.hei[cf]$/i.test(archivo.name);
}

/** iOS/Safari NO implementa ImageCapture en ninguna versión (lab §5.2). */
function esIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ se presenta como Mac con touch.
  return /Mac/.test(ua) && typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 1;
}

/** R-14 (lab releaseFrame L360-365): suelta YA el backing store del canvas
 *  perdedor — no espera al GC (disciplina de memoria iOS, error #22). */
function liberarCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

/** Telemetría reducida para el UI (throttle ~100 ms — LiveUi del lab). */
interface LiveUi {
  corners: Quad | null;
  score: number | null;
}

/** Frame del ring ZSL (copia dedicada + lapVar + timestamp). */
interface FrameAnillo {
  canvas: HTMLCanvasElement;
  lapVar: number;
  timestamp: number;
}

type CamEstado = "iniciando" | "viva" | "no-disponible";

export function ScanView() {
  const dispararEscaneo = useE14Store((s) => s.dispararEscaneo);
  const forzado = useE14Store((s) => s.forzado);
  const setForzado = useE14Store((s) => s.setForzado);
  const fuente = useE14Store((s) => s.fuente);
  const setFuente = useE14Store((s) => s.setFuente);
  const setArchivoPendiente = useE14Store((s) => s.setArchivoPendiente);
  const setFramePendiente = useE14Store((s) => s.setFramePendiente);
  const notificar = useE14Store((s) => s.notificar);
  const online = useE14Store((s) => s.online);
  const alternarConexion = useE14Store((s) => s.alternarConexion);
  const inputRef = useRef<HTMLInputElement>(null);
  /** HQ-iOS: cámara NATIVA del sistema (el click del shutter es el gesto). */
  const inputCamaraRef = useRef<HTMLInputElement>(null);

  // ── Cámara (refs y estado — patrón del lab L383-458) ──
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const visorRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef<CameraFrameLoop | null>(null);
  const procesandoRef = useRef(false);
  const cooldownRef = useRef(0);
  // D22/D24: AUTO default OFF — el operador decide si arma (intentos finitos).
  const [autoArmado, setAutoArmado] = useState(false);
  const autoRef = useRef(false);
  /** F-FLASH: preferencia de linterna de la sesión (re-aplicada por stream). */
  const [flashPrefOn, setFlashPrefOn] = useState(false);
  const flashRef = useRef(false);
  /** Espejo legible desde listeners sin re-render (lab L399-400). */
  const torchOnRef = useRef(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchDisponible, setTorchDisponible] = useState(false);
  const [camEstado, setCamEstado] = useState<CamEstado>("iniciando");
  const [live, setLive] = useState<LiveUi>({ corners: null, score: null });
  const [procesando, setProcesando] = useState(false);
  const [destelloKey, setDestelloKey] = useState(0);
  const [videoDims, setVideoDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [boxSize, setBoxSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const puedeTomarFotoRef = useRef(false);
  const toastIOSYaRef = useRef(false);
  const telemetriaAtRef = useRef(0);
  // Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L433-L440
  /** F-SENSOR-PROFILER (PASO 2): perfil del sensor de FOTO del track vivo
   *  (resolución nativa vía getPhotoCapabilities + tope seguro 4032/3200 px
   *  según la gama medida). null = aún sin sondear. */
  const sensorProfileRef = useRef<SensorProfile | null>(null);
  // F-ZSL — buffer circular Best-Shot (lab L407-411).
  const anilloRef = useRef<FrameAnillo[]>([]);
  const anilloFeedAtRef = useRef(0);
  const anilloScratchRef = useRef<HTMLCanvasElement | null>(null);

  // Espejos para listeners del loop sin re-render (lab L456-458).
  autoRef.current = autoArmado;
  flashRef.current = flashPrefOn;
  torchOnRef.current = torchOn;

  const modoCamara = fuente === "CAMARA";
  const camaraViva = modoCamara && camEstado === "viva";
  const buscando = camaraViva && live.corners === null;
  const scoreAlto = (live.score ?? 0) > SHUTTER_SCORE;
  const scorePct = live.score !== null ? Math.round(live.score * 100) : null;

  // §9: precarga OpenCV.js del worker sin bloquear la UI.
  useEffect(() => {
    warmUpScannerWorker();
  }, []);

  /* ── Linterna — F-FLASH v3 (lab L473-520) ─────────────────────────── */

  /** Enciende/apaga el torch y VERIFICA el resultado real leyendo
   *  getSettings().torch — NO confiando en getCapabilities() (hay Chrome que
   *  no anuncian torch en caps pero SÍ lo aplican). Devuelve true si el LED
   *  quedó controlado. */
  const ponerLinterna = useCallback(async (on: boolean): Promise<boolean> => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return false;
    try {
      const caps = track.getCapabilities?.() as { torch?: boolean } | undefined;
      if (caps?.torch) setTorchDisponible(true);
      await track.applyConstraints({
        advanced: [{ torch: on }],
      } as MediaTrackConstraints & { advanced: unknown[] });
      const st = track.getSettings() as { torch?: boolean };
      const aplicado = on ? st.torch === true : st.torch !== true;
      if (aplicado) {
        torchOnRef.current = on;
        setTorchOn(on);
      }
      if (caps?.torch || aplicado) setTorchDisponible(true);
      if (!aplicado && on) {
        // Aceptado en silencio pero sin señal verificable: deshaz para no
        // dejar un LED encendido "fantasma" (lab L494-502).
        await track
          .applyConstraints({ advanced: [{ torch: false }] } as MediaTrackConstraints & {
            advanced: unknown[];
          })
          .catch(() => undefined);
      }
      return aplicado;
    } catch {
      return false;
    }
  }, []);

  /** Re-aplica la preferencia persistida CON REINTENTOS (0/250/700/1500 ms):
   *  varios Android rechazan applyConstraints justo tras getUserMedia. */
  const aplicarLinternaGuardada = useCallback(() => {
    for (const ms of [0, 250, 700, 1500]) {
      window.setTimeout(() => {
        if (!flashRef.current || torchOnRef.current) return;
        void ponerLinterna(true);
      }, ms);
    }
  }, [ponerLinterna]);

  /* ── Captura ZSL (lab L710-770) ───────────────────────────────────── */

  // Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L444-L454
  /** F-SENSOR-PROFILER: sondea el sensor del stream REAL una vez por
   *  apertura (getPhotoCapabilities → nativa + tope por gama). Falla en
   *  silencio (Safari) → takePhoto dispara a secas y el clamp post-decode
   *  protege la RAM. */
  const profileActiveSensor = useCallback((stream: MediaStream): void => {
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    void profileSensor(track).then((p) => {
      sensorProfileRef.current = p;
    });
  }, []);

  /** Copia el fotograma al ring (máx 8) y suelta YA el backing store del
   *  expulsado (disciplina de memoria iOS, error #22). */
  const empujarAnillo = useCallback((canvas: HTMLCanvasElement, lapVar: number) => {
    const anillo = anilloRef.current;
    const copia = document.createElement("canvas");
    copia.width = canvas.width;
    copia.height = canvas.height;
    copia.getContext("2d")?.drawImage(canvas, 0, 0);
    anillo.push({ canvas: copia, lapVar, timestamp: performance.now() });
    if (anillo.length > RING_MAX) {
      const viejo = anillo.shift();
      if (viejo) liberarCanvas(viejo.canvas);
    }
  }, []);

  /** Alimenta el ring desde el <video> vivo a ~5 Hz: garantiza que el buffer
   *  SIEMPRE cubra la ventana pre-tap de 80–450 ms. */
  const alimentarAnillo = useCallback((): void => {
    const ahora = performance.now();
    if (ahora - anilloFeedAtRef.current < RING_FEED_MS) return;
    anilloFeedAtRef.current = ahora;
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) return;
    if (!anilloScratchRef.current) anilloScratchRef.current = document.createElement("canvas");
    const scratch = anilloScratchRef.current;
    if (scratch.width !== video.videoWidth || scratch.height !== video.videoHeight) {
      scratch.width = video.videoWidth;
      scratch.height = video.videoHeight;
    }
    const ctx = scratch.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const m = medirPixeles(scratch, scratch.width, scratch.height);
    empujarAnillo(scratch, m?.lapVar ?? 0);
  }, [empujarAnillo]);

  /** Libera el ring (al desmontar la sesión de cámara — lab L1395-1400). */
  const liberarAnillo = useCallback(() => {
    for (const f of anilloRef.current) liberarCanvas(f.canvas);
    anilloRef.current = [];
  }, []);

  /** Instantánea del <video> a resolución del track + medidas sobre ESA MISMA
   *  imagen (par píxel-idéntico). SIN encode: solo si gana el burst. */
  const instantanea = useCallback(
    (): { canvas: HTMLCanvasElement; lapVar: number } | null => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) return null;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0);
      const m = medirPixeles(canvas, canvas.width, canvas.height);
      empujarAnillo(canvas, m?.lapVar ?? 0);
      return { canvas, lapVar: m?.lapVar ?? 0 };
    },
    [empujarAnillo],
  );

  /** F-ZSL: ganador pre-tap (mayor lapVar entre 80 y 450 ms antes del
   *  disparo) y VACIADO del ring — el canvas del ganador pasa al burst. */
  const tomarZsl = useCallback((): { canvas: HTMLCanvasElement; lapVar: number } | null => {
    const ahora = performance.now();
    const enVentana = anilloRef.current.filter((f) => {
      const edad = ahora - f.timestamp;
      return edad >= ZSL_DESDE_MS && edad <= ZSL_HASTA_MS;
    });
    const ganador =
      enVentana.length > 0
        ? enVentana.reduce((a, b) => (b.lapVar > a.lapVar ? b : a))
        : null;
    // Libera el ring EXCEPTO el canvas del ganador (lab L809-814).
    for (const f of anilloRef.current) {
      if (f === ganador) continue;
      liberarCanvas(f.canvas);
    }
    anilloRef.current = [];
    if (!ganador) return null;
    return { canvas: ganador.canvas, lapVar: ganador.lapVar };
  }, []);

  // Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L625-L635
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

  // Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L637-L681
  // (takePhotoBlob COMPLETO — remediación H2: capas 1 y 2 del F-SENSOR-PROFILER).
  /** DUAL PIPELINE (pilar 2) — Captura a RESOLUCIÓN DEL SENSOR como Blob
   *  (aún SIN convertir a data URL): takePhoto() IGNORA la resolución del
   *  <video> del preview y dispara directo al sensor físico (12–48 MP, p.ej.
   *  4000×3000). Carrera de 8 s (takePhoto puede colgarse — error #29); null
   *  → el llamador cae al ZSL pre-tap y a los frames del video. La
   *  orientación EXIF la aplica el pipeline al decodificar (loadImage). */
  const tomarFoto = useCallback(async (): Promise<Blob | null> => {
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
              window.setTimeout(
                () => reject(new Error("takePhoto timeout 8s")),
                TAKEPHOTO_TIMEOUT_MS,
              ),
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

  /** Canvas → Blob JPEG 0.92 (toBlob, NUNCA toDataURL en canvas grande). */
  const canvasABlob = useCallback(async (canvas: HTMLCanvasElement): Promise<Blob | null> => {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92),
    );
    return blob && blob.size > 0 ? blob : null;
  }, []);

  /** Despacha la captura: destello + vibrate + File → store → ANALIZANDO.
   *  La navegación se demora ~260 ms para que el destello (~120 ms) se vea
   *  ANTES de desmontar el visor. */
  const despacharCaptura = useCallback(
    (archivo: File) => {
      setArchivoPendiente(archivo);
      setDestelloKey((k) => k + 1);
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(30);
      }
      window.setTimeout(() => {
        procesandoRef.current = false;
        setProcesando(false);
        void dispararEscaneo();
      }, NAVEGACION_TRAS_MS);
    },
    [dispararEscaneo, setArchivoPendiente],
  );

  // Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L574-L589
  // (dispatch de handleCaptureDataUrl — decode ÚNICO + capa 3 del
  //  F-SENSOR-PROFILER, remediación H2). Adaptación e14 (fila 4 de la
  //  auditoría): el lab entrega dataUrl a su pipeline; el bridge de e14
  //  recibe File → esta función decodifica UNA vez, aplica el tope por GAMA
  //  y devuelve el File YA dentro del tope — el pipeline de e14 recibe la
  //  foto ya dentro del tope, SIN IMPORTAR LA FUENTE (CÁMARA takePhoto/ZSL +
  //  IMPORTAR 12–48 MP + foto nativa iOS). `robusto` = Files del picker
  //  (F-IMPORT del core: HEIC/EXIF/12-48MP seguros — el lab hace exactamente
  //  esto en onFilePicked); false = File nacido del blob del sensor (base64
  //  barato, sin re-decode). Devuelve null SOLO si la ruta robusta falló.
  const archivoDentroDeTope = useCallback(
    async (archivo: File, robusto: boolean): Promise<File | null> => {
      try {
        const rawDataUrl = robusto
          ? await fileToCaptureDataUrl(archivo)
          : await blobToDataUrl(archivo);
        if (!rawDataUrl) return null; // F-IMPORT falló → el llamador avisa (lab L954-961)
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
        // Dentro del tope → el archivo original pasa INTACTO (F-RES-PRIORITY:
        // la resolución del sensor manda, cero re-encode extra).
        if (!scaledUrl) return archivo;
        const blob = await (await fetch(scaledUrl)).blob();
        if (!blob.size) return archivo;
        return new File([blob], archivo.name, { type: blob.type || "image/jpeg" });
      } catch {
        return archivo; // el bridge reintenta con su propio pipeline robusto
      }
    },
    [blobToDataUrl],
  );

  /** Despacha la captura FINAL (ya dentro del tope H2): destello + vibrate +
   *  File → store → ANALIZANDO. La navegación se demora ~260 ms para que el
   *  destello (~120 ms) se vea ANTES de desmontar el visor. */
  const despacharArchivo = useCallback(
    async (blobOArchivo: Blob, robusto: boolean) => {
      const base =
        blobOArchivo instanceof File
          ? blobOArchivo
          : new File([blobOArchivo], `acta-camara-${Date.now()}.jpg`, {
              type: blobOArchivo.type || "image/jpeg",
            });
      const final = (await archivoDentroDeTope(base, robusto)) ?? base;
      despacharCaptura(final);
    },
    [archivoDentroDeTope, despacharCaptura],
  );

  /** Captura inteligente (lab captureSmart L785-885, adaptada a e14: el
   *  resultado entra al pipeline del bridge como File):
   *  1. ZSL pre-tap (ganador del ring, anti tap-shock).
   *  2. Foto full-res del sensor (takePhoto) si hay ImageCapture → gana
   *     SIEMPRE (F-RES-PRIORITY: la resolución es intocable).
   *  3. Sin foto → burst {zsl, snapA, snap} por lapVar → encode del ganador.
   *  4. Sin NADA → grab del video vivo vía frameActual del bridge. */
  const capturarInteligente = useCallback(async (): Promise<void> => {
    if (procesandoRef.current) return;
    if (cooldownRef.current > Date.now()) return;
    loopRef.current?.notifyCaptured();
    cooldownRef.current = Date.now() + COOLDOWN_MS;
    procesandoRef.current = true;
    setProcesando(true);

    const zsl = tomarZsl();
    // §5.4 — frame A ANTES de la foto: si takePhoto cuelga y cae (8 s),
    // ya queda un candidato válido medido del momento real del tap.
    // Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L843-L845
    // (remediación H3 — snapA existe antes del disparo; el burst de respaldo
    //  queda [zsl, snapA, snapB] con snapA del instante correcto).
    const snapA = instantanea();
    const fotoBlob = puedeTomarFotoRef.current ? await tomarFoto() : null;
    if (fotoBlob) {
      // La foto full-sensor gana: suelta los frames de respaldo (R-14).
      if (zsl) liberarCanvas(zsl.canvas);
      if (snapA) liberarCanvas(snapA.canvas);
      // Capa 3 H2: decode único + tope por GAMA antes del bridge (el blob ya
      // viene ≤tope de las capas 1-2 — aquí es verificación barata, como el
      // dispatch L574-589 del lab).
      void despacharArchivo(fotoBlob, false);
      return;
    }
    if (puedeTomarFotoRef.current && camEstado === "viva") {
      // takePhoto colgó (> 8 s) o no existe → aviso honesto del fallback.
      notificar(
        "warn",
        "CAPTURA A RESOLUCIÓN DEL VISOR",
        "La foto del sensor no respondió; se analiza el mejor fotograma reciente.",
      );
    }
    const snapB = instantanea();
    const candidatos = [zsl, snapA, snapB].filter(
      (f): f is { canvas: HTMLCanvasElement; lapVar: number } => f !== null,
    );
    if (candidatos.length === 0) {
      // Último recurso (lab B8 → e14): grab del video vivo por el bridge
      // (frameActual → canvas a resolución del stream).
      const video = videoRef.current;
      if (video && video.readyState >= 2 && video.videoWidth) {
        setDestelloKey((k) => k + 1);
        window.setTimeout(() => {
          procesandoRef.current = false;
          setProcesando(false);
          void dispararEscaneo();
        }, NAVEGACION_TRAS_MS);
      } else {
        procesandoRef.current = false;
        setProcesando(false);
        notificar("crit", "NO SE PUDO CAPTURAR", "Inténtalo de nuevo.");
      }
      return;
    }
    const ganador = candidatos.reduce((a, b) => (b.lapVar > a.lapVar ? b : a));
    const blob = await canvasABlob(ganador.canvas);
    for (const c of candidatos) {
      if (c !== ganador) liberarCanvas(c.canvas);
    }
    if (blob) {
      // Capa 3 H2: el frame ganador también pasa por el tope (decode único,
      // verificación barata — frames de preview, muy por debajo del tope).
      void despacharArchivo(blob, false);
    } else {
      procesandoRef.current = false;
      setProcesando(false);
      notificar("crit", "NO SE PUDO CAPTURAR", "Inténtalo de nuevo.");
    }
  }, [
    tomarZsl,
    tomarFoto,
    instantanea,
    canvasABlob,
    despacharArchivo,
    dispararEscaneo,
    camEstado,
    notificar,
  ]);

  /** Ref fresca del captureSmart para los listeners del loop (lab L887-888). */
  const capturarRef = useRef(capturarInteligente);
  capturarRef.current = capturarInteligente;

  /* ── Arranque de cámara (lab L996-1252: F-LENS v4 + cascada de respaldo,
     fallback a SIMULACIÓN propio de e14 — remediado H1) ───────────────── */

  useEffect(() => {
    if (fuente !== "CAMARA") return;
    let cancelado = false;
    setCamEstado("iniciando");

    const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!media || typeof media.getUserMedia !== "function" || !window.isSecureContext) {
      notificar(
        "warn",
        "CÁMARA NO DISPONIBLE",
        "Sin acceso a la cámara en este entorno (se requiere HTTPS y permiso). VOLVIENDO A SIMULACIÓN.",
      );
      setFuente("SIMULACION");
      return;
    }

    // Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx
    // L1049-1053 (isPermError) — equivalente exacto (§3 auditoría: reutilizar,
    // no duplicar; aquí ya existía con este nombre desde L3).
    const esErrorPermiso = (e: unknown): boolean =>
      e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");

    // Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx
    // L1055-1093 (openWithCascade) — E3 + DUAL PIPELINE: SOLO anchos/altos
    // IDEALES (ideal nunca rechaza getUserMedia). F-LENS: el primer intento
    // fuerza EXACT la trasera (en algunos móviles "environment" a secas
    // negocia la gran angular); si el exact falla se relaja a ideal →
    // {video:true}. Es la RED DE SEGURIDAD que corre SOLO si las sondas de
    // F-LENS v4 no lograron abrir la principal.
    const abrirConCascada = async (): Promise<MediaStream | null> => {
      const intentos: MediaStreamConstraints[] = [
        {
          video: {
            facingMode: { exact: "environment" },
            width: { ideal: IDEAL_PREVIEW_WIDTH },
            height: { ideal: IDEAL_PREVIEW_HEIGHT },
          },
          audio: false,
        },
        {
          video: {
            facingMode: "environment",
            width: { ideal: IDEAL_PREVIEW_WIDTH },
            height: { ideal: IDEAL_PREVIEW_HEIGHT },
          },
          audio: false,
        },
        { video: { facingMode: "environment" }, audio: false },
        { video: true, audio: false },
      ];
      for (const c of intentos) {
        try {
          return await media.getUserMedia(c);
        } catch (e) {
          if (esErrorPermiso(e)) return null; // permiso: la cascada no ayuda
          /* siguiente nivel */
        }
      }
      return null;
    };

    // Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx
    // L1095-1207 (openMainCamera) — F-LENS v4 arranque estilo codigo-test
    // (donde el flash SÍ funciona):
    // 1) desbloquea labels con un stream genérico que se cierra al instante;
    // 2) sondea TODAS las cámaras UNA POR UNA cerrando cada una antes de
    //    abrir la siguiente (v3 las sondeaba con el stream vivo → en muchos
    //    Android la 2ª apertura lanza NotReadableError y NADA cambiaba);
    // 3) elige la principal con la regla D3/D6 (autofocus real → mayor
    //    resolución; torch desempata; sin AF → label más simple);
    // 4) abre SOLO la ganadora con el preview ligero (aquí 1920×1080 ideal —
    //    D27, decisión documentada de e14; la captura hi-res va por
    //    takePhoto al sensor).
    // Devuelve el stream de la principal o null (→ cascade/SIM).
    // (Nota e14: el lab marca permisoDenegado aquí para su aviso B2 con CTA
    //  «Activar cámara»; e14 no tiene ese overlay — el fallback unificado a
    //  SIMULACIÓN con toast cubre el caso, ver fila 16 de la auditoría.)
    const abrirCamaraPrincipal = async (): Promise<MediaStream | null> => {
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
                width: { ideal: IDEAL_PREVIEW_WIDTH },
                height: { ideal: IDEAL_PREVIEW_HEIGHT },
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
      let stream = await abrirCamaraPrincipal();
      if (!stream) stream = await abrirConCascada();
      if (!stream) {
        if (cancelado) return;
        // Permiso denegado / sin cámara / sin HTTPS (headless cae aquí):
        // toast warn + vuelta automática a SIMULACIÓN (spec §7).
        notificar(
          "warn",
          "CÁMARA NO DISPONIBLE",
          "No hay cámara accesible (permiso denegado, sin hardware o sin conexión segura). VOLVIENDO A SIMULACIÓN.",
        );
        setFuente("SIMULACION");
        return;
      }
      if (cancelado) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;
      setCamEstado("viva");
      // F-SENSOR-PROFILER (PASO 2) — Fuente: apps/scanner-lab/... L1032-1034:
      // mide la nativa de FOTO del sensor y fija el tope seguro (4032/3200
      // px) para tomarFoto, una vez por apertura (remediación H2).
      profileActiveSensor(stream);
      // §5.2: Safari/iOS no implementa ImageCapture → el shutter manual abre
      // la cámara NATIVA; auto-captura usa frames del video.
      puedeTomarFotoRef.current = typeof ImageCapture !== "undefined";
      if (!puedeTomarFotoRef.current && esIOS() && !toastIOSYaRef.current) {
        toastIOSYaRef.current = true;
        notificar(
          "warn",
          "CÁMARA NATIVA EN IPHONE",
          "El disparo abre la cámara del sistema: la foto sale a resolución completa del sensor.",
        );
      }
      // B3 (lab): si el track muere (permiso revocado, otra app roba la
      // cámara) → aviso + vuelta a SIMULACIÓN (el visor no queda congelado).
      const track = stream.getVideoTracks()[0];
      if (track) {
        track.onended = () => {
          if (cancelado) return;
          notificar("warn", "SE PERDIÓ LA CÁMARA", "El stream se cortó. VOLVIENDO A SIMULACIÓN.");
          setFuente("SIMULACION");
        };
      }
      // F-FLASH v3: botón habilitado SIEMPRE con cámara real (la verdad del
      // torch se verifica al pulsar); preferencia persistida → re-aplicar.
      setTorchDisponible(true);
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        void video.play().catch(() => undefined);
        setFramePendiente(video); // bridge: grab del frame si no hay foto
      }
      if (flashRef.current) aplicarLinternaGuardada();
    })();

    return () => {
      cancelado = true;
      const t = streamRef.current?.getVideoTracks()[0];
      if (t) t.onended = null; // stop() no dispara "ended" (lab B3)
      streamRef.current?.getTracks().forEach((st) => st.stop());
      streamRef.current = null;
      setFramePendiente(null);
      setCamEstado("iniciando");
      procesandoRef.current = false;
      cooldownRef.current = 0;
    };
  }, [fuente]);

  /** Re-asigna el stream al <video> (lab L1255-1261) por si el elemento se
   *  remontó (cambio de vista ida/vuelta manteniendo la fuente viva). */
  useEffect(() => {
    if (!camaraViva) return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream || video.srcObject === stream) return;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
  }, [camaraViva]);

  /** Dimensiones del video + "playing" → re-aplicar torch (lab L1262-1269). */
  useEffect(() => {
    if (!camaraViva) return;
    const video = videoRef.current;
    if (!video) return;
    const alReproducir = () => {
      if (flashRef.current && !torchOnRef.current) aplicarLinternaGuardada();
    };
    video.addEventListener("playing", alReproducir);
    return () => video.removeEventListener("playing", alReproducir);
  }, [camaraViva]);

  /** Tamaño del visor (ResizeObserver — mapeo object-cover del overlay). */
  useEffect(() => {
    const el = visorRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setBoxSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ── FRAME LOOP REAL (lab L1356-1402): detección en vivo + k-de-n ──── */

  useEffect(() => {
    if (!camaraViva) return;
    const video = videoRef.current;
    if (!video) return;
    const loop = new CameraFrameLoop();
    loopRef.current = loop;
    loop.start(video, {
      onFrame: (t) => {
        if (typeof window !== "undefined") window.__e14Telemetria = t;
        // F-ZSL: alimenta el ring (~5 Hz) — cubre la ventana pre-tap.
        alimentarAnillo();
        const ahora = performance.now();
        if (ahora - telemetriaAtRef.current < TELEMETRIA_UI_MS) return; // ~10 Hz
        telemetriaAtRef.current = ahora;
        setLive({ corners: t.corners, score: t.score ? t.score.total : null });
      },
      onTrigger: () => {
        // El gate fino (k-de-n, cooldown del core, re-arme, isDeviceStable)
        // vive en CameraFrameLoop — aquí solo el filtro del lab L1380-1385.
        if (!autoRef.current) return;
        if (procesandoRef.current) return;
        if (cooldownRef.current > Date.now()) return;
        void capturarRef.current();
      },
      onNoDetectTimeout: () => {
        notificar("warn", "NO DETECTO EL ACTA", "Acércala más al encuadre.");
      },
    });
    return () => {
      loop.stop();
      loopRef.current = null;
      // F-ZSL: libera el Best-Shot ring al cerrar la sesión de cámara.
      liberarAnillo();
    };
  }, [camaraViva]);

  /** Linterna — botón SIEMPRE activo con cámara; la verdad al pulsar (lab
   *  toggleTorch L1404-1422). Sin cámara viva o sin verificación → hint
   *  completo del lab (TORCH_HINT verbatim — remediación H4). */
  const alternarLinterna = useCallback(async () => {
    if (camEstado !== "viva") {
      notificar("warn", "LINTERNA NO CONTROLADA", TORCH_HINT);
      return;
    }
    const siguiente = !torchOn;
    const aplicado = await ponerLinterna(siguiente);
    if (aplicado) {
      setFlashPrefOn(siguiente);
      if (siguiente) {
        notificar("ok", "FLASH ENCENDIDO", "Linterna del dispositivo activa.");
      }
    } else {
      notificar("warn", "LINTERNA NO CONTROLADA", TORCH_HINT);
    }
  }, [camEstado, torchOn, ponerLinterna, notificar]);

  /* ── Disparo por plataforma (lab onShutter L902-925) ──────────────── */

  const alDisparar = useCallback(() => {
    if (fuente !== "CAMARA") {
      // SIM/ARCHIVO: disparo directo (L2 intacto; el guard del store avisa).
      void dispararEscaneo();
      return;
    }
    const video = videoRef.current;
    const streamVivo = camEstado === "viva" && !!video && video.readyState >= 2;
    if (streamVivo) {
      if (puedeTomarFotoRef.current || !esIOS()) {
        // Chrome/Android → takePhoto full-res; desktop sin ImageCapture →
        // best frame ZSL del ring (el fallback interno de captureSmart).
        void capturarInteligente();
      } else {
        // HQ-iOS: el click del shutter ES el gesto de usuario que iOS exige
        // → cámara NATIVA del sistema (input capture=environment).
        inputCamaraRef.current?.click();
      }
      return;
    }
    inputCamaraRef.current?.click(); // cámara iniciando → picker
  }, [fuente, camEstado, dispararEscaneo, capturarInteligente]);

  /** Elegir imagen = fuente ARCHIVO + análisis inmediato (L2) + capa 3 H2:
   *  la foto de galería (12–48 MP) entra al pipeline YA dentro del tope
   *  (decode único + downscaleImage por GAMA — dispatch L574-589 del lab).
 *  Guard F-IMPORT/HEIC del lab L937-948 (remediación H5). */
  const alElegirArchivo = (e: ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    e.target.value = ""; // permite re-elegir el MISMO archivo (REPETIR FOTO)
    if (!archivo) return;
    if (!pareceImagen(archivo)) {
      notificar("crit", "ARCHIVO NO VÁLIDO", "El archivo seleccionado no es una imagen.");
      return;
    }
    // HEIC explícito → aviso de conversión (puede tardar unos segundos; la
    // conversión vive en el F-HEIC del core, dentro del pipeline).
    if (esHeic(archivo)) {
      notificar("warn", "CONVIRTIENDO HEIC…", "La conversión puede tardar unos segundos.");
    }
    void (async () => {
      const final = await archivoDentroDeTope(archivo, true);
      if (!final) {
        // Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx
        // L954-L961 (error path de F-IMPORT) — re-vestido al toast de e14.
        notificar(
          "crit",
          "NO SE PUDO PROCESAR LA IMAGEN",
          esHeic(archivo)
            ? "No se pudo convertir el HEIC. El archivo parece dañado o protegido. Prueba con otro."
            : "El archivo puede estar corrupto o ser un formato no soportado. Prueba con otro.",
        );
        return;
      }
      setArchivoPendiente(final);
      setFuente("ARCHIVO");
      void dispararEscaneo();
    })();
  };

  /** Ruta iOS (HQ-iOS §5.2): la foto de la cámara nativa entra como archivo
   *  al MISMO pipeline (fuente ya es CÁMARA — spec §7 "como ARCHIVO, L2") +
   *  capa 3 H2: la foto nativa (12–48 MP, puede ser HEIC) pasa por el tope
   *  y la conversión robusta del core ANTES de tocar el bridge. Guard
   *  F-IMPORT/HEIC del lab L937-948 (remediación H5 — el mismo handler del
   *  lab sirve a sus dos inputs). */
  const alElegirFotoCamara = (e: ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    if (!archivo) return;
    if (!pareceImagen(archivo)) {
      notificar("crit", "ARCHIVO NO VÁLIDO", "El archivo seleccionado no es una imagen.");
      return;
    }
    if (esHeic(archivo)) {
      notificar("warn", "CONVIRTIENDO HEIC…", "La conversión puede tardar unos segundos.");
    }
    void despacharArchivo(archivo, true);
  };

  /* ── Overlay: quad REAL con mapeo object-cover (lab L1493-1515) ────── */

  const alCargarMetaVideo = useCallback(() => {
    const v = videoRef.current;
    if (v?.videoWidth) setVideoDims({ w: v.videoWidth, h: v.videoHeight });
  }, []);

  /** Mapea fracciones del FRAME → % del visor visible (object-cover). */
  const mapearPunto = useCallback(
    (p: { x: number; y: number }) => {
      if (!boxSize.w || !videoDims.w) return { x: p.x * 100, y: p.y * 100 };
      const escala = Math.max(boxSize.w / videoDims.w, boxSize.h / videoDims.h);
      const dw = videoDims.w * escala;
      const dh = videoDims.h * escala;
      const ox = (boxSize.w - dw) / 2;
      const oy = (boxSize.h - dh) / 2;
      return {
        x: ((ox + p.x * dw) / boxSize.w) * 100,
        y: ((oy + p.y * dh) / boxSize.h) * 100,
      };
    },
    [boxSize, videoDims],
  );

  const puntosQuad = live.corners
    ?.map((p) => {
      const m = mapearPunto(p);
      return `${m.x.toFixed(2)} ${m.y.toFixed(2)}`;
    })
    .join(" L ");

  /* ── Render ──────────────────────────────────────────────────────────── */

  return (
    <div className="flex-1 flex flex-col bg-bg pt-safe">
      {/* Inputs ocultos: IMPORTAR (galería) + cámara nativa iOS (capture).
          accept con .heic/.heif (lab L1536, remediación H5): en Android/Chrome
          los HEIC llegan con MIME vacío o raro y «image/*» a secas los deja
          FUERA del picker — sin el accept, la conversión F-HEIC del core
          jamás se ejercita. La cámara nativa iOS también entrega HEIC. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.heic,.heif"
        className="hidden"
        aria-label="Importar imagen"
        onChange={alElegirArchivo}
      />
      <input
        ref={inputCamaraRef}
        type="file"
        accept="image/*,.heic,.heif"
        capture="environment"
        className="hidden"
        aria-label="Tomar foto con la cámara del sistema"
        onChange={alElegirFotoCamara}
      />

      {/* Marco tipo visor (mismo marco + corner brackets en TODAS las fuentes) */}
      <div className="flex-1 min-h-0 px-4 pt-4 pb-2 flex">
        <div
          ref={visorRef}
          className="relative flex-1 rounded-xl border border-line bg-surface-1 flex items-center justify-center overflow-hidden"
        >
          {/* Corner brackets (2px, 24px) — el marco existente de e14 (el
              video vive DENTRO, spec §7); por encima de la máscara del quad. */}
          <div className="absolute inset-3 pointer-events-none z-30" aria-hidden>
            <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-ok-tint" />
            <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-ok-tint" />
            <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-ok-tint" />
            <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-ok-tint" />
          </div>

          {modoCamara ? (
            <>
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                disablePictureInPicture
                onLoadedMetadata={alCargarMetaVideo}
                aria-label="Vista previa de la cámara"
                className="absolute inset-0 h-full w-full object-cover"
              />

              {/* Estado: iniciando cámara (lab L1726-1734) */}
              {camEstado === "iniciando" && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-bg/60">
                  <span className="h-6 w-6 rounded-full border-2 border-ok-tint/30 border-t-ok-tint animate-spin" aria-hidden />
                  <span className="font-data text-[10px] tracking-[0.2em] text-ink-faint">
                    INICIANDO CÁMARA…
                  </span>
                </div>
              )}

              {/* Quad en vivo (lab L1693-1711) — SVG sobre el video, ok-tint,
                  transición CSS ~150 ms (el core throttlea la detección). */}
              {camaraViva && puntosQuad && (
                <div
                  className="absolute inset-0 pointer-events-none z-20 transition-opacity duration-150"
                  aria-hidden
                >
                  <svg
                    className="absolute inset-0 h-full w-full"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                  >
                    <path
                      d={`M 0 0 L 100 0 L 100 100 L 0 100 Z M ${puntosQuad} Z`}
                      fill="rgba(0,0,0,0.32)"
                      fillRule="evenodd"
                    />
                    <path
                      d={`M ${puntosQuad} Z`}
                      fill="none"
                      stroke="var(--color-ok-tint)"
                      strokeWidth={2}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                  {live.corners?.map((p, i) => {
                    const m = mapearPunto(p);
                    return (
                      <span
                        key={i}
                        className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_1.5px_rgba(63,229,108,0.9),0_1px_4px_rgba(0,0,0,0.5)]"
                        style={{ left: `${m.x}%`, top: `${m.y}%` }}
                      />
                    );
                  })}
                </div>
              )}

              {/* Pill "BUSCANDO ACTA…" (lab L1737-1753): superior centrada
                  mientras corners === null; desaparece al detectar. */}
              {buscando && !procesando && (
                <div className="pointer-events-none absolute inset-x-0 top-5 z-30 flex justify-center px-6">
                  <div className="flex items-center gap-2 rounded-full bg-black/60 px-3.5 py-1.5 backdrop-blur-sm">
                    <span
                      className="h-3.5 w-3.5 rounded-full border-2 border-ok-tint border-t-transparent animate-spin"
                      aria-hidden
                    />
                    <p className="text-[12px] font-medium text-white/85">BUSCANDO ACTA…</p>
                  </div>
                </div>
              )}

              {/* HUD (§7 rev.3): CALIDAD % + estado de detección + pill IA·AUTO */}
              {camaraViva && !procesando && (
                <>
                  <div
                    className="pointer-events-none absolute bottom-3 left-3 z-20 rounded-full bg-black/55 px-2.5 py-1.5 backdrop-blur-sm"
                    role="status"
                    aria-label={`Calidad de encuadre ${scorePct ?? 0} por ciento`}
                  >
                    <span
                      className={`font-data text-[10px] font-semibold tabular-nums ${
                        scoreAlto ? "text-ok-tint" : "text-white/85"
                      }`}
                    >
                      CALIDAD {scorePct !== null ? `${scorePct}%` : "--%"}
                    </span>
                  </div>
                  <div className="pointer-events-none absolute bottom-3 right-3 z-20 rounded-full bg-black/55 px-2.5 py-1.5 backdrop-blur-sm">
                    <span
                      className={`font-data text-[10px] font-semibold ${
                        live.corners ? "text-ok-tint" : "text-white/60"
                      }`}
                    >
                      {live.corners ? "ACTA DETECTADA" : "NO DETECTADA"}
                    </span>
                  </div>
                  {/* Pill IA · AUTO (lab L1553-1566) — punto pulsante verde
                      ok-tint + label del modo de disparo. */}
                  <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1.5 backdrop-blur-sm">
                    <span
                      className={`h-1.5 w-1.5 rounded-full bg-ok-tint ${
                        !scoreAlto ? "animate-pulse-sync" : ""
                      }`}
                      aria-hidden
                    />
                    <span className="font-data text-[10px] font-semibold tracking-wider text-white/90">
                      IA · {autoArmado ? "AUTO" : "MANUAL"}
                    </span>
                  </div>
                </>
              )}

              {/* Overlay "armado" (lab L1802): pill centrada cuando AUTO está
                  armado y el score supera el umbral del disparo. */}
              {camaraViva && autoArmado && scoreAlto && !procesando && (
                <div className="pointer-events-none absolute inset-x-0 top-[42%] z-30 flex justify-center px-6">
                  <div className="flex items-center gap-2.5 rounded-[20px] bg-black/75 px-4 py-2.5 shadow-[0_4px_12px_rgba(0,0,0,0.3)] backdrop-blur-sm">
                    <span className="h-2 w-2 rounded-full bg-ok-tint" aria-hidden />
                    <p className="text-[13px] font-medium text-white">
                      MANTÉN INMÓVIL EL ACTA…
                    </p>
                  </div>
                </div>
              )}

              {/* Procesando captura (lab L1889-1912, re-vestido). */}
              {procesando && (
                <div
                  className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-black/70 backdrop-blur-[3px]"
                  role="status"
                  aria-live="polite"
                >
                  <span
                    className="h-10 w-10 rounded-full border-[3px] border-white/15 border-t-ok-tint animate-spin"
                    aria-hidden
                  />
                  <p className="text-[13px] font-medium text-white">CAPTURANDO…</p>
                  <p className="font-data text-[10px] tracking-[0.2em] text-white/55">
                    CAPTURA RECIBIDA · PASANDO A ANÁLISIS
                  </p>
                </div>
              )}

              {/* Destello blanco de captura (~120 ms — lab L569, flashKey) */}
              {destelloKey > 0 && (
                <div
                  key={destelloKey}
                  className="animate-capture-flash pointer-events-none absolute inset-0 z-50 bg-white"
                  aria-hidden
                />
              )}
            </>
          ) : (
            /* Retícula central (SIMULACIÓN/ARCHIVO — exacto a L2) */
            <div className="flex flex-col items-center gap-3 select-none" aria-hidden>
              <div className="relative w-16 h-16">
                <div className="absolute inset-x-0 top-1/2 h-px bg-outline-dim" />
                <div className="absolute inset-y-0 left-1/2 w-px bg-outline-dim" />
                <div className="absolute inset-[22px] border border-outline-dim rounded-sm" />
              </div>
              <span className="font-data text-[10px] tracking-[0.2em] text-ink-faint">
                {fuente === "ARCHIVO"
                  ? "ESPERANDO IMAGEN · IMPORTAR ARCHIVO"
                  : "ESPERANDO CAPTURA · MODO SIMULACIÓN"}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Botón disparo: en CÁMARA la fila es [FLASH | shutter 72px | AUTO]
          (lab bottom bar L1939-2034, re-vestida); en SIM/ARCHIVO exacto a L2. */}
      {modoCamara ? (
        <div className="grid grid-cols-[1fr_auto_1fr] items-center px-4 py-4">
          {/* FLASH — F-FLASH v3: SIEMPRE activo con cámara (la verdad se
              descubre al pulsar); sin stream → hint. */}
          <div className="flex justify-start pl-1">
            <button
              type="button"
              aria-pressed={torchOn}
              aria-label={
                torchOn
                  ? "Apagar la linterna"
                  : torchDisponible
                    ? "Encender la linterna"
                    : "Linterna — toca para ver el motivo"
              }
              onClick={() => void alternarLinterna()}
              className={`flex flex-col items-center gap-1 px-3 py-1.5 rounded-lg border transition-colors active:scale-95 ${
                torchOn
                  ? "border-warn/40 bg-warn/10 text-warn"
                  : "border-line text-ink-faint hover:bg-hover"
              }`}
            >
              <FlashIcon className="w-4 h-4" />
              <span className="label-caps !text-[9px]">FLASH</span>
            </button>
          </div>

          <button
            type="button"
            aria-label="Escanear acta"
            onClick={alDisparar}
            disabled={procesando}
            className={`w-[72px] h-[72px] rounded-full bg-white ring-4 transition-transform flex items-center justify-center active:scale-95 ${
              scoreAlto
                ? "ring-ok-tint shadow-[0_0_24px_-4px_rgba(63,229,108,0.8)]"
                : "ring-ok-tint/50 shadow-[0_0_24px_-4px_rgba(63,229,108,0.5)]"
            } ${procesando ? "opacity-50" : ""}`}
          >
            <span className="w-[58px] h-[58px] rounded-full border-2 border-neutral-300" aria-hidden />
          </button>

          {/* AUTO (D22/D24: default OFF — el gate fino vive en el core). */}
          <div className="flex justify-end pr-1">
            <button
              type="button"
              aria-pressed={autoArmado}
              aria-label={`Auto-captura: ${autoArmado ? "armada" : "desactivada"}`}
              title="Auto-captura (dispara sola con el acta quieta y nítida)"
              onClick={() => setAutoArmado((v) => !v)}
              className={`flex flex-col items-center gap-1 px-3 py-1.5 rounded-lg border transition-colors active:scale-95 ${
                autoArmado
                  ? "border-ok-tint/40 bg-ok-tint/10 text-ok-tint"
                  : "border-line text-ink-faint hover:bg-hover"
              }`}
            >
              <ScanFrameIcon className="w-4 h-4" />
              <span className="label-caps !text-[9px]">AUTO</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex justify-center py-4">
          <button
            type="button"
            aria-label="Escanear acta"
            onClick={() => dispararEscaneo()}
            className="w-[72px] h-[72px] rounded-full bg-white ring-4 ring-ok-tint/50 shadow-[0_0_24px_-4px_rgba(63,229,108,0.5)] active:scale-95 transition-transform flex items-center justify-center"
          >
            <span className="w-[58px] h-[58px] rounded-full border-2 border-neutral-300" aria-hidden />
          </button>
        </div>
      )}

      {/* IMPORTAR IMAGEN — REAL en L2 (oculto en CÁMARA: el visor ES la
          fuente; IMPORTAR sigue accesible en el chip de fuente) */}
      {fuente !== "CAMARA" && (
        <div className="px-4 pb-3 flex justify-center">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-outline-dim text-ink-dim hover:bg-hover active:scale-95 transition-all"
          >
            <ImportIcon className="w-4 h-4" />
            <span className="label-caps !text-[10px]">IMPORTAR IMAGEN</span>
          </button>
        </div>
      )}

      {/* Fila de chips de FUENTE (L2 §7) — encima del panel de simulación */}
      <div className="px-4 pb-2">
        <div className="flex flex-wrap gap-1.5">
          {FUENTES.map(({ valor, label }) => {
            const activo = fuente === valor;
            return (
              <button
                key={valor}
                type="button"
                aria-pressed={activo}
                onClick={() => {
                  if (valor === "CAMARA") {
                    // L3: activa el visor de cámara real (con fallback
                    // automático a SIMULACIÓN si no hay acceso).
                    setFuente("CAMARA");
                    return;
                  }
                  if (valor === "ARCHIVO") {
                    inputRef.current?.click();
                    return;
                  }
                  setFuente("SIMULACION");
                }}
                className={`label-caps !text-[9px] px-2.5 py-1.5 rounded border transition-colors ${
                  activo
                    ? "border-ok-tint/40 bg-ok-tint/10 text-ok-tint"
                    : "border-line text-ink-faint hover:bg-hover"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Panel de simulación (MOCK) — discreto: border-line + tint 10%.
          En fuente !== SIMULACIÓN muestra el estado de la fuente + IMPORTAR
          (los chips de resultado son solo del modo SIMULACIÓN, §7). */}
      <div className="px-4 pb-4">
        <div className="rounded-lg border border-line bg-surface-1/60 px-2.5 py-2">
          {fuente === "SIMULACION" ? (
            <>
              <span className="font-data text-[8px] tracking-[0.25em] text-ink-faint uppercase block mb-1.5">
                Simulación
              </span>
              <div className="flex flex-wrap gap-1.5">
                {CHIPS.map(({ valor, label }) => {
                  const activo = forzado === valor;
                  return (
                    <button
                      key={valor}
                      type="button"
                      onClick={() => setForzado(valor)}
                      aria-pressed={activo}
                      className={`label-caps !text-[9px] px-2 py-1 rounded border transition-colors ${
                        activo
                          ? "border-ok-tint/40 bg-ok-tint/10 text-ok-tint"
                          : "border-line text-ink-faint hover:bg-hover"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={alternarConexion}
                  aria-pressed={!online}
                  className={`label-caps !text-[9px] px-2 py-1 rounded border transition-colors ${
                    online
                      ? "border-line text-ink-faint hover:bg-hover"
                      : "border-warn/40 bg-warn/10 text-warn"
                  }`}
                >
                  {online ? "PASAR A OFFLINE" : "VOLVER EN LÍNEA"}
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="font-data text-[8px] tracking-[0.25em] text-ink-faint uppercase block mb-1.5">
                Fuente de captura
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-data text-[9px] tracking-wide text-ok-tint">
                  {fuente === "ARCHIVO"
                    ? "IMPORTAR · LA IMAGEN SE ANALIZA AL ELEGIRLA"
                    : camEstado === "viva"
                      ? `CÁMARA · EN VIVO${autoArmado ? " — AUTO ARMADO" : " — DISPARO MANUAL"}`
                      : camEstado === "iniciando"
                        ? "CÁMARA · INICIANDO…"
                        : "CÁMARA · NO DISPONIBLE"}
                </span>
                {fuente === "ARCHIVO" && (
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    className="flex items-center gap-1.5 px-2 py-1 rounded border border-outline-dim text-ink-dim hover:bg-hover active:scale-95 transition-all"
                  >
                    <ImportIcon className="w-3.5 h-3.5" />
                    <span className="label-caps !text-[9px]">IMPORTAR</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={alternarConexion}
                  aria-pressed={!online}
                  className={`label-caps !text-[9px] px-2 py-1 rounded border transition-colors ${
                    online
                      ? "border-line text-ink-faint hover:bg-hover"
                      : "border-warn/40 bg-warn/10 text-warn"
                  }`}
                >
                  {online ? "PASAR A OFFLINE" : "VOLVER EN LÍNEA"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
