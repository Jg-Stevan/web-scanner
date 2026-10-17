"use client";

/**
 * PANTALLA 2 — EDITOR (post-captura Y revisión de documento, fondo NEGRO) —
 * FLUJO ADOBE SCAN (F-NOVIEW: la 3ª interfaz desapareció — la biblioteca
 * abre los documentos AQUÍ, en el mismo editor, igual que Adobe Scan).
 *
 * Tres modos:
 *
 *  · REVIEW (por defecto): tras la captura se navega directo aquí y se
 *    muestra el RECORTADO AUTOMÁTICO con el filtro ya aplicados (warp real +
 *    enhance "auto"). F-ZOOM: pinza para ampliar (1×–6×), arrastrar para
 *    desplazar ampliado, doble toque alterna 1× ↔ 2,5×, rueda en escritorio
 *    — exactamente como la revisión de Adobe Scan (verificar el texto/código
 *    de barras antes de guardar). Mantener pulsado (a 1×) muestra el ORIGINAL
 *    (comparación antes/después). Navegación de páginas con pill
 *    "Página X de Y" + carrusel de miniaturas. Toolbar: Repetir · Recortar ·
 *    Rotar · Filtros · Texto (OCR) · Eliminar. Botones grandes:
 *    "Seguir escaneando"/"Añadir página" + "Guardar PDF". Botón de
 *    presentación a pantalla completa en el header.
 *
 *  · CROP (botón "Recortar"): el editor de perspectiva clásico — marco
 *    #007AFF arrastrable (4 esquinas + 4 puntos medios), lupa 3×, tween
 *    animado de la detección automática y badge "Bordes detectados".
 *    Header propio: Cancelar / Ajustar bordes / Aplicar.
 *
 *  · DOC (reviewDocId): el editor revisa un documento YA GUARDADO (sus
 *    páginas cargan como sesión con preview inmediato). Los cambios se
 *    fusionan al documento al salir (auto-guardado, patrón Adobe Scan) y
 *    "Guardar PDF" exporta/descarga el archivo. "Añadir página" vuelve a la
 *    cámara para enganchar más páginas al documento.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  PointerEvent as ReactPointerEvent,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ZoomableVisor } from "@jg-stevan/scanner-ui";
import { Drawer as DrawerPrimitive } from "vaul";
import {
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Crop,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  RotateCw,
  ScanText,
  Search,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { useScannerStore } from "@jg-stevan/scanner-core/store";
import {
  detectDocumentEdges,
  loadImage,
  processImage,
  PROCESSED_MAX_LONG_SIDE,
} from "@jg-stevan/scanner-core/image-processor";
import {
  FILTER_PRESETS,
  TRASH_RETENTION_DAYS,
  capturePageKey,
  defaultQuad,
} from "@jg-stevan/scanner-core/types";
import type { CapturePage, PageFilter, Point, Quad } from "@jg-stevan/scanner-core/types";
import { ocrTextIsValid, requestOcr } from "@jg-stevan/scanner-core/ocr";
// PERF-2 (lote5) — pdf-export (arrastra jspdf, 342 KB min) SOLO vía import
// dinámico dentro de los handlers de export/share (mismo patrón que
// diag-report en SettingsView). Cero import estático de pdf-export en la app.
import { dataUrlBytes, formatBytes } from "@jg-stevan/scanner-core/format";
import { dataUrlToBlob } from "@jg-stevan/scanner-core/codec";
import type { ScanEngine } from "@jg-stevan/scanner-core/types";
import { hapticConfirm } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { perfProbe } from "@/lib/perf-probe";
import { readImageLongSide } from "@/lib/image-size";
import { beginBackgroundJob, endBackgroundJob } from "@/lib/burst-budget";
import { qaStandardTest, useQaTestStore } from "@/lib/qa-standard-test";
import { SaveSuccessOverlay } from "@/components/scanner/SaveSuccessOverlay";
import { PresentationView, type PresentationPage } from "@/components/scanner/PresentationView";

// PERF-2 (lote5) — helper local VERBATIM (Fuente: packages/scanner-core/src/
// text-export.ts L18-26). El import estático de text-export arrastra
// pdf-export → jspdf (425 KB) al chunk inicial: text-export importa
// downloadBlob/sanitizeFileName de pdf-export. Copia puente byte-idéntica —
// se elimina cuando el core separe los helpers de descarga de jspdf
// (pendiente del dueño, desviación D-2 del doc del lote).
type OcrPageLike = { ocrText?: string };
function ocrTextOfPages(pages: readonly OcrPageLike[]): string {
  const withText = pages
    .map((p, i) => ({ index: i + 1, text: (p.ocrText ?? "").trim() }))
    .filter((p) => p.text.length > 0);
  if (withText.length === 0) return "";
  if (withText.length === 1) return withText[0]!.text;
  return withText.map((p) => `── Página ${p.index} ──\n${p.text}`).join("\n\n");
}

/** LOTE 2 (F2-E) — lado mayor del PRIMER pintado del editor (tier fast).
 *  2048: el warp del worker escala ~cuadrático con el output
 *  ((2048/4032)² ≈ 0.26×) y el downscale 4032→2048 cuesta ~1 ms en A13.
 *  El tier full (4032) llega después en background y reemplaza este entry. */
const PREVIEW_FAST_LONG_SIDE = 2048;

// LOTE 4 (F4-A) — GRACIA del full pass: la pasada FULL 4032 monopoliza el
// worker ~8 s (diag 2238: foto 18.6 s, filtros 11.5 s, FPS 20→5 — la cola
// pisando al visor). El uso real del escáner rápido es «mirar y volver a
// disparar»: la pasada solo se agenda tras la gracia; si el editor se
// desmonta antes, NUNCA arranca. Tunable con datos del diag (solo este
// número, sin tocar nada más).
const FULL_PASS_GRACE_MS = 2500;

/** Aproximación CSS de cada filtro para las previews en vivo (§8.4 del
 *  SPEC-MAESTRO: solo cosmética — el procesado real ocurre al confirmar). */
const CSS_FILTERS: Record<PageFilter, string> = {
  original: "none",
  text: "brightness(1.12) contrast(1.35)",
  bw: "grayscale(1) contrast(2.6) brightness(1.05)",
};

const TWEEN_MS = 280;

/** Lupa 3× durante el arrastre de un handle (puerto fiel del AdjustEditor del
 *  producto: EDITOR_LOUPE_SCALE=3 + EDITOR_LOUPE_RADIUS=84 — F4 validación
 *  humana 2026-09-25: "la lupa aparece en el lado opuesto al dedo" y el
 *  crosshair marca el punto de corte real, no el dedo). */
const LOUPE_SCALE = 3;
const LOUPE_RADIUS = 84;
const LOUPE_GAP = 14;

/** Preview procesado de la página en edición (modo review).
 *  `url` es el DATO completo (PNG hasta 4032 px — fuente de
 *  verdad para rotación/export/guardado) y, desde el EXPERIMENTO
 *  v11, es TAMBIÉN lo que consumen todos los <img> del editor y de
 *  la presentación: fuente única, sin copia de pantalla.
 *  EXPERIMENTO v11 (crash-test): `displayUrl` (la copia de PANTALLA
 *  JPEG ≤ tope de v5/v10-A) queda APAGADA — nadie la escribe ni la
 *  lee. El campo y `makeDisplayUrl` se conservan como SEAM para
 *  revertir el experimento con un commit si el crash-test lo pide. */
interface PreviewEntry {
  url: string;
  /** EXPERIMENTO v11: APAGADO — seam sin uso (copia de display v5/v10-A). */
  displayUrl?: string;
  w: number;
  h: number;
  engine: "worker" | "canvas";
  /** LOTE 2 (F2-E) — tier del entry: "fast" (≤2048, SOLO display del editor,
   *  pintado del primer render), "full" (4032, WYSIWYG — el mismo dato que
   *  el guardado/export) o "raw-fallback" (B-05, auditoría leaks-recursos:
   *  preview de ERROR — es el ORIGINAL sin procesar cuando el pipeline
   *  falló; el visor sí lo pinta, pero NO es dato procesado: los
   *  consumidores que no son display — OCR — lo tratan como «no
   *  procesado» y jamás lo consumen). */
  tier: "fast" | "full" | "raw-fallback";
}

function clampN(v: number) {
  return Math.min(1, Math.max(0, v));
}

/** Centro de la lupa (puerto de loupeCenter): lado VERTICAL opuesto al handle
 *  (arriba por defecto; abajo si el círculo no cabe arriba), X clampeada al
 *  contenedor. La FUENTE sigue centrada en el handle: el crosshair de la lupa
 *  marca siempre el punto de corte real. */
function loupeCenterAt(hx: number, hy: number, w: number, h: number) {
  const R = LOUPE_RADIUS;
  const x = Math.min(Math.max(hx, R), Math.max(R, w - R));
  let y = hy - (R + LOUPE_GAP);
  if (y - R < 0) y = Math.min(hy + R + LOUPE_GAP, Math.max(R, h - R));
  return { x, y };
}

function quadsClose(a: Quad, b: Quad) {
  return a.every(
    (p, i) => Math.abs(p.x - b[i].x) < 5e-4 && Math.abs(p.y - b[i].y) < 5e-4
  );
}

/** Fecha estilo Adobe Scan ("17 sept 2026"). */
function prettyDate(ts: number): string {
  try {
    return new Date(ts).toLocaleDateString("es", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

/** Encode PNG de un canvas vía toBlob (memoria-seguro en iOS) → data URL. */
function encodePngDataUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => {
        if (!b || b.size === 0) {
          reject(new Error("toBlob vacío"));
          return;
        }
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result ?? ""));
        fr.onerror = () => reject(new Error("FileReader falló"));
        fr.readAsDataURL(b);
      }, "image/png");
    } catch (e) {
      reject(e instanceof Error ? e : new Error("toBlob falló"));
    }
  });
}

/**
 * F-ROT-RAPID — rota una data URL en múltiplos de 90° SIN reprocesar el
 * pipeline (warp+enhance). Matemáticamente equivalente: el warp ya ocurrió y
 * los filtros (raw/text/bw: operaciones por píxel + gaussiano isotrópico) son
 * conmutativos con rotaciones de 90°. Devuelve también una miniatura 160px
 * coherente para el merge al guardar.
 */
async function rotateProcessedDataUrl(
  url: string,
  deg: number
): Promise<{ url: string; thumb: string; w: number; h: number }> {
  const img = await loadImage(url);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) throw new Error("imagen sin dimensiones");
  const swapped = deg % 180 !== 0;
  const cw = swapped ? h : w;
  const ch = swapped ? w : h;
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("sin contexto 2d");
  ctx.imageSmoothingQuality = "high";
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2);
  const tW = 160;
  const tH = Math.max(1, Math.round((ch / cw) * tW));
  const tCanvas = document.createElement("canvas");
  tCanvas.width = tW;
  tCanvas.height = tH;
  const tCtx = tCanvas.getContext("2d");
  if (tCtx) {
    tCtx.imageSmoothingQuality = "high";
    tCtx.drawImage(canvas, 0, 0, tW, tH);
  }
  const [urlOut, thumb] = await Promise.all([
    encodePngDataUrl(canvas),
    Promise.resolve(tCanvas.toDataURL("image/jpeg", 0.8)),
  ]);
  return { url: urlOut, thumb, w: cw, h: ch };
}

/** EXPERIMENTO v11 (crash-test fuente única) — tope de DISPLAY apagado
 *  por decisión del dueño: TODOS los dispositivos ven el mismo dato de
 *  imagen (el de 4032 px), sin degradación por tier y sin red de
 *  seguridad. Si el crash-test en gama baja NO crashea, esto se vuelve
 *  permanente; si crashea, se reactiva la protección SOLO en el punto
 *  exacto del fallo (restaurar los tiers v10-A: deviceMemory
 *  4032/3200/2560, iOS 3200).
 *
 *  (Histórico v10-A: tope adaptativo 2560/3200/4032 por deviceMemory;
 *  v5 fijaba 2560 para ahorrar RAM en gama baja. Memoria esperada por
 *  imagen activa decodificada: 2560→~19 MB · 3200→~33 MB · 4032→~49 MB.)
 *
 *  La telemetría `window.__displayMax` sigue viva y debe leer **4032**
 *  en todos los entornos mientras dure el experimento. */
function computeDisplayMaxLongSide(): number {
  // EXPERIMENTO v11: apagado por decisión del dueño — todos los dispositivos
  // ven el dato completo; restaurar tiers solo si el crash-test lo justifica.
  return 4032;
}

/** FIX v10-A — tope de DISPLAY (EXPERIMENTO v11: constante 4032 — ver computeDisplayMaxLongSide). */
const DISPLAY_MAX_LONG_SIDE = computeDisplayMaxLongSide();

// Telemetría QA (patrón existente, solo dev/QA): tope efectivo en window.
if (typeof window !== "undefined") {
  (window as unknown as { __displayMax?: number }).__displayMax = DISPLAY_MAX_LONG_SIDE;
}

/** FIX v5 (5.1) — calidad JPEG de la copia de display (seam v11, sin uso activo). */
const DISPLAY_JPEG_QUALITY = 0.92;

/** FIX v5 (5.1) / v10-A — makeDisplayUrl: re-encode JPEG ≤ DISPLAY_MAX_LONG_SIDE px para PANTALLA.
 *
 *  ⚠️ EXPERIMENTO v11 (crash-test fuente única): SIN LLAMADAS ACTIVAS —
 *  la red de seguridad está APAGADA por decisión del dueño (todos los
 *  dispositivos consumen el dato completo). Esta función queda como
 *  SEAM para revertir el experimento con un commit; su única línea viva
 *  es el contador de verificación `window.__displayUrlCalls`, que debe
 *  permanecer en **0** durante el QA (prueba de que no corre).
 *
 *  (Histórico v5 5.1: el editor mostraba el data URL PNG completo del
 *  worker (4032 px → 5–20 MB de cadena): en gama baja el navegador lo
 *  decodificaba por una superficie de baja resolución → preview BORROSO
 *  aunque el dato estuviera intacto. La copia era SOLO de display:
 *  ligera, SIEMPRE JPEG, re-encodeada incluso si la fuente ya era ≤ tope;
 *  el DATO no cambiaba. Ante cualquier fallo devolvía la url original.) */
async function makeDisplayUrl(dataUrl: string): Promise<string> {
  // EXPERIMENTO v11 — contador de verificación QA: debe quedar en 0
  // (la red de seguridad NO corre; makeDisplayUrl es solo el seam de
  // reversión).
  (window as unknown as { __displayUrlCalls?: number }).__displayUrlCalls =
    ((window as unknown as { __displayUrlCalls?: number }).__displayUrlCalls ?? 0) + 1;
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return dataUrl;
  const scale = Math.min(1, DISPLAY_MAX_LONG_SIDE / Math.max(w, h));
  const dw = Math.max(1, Math.round(w * scale));
  const dh = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, dw, dh);
  return await new Promise<string>((resolve) => {
    try {
      canvas.toBlob(
        (b) => {
          if (!b || b.size === 0) {
            resolve(dataUrl);
            return;
          }
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result ?? dataUrl));
          fr.onerror = () => resolve(dataUrl);
          fr.readAsDataURL(b);
        },
        "image/jpeg",
        DISPLAY_JPEG_QUALITY
      );
    } catch {
      resolve(dataUrl);
    }
  });
}

/** F-FIND — texto OCR con las coincidencias de la búsqueda resaltadas
 *  (marca amarilla #ffd60a estilo iOS, case-insensitive). Sin consulta
 *  activa se renderiza el texto plano. */
function OcrHighlightedText({
  text,
  query,
}: {
  text: string;
  query: string | null;
}) {
  const q = query?.trim();
  if (!q) {
    return (
      <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-white/90">
        {text}
      </p>
    );
  }
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  const needle = q.toLowerCase();
  return (
    <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-white/90">
      {/* BP-10 (Lote 9): key por índice JUSTIFICADA — la lista es un split
          estático del texto actual (orden/longitud inmutables entre renders
          del mismo texto); sin reordenar ni insertar en medio. */}
      {parts.map((part, i) =>
        part.toLowerCase() === needle ? (
          <mark
            key={i}
            className="rounded-[3px] bg-[#ffd60a] px-0.5 font-semibold text-black"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </p>
  );
}

export default function EditorView() {
  // ── Store ────────────────────────────────────────────────────────────────
  const capturePages = useScannerStore((s) => s.capturePages);
  const editingIndex = useScannerStore((s) => s.editingIndex);
  const setEditingIndex = useScannerStore((s) => s.setEditingIndex);
  const updateCapturePage = useScannerStore((s) => s.updateCapturePage);
  const removeCapturePage = useScannerStore((s) => s.removeCapturePage);
  const setView = useScannerStore((s) => s.setView);
  const documentsCount = useScannerStore(
    (s) => s.documents.filter((d) => d.deletedAt === undefined).length
  );
  const saveSessionAsDocument = useScannerStore((s) => s.saveSessionAsDocument);
  const startBatchDocument = useScannerStore((s) => s.startBatchDocument);
  const batchSavedCount = useScannerStore((s) => s.batchSavedCount);
  // Lote D (D-1, COMP-4) — nitidez del visor: select FINO (FORT-6) — cambiar
  // el ajuste NO re-renderiza la biblioteca; solo este componente y el
  // efecto de display (que lo tiene en deps: al cambiar se re-pinta desde
  // cache — instantáneo — y re-evalúa el gate de la pasada full).
  const previewQuality = useScannerStore((s) => s.settings.previewQuality ?? "auto");
  /** F-NOVIEW — modo revisión de documento: el editor trabaja sobre las
   *  páginas de un documento guardado (cargadas como sesión con sus ids). */
  const reviewDocId = useScannerStore((s) => s.reviewDocId);
  const reviewDoc = useScannerStore((s) =>
    s.reviewDocId ? (s.documents.find((d) => d.id === s.reviewDocId) ?? null) : null
  );
  const saveSessionToDocument = useScannerStore((s) => s.saveSessionToDocument);
  const exitReviewToLibrary = useScannerStore((s) => s.exitReviewToLibrary);
  /** F-OCR-AUTO: «Reconocimiento OCR» (Ajustes › Procesamiento) — en sesiones
   *  de captura nuevas extrae el texto de cada página en segundo plano. */
  const ocrEnabled = useScannerStore((s) => s.settings.ocrEnabled);
  const exportQuality = useScannerStore((s) => s.settings.exportQuality);
  /** F-FIND: consulta prestada por la biblioteca (búsqueda que matcheó por
   *  texto OCR) — abre el sheet de texto y salta a la 1ª página con
   *  coincidencias, resaltándolas. */
  const pendingFindQuery = useScannerStore((s) => s.pendingFindQuery);
  const setPendingFindQuery = useScannerStore((s) => s.setPendingFindQuery);

  const page: CapturePage | undefined =
    capturePages[editingIndex] ?? capturePages[capturePages.length - 1];
  const activeIdx = page ? capturePages.indexOf(page) : -1;

  // ── Modo review/crop + preview procesado (F-FLOW) ───────────────────────
  const [mode, setMode] = useState<"review" | "crop">("review");
  const [preview, setPreview] = useState<PreviewEntry | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewCache = useRef(new Map<string, PreviewEntry>());
  // ── OCR (F-OCR · sheet "Texto") ─────────────────────────────────────────
  const [ocrOpen, setOcrOpen] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<{ i: number; n: number } | null>(null);
  /** F-FIND: término activo de búsqueda dentro del texto OCR (las
   *  coincidencias se resaltan mientras el sheet está abierto). */
  const [findQuery, setFindQuery] = useState<string | null>(null);

  /** Hint de zoom: visible ~6 s al montar (didáctico, luego se va solo). */
  const [zoomHintVisible, setZoomHintVisible] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setZoomHintVisible(false), 6000);
    return () => window.clearTimeout(t);
  }, []);

  // ── Presentación a pantalla completa (desde el header) ───────────────────
  const [presentationOpen, setPresentationOpen] = useState(false);

  // ── Estado local ─────────────────────────────────────────────────────────
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [displayQuad, setDisplayQuad] = useState<Quad>(
    () => page?.quad ?? defaultQuad()
  );
  const [detecting, setDetecting] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Overlay de éxito tras guardar: {docId, pages, engine} mientras se muestra. */
  const [savedInfo, setSavedInfo] = useState<{
    docId: string;
    pages: number;
    engine: ScanEngine;
  } | null>(null);
  const savedInfoRef = useRef(savedInfo);
  savedInfoRef.current = savedInfo;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);
  const [badgeVisible, setBadgeVisible] = useState(false);
  /** Lupa 3× durante el arrastre: {x,y} = centro en coords del contenedor del
   *  preview; {fx,fy} = punto de corte en fracciones de la imagen ORIGINAL
   *  (sin rotar — la lupa siempre muestra los píxeles que se van a cortar). */
  const [loupe, setLoupe] = useState<{
    x: number;
    y: number;
    fx: number;
    fy: number;
  } | null>(null);

  // ── Refs ─────────────────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const carouselRef = useRef<HTMLDivElement>(null);
  /** F-THUMBS: carrusel de miniaturas visible (desplegable). */
  const [thumbsOpen, setThumbsOpen] = useState(true);
  const displayRef = useRef<Quad>(displayQuad);
  const draggingRef = useRef(false);
  const dragRef = useRef<{ kind: "corner" | "mid"; index: number } | null>(null);
  const pageIdRef = useRef<string | null>(null);
  // Snapshot del quad al ENTRAR en modo recorte (por página): Cancelar/Escape
  // restauran este estado — el quad persistido en el store ya habrá sido
  // sobreescrito por el arrastre (onContainerPointerUp), así que sin este
  // snapshot "Cancelar" ≡ "Aplicar".
  const cropEntryRef = useRef<{
    pid: string;
    quad: Quad;
    manual: boolean;
  } | null>(null);
  const autoIds = useRef<Set<string>>(new Set());
  const manualIds = useRef<Set<string>>(new Set());
  const badgeTimer = useRef<number>(0);
  // DIAG (spec diag §5) — solo instrumentación de la sonda: última página
  // cuyo «primer render» ya se marcó, t0 de la sesión del editor.
  const firstRenderPidRef = useRef<string | null>(null);
  const diagEditorOpenT0Ref = useRef(0);

  // ── Título del header (estilo Adobe Scan: "Digitalización N · fecha") ────
  const headerTitle = reviewDoc ? reviewDoc.title : `Digitalización ${documentsCount + 1}`;
  // BP-11 (Lote 9) — la fecha de la sesión ya NO se lee con Date.now() en
  // render (impuro + congelado tras medianoche): nace en el montaje (lazy
  // state) y se refresca SOLO si cambió el día local (el header no muestra
  // hora — un intervalo de 60 s con comparación de día es el mínimo).
  // Comportamiento visible idéntico (fechas correctas), sin impureza.
  const [sessionNowMs, setSessionNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => {
      setSessionNowMs((prev) =>
        new Date(prev).toDateString() === new Date().toDateString() ? prev : Date.now()
      );
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);
  const headerDate = prettyDate(reviewDoc ? reviewDoc.updatedAt : sessionNowMs);

  // ── Badge "Bordes detectados" (persistente 4s y se desvanece) ────────────
  const showBadge = useCallback(() => {
    setBadgeVisible(true);
    window.clearTimeout(badgeTimer.current);
    badgeTimer.current = window.setTimeout(() => setBadgeVisible(false), 4000);
  }, []);

  useEffect(() => () => window.clearTimeout(badgeTimer.current), []);

  // ── Portal del sheet de filtros dentro del marco del teléfono ────────────
  useEffect(() => {
    setPortalEl(document.getElementById("app-phone"));
  }, []);

  // DIAG (spec diag §5/§6 · v1.1) — sesión del editor: apertura NUMERADA
  // (1, 2, 3… de la sesión — derivada del propio anillo de marcas, sin
  // estado extra) + cierre (duración total de la edición). El
  // AnimatePresence de page.tsx REMONTA la vista en cada entrada → un par
  // editor_open/editor_close por sesión de edición.
  useEffect(() => {
    let openIndex = 1;
    for (const m of perfProbe.marks) {
      if (m.ev === "editor_open") openIndex += 1;
    }
    perfProbe.mark("editor_open", { openIndex });
    diagEditorOpenT0Ref.current = performance.now();
    return () => {
      perfProbe.mark("editor_close", {
        durationMs: Math.max(0, Math.round(performance.now() - diagEditorOpenT0Ref.current)),
      });
    };
  }, []);

  // ── F-NOVIEW: la biblioteca abre el documento directamente en el editor
  // (modo revisión). La sesión llega cargada desde beginReviewDocument.

  // ── REVIEW: procesa la página (warp + enhance) y cachea el resultado ────
  // F-FLOW: al entrar (o al cambiar página/quad/filtro/rotación) se procesa
  // la página con el RECORTE AUTOMÁTICO y el filtro — el usuario ve el
  // documento final, no el original con marco (eso queda para "Recortar").
  const cacheKey = page ? capturePageKey(page) : "";

  /** Inserta en la cache de previews con recorte LRU unificado. FIX v3
   *  (4.5): tope 12 → 6 entradas — al procesar TODO a 4032 px, cada entrada
   *  (data URL PNG) pesa ~el doble (10-25 MB como cadena JS, ×2 en heap):
   *  mismo presupuesto TOTAL de memoria que antes, mitades entradas → sin
   *  riesgo de jetsam en iOS con sesiones largas (runOcrAll incluido).
   *  EXPERIMENTO v11: la entrada es SOLO el dato completo (sin copia de
   *  display) — el LRU de 6 NO se toca (medir la presión real ES el
   *  experimento). */
  const cachePreviewEntry = useCallback((key: string, entry: PreviewEntry) => {
    previewCache.current.set(key, entry);
    if (previewCache.current.size > 6) {
      const oldest = previewCache.current.keys().next().value;
      if (oldest) previewCache.current.delete(oldest);
    }
  }, []);

  useEffect(() => {
    if (mode !== "review" || !page) return;
    // F-NOVIEW: las páginas de un documento guardado llegan con su
    // `processed` persistido + `processedKey` (estado exacto de fábrica) →
    // se siembra en la cache SOLO si el estado no ha cambiado (rotar/
    // filtrar/recortar invalida la procesada guardada y fuerza reproceso).
    if (
      page.processed &&
      page.processedKey === cacheKey &&
      !previewCache.current.has(cacheKey)
    ) {
      previewCache.current.set(cacheKey, {
        url: page.processed,
        w: 0,
        h: 0,
        engine: "canvas",
        tier: "full", // LOTE 2 (F2-E): la procesada persistida es full-res (4032)
      });
    }
    let cancelled = false;

    // LOTE 2 (F2-E) — PASADA FULL (background, WYSIWYG 4032): el entry tier
    // fast es SOLO display; esta pasada reemplaza el cache entry y el preview
    // SI la página/filtro/rotación siguen siendo los mismos (cacheKey intacto
    // — el cleanup de abajo marca cancelled en desmontaje o cambio de key).
    // Cancelación (§2.3.2): desmontaje / cambio de cacheKey / vuelta a
    // cámara — al cancelarse, el par begin/end de bg-jobs se libera
    // INMEDIATAMENTE (releaseFullJob) → bgJobsAtShot se mantiene en 0 cuando
    // la cámara dispare (§2.3.4): la pasada no sigue viva como job
    // contabilizado aunque su promesa termine en el vacío.
    let fullJobActive = false;
    let fullPassTimer: number | null = null;
    const releaseFullJob = () => {
      if (fullJobActive) {
        fullJobActive = false;
        endBackgroundJob();
      }
    };
    const scheduleFullPass = (): void => {
      if (cancelled) return;
      const live = previewCache.current.get(cacheKey);
      if (live && live.tier !== "fast") return; // ya hay full en pie
      if (fullPassTimer !== null) return; // F4-A: gracia ya en curso
      // LOTE 4 (F4-A) — GRACIA: la pasada FULL se agenda tras
      // FULL_PASS_GRACE_MS. El cleanup del efecto (desmontaje / cambio de
      // key / mode toggle) cancela el timer → el escáner rápido nunca
      // monopoliza el worker.
      fullPassTimer = window.setTimeout(() => {
        fullPassTimer = null;
        if (cancelled) return;
        perfProbe.mark("editor_fullpass_grace_fired", { ms: FULL_PASS_GRACE_MS });
        // v4 §2.3 (v4.3, burst-budget) — jobs en background #2/#3 del editor
        // (pareado begin/end con liberación inmediata al cancelar).
        beginBackgroundJob();
        fullJobActive = true;
        void (async () => {
          try {
            // FIX v3 (2.1): MISMA constante que el guardado (store) → WYSIWYG
            // estricto por construcción: el upgrade ES la imagen guardada.
            const tFull = performance.now();
            const res = await processImage(page.original, page.quad, page.filter, page.rotation, {
              manual: page.quadManual === true,
              maxLongSide: PROCESSED_MAX_LONG_SIDE,
            });
            if (cancelled) return;
            const fullEntry: PreviewEntry = {
              url: res.processed,
              w: res.precision?.width ?? 0,
              h: res.precision?.height ?? 0,
              engine: res.precision?.engine === "worker" ? "worker" : "canvas",
              tier: "full",
            };
            // Reemplazo SOLO si el entry vivo sigue siendo el fast de ESTE key
            // (un reproceso manual — OCR/export/rotación — pudo sembrar un
            // full nuevo mientras tanto).
            if (previewCache.current.get(cacheKey)?.tier === "fast") {
              cachePreviewEntry(cacheKey, fullEntry);
              setPreview(fullEntry);
              // DIAG (LOTE 2 F2-G) — upgrade fast→full completado (aditivo).
              perfProbe.mark("editor_preview_upgraded", {
                ms: Math.round(performance.now() - tFull),
                filterId: page.filter,
              });
            }
          } catch {
            /* FULL best-effort: el entry fast queda en pie */
          } finally {
            releaseFullJob();
          }
        })();
      }, FULL_PASS_GRACE_MS);
    };

    const cached = previewCache.current.get(cacheKey);
    if (cached) {
      setPreview(cached);
      setPreviewLoading(false);
      // EXPERIMENTO v11: sin copia de display — se consume el DATO
      // completo directamente (la generación en 2º plano de displayUrl
      // de v5 5.1 está APAGADA; la entrada se pinta YA con su url).
      // DIAG (spec diag §6) — primer render de esta página en la vista
      // (entrada cacheada: instantánea).
      if (firstRenderPidRef.current !== page.id) {
        firstRenderPidRef.current = page.id;
        perfProbe.mark("editor_first_render", { engine: cached.engine, cached: true });
      }
      // LOTE 2 (F2-E) §2.3.3 — cache-hit con tier fast: pintado instantáneo
      // (arriba) + RE-AGENDAR la pasada FULL en background (mismo mecanismo
      // del cache-miss). Tier full → comportamiento actual (nada extra).
      // Lote D (D-1): "ligera" NO agenda la pasada full para display (se
      // queda en tier fast; lo guardado sigue siendo 4032). "auto" y
      // "exacta" mantienen el mecanismo actual (hoy no existe gate por
      // equipo que "exacta" deba forzar — ver docs/lab/fix-loteD-decisiones-v1.md).
      if (cached.tier === "fast" && previewQuality !== "ligera") scheduleFullPass();
      return () => {
        cancelled = true;
        // LOTE 4 (F4-A) — gracia pendiente: cancelar el timer. Si la pasada no
        // empezó, NUNCA empieza (worker libre para el visor; bgJobsAtShot se
        // mantiene en 0). Evidencia del diag: este mark.
        if (fullPassTimer !== null) {
          window.clearTimeout(fullPassTimer);
          fullPassTimer = null;
          perfProbe.mark("editor_fullpass_grace_cancel");
        }
        releaseFullJob();
      };
    }
    // Cache-miss: limpiar el preview ANTERIOR — sin esto, durante el
    // reproceso (segundos en 12 MP) el preview sigue siendo el de la página
    // previa y el OCR podría capturarlo y persistir texto en la página
    // equivocada.
    setPreview(null);
    setPreviewLoading(true);
    void (async () => {
      // v4 §2.3 (v4.3, burst-budget) — jobs en background #2/#3 del editor:
      // aplicación de filtros bw/text + generación del preview procesado
      // (el MISMO processImage). Pueden solaparse con la captura SIGUIENTE
      // (candidato #3 del tramo opaco) → contador aditivo que el mark
      // capture_shot estampa como bgJobsAtShot. Instrumentación pura.
      beginBackgroundJob();
      try {
        // LOTE 2 (F2-E) — PASADA FAST (tier fast): primer pintado del editor
        // con warp a 2048 (el output queda ≤ PREVIEW_FAST_LONG_SIDE por
        // construcción — ver image-processor). El principo de diseño manda:
        // VER el acta rápido; el tier full llega después en background.
        // DIAG (spec diag §6) — tiempo de la pasada fast (warp + filtro).
        const tFilter = performance.now();
        const res = await processImage(page.original, page.quad, page.filter, page.rotation, {
          manual: page.quadManual === true,
          maxLongSide: PREVIEW_FAST_LONG_SIDE,
        });
        const filterMs = Math.round(performance.now() - tFilter);
        if (cancelled) return;
        // EXPERIMENTO v11: sin copia de display — la entry se crea SOLO
        // con el DATO completo (url/w/h/engine/tier); los <img> del editor
        // decodifican directamente el PNG ≤2048 del tier fast.
        const entry: PreviewEntry = {
          url: res.processed,
          w: res.precision?.width ?? 0,
          h: res.precision?.height ?? 0,
          engine: res.precision?.engine === "worker" ? "worker" : "canvas",
          tier: "fast",
        };
        cachePreviewEntry(cacheKey, entry);
        setPreview(entry);
        // DIAG (spec diag §6 · v1.1) — filtro aplicado (ms del pipeline) +
        // id EXPLÍCITO + tamaño de ENTRADA (lado largo del original, leído
        // de la cabecera SIN decodificar — medirlo costaría otro decode de
        // 12 MP) + primer render de esta página en la vista.
        perfProbe.mark("filter_applied", {
          ms: filterMs,
          engine: entry.engine,
          filter: page.filter,
          filterId: page.filter,
          inputPx: readImageLongSide(`p:${page.id}`, page.original) ?? null,
        });
        if (firstRenderPidRef.current !== page.id) {
          firstRenderPidRef.current = page.id;
          // LOTE 2 (F2-E) §2.3.1 — mark igual que hoy (mismo orden de
          // campos) + previewTier del tier que pintó.
          // LOTE 3 (F3-B) — decodeMs de la adquisición de la fuente del
          // warp (blob-first del tier fast O fallback; null si el pipeline
          // que respondió no lo midió — fallback canvas local).
          perfProbe.mark("editor_first_render", {
            engine: entry.engine,
            cached: false,
            ms: filterMs,
            previewTier: "fast",
            decodeMs: typeof res.decodeMs === "number" ? res.decodeMs : null,
          });
        }
      } catch {
        if (!cancelled)
          // B-05 (auditoría leaks-recursos): NO disfrazar el original como
          // tier "full" — era un mentiroso que el OCR consumía como si
          // fuera procesado (persistía texto del original sin recortar).
          // El visor SÍ lo pinta (mejor un original visible que un hueco),
          // pero marcado como raw-fallback: el OCR lo trata como «no
          // procesado» (ver runOcrCurrent y el auto-OCR).
          setPreview({ url: page.original, w: 0, h: 0, engine: "canvas", tier: "raw-fallback" });
      } finally {
        // v4 §2.3 — SIEMPRE libera el contador (jobs pareados), incluso si
        // el efecto se canceló a mitad del reproceso.
        endBackgroundJob();
        if (!cancelled) setPreviewLoading(false);
      }
      // LOTE 2 (F2-E) §2.3.1 — PASADA FULL inmediatamente después de la
      // fast (background, NO bloquea): SOLO si la fast aterrizó como entry
      // fast de este key (si falló, el fallback original queda en pie como
      // hoy — sin reproceso extra). Lote D (D-1): "ligera" la salta.
      if (
        !cancelled &&
        previewQuality !== "ligera" &&
        previewCache.current.get(cacheKey)?.tier === "fast"
      ) {
        scheduleFullPass();
      }
    })();
    return () => {
      cancelled = true;
      // LOTE 4 (F4-A) — gracia pendiente: cancelar el timer. Si la pasada no
      // empezó, NUNCA empieza (worker libre para el visor; bgJobsAtShot se
      // mantiene en 0). Evidencia del diag: este mark.
      if (fullPassTimer !== null) {
        window.clearTimeout(fullPassTimer);
        fullPassTimer = null;
        perfProbe.mark("editor_fullpass_grace_cancel");
      }
      releaseFullJob();
    };
  }, [mode, cacheKey, page?.original, cachePreviewEntry, previewQuality]);

  // EXPERIMENTO v11 — telemetría QA: fuente única en el editor. El <img>
  // del preview consume preview.url (el DATO completo) — sin copia de
  // display. Debe leer "preview-url" durante el QA físico.
  useEffect(() => {
    if (mode !== "review" || !preview) return;
    (window as unknown as { __editorSource?: string }).__editorSource = "preview-url";
  }, [mode, preview]);

  /** Navegación de páginas (pill + carrusel + swipe F-SWIPE). Definida
   *  ANTES de los gestos del stage: los handlers la usan y la TS la exige. */
  const goToPage = useCallback(
    (i: number) => {
      if (i < 0 || i >= capturePages.length || i === activeIdx) return;
      setEditingIndex(i);
    },
    [capturePages.length, activeIdx, setEditingIndex]
  );

  const totalPages = capturePages.length;

  // ── Medición del contenedor del preview (ResizeObserver) ─────────────────
  // F-FLOW: el contenedor de arrastre SOLO existe en modo crop → el observer
  // se (re)conecta cada vez que se entra al modo recorte (en "review" no hay
  // contenedor y box quedaría en 0×0 → loader eterno).
  useEffect(() => {
    if (mode !== "crop") return;
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setBox({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode]);

  // ── Dimensiones naturales de la página en edición ────────────────────────
  useEffect(() => {
    let cancelled = false;
    const src = page?.original;
    setNatural(null);
    if (!src) return;
    loadImage(src)
      .then((img) => {
        if (!cancelled) {
          setNatural({
            w: img.naturalWidth || img.width,
            h: img.naturalHeight || img.height,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setNatural(null);
      });
    return () => {
      cancelled = true;
    };
  }, [page?.original]);

  // ── Interpolación suave del quad (detección automática) ──────────────────
  // Al cambiar de página hace "snap"; al detectar bordes anima con rAF.
  // Durante un arrastre no interpola (el puntero manda).
  useEffect(() => {
    const target = page?.quad;
    const pid = page?.id;
    if (!target || !pid) return;
    if (pageIdRef.current !== pid) {
      pageIdRef.current = pid;
      displayRef.current = target;
      setDisplayQuad(target);
      return;
    }
    if (draggingRef.current) return;
    const from = displayRef.current;
    if (quadsClose(from, target)) {
      if (displayRef.current !== target) {
        displayRef.current = target;
        setDisplayQuad(target);
      }
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / TWEEN_MS);
      const e = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const q = from.map((p, i) => ({
        x: p.x + (target[i].x - p.x) * e,
        y: p.y + (target[i].y - p.y) * e,
      })) as Quad;
      displayRef.current = q;
      setDisplayQuad(q);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [page?.id, page?.quad]);

  // ── Badge al entrar en una página con quad auto-detectado ────────────────
  useEffect(() => {
    const pid = page?.id;
    if (!pid) return;
    if (autoIds.current.has(pid) && !manualIds.current.has(pid)) showBadge();
  }, [page?.id, showBadge]);

  // ── Auto-scroll del carrusel a la página activa ──────────────────────────
  useEffect(() => {
    const root = carouselRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [activeIdx, mode, thumbsOpen]);

  // ── Geometría del preview (modo crop) ────────────────────────────────────
  const rotation = ((page?.rotation ?? 0) % 360 + 360) % 360;
  const swapped = rotation === 90 || rotation === 270;

  const fit = useMemo(() => {
    if (!natural || box.w < 8 || box.h < 8) return null;
    const dw = swapped ? natural.h : natural.w;
    const dh = swapped ? natural.w : natural.h;
    const scale = Math.min(box.w / dw, box.h / dh);
    return { w: dw * scale, h: dh * scale };
  }, [natural, box, swapped]);

  // El contenedor interior mantiene el aspecto natural y rota con framer-motion;
  // el exterior ocupa el hueco del aspecto ya rotado.
  const innerW = fit ? (swapped ? fit.h : fit.w) : 0;
  const innerH = fit ? (swapped ? fit.w : fit.h) : 0;

  const polygonPoints = useMemo(
    () =>
      displayQuad.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(" "),
    [displayQuad]
  );

  // ── Arrastre de handles (pointer events) ─────────────────────────────────
  /** Convierte coordenadas de pantalla a coords normalizadas de la imagen
   *  (invirtiendo la rotación CSS del contenedor interior). */
  const pointerToNormalized = useCallback(
    (clientX: number, clientY: number): Point | null => {
      const el = innerRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return null;
      const r = ((page?.rotation ?? 0) % 360 + 360) % 360;
      const isSwapped = r === 90 || r === 270;
      const localW = isSwapped ? rect.height : rect.width;
      const localH = isSwapped ? rect.width : rect.height;
      const px = clientX - (rect.left + rect.width / 2);
      const py = clientY - (rect.top + rect.height / 2);
      const rad = (r * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      // Inversa de la rotación (ejes de pantalla, Y hacia abajo):
      const lx = px * cos + py * sin;
      const ly = -px * sin + py * cos;
      return { x: lx / localW + 0.5, y: ly / localH + 0.5 };
    },
    [page?.rotation]
  );

  /** Actualiza la lupa para el handle arrastrado del quad `q` (recién movido):
   *  calcula la posición de pantalla del punto (con la rotación CSS del
   *  contenedor interior) y coloca el círculo en el lado opuesto (F4). */
  const updateLoupe = useCallback(
    (q: Quad, kind: "corner" | "mid", index: number) => {
      const cont = containerRef.current;
      const el = innerRef.current;
      if (!cont || !el) return;
      let fx: number;
      let fy: number;
      if (kind === "corner") {
        // BP-9 (Lote 9): guard explícito en vez de non-null assertion (el
        // índice es 0-3 por construcción, pero el guard es trivial y barato).
        const pt = q[index];
        if (!pt) return;
        fx = pt.x;
        fy = pt.y;
      } else {
        const a = q[index];
        const b = q[(index + 1) % 4];
        if (!a || !b) return;
        fx = (a.x + b.x) / 2;
        fy = (a.y + b.y) / 2;
      }
      const ir = el.getBoundingClientRect();
      const cr = cont.getBoundingClientRect();
      if (ir.width < 2 || ir.height < 2 || cr.width < 2) return;
      const r = ((page?.rotation ?? 0) % 360 + 360) % 360;
      const swapped = r === 90 || r === 270;
      // Dims display de la imagen SIN rotar (el div interior):
      const iw = swapped ? ir.height : ir.width;
      const ih = swapped ? ir.width : ir.height;
      const cx = ir.left + ir.width / 2 - cr.left;
      const cy = ir.top + ir.height / 2 - cr.top;
      const px = fx * iw - iw / 2;
      const py = fy * ih - ih / 2;
      const rad = (r * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const hx = cx + px * cos - py * sin;
      const hy = cy + px * sin + py * cos;
      const c = loupeCenterAt(hx, hy, cr.width, cr.height);
      setLoupe({ x: c.x, y: c.y, fx, fy });
    },
    [page?.rotation]
  );

  const onHandleDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>, kind: "corner" | "mid", index: number) => {
      if (!page) return;
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* algunos navegadores lanzan si el puntero ya se soltó */
      }
      dragRef.current = { kind, index };
      draggingRef.current = true;
      updateLoupe(displayRef.current, kind, index);
    },
    [page, updateLoupe]
  );

  const onContainerPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d) return;
      const n = pointerToNormalized(e.clientX, e.clientY);
      if (!n) return;
      const q = displayRef.current.map((p) => ({ x: p.x, y: p.y })) as Quad;
      if (d.kind === "corner") {
        q[d.index] = { x: clampN(n.x), y: clampN(n.y) };
      } else {
        // Punto medio: traslada la arista completa (ambos vértices).
        const i = d.index;
        const j = (i + 1) % 4;
        const a = q[i];
        const b = q[j];
        const dx = n.x - (a.x + b.x) / 2;
        const dy = n.y - (a.y + b.y) / 2;
        q[i] = { x: clampN(a.x + dx), y: clampN(a.y + dy) };
        q[j] = { x: clampN(b.x + dx), y: clampN(b.y + dy) };
      }
      displayRef.current = q;
      setDisplayQuad(q);
      updateLoupe(q, d.kind, d.index);
    },
    [pointerToNormalized, updateLoupe]
  );

  const onContainerPointerUp = useCallback(() => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    draggingRef.current = false;
    setLoupe(null);
    if (page) {
      manualIds.current.add(page.id);
      updateCapturePage(page.id, { quad: displayRef.current, quadManual: true });
    }
  }, [page, updateCapturePage]);

  // ── Acciones ─────────────────────────────────────────────────────────────

  /** En vuelo: rotación rápida (evita doble tap concurrente). */
  const rotatingRef = useRef(false);
  const [exportingImg, setExportingImg] = useState(false);

  /** Resuelve el PREVIEW actual de la página (cache de sesión o procesada
   *  persistida con clave válida). null = aún no hay procesada confiable. */
  const currentPreviewEntry = useCallback(
    (p: CapturePage): PreviewEntry | null => {
      const key = capturePageKey(p);
      const cached = previewCache.current.get(key);
      if (cached) return cached;
      if (p.processed && p.processedKey === key) {
        // LOTE 2 (F2-E): la procesada persistida es full-res (4032) → tier full.
        return { url: p.processed, w: 0, h: 0, engine: "canvas", tier: "full" };
      }
      return null;
    },
    []
  );

  /**
   * Rotar 90° — F-ROT-RAPID: si existe la procesada del estado actual, se
   * GIRA ESA IMAGEN (rotación de 90° = píxel-idéntica al reproceso completo,
   * porque el filtro es por píxel y su gaussiano es isotrópico) y se guarda
   * como `processed`+`processedKey` con la nueva rotación → el preview y el
   * guardado NO vuelven a llamar al worker. De 2-6 s a ~0,2 s.
   * En crop el preview rota en vivo (CSS) como antes.
   *
   * FIX v3 (2.2 — calidad): la rotada solo viaja al documento como "final"
   * si conserva la RESOLUCIÓN OBJETIVO: min(4032, máx(aristas del quad en px
   * del original)) — la misma geometría con la que el warp dimensiona su
   * salida. Una fuente menor (auto-captura iOS 1920 px) no puede dar 4032 y
   * NO está degradada; una base degradada heredada (3200/2600 de versiones
   * con benchmark o cachés viejas) sí → se queda SIN processed/processedKey
   * y el store la REPROCESA a tope al guardar. La rotación rápida sigue
   * siendo válida para el PREVIEW (matemáticamente equivalente); solo se
   * prohíbe que una imagen inferior al objetivo llegue al documento.
   */
  const handleRotate = () => {
    const p = page;
    if (!p || rotatingRef.current) return;
    const newRotation = (p.rotation + 90) % 360;
    const base = currentPreviewEntry(p);
    if (!base || !base.url) {
      // Sin base procesable → camino histórico (cambia rotation y el efecto
      // de preview reprocesa con el pipeline completo).
      updateCapturePage(p.id, { rotation: newRotation });
      return;
    }
    rotatingRef.current = true;
    toast("Rotando…", { id: "rot-rapid", duration: 1500 });
    void (async () => {
      try {
        const rot = await rotateProcessedDataUrl(base.url, 90);
        const newKey = capturePageKey({ ...p, rotation: newRotation });
        previewCache.current.set(newKey, {
          url: rot.url,
          w: base.h || rot.w,
          h: base.w || rot.h,
          engine: base.engine,
          // LOTE 2 (F2-E): la rotada HEREDA el tier de su base — rotar un
          // entry fast no lo convierte en full; el efecto re-agenda la
          // pasada FULL para el nuevo key (converge a 4032 igual que hoy).
          tier: base.tier,
        });
        // Una sola actualización: con calidad completa, el efecto de preview
        // siembra la cache y pinta al instante (processedKey coincide) y el
        // merge al guardar NO reprocesa (F-ROT-RAPID en saveSessionToDocument).
        // Sin ella: solo rotation → al guardar el store reprocesa a 4032.
        // Resolución objetivo de ESTA página (geometría quad + original):
        // min(4032, máx aristas del quad en px) — tolerancia 0.9 (shrink
        // 3.5px/lado del worker + redondeos).
        const natW = natural?.w ?? 0;
        const natH = natural?.h ?? 0;
        let targetLong = PROCESSED_MAX_LONG_SIDE;
        if (natW > 0 && natH > 0) {
          let maxEdge = 0;
          for (let i = 0; i < 4; i += 1) {
            // BP-9 (Lote 9): guard trivial en vez de assertion (quad de 4 por tipo).
            const a = p.quad[i];
            const b = p.quad[(i + 1) % 4];
            if (!a || !b) continue;
            maxEdge = Math.max(maxEdge, Math.hypot((b.x - a.x) * natW, (b.y - a.y) * natH));
          }
          targetLong = Math.min(PROCESSED_MAX_LONG_SIDE, maxEdge);
        }
        const rotatedLong = Math.max(rot.w, rot.h);
        const atFullQuality = rotatedLong >= targetLong * 0.9;
        updateCapturePage(p.id, atFullQuality
          ? {
              rotation: newRotation,
              processed: rot.url,
              processedKey: newKey,
              thumbnail: rot.thumb,
            }
          : { rotation: newRotation });
      } catch {
        // Rotación rápida fallida (memoria, decode…): camino histórico.
        updateCapturePage(p.id, { rotation: newRotation });
      } finally {
        rotatingRef.current = false;
      }
    })();
  };

  /** F-IMG — "Imagen": descarga la página actual procesada como imagen
   *  (PNG sin pérdida, igual que la procesada persistida).
   *  BP-2 (Lote 6): useCallback — antes se re-creaba cada render y forzaba
   *  re-corridas del efecto QA (deps en la fila del guard) en cada render.
   *  El guard execKey hacía esas corridas inofensivas; con deps correctas el
   *  efecto QA sigue ejecutando EXACTAMENTE los mismos pasos (misma
   *  idempotencia) con menos pasadas vacías. */
  const handleSaveImage = useCallback(async () => {
    const p = page;
    if (!p || exportingImg) return;
    const entry = currentPreviewEntry(p);
    if (!entry) {
      toast("Aún se está procesando la página…");
      return;
    }
    setExportingImg(true);
    // PERF-2 — carga on-demand del módulo pdf-export en el handler.
    const { downloadBlob, sanitizeFileName } = await import(
      "@jg-stevan/scanner-core/pdf-export"
    );
    // DIAG (spec diag §6 · v1.1) — export de imagen (PNG/JPG) con ms, bytes,
    // páginas (siempre 1) y lado largo de la fuente.
    perfProbe.mark("export_start", { type: "png", pages: 1 });
    const tExport = performance.now();
    try {
      // LOTE 2 (F2-E) — WYSIWYG del export (§2.4 intocable): si el entry
      // vivo es tier fast (≤2048, solo display), el export reprocesa a
      // 4032 (mismo camino que el guardado) y siembra la cache con el
      // entry full; con tier full el dato es el de siempre.
      let exportUrl = entry.url;
      let exportLong = Math.max(entry.w, entry.h);
      if (entry.tier === "fast") {
        const res = await processImage(p.original, p.quad, p.filter, p.rotation, {
          manual: p.quadManual === true,
          maxLongSide: PROCESSED_MAX_LONG_SIDE,
        });
        exportUrl = res.processed;
        exportLong = Math.max(res.precision?.width ?? 0, res.precision?.height ?? 0);
        cachePreviewEntry(capturePageKey(p), {
          url: res.processed,
          w: res.precision?.width ?? 0,
          h: res.precision?.height ?? 0,
          engine: res.precision?.engine === "worker" ? "worker" : "canvas",
          tier: "full",
        });
      }
      // DRY-4 (Lote 9): dataUrlToBlob ÚNICA (core, sincrónica — parse manual).
      // Misma semántica que la fetch-based local: entrada inválida o blob
      // vacío → throw → el catch de abajo avisa (antes: throw "blob vacío").
      const blob = dataUrlToBlob(exportUrl);
      if (blob === null || blob.size === 0) throw new Error("blob vacío");
      const ext = blob.type === "image/jpeg" ? "jpg" : "png";
      const name = sanitizeFileName(
        `${headerTitle}-página-${activeIdx + 1}.${ext}`
      );
      downloadBlob(blob, name);
      perfProbe.mark("export_end", {
        type: ext,
        ms: Math.round(performance.now() - tExport),
        bytes: blob.size,
        pages: 1,
        pxLong:
          exportLong > 0
            ? exportLong
            : readImageLongSide(`e:${p.id}:${cacheKey}`, exportUrl) ?? null,
      });
      toast.success(`Imagen guardada: ${name}`);
    } catch {
      toast.error("No se pudo guardar la imagen");
    } finally {
      setExportingImg(false);
    }
  }, [page, exportingImg, currentPreviewEntry, cachePreviewEntry, headerTitle, activeIdx, cacheKey]);

  /** Recortar: entra al modo de ajuste manual de bordes. */
  const handleEnterCrop = () => {
    if (!page) return;
    cropEntryRef.current = {
      pid: page.id,
      quad: page.quad,
      manual: page.quadManual === true,
    };
    setMode("crop");
  };

  /** Aplicar el recorte: vuelve a review (el efecto reprocesa el preview). */
  const handleApplyCrop = () => {
    setMode("review");
  };

  /** Cancelar el recorte: restaura el quad de ENTRADA (snapshot) y vuelve a
   *  review. Restaurar "page.quad" no sirve: onContainerPointerUp ya
   *  persistió el quad arrastrado en el store, así que page.quad ES el quad
   *  nuevo — cancelar lo dejaría aplicado. */
  const handleCancelCrop = useCallback(() => {
    const entry = cropEntryRef.current;
    if (page && entry && entry.pid === page.id) {
      displayRef.current = entry.quad;
      setDisplayQuad(entry.quad);
      updateCapturePage(page.id, {
        quad: entry.quad,
        quadManual: entry.manual,
      });
      if (entry.manual) manualIds.current.add(page.id);
      else manualIds.current.delete(page.id);
    } else if (page) {
      displayRef.current = page.quad;
      setDisplayQuad(page.quad);
    }
    setMode("review");
  }, [page, updateCapturePage]);

  /** Escape en modo crop: cancela el recorte (antes de navegar atrás). */
  useEffect(() => {
    if (mode !== "crop") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      handleCancelCrop();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [mode, handleCancelCrop]);

  const handleDetect = useCallback(async () => {
    if (!page || detecting) return;
    setDetecting(true);
    try {
      const quad = await detectDocumentEdges(page.original);
      autoIds.current.add(page.id);
      manualIds.current.delete(page.id);
      updateCapturePage(page.id, { quad, quadManual: false });
      showBadge();
    } catch {
      toast.error("No se pudieron detectar los bordes");
    } finally {
      setDetecting(false);
    }
  }, [page, detecting, updateCapturePage, showBadge]);

  // BP-2 (Lote 6): useCallback — misma razón que handleSaveImage (efecto QA).
  const handleFilter = useCallback((filter: PageFilter, label: string) => {
    if (page) updateCapturePage(page.id, { filter });
    toast.success(`Filtro aplicado: ${label}`, { duration: 1500 });
    setFiltersOpen(false);
  }, [page, updateCapturePage]);

  /** Repetir: elimina la página actual y vuelve a la cámara para retomarla
   *  (igual que "Repetir" de Adobe Scan). En modo documento la página sale
   *  de la sesión y el merge la sustituye por la nueva captura. */
  const handleRepeat = () => {
    if (page) removeCapturePage(page.id);
    setView("camera");
  };

  /** Eliminar la página actual de la sesión (sin salir del editor).
   *  F-NOVIEW: en modo documento, si era la ÚLTIMA página el documento
   *  desaparece con ella (merge vacío → deleteDocument) y volvemos a la
   *  biblioteca, como hacía el detalle antiguo. */
  const handleDeletePage = () => {
    if (!page) return;
    removeCapturePage(page.id);
    if (capturePages.length <= 1) {
      if (reviewDocId) {
        setView("library");
        void saveSessionToDocument();
        toast("Documento movido a Eliminados", {
          description: `Era su única página · ${TRASH_RETENTION_DAYS} días para recuperarlo.`,
          icon: "🗑️",
        });
      } else {
        // Era la única página de la sesión → no queda nada que revisar.
        setView("camera");
        toast("Página eliminada", { icon: "🗑️" });
      }
    } else {
      toast.success("Página eliminada");
    }
  };

  /** Exporta (descarga) el PDF de un documento ya fusionado. */
  const downloadDocPdf = useCallback(async (docId: string) => {
    const s = useScannerStore.getState();
    const doc = s.documents.find((d) => d.id === docId);
    if (!doc || doc.pages.length === 0) return;
    // PERF-2 — carga on-demand del módulo pdf-export en el handler.
    const { buildDocPdf, sanitizeFileName } = await import(
      "@jg-stevan/scanner-core/pdf-export"
    );
    // Lado largo de la fuente del PDF (v1.1): máx entre páginas — precision
    // si existe (docs guardados), si no cabecera SIN decodificar.
    const docPxLong = doc.pages.reduce((mx, p) => {
      const fromPrecision =
        p.precision && p.precision.width > 0
          ? Math.max(p.precision.width, p.precision.height ?? 0)
          : null;
      const side =
        fromPrecision ?? readImageLongSide(`d:${doc.id}:${p.id}`, p.processed) ?? 0;
      return Math.max(mx, side);
    }, 0);
    // DIAG (spec diag §6 · v1.1) — export PDF: ms, bytes, PÁGINAS y px fuente.
    perfProbe.mark("export_start", { type: "pdf", pages: doc.pages.length });
    const tExport = performance.now();
    try {
      const { pdf, bytes } = await buildDocPdf(doc, s.settings.exportQuality);
      pdf.save(`${sanitizeFileName(doc.title)}.pdf`);
      perfProbe.mark("export_end", {
        type: "pdf",
        ms: Math.round(performance.now() - tExport),
        bytes,
        pages: doc.pages.length,
        pxLong: docPxLong > 0 ? docPxLong : null,
      });
      toast.success(
        `PDF exportado · ${doc.pages.length} ${doc.pages.length === 1 ? "página" : "páginas"} · ${formatBytes(bytes)}`
      );
    } catch {
      toast.error("No se pudo exportar el PDF");
    }
  }, []);

  /** F-NOVIEW — "Guardar PDF":
   *  · Sesión de captura: procesa todas las páginas, guarda el documento y
   *    muestra el overlay de éxito (check dibujado) → auto-cierre en la
   *    BIBLIOTECA (el video de Adobe Scan: guardar → inicio, sin 3ª pantalla).
   *  · Modo documento: fusiona la sesión con su documento y DESCARGA el PDF. */
  const handleSave = useCallback(async () => {
    if (saving || savedInfo) return;
    const s = useScannerStore.getState();
    if (s.capturePages.length === 0) {
      toast.error("No hay páginas para guardar");
      setView("camera");
      return;
    }
    setSaving(true);
    // DIAG (spec diag §6) — la sonda mide el guardado completo (proceso +
    // merge de todas las páginas): save_done con ms y bytes PROCESADAS
    // totales (el detalle por página vive en los page_saved de captura).
    const tSave = performance.now();
    const markSavedDoc = (doc: { pages: Array<{ processed: string }> }) => {
      let totalBytes = 0;
      for (const p of doc.pages) {
        totalBytes += dataUrlBytes(p.processed);
      }
      perfProbe.mark("save_done", {
        ms: Math.round(performance.now() - tSave),
        bytes: totalBytes,
      });
    };
    try {
      if (s.reviewDocId) {
        const docId = await s.saveSessionToDocument();
        if (docId) {
          const saved = useScannerStore
            .getState()
            .documents.find((d) => d.id === docId);
          if (saved) markSavedDoc(saved);
          if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
            hapticConfirm();
          }
          // El botón sigue deshabilitado (saving) DURANTE la descarga: antes
          // se reseteaba antes del await y un doble tap caía en "No hay
          // páginas" → setView("camera") sorpresivo con el store ya fusionado.
          await downloadDocPdf(docId);
        }
        setSaving(false);
        setView("library");
        return;
      }
      // Solo cuenta los documentos VIVOS (los de la papelera no ocupa nº de
      // título — evita «Digitalización 5» cuando el 4 está en Eliminados).
      const n = s.documents.filter((d) => d.deletedAt === undefined).length + 1;
      const doc = await s.saveSessionAsDocument(`Digitalización ${n}`);
      if (doc) {
        markSavedDoc(doc);
        const engine = doc.pages.some((p) => p.precision?.engine === "worker")
          ? "opencv"
          : "canvas";
        if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
          hapticConfirm();
        }
        setSavedInfo({ docId: doc.id, pages: doc.pages.length, engine });
      } else {
        toast.error("No se pudo guardar el documento");
        setSaving(false);
      }
    } catch {
      toast.error("No se pudo guardar el documento");
      setSaving(false);
    } finally {
      // Seguro de vida: si el overlay de éxito NO está activo (errores, o un
      // futuro refactor que mantenga montado el editor), liberar el botón —
      // antes el camino de éxito lo dejaba saving=true para siempre.
      if (!savedInfoRef.current) setSaving(false);
    }
  }, [saving, savedInfo, downloadDocPdf, setView]);

  /** Al cerrarse el overlay de éxito → BIBLIOTECA (flujo Adobe Scan). */
  const finishSave = useCallback(() => {
    setSavedInfo(null);
    setView("library");
  }, [setView]);

  /** Overlay de éxito → "Guardar PDF": descarga el archivo del doc guardado
   *  (la 3ª interfaz con su botón de exportar ya no existe — el archivo se
   *  baja desde aquí o desde el menú ··· de la biblioteca). */
  const downloadFromOverlay = useCallback(() => {
    const info = savedInfoRef.current;
    setSavedInfo(null);
    setView("library");
    if (info) void downloadDocPdf(info.docId);
  }, [downloadDocPdf, setView]);

  /** Modo lote: encadena otro documento sin salir del ciclo de cámara. */
  const scanAnother = useCallback(() => {
    const info = savedInfoRef.current;
    setSavedInfo(null);
    startBatchDocument();
    toast.success("Listo para el siguiente documento", {
      description:
        info && info.pages > 0
          ? `Documento anterior guardado con ${info.pages} ${info.pages === 1 ? "página" : "páginas"}.`
          : "Captura las páginas del nuevo documento.",
    });
  }, [startBatchDocument]);

  /* ── F-OCR — Reconocimiento de texto desde el editor (antes vivía en la
   *  3ª interfaz; ahora es el botón "Texto" del toolbar, como "Editar
   *  texto" de Adobe Scan). Corre sobre la imagen PROCESADA (recorte +
   *  filtro) de la página actual; el texto se guarda en la página de la
   *  sesión y viaja al documento al guardar/fusionar. */
  const runOcrCurrent = useCallback(async () => {
    if (!page || ocrRunning) return;
    // Reproceso en vuelo: el preview (y la página) están en transición — el
    // OCR de un preview stale haría texto de la página ANTERIOR.
    if (previewLoading) {
      toast.info("Preparando la página…", {
        description: "Espera un instante a que termine el procesado",
        duration: 2500,
      });
      return;
    }
    // Preview actual (estado fresco) → procesada guardada si sigue vigente →
    // original como último recurso. LOTE 2 (F2-E): los entries tier fast
    // (≤2048, solo display) NO valen de entrada de OCR (§2.4 intocable) —
    // se reprocesa a 4032 al vuelo (mismo camino que runOcrAll) y se
    // siembra la cache con el entry full. B-05 (auditoría leaks-recursos):
    // raw-fallback TAMPOCO vale (es el ORIGINAL sin procesar) → solo un
    // entry "full" sirve como preview de entrada.
    let image =
      preview && preview.tier === "full"
        ? preview.url
        : (page.processed && page.processedKey === cacheKey ? page.processed : undefined);
    // LOTE 2 (F2-E): el flag va ARRIBA para cubrir también el reproceso
    // (single-flight: el QA y los toques repetidos no duplican la pasada).
    setOcrRunning(true);
    if (!image && (preview?.tier === "fast" || preview?.tier === "raw-fallback")) {
      try {
        const res = await processImage(page.original, page.quad, page.filter, page.rotation, {
          manual: page.quadManual === true,
          maxLongSide: PROCESSED_MAX_LONG_SIDE,
        });
        image = res.processed;
        cachePreviewEntry(cacheKey, {
          url: res.processed,
          w: res.precision?.width ?? 0,
          h: res.precision?.height ?? 0,
          engine: res.precision?.engine === "worker" ? "worker" : "canvas",
          tier: "full",
        });
      } catch {
        /* sin reproceso → cae a las fuentes de siempre (persistida/original) */
      }
    }
    // B-05 (auditoría leaks-recursos): si el preview vivo es raw-fallback
    // (el pipeline falló) y el reproceso también falló, ABORTAR con el
    // aviso existente — el OCR JAMÁS corre sobre el original del fallback
    // (persistía texto sin recortar esquivando las guardas §2.4). El visor
    // sigue pintando el original; el usuario reintenta más tarde.
    if (!image && preview?.tier === "raw-fallback") {
      setOcrRunning(false);
      toast.error("No se pudo reconocer el texto", {
        description: "La página no se pudo procesar — reintenta en unos segundos.",
      });
      return;
    }
    if (!image) image = page.original;
    // DIAG (spec diag §5) — duración del OCR de la página actual (la 1ª de
    // la sesión incluye la descarga del motor ~3 MB → frío vs tibio).
    perfProbe.mark("ocr_start", { site: "current" });
    const tOcr = performance.now();
    try {
      const text = await requestOcr(image);
      const ocrOk = ocrTextIsValid(text);
      perfProbe.mark("ocr_done", {
        ms: Math.round(performance.now() - tOcr),
        chars: text.length,
        ok: ocrOk,
        site: "current",
      });
      if (ocrTextIsValid(text)) {
        updateCapturePage(page.id, { ocrText: text, ocrDone: true });
        toast.success("Texto reconocido", {
          description: `${text.length} caracteres · ya puedes copiarlo`,
        });
      } else {
        toast.info("La página no parece tener texto legible");
      }
    } catch (err) {
      perfProbe.mark("ocr_done", {
        ms: Math.round(performance.now() - tOcr),
        chars: 0,
        ok: false,
        site: "current",
      });
      toast.error("No se pudo reconocer el texto", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setOcrRunning(false);
    }
  }, [page, preview, cacheKey, ocrRunning, previewLoading, updateCapturePage, cachePreviewEntry]);

  /** OCR secuencial de TODAS las páginas de la sesión (con progreso). */
  const runOcrAll = useCallback(async () => {
    if (ocrRunning) return;
    const s = useScannerStore.getState();
    const pages = s.capturePages;
    if (pages.length === 0) return;
    setOcrRunning(true);
    try {
      for (let i = 0; i < pages.length; i += 1) {
        const p = pages[i]; // BP-9 (Lote 9): guard trivial en vez de assertion
        if (!p) continue;
        setOcrProgress({ i: i + 1, n: pages.length });
        if (p.ocrDone && p.ocrText) continue;
        // La procesada guardada solo sirve si el estado no cambió (como el
        // preview): rotada/filtrada/recortada → procesar al vuelo.
        const freshKey = capturePageKey(p);
        let image = p.processed && p.processedKey === freshKey ? p.processed : undefined;
        if (!image) {
          // LOTE 2 (F2-E): los entries tier fast (≤2048, solo display) NO
          // valen de entrada de OCR — como si no existieran (hoy la cache
          // solo guarda 4032); el reproceso de abajo mantiene el OCR a
          // full-res byte a byte igual que antes del lote.
          const cachedPreview = previewCache.current.get(freshKey);
          if (cachedPreview && cachedPreview.tier !== "fast") {
            image = cachedPreview.url;
          }
        }
        if (!image) {
          // Procesa al vuelo (sesión de captura: aún no hay procesada).
          // FIX v3 (2.1): misma constante que preview y guardado (WYSIWYG).
          const res = await processImage(p.original, p.quad, p.filter, p.rotation, {
            manual: p.quadManual === true,
            maxLongSide: PROCESSED_MAX_LONG_SIDE,
          });
          image = res.processed;
          cachePreviewEntry(capturePageKey(p), {
            url: res.processed,
            w: 0,
            h: 0,
            engine: res.precision?.engine === "worker" ? "worker" : "canvas",
            tier: "full", // LOTE 2 (F2-E): reproceso OCR = full-res (§2.3.5)
          });
        }
        const tOcr = performance.now();
        perfProbe.mark("ocr_start", { site: "all" });
        const text = await requestOcr(image);
        perfProbe.mark("ocr_done", {
          ms: Math.round(performance.now() - tOcr),
          chars: text.length,
          ok: ocrTextIsValid(text),
          site: "all",
        });
        if (ocrTextIsValid(text)) {
          updateCapturePage(p.id, { ocrText: text, ocrDone: true });
        }
      }
      toast.success("Texto reconocido en todas las páginas");
    } catch (err) {
      toast.error("No se pudo completar el reconocimiento", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setOcrRunning(false);
      setOcrProgress(null);
    }
  }, [ocrRunning, updateCapturePage, cachePreviewEntry]);

  const copyOcrText = useCallback(async () => {
    const text = page?.ocrText ?? "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Texto copiado al portapapeles");
    } catch {
      toast.error("No se pudo copiar el texto");
    }
  }, [page?.ocrText]);

  /** F-SHARE — comparte el PDF del documento en revisión (Web Share API
   *  nivel 2, archivos) con fallback honesto a descarga directa. */
  const [sharing, setSharing] = useState(false);
  const shareDocPdf = useCallback(async () => {
    const doc = reviewDoc;
    if (!doc || sharing || doc.pages.length === 0) return;
    setSharing(true);
    // PERF-2 — carga on-demand del módulo pdf-export en el handler.
    const { buildDocPdf, downloadBlob, sanitizeFileName } = await import(
      "@jg-stevan/scanner-core/pdf-export"
    );
    try {
      const { pdf, bytes } = await buildDocPdf(doc, exportQuality);
      const fileName = `${sanitizeFileName(doc.title)}.pdf`;
      const blob = pdf.output("blob");
      const file = new File([blob], fileName, { type: "application/pdf" });
      const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
      if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: doc.title });
        toast.success(`Documento compartido · ${formatBytes(bytes)}`);
      } else {
        downloadBlob(blob, fileName);
        toast.success("Compartir no está disponible aquí", {
          description: `El PDF (${formatBytes(bytes)}) se ha descargado en su lugar.`,
        });
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return; // el usuario canceló
      toast.error("No se pudo compartir el documento");
    } finally {
      setSharing(false);
    }
  }, [reviewDoc, sharing, exportQuality]);

  /** F-TXT: texto OCR de TODAS las páginas de la sesión (para «Copiar todo»). */
  const allDocOcrText = useMemo(() => ocrTextOfPages(capturePages), [capturePages]);
  const copyAllOcr = useCallback(async () => {
    if (!allDocOcrText) return;
    try {
      await navigator.clipboard.writeText(allDocOcrText);
      toast.success("Texto de todas las páginas copiado");
    } catch {
      toast.error("No se pudo copiar el texto");
    }
  }, [allDocOcrText]);

  /* ── F-OCR-AUTO — OCR de fondo tras cada captura ────────────────────────
   *  «Reconocimiento OCR» activo (Ajustes › Procesamiento) + página NUEVA
   *  (sin processedKey: recién capturada, tanto en sesión nueva como añadida
   *  a un documento en revisión) + preview listo → extrae el texto UNA vez
   *  por página, en silencio y sin bloquear la edición. Las páginas ya
   *  guardadas (cargadas con processedKey) nunca se re-procesan solas. El
   *  botón «Texto» sigue disponible para re-ejecutar o ver el resultado.
   *  Mientras vuela, un pill flotante informa del progreso (la extracción
   *  tarda segundos y la red no es invisible). */
  const autoOcrTried = useRef<Set<string>>(new Set());
  const [autoOcrBusy, setAutoOcrBusy] = useState(false);
  useEffect(() => {
    // Concurrency gate: máximo UN OCR en vuelo (auto o manual) — al terminar,
    // el efecto re-ejecuta con el estado fresco y procesa la página activa.
    if (!ocrEnabled || !page || ocrRunning || previewLoading || autoOcrBusy) return;
    if (page.ocrDone === true || page.processedKey !== undefined) return;
    if (autoOcrTried.current.has(page.id)) return;
    // LOTE 2 (F2-E): el auto-OCR espera al entry tier FULL — con el preview
    // escalonado, el primer pintado es fast (≤2048, solo display) y la
    // pasada FULL sigue en vuelo; correr OCR sobre la fast degradaría el
    // reconocimiento (§2.4 intocable) y competiría con el upgrade. Cuando
    // el full aterrice, preview?.url cambia y el efecto re-ejecuta (mismo
    // disparo que hoy: preview 4032 pintado). B-05 (auditoría
    // leaks-recursos): raw-fallback TAMPOCO — es el ORIGINAL sin procesar;
    // se espera (sin marcar tried) a que un reproceso aterrice un entry
    // full; el OCR jamás corre sobre el fallback.
    if (preview?.tier === "fast" || preview?.tier === "raw-fallback") return;
    const image =
      preview?.url ??
      (page.processed && page.processedKey === cacheKey ? page.processed : undefined);
    if (!image) return;
    autoOcrTried.current.add(page.id);
    setAutoOcrBusy(true);
    void (async () => {
      // DIAG (spec diag §5) — OCR automático de fondo tras la captura.
      perfProbe.mark("ocr_start", { site: "auto" });
      const tOcr = performance.now();
      try {
        const text = await requestOcr(image);
        perfProbe.mark("ocr_done", {
          ms: Math.round(performance.now() - tOcr),
          chars: text.length,
          ok: ocrTextIsValid(text),
          site: "auto",
        });
        if (ocrTextIsValid(text)) {
          updateCapturePage(page.id, { ocrText: text, ocrDone: true });
        }
      } catch {
        perfProbe.mark("ocr_done", {
          ms: Math.round(performance.now() - tOcr),
          chars: 0,
          ok: false,
          site: "auto",
        });
        /* silencioso en modo automático: el usuario puede reintentar a mano */
      } finally {
        setAutoOcrBusy(false);
      }
    })();
  }, [
    ocrEnabled,
    page,
    ocrRunning,
    previewLoading,
    autoOcrBusy,
    preview?.url,
    preview?.tier,
    cacheKey,
    updateCapturePage,
  ]);

  /* ── F-FIND — llegada desde la biblioteca con una búsqueda que matcheó ──
   *  por texto OCR: salta a la primera página con coincidencias, abre el
   *  sheet de texto y resalta el término (hasta que se cierre el sheet). */
  useEffect(() => {
    const q = pendingFindQuery?.trim();
    if (!q || !capturePages.length) return;
    setPendingFindQuery(null);
    const needle = q.toLowerCase();
    const idx = capturePages.findIndex((p) =>
      (p.ocrText ?? "").toLowerCase().includes(needle)
    );
    if (idx < 0) return;
    setFindQuery(q);
    setOcrOpen(true);
    if (idx !== editingIndex) setEditingIndex(idx);
  }, [pendingFindQuery, capturePages, editingIndex, setEditingIndex, setPendingFindQuery]);

  /** Contadores del sheet de texto (palabras · caracteres · coincidencias). */
  const ocrStats = useMemo(() => {
    const text = page?.ocrText ?? "";
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    let matches = 0;
    const q = findQuery?.trim().toLowerCase();
    if (q) {
      const hay = text.toLowerCase();
      let pos = 0;
      while ((pos = hay.indexOf(q, pos)) !== -1) {
        matches += 1;
        pos += q.length;
      }
    }
    return { words, chars: text.length, matches };
  }, [page?.ocrText, findQuery]);


  /** FIX v3 (1.4): páginas de la sesión proyectadas a ScanPage para la
   *  presentación, construidas AL ABRIR (lectura FRESCA de la caché de
   *  previews). ANTES era un useMemo con deps [capturePages, preview?.url]
   * que LEÍA previewCache.current (un ref): la caché se llena a medida que
   * cada página se previsualiza, pero el memo NO se recalculaba por eso →
   * para páginas nunca visitadas caía a p.processed ?? p.original → la
   *  presentación mostraba la foto ORIGINAL SIN RECORTAR (parecía otra
   *  imagen / "mal recortada"). */
  const [presentationPages, setPresentationPages] = useState<PresentationPage[]>([]);
  const openPresentation = useCallback(() => {
    const state = useScannerStore.getState();
    if (state.capturePages.length === 0) return;
    const built = state.capturePages.map((p) => {
      // EXPERIMENTO v11: la presentación consume el DATO completo — si la
      // entry existe en la caché de previews, se arranca YA con su url
      // (PNG ≤4032), la MISMA fuente que el editor (imposible que se vean
      // distintas). FIX v6 (6.4): si NO existe, se pinta YA el THUMBNAIL
      // (~160 px, placeholder con blur estilo iOS en PresentationView) y
      // el dato completo se intercambia en background (cola de concurrencia
      // 2, abajo — ahora SIN re-encode) — al aterrizar, swap suave.
      const entry = previewCache.current.get(capturePageKey(p));
      const ready = entry?.url ?? null;
      return {
        page: {
          id: p.id,
          original: p.original,
          processed: ready ?? p.thumbnail ?? p.original, // placeholder si no hay display
          // C3: miniatura REAL (~160 px, coherente con la procesada) — pasar el
          // original hacía decodificar N fotos completas para pintar pies de 40×52.
          thumbnail: p.thumbnail ?? p.original,
          filter: p.filter,
          quad: p.quad,
          quadManual: p.quadManual,
          rotation: p.rotation,
          quality: p.quality,
          ocrText: p.ocrText,
          ocrDone: p.ocrDone === true,
          createdAt: 0,
          displayPending: !ready,
        } as PresentationPage,
        key: capturePageKey(p),
        // Fuente para el swap en background (EXPERIMENTO v11: SIN
        // re-encode): el DATO procesado de la caché si existe; si la
        // página nunca fue previsualizada, el original (mismo fallback
        // que v5/v6, pero sin bloquear la apertura).
        source: entry?.url ?? p.original,
      };
    });
    setPresentationPages(built.map((b) => b.page));
    setPresentationOpen(true);
    // FIX v6 (6.4) — apertura progresiva: copias de display de las páginas
    // que aún no la tienen, generadas en BACKGROUND con concurrencia 2
    // (cola simple — decodificar N gigantes a la vez en iOS son picos de
    // memoria). Al aterrizar cada una: la presentación se actualiza (la
    // imagen hace swap suave) y la caché de previews queda sembrada → la
    // PRÓXIMA apertura de la presentación es instantánea para esa página.
    const pending = built.filter((b) => b.page.displayPending);
    let cursor = 0;
    const runNext = (): void => {
      if (cursor >= pending.length) return;
      const item = pending[cursor++];
      if (!item) return;
      void (async () => {
        try {
          // EXPERIMENTO v11: SIN re-encode — swap directo al DATO completo
          // (entry?.url ?? p.original). La red de seguridad está apagada:
          // ya NO se escriben displayUrl en la caché.
          const resolved = item.source;
          setPresentationPages((prev) =>
            prev.map((pg) =>
              pg.id === item.page.id
                ? { ...pg, processed: resolved, displayPending: false }
                : pg
            )
          );
        } finally {
          runNext();
        }
      })();
    };
    runNext();
    runNext(); // concurrencia 2 — EXPERIMENTO v11: SE MANTIENE (evita decodificar N PNG de 4032 px a la vez en la apertura)
  }, []);

  /* ── QA (spec test estándar v1.1) — OBEDIENCIA AL GUIÓN ────────────────
   * Cada paso del test se ejecuta con los MISMOS handlers que usan los
   * botones reales del editor (handleFilter / runOcrCurrent /
   * handleSaveImage / handleSave): cero lógica nueva, cero duplicación.
   * El guard por runId+step garantiza una sola ejecución por paso. */
  const qaRunId = useQaTestStore((s) => s.runId);
  const qaStep = useQaTestStore((s) => s.step);
  const qaRunning = useQaTestStore((s) => s.running);
  const qaExecutedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!qaRunning || !qaStep || mode !== "review") return;
    const execKey = `${qaRunId}:${qaStep}`;
    if (qaExecutedRef.current === execKey) return;
    switch (qaStep) {
      case "filter-text":
      case "filter-bw": {
        if (page) {
          qaExecutedRef.current = execKey;
          const want = qaStep === "filter-text" ? "text" : "bw";
          // Cache hit (v11): si el preview de ESTE filtro ya está cacheado,
          // el review no reprocesa y no habrá filter_applied → avisar al
          // guión para que complete el paso con la aplicación instantánea.
          const nextKey = capturePageKey({ ...page, filter: want });
          handleFilter(want, want === "text" ? "Texto claro" : "B/N adaptativo");
          if (previewCache.current.has(nextKey)) {
            qaStandardTest.noteFilterCached(want);
          }
        }
        break;
      }
      case "ocr-cold":
      case "ocr-warm":
        if (!ocrRunning && !previewLoading) {
          qaExecutedRef.current = execKey;
          void runOcrCurrent();
        }
        break;
      case "export-png":
        if (!exportingImg) {
          qaExecutedRef.current = execKey;
          void handleSaveImage();
        }
        break;
      case "export-pdf":
        if (!saving && !savedInfo) {
          qaExecutedRef.current = execKey;
          void handleSave();
        }
        break;
      default:
        break;
    }
  }, [
    qaRunning,
    qaStep,
    qaRunId,
    mode,
    page,
    ocrRunning,
    previewLoading,
    exportingImg,
    saving,
    savedInfo,
    handleFilter,
    runOcrCurrent,
    handleSaveImage,
    handleSave,
  ]);

  // QA — export-pdf, 2ª fase: el overlay de éxito del guardado aparece →
  // descargar el PDF con el MISMO handler de su botón («Guardar PDF» del
  // SaveSuccessOverlay), que es quien emite export_start/end del PDF.
  const qaPdfDownloadedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!qaRunning || qaStep !== "export-pdf" || !savedInfo) return;
    const execKey = `${qaRunId}:pdf-download`;
    if (qaPdfDownloadedRef.current === execKey) return;
    qaPdfDownloadedRef.current = execKey;
    downloadFromOverlay();
  }, [qaRunning, qaStep, qaRunId, savedInfo, downloadFromOverlay]);

  const poorQuality = page?.quality?.level === "poor" || page?.quality?.level === "fair";

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="relative flex h-full w-full flex-col bg-black" data-editor-mode={mode}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      {mode === "review" ? (
        <header className="relative z-20 flex shrink-0 items-center justify-between gap-2 px-3 pb-2 pt-safe">
          <button
            type="button"
            aria-label={
              reviewDocId
                ? "Guardar los cambios y volver a la biblioteca"
                : "Volver a la cámara"
            }
            onClick={() => {
              // F-NOVIEW: en modo documento el "atrás" auto-guarda (patrón
              // Adobe Scan); en sesión de captura vuelve a la cámara.
              if (reviewDocId) void exitReviewToLibrary();
              else setView("camera");
            }}
            className="flex min-w-0 items-center gap-0.5 rounded-lg py-1 pr-2 text-white transition-opacity active:opacity-60"
          >
            <ChevronLeft className="h-[22px] w-[22px] shrink-0" strokeWidth={2.5} />
            <span className="hidden text-[17px] font-semibold tracking-tight min-[380px]:inline">
              {reviewDocId ? "Biblioteca" : "Editor"}
            </span>
          </button>
          {/* Título centrado estilo Adobe Scan: nombre + fecha */}
          <div className="flex min-w-0 flex-col items-center px-1">
            <span className="max-w-[180px] truncate text-[15px] font-semibold leading-tight text-white">
              {headerTitle}
            </span>
            <span className="text-[11px] leading-tight text-white/50">{headerDate}</span>
          </div>
          {/* Compartir el documento en revisión (F-SHARE, como Adobe Scan) */}
          {reviewDoc && (
            <button
              type="button"
              aria-label="Compartir documento"
              onClick={() => void shareDocPdf()}
              disabled={sharing || totalPages === 0}
              className="hit-slop flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/85 transition-all active:scale-90 active:bg-white/10 disabled:opacity-30"
            >
              {sharing ? (
                <Loader2 className="h-[19px] w-[19px] animate-spin" />
              ) : (
                <Share2 className="h-[19px] w-[19px]" strokeWidth={2.2} />
              )}
            </button>
          )}
          {/* Presentación a pantalla completa (antes vivía en el detalle) */}
          <button
            type="button"
            aria-label="Ver presentación a pantalla completa"
            onClick={openPresentation}
            disabled={totalPages === 0}
            className="hit-slop flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/85 transition-all active:scale-90 active:bg-white/10 disabled:opacity-30"
          >
            <Maximize2 className="h-[19px] w-[19px]" strokeWidth={2.2} />
          </button>
        </header>
      ) : (
        <header
          data-editor-crop="true"
          className="relative z-20 flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3 pb-2 pt-safe"
        >
          <button
            type="button"
            aria-label="Cancelar el ajuste de bordes"
            onClick={handleCancelCrop}
            className="rounded-lg px-2 py-1.5 text-[15px] font-medium text-white/85 transition-opacity active:opacity-60"
          >
            Cancelar
          </button>
          <span className="text-[15px] font-semibold text-white">Ajustar bordes</span>
          <motion.button
            type="button"
            whileTap={{ scale: 0.95 }}
            aria-label="Aplicar el recorte"
            onClick={handleApplyCrop}
            className="flex items-center gap-1.5 rounded-full bg-[#007aff] px-4 py-[7px] text-[15px] font-semibold text-white shadow-[0_4px_14px_rgba(0,122,255,0.35)]"
          >
            <Check className="h-4 w-4" strokeWidth={3} />
            Aplicar
          </motion.button>
        </header>
      )}

      {mode === "review" ? (
        /* ── REVIEW: documento recortado + filtro (F-FLOW) ───────────────── */
        <section
          aria-label="Revisión de la página escaneada"
          className="relative flex min-h-0 flex-1 flex-col"
        >
          {/* Preview del RECORTADO — F-ZOOM vía @jg-stevan/scanner-ui
              (ZoomableVisor: pinza/pan/doble-toque/rueda + F-SWIPE de
              páginas; a 1× mantener pulsado compara con el ORIGINAL).
              Regla de oro #0: el visor vive SOLO en el paquete — aquí solo
              quedan el carrusel, la toolbar y el chrome del editor. */}
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
            <div
              aria-hidden="true"
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(120% 90% at 50% 30%, #1d1d20 0%, #101012 55%, #000 100%)",
              }}
            />
            {previewLoading && !preview ? (
              <div className="relative z-10 flex flex-col items-center gap-3">
                <div className="relative flex h-12 w-12 items-center justify-center">
                  <span className="absolute inset-0 rounded-full border-[3px] border-white/15" />
                  <span className="absolute inset-0 animate-spin rounded-full border-[3px] border-transparent border-t-[#007aff]" />
                  <Crop className="h-4 w-4 text-white/85" strokeWidth={2} />
                </div>
                <span className="text-[13px] font-medium text-white/70">
                  Recortando y aplicando filtro…
                </span>
              </div>
            ) : preview ? (
              <motion.div
                key={page?.id ?? "page"}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, ease: [0.65, 0, 0.35, 1] }}
                className="relative z-10 h-full w-full"
              >
                <ZoomableVisor
                  src={preview.url}
                  alt={`Página ${activeIdx + 1} escaneada y recortada`}
                  compareSrc={page?.original}
                  carousel={{
                    canPrev: activeIdx > 0,
                    canNext: activeIdx < totalPages - 1,
                    onPrev: () => goToPage(activeIdx - 1),
                    onNext: () => goToPage(activeIdx + 1),
                  }}
                  showHint={zoomHintVisible && !previewLoading}
                />
              </motion.div>
            ) : null}

            {/* Aviso de calidad baja (invita a repetir la captura) */}
            {page && poorQuality && !previewLoading && !zoomHintVisible && (
              <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center px-6">
                <span className="rounded-full bg-[#ff9f0a]/18 px-3.5 py-1.5 text-[11px] font-semibold text-[#ffd60a] ring-1 ring-inset ring-[#ff9f0a]/35 backdrop-blur-md">
                  Calidad {page.quality.label.toLowerCase()} · mantén el pulso y repite la captura
                </span>
              </div>
            )}

            {/* Sombra de "Procesando" al cambiar filtro/página (preview viejo debajo) */}
            {previewLoading && preview && (
              <div className="absolute right-3 top-3 z-20 flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white/85 backdrop-blur-md">
                <Loader2 className="size-3 animate-spin text-[#007aff]" aria-hidden="true" />
                Procesando
              </div>
            )}
          </div>

          {/* Pill "Página X de Y" con navegación (estilo Adobe Scan) */}
          {totalPages > 0 && (
            <div className="relative z-10 flex shrink-0 items-center justify-center gap-1.5 py-2">
              <button
                type="button"
                aria-label="Página anterior"
                disabled={activeIdx <= 0}
                onClick={() => goToPage(activeIdx - 1)}
                className="hit-slop flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white transition-all active:scale-90 disabled:opacity-25"
              >
                <ChevronLeft className="size-4" strokeWidth={2.6} />
              </button>
              <span className="flex items-center gap-1.5 rounded-full bg-[#1c1c1e]/95 px-3.5 py-1.5 text-[13px] font-semibold tabular-nums text-white shadow-[0_2px_10px_rgba(0,0,0,0.4)] ring-1 ring-inset ring-white/10">
                Página {activeIdx + 1} de {totalPages}
              </span>
              <button
                type="button"
                aria-label="Página siguiente"
                disabled={activeIdx >= totalPages - 1}
                onClick={() => goToPage(activeIdx + 1)}
                className="hit-slop flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white transition-all active:scale-90 disabled:opacity-25"
              >
                <ChevronRight className="size-4" strokeWidth={2.6} />
              </button>
            </div>
          )}

          {/* F-THUMBS — desplegable para ocultar/mostrar las miniaturas */}
          {totalPages > 0 && (
            <div className="relative z-10 flex shrink-0 justify-center pb-1">
              <button
                type="button"
                aria-expanded={thumbsOpen}
                aria-controls="thumbs-carousel"
                aria-label={thumbsOpen ? "Ocultar miniaturas de páginas" : "Mostrar miniaturas de páginas"}
                onClick={() => setThumbsOpen((v) => !v)}
                className="flex h-7 items-center gap-1 rounded-full bg-white/10 px-3.5 text-[11px] font-semibold text-white/80 backdrop-blur-md transition-all active:scale-95"
              >
                Miniaturas
                <ChevronDown
                  className={cn(
                    "size-3.5 transition-transform duration-200",
                    thumbsOpen && "rotate-180"
                  )}
                  strokeWidth={2.6}
                  aria-hidden="true"
                />
              </button>
            </div>
          )}

          {/* Carrusel de miniaturas (colapsable con F-THUMBS) */}
          <AnimatePresence initial={false}>
            {totalPages > 0 && thumbsOpen && (
              <motion.div
                key="thumbs-carousel"
                id="thumbs-carousel"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.24, ease: [0.4, 0, 0.2, 1] }}
                className="shrink-0 overflow-hidden"
              >
            <div
              ref={carouselRef}
              className="no-scrollbar flex gap-2.5 overflow-x-auto px-5 pb-2 pt-1"
              aria-label="Páginas de la sesión"
            >
              {capturePages.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  data-idx={i}
                  aria-label={`Ir a la página ${i + 1}`}
                  aria-current={i === activeIdx ? "true" : undefined}
                  onClick={() => goToPage(i)}
                  className={cn(
                    "relative h-16 w-12 shrink-0 overflow-hidden rounded-lg border-2 transition-transform active:scale-95",
                    i === activeIdx
                      ? "border-[#007aff] shadow-[0_0_0_3px_rgba(0,122,255,0.25)]"
                      : "border-white/15 opacity-70"
                  )}
                >
                  <img
                    src={p.thumbnail ?? p.original}
                    alt=""
                    draggable={false}
                    style={{ filter: CSS_FILTERS[p.filter] ?? "none" }}
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute bottom-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-[9px] font-bold text-white">
                    {i + 1}
                  </span>
                </button>
              ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      ) : (
        /* ── CROP: editor de perspectiva clásico (pantalla 2 del usuario) ── */
        <>
          <section
            aria-label="Ajuste de bordes de la página"
            className="relative min-h-0 flex-1 px-4"
          >
            <div
              ref={containerRef}
              onPointerMove={onContainerPointerMove}
              onPointerUp={onContainerPointerUp}
              onPointerCancel={onContainerPointerUp}
              className="relative flex h-full w-full items-center justify-center"
            >
              {!page ? (
                <div className="flex flex-col items-center gap-3 text-[#8e8e93]">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <span className="text-[13px]">Preparando página…</span>
                </div>
              ) : !fit || !natural ? (
                <Loader2 className="h-6 w-6 animate-spin text-[#8e8e93]" aria-label="Cargando imagen" />
              ) : (
                <motion.div
                  key={page.id}
                  className="relative shrink-0"
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1, width: fit.w, height: fit.h }}
                  transition={{ duration: 0.32, ease: [0.65, 0, 0.35, 1] }}
                >
                  {/* Contenedor interior: aspecto natural + rotación animada.
                      El overlay y los handles viven aquí dentro, por lo que
                      rotan solidariamente con la imagen. */}
                  <motion.div
                    ref={innerRef}
                    className="absolute left-1/2 top-1/2 select-none"
                    initial={false}
                    animate={{
                      x: "-50%",
                      y: "-50%",
                      rotate: rotation,
                      width: innerW,
                      height: innerH,
                    }}
                    transition={{ duration: 0.4, ease: [0.65, 0, 0.35, 1] }}
                  >
                    <img
                      src={page.original}
                      alt="Página capturada en edición"
                      draggable={false}
                      className="block h-full w-full"
                      style={{
                        filter: CSS_FILTERS[page.filter] ?? "none",
                        transition: "filter 0.3s ease",
                      }}
                    />

                    {/* Marco de perspectiva (coordenadas normalizadas 0-1) */}
                    <svg
                      className="pointer-events-none absolute inset-0 h-full w-full"
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      <polygon
                        points={polygonPoints}
                        fill="rgba(0,122,255,0.05)"
                        stroke="#007aff"
                        strokeWidth={2.5}
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                      />
                    </svg>

                    {/* Handles de punto medio (aristas) — arrastrables.
                        Pad táctil 44×44 (estándar del producto: EDITOR_TOUCH_PX=44)
                        con punto visual pequeño — el dedo agarra bien sin tapar. */}
                    {displayQuad.map((p, i) => {
                      const q = displayQuad[(i + 1) % 4];
                      return (
                        <button
                          key={`mid-${i}`}
                          type="button"
                          aria-label={`Punto medio de la arista ${i + 1}`}
                          onPointerDown={(e) => onHandleDown(e, "mid", i)}
                          className="absolute z-10 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none items-center justify-center rounded-full outline-none active:cursor-grabbing"
                          style={{
                            left: `${((p.x + q.x) / 2) * 100}%`,
                            top: `${((p.y + q.y) / 2) * 100}%`,
                          }}
                        >
                          <span className="pointer-events-none block h-3 w-3 rounded-full border-[1.5px] border-[#007aff] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.4)] transition-transform active:scale-125" />
                        </button>
                      );
                    })}

                    {/* Handles de esquina — arrastrables. Pad táctil 44×44
                        (EDITOR_TOUCH_PX=44 del producto) con el punto visual
                        animado dentro. */}
                    {displayQuad.map((p, i) => (
                      <button
                        key={`corner-${i}`}
                        type="button"
                        aria-label={`Vértice ${i + 1} del marco`}
                        onPointerDown={(e) => onHandleDown(e, "corner", i)}
                        className="absolute z-10 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none items-center justify-center rounded-full outline-none active:cursor-grabbing"
                        style={{
                          left: `${p.x * 100}%`,
                          top: `${p.y * 100}%`,
                        }}
                      >
                        <span className="pointer-events-none relative block rounded-full border-2 border-[#007aff] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.4)]">
                          <motion.span
                            aria-hidden="true"
                            className="absolute inset-0 rounded-full border-2 border-[#007aff]"
                            initial={false}
                            animate={{ scale: [1, 1.7], opacity: [0.55, 0] }}
                            transition={{
                              duration: 1.3,
                              repeat: Infinity,
                              ease: "easeOut",
                            }}
                          />
                        </span>
                      </button>
                    ))}

                    {/* Badge "Bordes detectados" cerca del vértice superior-izquierdo */}
                    <AnimatePresence>
                      {badgeVisible && (
                        <motion.div
                          key="edges-badge"
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 4 }}
                          transition={{ duration: 0.25 }}
                          className="pointer-events-none absolute z-20"
                          style={{
                            left: `${displayQuad[0].x * 100}%`,
                            top: `${displayQuad[0].y * 100}%`,
                          }}
                        >
                          <span className="block -translate-x-3 -translate-y-[calc(100%+14px)] whitespace-nowrap rounded-full bg-[rgba(28,28,30,0.9)] px-3 py-1.5 text-[12px] font-medium text-white shadow-[0_4px_12px_rgba(0,0,0,0.35)] backdrop-blur-md">
                            Bordes detectados
                          </span>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                </motion.div>
              )}

              {/* ── Lupa 3× durante el arrastre (puerto del AdjustEditor F4) ──
                  Círculo Ø168 en el lado opuesto al dedo; contenido = imagen
                  ORIGINAL ampliada 3× (los píxeles que se van a cortar, sin
                  rotar); crosshair amarillo = punto de corte real. */}
              {loupe && page && natural && fit ? (() => {
                const lw = innerW * LOUPE_SCALE;
                const lh = innerH * LOUPE_SCALE;
                return (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute z-30 overflow-hidden rounded-full bg-black shadow-[0_10px_28px_rgba(0,0,0,0.6)] ring-[3px] ring-white/90"
                    style={{
                      left: loupe.x - LOUPE_RADIUS,
                      top: loupe.y - LOUPE_RADIUS,
                      width: LOUPE_RADIUS * 2,
                      height: LOUPE_RADIUS * 2,
                    }}
                  >
                    <img
                      src={page.original}
                      alt=""
                      draggable={false}
                      className="absolute max-w-none select-none"
                      style={{
                        width: lw,
                        height: lh,
                        left: LOUPE_RADIUS - loupe.fx * lw,
                        top: LOUPE_RADIUS - loupe.fy * lh,
                        filter: CSS_FILTERS[page.filter] ?? "none",
                      }}
                    />
                    {/* Crosshair: marca el punto de corte real (F4) */}
                    <span className="absolute left-1/2 top-0 h-full w-[1.5px] -translate-x-1/2 bg-[rgba(234,179,8,0.95)]" />
                    <span className="absolute left-0 top-1/2 h-[1.5px] w-full -translate-y-1/2 bg-[rgba(234,179,8,0.95)]" />
                  </div>
                );
              })() : null}
            </div>
          </section>

          {/* ── Detección automática (solo en modo crop) ──────────────────── */}
          <div className="flex shrink-0 justify-center py-2.5">
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={handleDetect}
              disabled={detecting}
              className="flex items-center gap-2 rounded-full border border-[#3a3a3c] bg-[#2c2c2e] px-5 py-2.5 transition-colors active:bg-[#3a3a3c] disabled:opacity-70"
            >
              {detecting ? (
                <Loader2 className="h-[18px] w-[18px] animate-spin text-[#007aff]" />
              ) : (
                <Sparkles className="h-[18px] w-[18px] text-[#007aff]" />
              )}
              <span className="text-[15px] font-medium text-white">
                Detección automática
              </span>
            </motion.button>
          </div>
        </>
      )}

      {/* ── F-OCR-AUTO: pill flotante mientras el OCR de fondo vuela ──────── */}
      <AnimatePresence>
        {autoOcrBusy && mode === "review" && !ocrOpen && (
          <motion.div
            key="auto-ocr-pill"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="pointer-events-none absolute inset-x-0 bottom-[128px] z-30 flex justify-center px-6"
          >
            <div className="flex items-center gap-2 rounded-full bg-[#1c1c1e]/92 px-4 py-2 shadow-[0_4px_16px_rgba(0,0,0,0.35)] ring-1 ring-inset ring-white/10 backdrop-blur-xl">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#007aff]" />
              <span className="text-[12.5px] font-medium text-white/85">
                Reconociendo texto…
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── F-DEFER-CROP v6.2: pill mientras la detección de bordes vuela ──
          La captura abre el editor al instante con un marco provisional; el
          quad real aterriza en background (worker) y el preview se re-procesa
          solo. Pill en 176px para no chocar con el pill de OCR si ambos
          coinciden (OCR automático re-activado por el usuario). */}
      <AnimatePresence>
        {page?.autoQuadPending === true && mode === "review" && (
          <motion.div
            key="auto-quad-pill"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="pointer-events-none absolute inset-x-0 bottom-[176px] z-30 flex justify-center px-6"
          >
            <div className="flex items-center gap-2 rounded-full bg-[#1c1c1e]/92 px-4 py-2 shadow-[0_4px_16px_rgba(0,0,0,0.35)] ring-1 ring-inset ring-white/10 backdrop-blur-xl">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#007aff]" />
              <span className="text-[12.5px] font-medium text-white/85">
                Ajustando recorte…
              </span>
            </div>
          </motion.div>
        )}
        {page?.upgrading === true && mode === "review" && (
          <motion.div
            key="upgrade-pill"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="pointer-events-none absolute inset-x-0 bottom-[136px] z-30 flex justify-center px-6"
          >
            <div className="flex items-center gap-2 rounded-full bg-[#1c1c1e]/92 px-4 py-2 shadow-[0_4px_16px_rgba(0,0,0,0.35)] ring-1 ring-inset ring-white/10 backdrop-blur-xl">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#007aff]" />
              <span className="text-[12.5px] font-medium text-white/85">
                Afinando a calidad completa…
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {mode === "review" && (
        /* ── Bottom bar de REVIEW: toolbar + acciones principales ─────────── */
        <div className="relative z-10 shrink-0 bg-black pb-safe">
          {/* Toolbar de página (estilo Adobe Scan: con "Texto" = OCR,
              como "Editar texto" del video de referencia) */}
          <nav className="grid grid-cols-7 gap-0.5 px-1.5 pt-1" aria-label="Acciones de la página">
            <ToolItem icon={Camera} label="Repetir" danger onClick={handleRepeat} />
            <ToolItem icon={Crop} label="Recortar" onClick={handleEnterCrop} />
            <ToolItem icon={RotateCw} label="Rotar" onClick={handleRotate} />
            <ToolItem
              icon={SlidersHorizontal}
              label="Filtros"
              onClick={() => setFiltersOpen(true)}
            />
            <ToolItem
              icon={ScanText}
              label="Texto"
              active={page?.ocrDone === true}
              onClick={() => setOcrOpen(true)}
            />
            <ToolItem
              icon={ImageIcon}
              label="Imagen"
              active={exportingImg}
              onClick={() => void handleSaveImage()}
            />
            <ToolItem icon={Trash2} label="Eliminar" danger onClick={handleDeletePage} />
          </nav>

          {/* Botones principales: seguir escaneando/añadir página + Guardar PDF */}
          <div className="flex gap-3 px-5 pb-2 pt-2.5">
            <button
              type="button"
              onClick={() => setView("camera")}
              className="flex-1 rounded-full bg-white/12 py-3 text-[15px] font-semibold text-white ring-1 ring-inset ring-white/15 transition-all active:scale-[0.97] active:bg-white/20"
            >
              {reviewDocId ? "Añadir página" : "Seguir escaneando"}
            </button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={handleSave}
              disabled={saving}
              className="flex flex-[1.25] items-center justify-center gap-1.5 rounded-full bg-[#007aff] py-3 text-[15px] font-semibold text-white shadow-[0_6px_20px_rgba(0,122,255,0.45)] disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" strokeWidth={3} />
              )}
              Guardar PDF
            </motion.button>
          </div>

          <div className="home-indicator mb-1.5 mt-0.5" aria-hidden="true" />
        </div>
      )}

      {mode === "crop" && (
        <div className="home-indicator mb-2 mt-0 shrink-0" aria-hidden="true" />
      )}

      {/* ── Sheet de filtros (vaul, confinado al marco del teléfono) ────── */}
      {portalEl && page && (
        <DrawerPrimitive.Root open={filtersOpen} onOpenChange={setFiltersOpen}>
          <DrawerPrimitive.Portal container={portalEl}>
            <DrawerPrimitive.Overlay className="absolute inset-0 z-40 bg-black/50" />
            <DrawerPrimitive.Content
              className="absolute inset-x-0 bottom-0 z-50 mx-auto rounded-t-[22px] bg-[#1c1c1e] pb-safe outline-none"
            >
              <div className="mx-auto mt-2.5 h-1.5 w-9 rounded-full bg-white/25" />
              <DrawerPrimitive.Title className="px-5 pb-1 pt-3 text-center text-[17px] font-semibold text-white">
                Filtros
              </DrawerPrimitive.Title>
              <DrawerPrimitive.Description className="sr-only">
                Elige un filtro para la página en edición
              </DrawerPrimitive.Description>
              <div className="no-scrollbar flex gap-3 overflow-x-auto px-5 pb-5 pt-2">
                {FILTER_PRESETS.map((f) => {
                  const active = page.filter === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => handleFilter(f.id, f.label)}
                      className="flex w-[78px] shrink-0 flex-col items-center gap-1.5"
                    >
                      <span
                        className={cn(
                          "block h-[104px] w-full overflow-hidden rounded-xl border-2",
                          active
                            ? "border-[#007aff] shadow-[0_0_0_3px_rgba(0,122,255,0.25)]"
                            : "border-white/10"
                        )}
                      >
                        <img
                          src={page.original}
                          alt=""
                          draggable={false}
                          style={{ filter: CSS_FILTERS[f.id] ?? "none" }}
                          className="h-full w-full object-cover"
                        />
                      </span>
                      <span
                        className={cn(
                          "text-[11px]",
                          active ? "font-medium text-white" : "text-[#8e8e93]"
                        )}
                      >
                        {f.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </DrawerPrimitive.Content>
          </DrawerPrimitive.Portal>
        </DrawerPrimitive.Root>
      )}

      {/* ── Sheet de OCR "Texto" (F-OCR · vaul, confinado al teléfono) ────── */}
      {portalEl && page && (
        <DrawerPrimitive.Root
          open={ocrOpen}
          onOpenChange={(open) => {
            setOcrOpen(open);
            // F-FIND: al cerrar el sheet se limpia el resaltado.
            if (!open) setFindQuery(null);
          }}
        >
          <DrawerPrimitive.Portal container={portalEl}>
            <DrawerPrimitive.Overlay className="absolute inset-0 z-40 bg-black/50" />
            <DrawerPrimitive.Content
              className="absolute inset-x-0 bottom-0 z-50 mx-auto rounded-t-[22px] bg-[#1c1c1e] pb-safe outline-none"
            >
              <div className="mx-auto mt-2.5 h-1.5 w-9 rounded-full bg-white/25" />
              <DrawerPrimitive.Title className="flex items-center justify-center gap-2 px-5 pb-1 pt-3 text-center text-[17px] font-semibold text-white">
                <ScanText className="size-[18px] text-[#007aff]" strokeWidth={2.2} />
                Texto reconocido
              </DrawerPrimitive.Title>
              <DrawerPrimitive.Description className="sr-only">
                Texto extraído por OCR de la página {activeIdx + 1}
              </DrawerPrimitive.Description>

              <div className="px-5 pb-4 pt-1">
                {ocrRunning ? (
                  <div className="flex min-h-[140px] flex-col items-center justify-center gap-3">
                    <Loader2 className="h-6 w-6 animate-spin text-[#007aff]" />
                    <span className="text-[13px] font-medium text-white/70">
                      {ocrProgress
                        ? `Reconociendo página ${ocrProgress.i} de ${ocrProgress.n}…`
                        : "Reconociendo texto…"}
                    </span>
                  </div>
                ) : page.ocrText ? (
                  <>
                    {/* F-FIND: barra de coincidencias activa (amarillo iOS) */}
                    {findQuery && (
                      <div className="mb-2 flex items-center justify-between gap-2 rounded-xl bg-[#ffd60a]/12 px-3 py-2 ring-1 ring-inset ring-[#ffd60a]/30">
                        <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium text-[#ffd60a]">
                          <Search className="size-3.5 shrink-0" strokeWidth={2.4} />
                          <span className="truncate">
                            {ocrStats.matches}{' '}
                            {ocrStats.matches === 1 ? 'coincidencia' : 'coincidencias'} de “{findQuery}”
                          </span>
                        </span>
                        <button
                          type="button"
                          aria-label="Quitar resaltado"
                          onClick={() => setFindQuery(null)}
                          className="shrink-0 rounded-full p-1 text-[#ffd60a]/80 transition-colors active:bg-white/10"
                        >
                          <X className="size-4" strokeWidth={2.4} />
                        </button>
                      </div>
                    )}
                    <div className="no-scrollbar max-h-[38vh] overflow-y-auto rounded-xl bg-black/40 p-3.5 ring-1 ring-inset ring-white/10">
                      <OcrHighlightedText text={page.ocrText} query={findQuery} />
                    </div>
                    {/* Contadores informativos (estilo chips iOS) */}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 px-0.5">
                      <span className="rounded-full bg-white/8 px-2.5 py-1 text-[11.5px] font-medium tabular-nums text-white/60">
                        {ocrStats.words} {ocrStats.words === 1 ? "palabra" : "palabras"}
                      </span>
                      <span className="rounded-full bg-white/8 px-2.5 py-1 text-[11.5px] font-medium tabular-nums text-white/60">
                        {ocrStats.chars} {ocrStats.chars === 1 ? "carácter" : "caracteres"}
                      </span>
                    </div>
                    <div className="mt-3 flex gap-2.5">
                      <button
                        type="button"
                        onClick={() => void runOcrCurrent()}
                        className="flex-1 rounded-full bg-white/10 py-2.5 text-[14px] font-semibold text-white/90 ring-1 ring-inset ring-white/15 transition-all active:scale-[0.97]"
                      >
                        Reconocer de nuevo
                      </button>
                      <motion.button
                        type="button"
                        whileTap={{ scale: 0.97 }}
                        onClick={() => void copyOcrText()}
                        className="flex flex-[1.3] items-center justify-center gap-1.5 rounded-full bg-[#007aff] py-2.5 text-[14px] font-semibold text-white shadow-[0_4px_16px_rgba(0,122,255,0.4)]"
                      >
                        <Copy className="size-4" strokeWidth={2.4} />
                        Copiar texto
                      </motion.button>
                    </div>
                  </>
                ) : (
                  <div className="flex min-h-[140px] flex-col items-center justify-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/8">
                      <ScanText className="h-6 w-6 text-[#8e8e93]" strokeWidth={1.8} />
                    </div>
                    <span className="max-w-[260px] text-center text-[13px] leading-snug text-[#8e8e93]">
                      Extrae el texto de la página {activeIdx + 1} para copiarlo o
                      buscarlo luego desde la biblioteca.
                    </span>
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.97 }}
                      onClick={() => void runOcrCurrent()}
                      className="rounded-full bg-[#007aff] px-6 py-2.5 text-[14px] font-semibold text-white shadow-[0_4px_16px_rgba(0,122,255,0.4)]"
                    >
                      Reconocer texto
                    </motion.button>
                  </div>
                )}

                {/* Copiar el texto de TODAS las páginas (F-TXT) */}
                {totalPages > 1 && allDocOcrText && !ocrRunning && (
                  <button
                    type="button"
                    onClick={() => void copyAllOcr()}
                    className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-full bg-white/8 py-2.5 text-[13.5px] font-medium text-white/75 ring-1 ring-inset ring-white/10 transition-all active:scale-[0.98]"
                  >
                    <Copy className="size-4" strokeWidth={2.2} />
                    Copiar texto de las {totalPages} páginas
                  </button>
                )}

                {/* OCR de todo el documento (secuencial con progreso) */}
                {totalPages > 1 && !ocrRunning && (
                  <button
                    type="button"
                    onClick={() => void runOcrAll()}
                    className="mt-2.5 w-full rounded-full bg-white/8 py-2.5 text-[13.5px] font-medium text-white/75 ring-1 ring-inset ring-white/10 transition-all active:scale-[0.98]"
                  >
                    OCR en todas las páginas ({totalPages})
                  </button>
                )}
              </div>
            </DrawerPrimitive.Content>
          </DrawerPrimitive.Portal>
        </DrawerPrimitive.Root>
      )}

      {/* ── Presentación a pantalla completa (F-NOVIEW: antes en el detalle) ── */}
      <AnimatePresence>
        {presentationOpen && presentationPages.length > 0 && (
          <PresentationView
            key="editor-presentation"
            pages={presentationPages}
            title={headerTitle}
            initialIndex={activeIdx}
            onClose={() => setPresentationOpen(false)}
            onIndexChange={goToPage}
          />
        )}
      </AnimatePresence>

      {/* ── Overlay de guardado ──────────────────────────────────────────── */}
      <AnimatePresence>
        {saving && !savedInfo && (
          <motion.div
            key="saving-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-[2px]"
          >
            <div className="flex flex-col items-center gap-3 rounded-2xl bg-[#1c1c1e] px-8 py-6 shadow-2xl">
              <Loader2 className="h-7 w-7 animate-spin text-[#007aff]" />
              <span className="text-[14px] font-medium text-white">
                {reviewDocId ? "Exportando PDF…" : "Procesando y guardando…"}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Overlay de ÉXITO (check dibujado, patrón iOS) ──────────────────── */}
      <AnimatePresence>
        {savedInfo && (
          <SaveSuccessOverlay
            key="save-success"
            pageCount={savedInfo.pages}
            engine={savedInfo.engine}
            onFinished={finishSave}
            onScanAnother={scanAnother}
            onDownloadPdf={downloadFromOverlay}
            batchCount={batchSavedCount + 1}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** Item del toolbar de review (icono 24px + label 11px). Activo = halo azul
 *  suave + glow del icono (feedback inmediato, estilo iOS/Adobe Scan). */
function ToolItem({
  icon: Icon,
  label,
  active,
  danger,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="group flex flex-col items-center gap-1 rounded-xl px-1 py-1.5 transition-all duration-200 active:opacity-60"
    >
      <span
        className={cn(
          "flex h-[34px] w-[34px] items-center justify-center rounded-full transition-all duration-200",
          active
            ? "bg-[#007aff]/14 shadow-[inset_0_0_0_1px_rgba(0,122,255,0.35)]"
            : "group-active:bg-white/8"
        )}
      >
        <Icon
          className={cn(
            "h-6 w-6 transition-all duration-200",
            danger
              ? "text-[#ff3b30]"
              : active
                ? "text-[#007aff] drop-shadow-[0_0_7px_rgba(0,122,255,0.55)]"
                : "text-[#8e8e93] group-hover:text-white/90"
          )}
          strokeWidth={active ? 2.2 : 1.8}
        />
      </span>
      <span
        className={cn(
          "text-[11px] transition-colors duration-200",
          danger
            ? "text-[#ff3b30]/80"
            : active
              ? "font-medium text-[#007aff]"
              : "text-[#8e8e93] group-hover:text-white/80"
        )}
      >
        {label}
      </span>
    </button>
  );
}
