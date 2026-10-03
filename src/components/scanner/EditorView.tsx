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
  WheelEvent as ReactWheelEvent,
} from "react";
import { AnimatePresence, motion, useMotionValue } from "framer-motion";
import { Drawer as DrawerPrimitive } from "vaul";
import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Crop,
  Eye,
  Loader2,
  Maximize2,
  RotateCw,
  ScanText,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { nextId, useScannerStore } from "@/lib/scanner/store";
import {
  detectDocumentEdges,
  evaluateQuality,
  generateDemoPage,
  loadImage,
  processImage,
} from "@/lib/scanner/image-processor";
import {
  FILTER_PRESETS,
  capturePageKey,
  defaultQuad,
} from "@/lib/scanner/types";
import type { CapturePage, PageFilter, Point, Quad, ScanPage } from "@/lib/scanner/types";
import { ocrTextIsValid, requestOcr } from "@/lib/scanner/ocr";
import { buildDocPdf, sanitizeFileName } from "@/lib/scanner/pdf-export";
import { formatBytes } from "@/lib/scanner/format";
import { cn } from "@/lib/utils";
import { SaveSuccessOverlay } from "@/components/scanner/SaveSuccessOverlay";
import { PresentationView } from "@/components/scanner/PresentationView";

/** Aproximación CSS de cada filtro para las previews en vivo (§8.4 del
 *  SPEC-MAESTRO: solo cosmética — el procesado real ocurre al confirmar). */
const CSS_FILTERS: Record<PageFilter, string> = {
  original: "none",
  text: "brightness(1.12) contrast(1.35)",
  bw: "grayscale(1) contrast(2.6) brightness(1.05)",
};

const TWEEN_MS = 280;

/** F-ZOOM — límites del zoom de revisión (mismos que la presentación). */
const ZOOM_MIN = 1;
const ZOOM_MAX = 6;
const ZOOM_DOUBLE_TAP = 2.5;
/** Umbral de movimiento (px) para distinguir arrastre de toque. */
const TAP_SLOP = 8;

/** Lupa 3× durante el arrastre de un handle (puerto fiel del AdjustEditor del
 *  producto: EDITOR_LOUPE_SCALE=3 + EDITOR_LOUPE_RADIUS=84 — F4 validación
 *  humana 2026-09-25: "la lupa aparece en el lado opuesto al dedo" y el
 *  crosshair marca el punto de corte real, no el dedo). */
const LOUPE_SCALE = 3;
const LOUPE_RADIUS = 84;
const LOUPE_GAP = 14;

/** Mantener pulsado el preview (ms) antes de mostrar el original. */
const COMPARE_HOLD_MS = 350;

/** Preview procesado de la página en edición (modo review). */
interface PreviewEntry {
  url: string;
  w: number;
  h: number;
  engine: "worker" | "canvas";
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

export default function EditorView() {
  // ── Store ────────────────────────────────────────────────────────────────
  const capturePages = useScannerStore((s) => s.capturePages);
  const editingIndex = useScannerStore((s) => s.editingIndex);
  const setEditingIndex = useScannerStore((s) => s.setEditingIndex);
  const updateCapturePage = useScannerStore((s) => s.updateCapturePage);
  const removeCapturePage = useScannerStore((s) => s.removeCapturePage);
  const addCapturePage = useScannerStore((s) => s.addCapturePage);
  const setView = useScannerStore((s) => s.setView);
  const documentsCount = useScannerStore((s) => s.documents.length);
  const saveSessionAsDocument = useScannerStore((s) => s.saveSessionAsDocument);
  const startBatchDocument = useScannerStore((s) => s.startBatchDocument);
  const batchSavedCount = useScannerStore((s) => s.batchSavedCount);
  const unsharpOriginal = useScannerStore((s) => s.settings.unsharpOriginal);
  /** F-NOVIEW — modo revisión de documento: el editor trabaja sobre las
   *  páginas de un documento guardado (cargadas como sesión con sus ids). */
  const reviewDocId = useScannerStore((s) => s.reviewDocId);
  const reviewDoc = useScannerStore((s) =>
    s.reviewDocId ? (s.documents.find((d) => d.id === s.reviewDocId) ?? null) : null
  );
  const saveSessionToDocument = useScannerStore((s) => s.saveSessionToDocument);
  const exitReviewToLibrary = useScannerStore((s) => s.exitReviewToLibrary);

  const page: CapturePage | undefined =
    capturePages[editingIndex] ?? capturePages[capturePages.length - 1];
  const activeIdx = page ? capturePages.indexOf(page) : -1;

  // ── Modo review/crop + preview procesado (F-FLOW) ───────────────────────
  const [mode, setMode] = useState<"review" | "crop">("review");
  const [preview, setPreview] = useState<PreviewEntry | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewCache = useRef(new Map<string, PreviewEntry>());
  /** Comparación antes/después: mantener pulsado el preview → original. */
  const [comparing, setComparing] = useState(false);
  const compareTimer = useRef<number | null>(null);

  // ── F-ZOOM — zoom de revisión (pinza · pan · doble toque · rueda) ────────
  const zoomStageRef = useRef<HTMLDivElement>(null);
  const zoomWrapRef = useRef<HTMLDivElement>(null);
  const zoomImgRef = useRef<HTMLImageElement>(null);
  const zoomScale = useMotionValue(1);
  const zoomX = useMotionValue(0);
  const zoomY = useMotionValue(0);
  /** % del zoom para el chip flotante (estado discreto, no por frame). */
  const [zoomPct, setZoomPct] = useState(100);
  const zoomPointers = useRef(new Map<number, { x: number; y: number }>());
  const zoomGesture = useRef<
    | null
    | {
        type: "pan" | "pinch";
        startScale: number;
        startDist: number;
        startX: number;
        startY: number;
        midX: number;
        midY: number;
      }
  >(null);
  const zoomDownAt = useRef<{ x: number; y: number; t: number } | null>(null);
  const zoomLastTap = useRef(0);

  // ── OCR (F-OCR · sheet "Texto") ─────────────────────────────────────────
  const [ocrOpen, setOcrOpen] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<{ i: number; n: number } | null>(null);

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
    engine: "opencv" | "canvas";
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
  const displayRef = useRef<Quad>(displayQuad);
  const draggingRef = useRef(false);
  const dragRef = useRef<{ kind: "corner" | "mid"; index: number } | null>(null);
  const pageIdRef = useRef<string | null>(null);
  const autoIds = useRef<Set<string>>(new Set());
  const manualIds = useRef<Set<string>>(new Set());
  const badgeTimer = useRef<number>(0);

  // ── Título del header (estilo Adobe Scan: "Digitalización N · fecha") ────
  const headerTitle = reviewDoc ? reviewDoc.title : `Digitalización ${documentsCount + 1}`;
  const headerDate = prettyDate(reviewDoc ? reviewDoc.updatedAt : Date.now());

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

  // ── F-NOVIEW: la biblioteca abre el documento directamente en el editor
  // (modo revisión). La sesión llega cargada desde beginReviewDocument.

  // ── Si la sesión está vacía, siembra una página de demo ──────────────────
  // (permite ver/validar el Editor sin capturar; la cámara real la sustituye)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (useScannerStore.getState().capturePages.length > 0) return;
      try {
        const src = generateDemoPage(1);
        if (!src || cancelled) return;
        const quad = await detectDocumentEdges(src);
        const quality = await evaluateQuality(src);
        if (cancelled) return;
        if (useScannerStore.getState().capturePages.length > 0) return;
        const id = nextId("page");
        autoIds.current.add(id);
        addCapturePage({
          id,
          original: src,
          quad,
          filter: "original",
          rotation: 0,
          quality,
        });
      } catch {
        /* sin contexto de canvas: la vista muestra el estado vacío */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [addCapturePage]);

  // ── REVIEW: procesa la página (warp + enhance) y cachea el resultado ────
  // F-FLOW: al entrar (o al cambiar página/quad/filtro/rotación) se procesa
  // la página con el RECORTE AUTOMÁTICO y el filtro — el usuario ve el
  // documento final, no el original con marco (eso queda para "Recortar").
  const cacheKey = page ? capturePageKey(page) : "";

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
      });
    }
    const cached = previewCache.current.get(cacheKey);
    if (cached) {
      setPreview(cached);
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    void (async () => {
      try {
        const res = await processImage(
          page.original,
          page.quad,
          page.filter,
          page.rotation,
          {
            manual: page.quadManual === true,
            unsharpOriginal,
          }
        );
        if (cancelled) return;
        const entry: PreviewEntry = {
          url: res.processed,
          w: res.precision?.width ?? 0,
          h: res.precision?.height ?? 0,
          engine: res.precision?.engine === "worker" ? "worker" : "canvas",
        };
        previewCache.current.set(cacheKey, entry);
        // LRU tosco: 12 entradas como máximo (data URLs grandes).
        if (previewCache.current.size > 12) {
          const oldest = previewCache.current.keys().next().value;
          if (oldest) previewCache.current.delete(oldest);
        }
        setPreview(entry);
      } catch {
        if (!cancelled) setPreview({ url: page.original, w: 0, h: 0, engine: "canvas" });
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
     
  }, [mode, cacheKey, page?.original, unsharpOriginal]);

  // ── Comparación antes/después (mantener pulsado el preview a 1×) ──────────
  const startCompareTimer = useCallback(() => {
    if (compareTimer.current !== null) window.clearTimeout(compareTimer.current);
    compareTimer.current = window.setTimeout(() => {
      compareTimer.current = null;
      setComparing(true);
      navigator.vibrate?.(18);
    }, COMPARE_HOLD_MS);
  }, []);
  const endCompare = useCallback(() => {
    if (compareTimer.current !== null) {
      window.clearTimeout(compareTimer.current);
      compareTimer.current = null;
    }
    setComparing(false);
  }, []);
  useEffect(() => () => endCompare(), [endCompare]);

  /* ── F-ZOOM — gestos de ampliación del preview (modo review) ──────────
   * Pinza (2 dedos) 1×–6× anclada al punto medio · pan con 1 dedo ampliado
   * (acotado a los bordes de la IMAGEN) · doble toque alterna 1× ↔ 2,5×
   * centrado en el punto · rueda del ratón en escritorio. El chip flotante
   * muestra el % y se reinicia al cambiar de página. */
  const clampZoomPan = useCallback(() => {
    const s = zoomScale.get();
    const img = zoomImgRef.current;
    let bx = 0;
    let by = 0;
    // Límites con el tamaño REAL mostrado de la imagen (no del contenedor).
    if (img && s > 1) {
      bx = Math.max(0, (img.offsetWidth * (s - 1)) / 2);
      by = Math.max(0, (img.offsetHeight * (s - 1)) / 2);
    }
    if (zoomX.get() > bx) zoomX.set(bx);
    if (zoomX.get() < -bx) zoomX.set(-bx);
    if (zoomY.get() > by) zoomY.set(by);
    if (zoomY.get() < -by) zoomY.set(-by);
  }, [zoomScale, zoomX, zoomY, zoomImgRef]);

  const commitZoomScale = useCallback(
    (next: number) => {
      zoomScale.set(next);
      setZoomPct(Math.round(next * 100));
    },
    [zoomScale]
  );

  const resetZoom = useCallback(() => {
    zoomScale.set(1);
    zoomX.set(0);
    zoomY.set(0);
    setZoomPct(100);
  }, [zoomScale, zoomX, zoomY]);

  // El zoom se reinicia al cambiar de página o de modo (como Fotos de iOS).
  useEffect(() => {
    resetZoom();
  }, [page?.id, mode, resetZoom]);

  /** Coordenadas del puntero relativas al CENTRO del stage (ancla de zoom). */
  const zoomRelToCenter = useCallback((cx: number, cy: number) => {
    const rect = zoomStageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: cx - (rect.left + rect.width / 2), y: cy - (rect.top + rect.height / 2) };
  }, []);

  /** Escala a `next` manteniendo bajo el punto `px,py` (relativo al centro)
   *  el mismo contenido que había (fórmula clásica de zoom anclado). */
  const zoomAtPoint = useCallback(
    (px: number, py: number, next: number) => {
      const s = zoomScale.get();
      const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
      if (clamped === s) return;
      // Punto de contenido (coords a escala 1) bajo el ancla:
      const cx = (px - zoomX.get()) / s;
      const cy = (py - zoomY.get()) / s;
      commitZoomScale(clamped);
      zoomX.set(px - cx * clamped);
      zoomY.set(py - cy * clamped);
      if (clamped === ZOOM_MIN) {
        zoomX.set(0);
        zoomY.set(0);
      } else {
        clampZoomPan();
      }
    },
    [zoomScale, zoomX, zoomY, commitZoomScale, clampZoomPan]
  );

  const onStagePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const el = zoomStageRef.current;
      if (!el) return;
      // F-NAV (lección de la presentación): solo capturar cuando el down cae
      // en el propio stage — si cae en un hijo (chip de zoom) su click debe
      // vivir (setPointerCapture en el ancestro se lo roba).
      if (e.target === e.currentTarget) {
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* algunos navegadores lanzan si el puntero ya se soltó */
        }
      }
      zoomPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (zoomPointers.current.size === 2) {
        // Inicio de pinza: cancela la comparación (gesto de 1 dedo).
        endCompare();
        const [a, b] = [...zoomPointers.current.values()];
        const mid = zoomRelToCenter((a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
        zoomGesture.current = {
          type: "pinch",
          startScale: zoomScale.get(),
          startDist: Math.hypot(a!.x - b!.x, a!.y - b!.y),
          startX: zoomX.get(),
          startY: zoomY.get(),
          midX: mid.x,
          midY: mid.y,
        };
      } else if (zoomPointers.current.size === 1) {
        zoomDownAt.current = { x: e.clientX, y: e.clientY, t: performance.now() };
        zoomGesture.current = {
          type: "pan",
          startScale: zoomScale.get(),
          startDist: 0,
          startX: zoomX.get(),
          startY: zoomY.get(),
          midX: 0,
          midY: 0,
        };
        // F-ZOOM: a escala 1× el "mantener pulsado" compara ORIGINAL vs
        // procesado (como Fotos de iOS); ampliado, el mismo dedo hace PAN.
        if (zoomScale.get() <= 1.01 && (e.button === 0 || e.pointerType !== "mouse")) {
          if (e.target === e.currentTarget) startCompareTimer();
        }
      }
    },
    [zoomRelToCenter, endCompare, startCompareTimer, zoomScale, zoomX, zoomY]
  );

  const onStagePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!zoomPointers.current.has(e.pointerId)) return;
      zoomPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = zoomGesture.current;
      if (!g) return;
      if (g.type === "pinch" && zoomPointers.current.size >= 2) {
        const [a, b] = [...zoomPointers.current.values()];
        const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (g.startDist > 4) {
          const next = g.startScale * (dist / g.startDist);
          zoomAtPoint(g.midX, g.midY, next);
        }
      } else if (g.type === "pan") {
        // Pan solo ampliado; a 1× el arrastre no hace nada (es hold-comparar).
        if (zoomScale.get() <= 1.01) return;
        const down = zoomDownAt.current;
        if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > TAP_SLOP) {
          zoomGesture.current = { ...g, type: "pan", startX: g.startX, startY: g.startY };
        }
        zoomX.set(g.startX + (e.clientX - (down?.x ?? e.clientX)));
        zoomY.set(g.startY + (e.clientY - (down?.y ?? e.clientY)));
        clampZoomPan();
      }
    },
    [zoomAtPoint, clampZoomPan, zoomScale, zoomX, zoomY]
  );

  const onStagePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wasPinch = zoomGesture.current?.type === "pinch";
      zoomPointers.current.delete(e.pointerId);
      if (zoomPointers.current.size === 0) {
        const down = zoomDownAt.current;
        const g = zoomGesture.current;
        zoomDownAt.current = null;
        zoomGesture.current = null;
        endCompare();
        clampZoomPan();
        // ¿Toque limpio (sin arrastre)? → candidato a doble toque.
        const cleanTap =
          down &&
          g?.type === "pan" &&
          Math.hypot(e.clientX - down.x, e.clientY - down.y) <= TAP_SLOP &&
          performance.now() - down.t < 280;
        if (cleanTap && !wasPinch) {
          const now = performance.now();
          if (now - zoomLastTap.current < 320) {
            // Doble toque: alterna 1× ↔ 2,5× centrado en el punto.
            zoomLastTap.current = 0;
            const p = zoomRelToCenter(e.clientX, e.clientY);
            if (zoomScale.get() > 1.01) resetZoom();
            else zoomAtPoint(p.x, p.y, ZOOM_DOUBLE_TAP);
          } else {
            zoomLastTap.current = now;
          }
        }
      } else if (zoomPointers.current.size === 1) {
        // Un dedo sigue en pantalla tras la pincha → pasa a pan desde aquí.
        const [a] = [...zoomPointers.current.values()];
        zoomGesture.current = {
          type: "pan",
          startScale: zoomScale.get(),
          startDist: 0,
          startX: zoomX.get(),
          startY: zoomY.get(),
          midX: 0,
          midY: 0,
        };
        zoomDownAt.current = a ? { x: a.x, y: a.y, t: performance.now() } : null;
      }
    },
    [clampZoomPan, endCompare, zoomRelToCenter, zoomAtPoint, resetZoom, zoomScale, zoomX, zoomY]
  );

  /** Rueda del ratón (escritorio): zoom anclado al cursor. */
  const onStageWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      if (!e.deltaY) return;
      e.preventDefault();
      const p = zoomRelToCenter(e.clientX, e.clientY);
      const factor = Math.exp(-e.deltaY * 0.0016);
      zoomAtPoint(p.x, p.y, zoomScale.get() * factor);
    },
    [zoomRelToCenter, zoomAtPoint, zoomScale]
  );

  const zoomed = zoomPct > 101;

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
  }, [activeIdx, mode]);

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
        fx = q[index]!.x;
        fy = q[index]!.y;
      } else {
        const a = q[index]!;
        const b = q[(index + 1) % 4]!;
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

  /** Rotar 90° (en review se reprocesa solo; en crop el preview rota en vivo). */
  const handleRotate = () => {
    if (!page) return;
    updateCapturePage(page.id, { rotation: (page.rotation + 90) % 360 });
  };

  /** Recortar: entra al modo de ajuste manual de bordes. */
  const handleEnterCrop = () => {
    if (!page) return;
    setMode("crop");
  };

  /** Aplicar el recorte: vuelve a review (el efecto reprocesa el preview). */
  const handleApplyCrop = () => {
    setMode("review");
  };

  /** Cancelar el recorte: restaura el quad persistido y vuelve a review. */
  const handleCancelCrop = () => {
    if (page) {
      displayRef.current = page.quad;
      setDisplayQuad(page.quad);
    }
    setMode("review");
  };

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
     
  }, [mode, page?.id]);

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

  const handleFilter = (filter: PageFilter, label: string) => {
    if (page) updateCapturePage(page.id, { filter });
    toast.success(`Filtro aplicado: ${label}`, { duration: 1500 });
    setFiltersOpen(false);
  };

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
        toast("Documento eliminado", {
          description: "Era su única página.",
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
    try {
      const { pdf, bytes } = await buildDocPdf(doc, s.settings.exportQuality);
      pdf.save(`${sanitizeFileName(doc.title)}.pdf`);
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
    try {
      if (s.reviewDocId) {
        const docId = await s.saveSessionToDocument();
        setSaving(false);
        if (docId) {
          if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
            navigator.vibrate([28, 60, 28]);
          }
          await downloadDocPdf(docId);
        }
        setView("library");
        return;
      }
      const n = s.documents.length + 1;
      const doc = await s.saveSessionAsDocument(`Digitalización ${n}`);
      if (doc) {
        const engine = doc.pages.some((p) => p.precision?.engine === "worker")
          ? "opencv"
          : "canvas";
        if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
          navigator.vibrate([28, 60, 28]);
        }
        setSavedInfo({ docId: doc.id, pages: doc.pages.length, engine });
      } else {
        toast.error("No se pudo guardar el documento");
        setSaving(false);
      }
    } catch {
      toast.error("No se pudo guardar el documento");
      setSaving(false);
    }
  }, [saving, savedInfo, downloadDocPdf]);

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
  }, [downloadDocPdf]);

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
    // Preview actual (estado fresco) → procesada guardada si sigue vigente →
    // original como último recurso.
    const image =
      preview?.url ??
      (page.processed && page.processedKey === cacheKey ? page.processed : undefined) ??
      page.original;
    setOcrRunning(true);
    try {
      const text = await requestOcr(image);
      if (ocrTextIsValid(text)) {
        updateCapturePage(page.id, { ocrText: text, ocrDone: true });
        toast.success("Texto reconocido", {
          description: `${text.length} caracteres · ya puedes copiarlo`,
        });
      } else {
        toast.info("La página no parece tener texto legible");
      }
    } catch (err) {
      toast.error("No se pudo reconocer el texto", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setOcrRunning(false);
    }
  }, [page, preview?.url, cacheKey, ocrRunning, updateCapturePage]);

  /** OCR secuencial de TODAS las páginas de la sesión (con progreso). */
  const runOcrAll = useCallback(async () => {
    if (ocrRunning) return;
    const s = useScannerStore.getState();
    const pages = s.capturePages;
    if (pages.length === 0) return;
    setOcrRunning(true);
    try {
      for (let i = 0; i < pages.length; i += 1) {
        const p = pages[i]!;
        setOcrProgress({ i: i + 1, n: pages.length });
        if (p.ocrDone && p.ocrText) continue;
        // La procesada guardada solo sirve si el estado no cambió (como el
        // preview): rotada/filtrada/recortada → procesar al vuelo.
        const freshKey = capturePageKey(p);
        let image = p.processed && p.processedKey === freshKey ? p.processed : undefined;
        if (!image) {
          image = previewCache.current.get(freshKey)?.url;
        }
        if (!image) {
          // Procesa al vuelo (sesión de captura: aún no hay procesada).
          const res = await processImage(p.original, p.quad, p.filter, p.rotation, {
            manual: p.quadManual === true,
            unsharpOriginal: s.settings.unsharpOriginal,
          });
          image = res.processed;
          previewCache.current.set(capturePageKey(p), {
            url: res.processed,
            w: 0,
            h: 0,
            engine: res.precision?.engine === "worker" ? "worker" : "canvas",
          });
        }
        const text = await requestOcr(image);
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
  }, [ocrRunning, updateCapturePage]);

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

  /** Páginas de la sesión proyectadas a ScanPage para la presentación
   *  (usa la procesada de la cache — la misma que se ve en el preview). */
  const presentationPages = useMemo<ScanPage[]>(() => {
    return capturePages.map((p) => {
      const url = previewCache.current.get(capturePageKey(p))?.url;
      return {
        id: p.id,
        original: p.original,
        processed: url ?? p.processed ?? p.original,
        thumbnail: p.original,
        filter: p.filter,
        quad: p.quad,
        quadManual: p.quadManual,
        rotation: p.rotation,
        quality: p.quality,
        ocrText: p.ocrText,
        ocrDone: p.ocrDone === true,
        createdAt: 0,
      };
    });
  }, [capturePages, preview?.url]);

  /** Navegación de páginas (pill + carrusel). */
  const goToPage = useCallback(
    (i: number) => {
      if (i < 0 || i >= capturePages.length || i === activeIdx) return;
      setEditingIndex(i);
    },
    [capturePages.length, activeIdx, setEditingIndex]
  );

  const totalPages = capturePages.length;
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
          {/* Presentación a pantalla completa (antes vivía en el detalle) */}
          <button
            type="button"
            aria-label="Ver presentación a pantalla completa"
            onClick={() => setPresentationOpen(true)}
            disabled={totalPages === 0}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/85 transition-all active:scale-90 active:bg-white/10 disabled:opacity-30"
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
          {/* Preview del RECORTADO — F-ZOOM: pinza/pan/doble-toque/rueda.
              A 1× mantener pulsado compara con el ORIGINAL. */}
          <div
            ref={zoomStageRef}
            className="relative flex min-h-0 flex-1 touch-none select-none items-center justify-center overflow-hidden px-3"
            onPointerDown={onStagePointerDown}
            onPointerMove={onStagePointerMove}
            onPointerUp={onStagePointerUp}
            onPointerLeave={onStagePointerUp}
            onPointerCancel={onStagePointerUp}
            onWheel={onStageWheel}
            onContextMenu={(e) => e.preventDefault()}
          >
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
                className="relative z-10 flex h-full w-full items-center justify-center overflow-hidden"
              >
                {/* Capa de zoom: scale/x/y por motion values (will-change GPU) */}
                <motion.div
                  ref={zoomWrapRef}
                  style={{ scale: zoomScale, x: zoomX, y: zoomY }}
                  className="flex h-full w-full items-center justify-center will-change-transform"
                >
                  <img
                    ref={zoomImgRef}
                    src={preview.url}
                    alt={`Página ${activeIdx + 1} escaneada y recortada`}
                    draggable={false}
                    className="max-h-full max-w-full select-none rounded-[6px] object-contain shadow-[0_18px_60px_rgba(0,0,0,0.65)]"
                  />
                  {/* Comparación antes/después: el ORIGINAL mientras se mantiene pulsado */}
                  <AnimatePresence>
                    {comparing && page && (
                      <motion.div
                        key="review-compare"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.14 }}
                        className="absolute inset-0 z-20 flex items-center justify-center"
                        aria-hidden="true"
                      >
                        <img
                          src={page.original}
                          alt=""
                          draggable={false}
                          className="max-h-full max-w-full select-none rounded-[6px] object-contain shadow-[0_18px_60px_rgba(0,0,0,0.65)]"
                        />
                        <span className="absolute left-1/2 top-3 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-white/95 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[#1c1c1e] shadow-[0_2px_10px_rgba(0,0,0,0.35)] backdrop-blur-md">
                          <Eye className="size-3.5" strokeWidth={2.4} />
                          Original
                        </span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              </motion.div>
            ) : null}

            {/* F-ZOOM — chip de zoom con % y botón de reinicio (patrón Fotos) */}
            <AnimatePresence>
              {zoomed && (
                <motion.div
                  key="zoom-chip"
                  initial={{ opacity: 0, y: 8, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.94 }}
                  transition={{ duration: 0.18 }}
                  className="absolute right-3 top-3 z-30"
                >
                  <button
                    type="button"
                    aria-label="Restablecer el zoom"
                    onClick={resetZoom}
                    className="flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1.5 text-[11px] font-semibold tabular-nums text-white backdrop-blur-md transition-transform active:scale-95"
                  >
                    {zoomPct}%
                    <span className="text-white/50" aria-hidden="true">·</span>
                    <span className="font-medium text-[#007aff]">Restablecer</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Hint de zoom (una vez por montaje, solo primera página) */}
            {!zoomed && totalPages > 0 && !previewLoading && zoomHintVisible && (
              <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-6">
                <span className="rounded-full bg-black/45 px-3 py-1 text-[10.5px] font-medium text-white/70 backdrop-blur-md">
                  Pellizca para ampliar · mantén pulsado para ver el original
                </span>
              </div>
            )}

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
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white transition-all active:scale-90 disabled:opacity-25"
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
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white transition-all active:scale-90 disabled:opacity-25"
              >
                <ChevronRight className="size-4" strokeWidth={2.6} />
              </button>
            </div>
          )}

          {/* Carrusel de miniaturas (siempre visible en review) */}
          {totalPages > 0 && (
            <div
              ref={carouselRef}
              className="no-scrollbar flex shrink-0 gap-2.5 overflow-x-auto px-5 pb-2"
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
                    src={p.original}
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
          )}
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

      {mode === "review" && (
        /* ── Bottom bar de REVIEW: toolbar + acciones principales ─────────── */
        <div className="relative z-10 shrink-0 bg-black pb-safe">
          {/* Toolbar de página (estilo Adobe Scan: con "Texto" = OCR,
              como "Editar texto" del video de referencia) */}
          <nav className="grid grid-cols-6 gap-1 px-2 pt-1" aria-label="Acciones de la página">
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
        <DrawerPrimitive.Root open={ocrOpen} onOpenChange={setOcrOpen}>
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
                    <div className="no-scrollbar max-h-[38vh] overflow-y-auto rounded-xl bg-black/40 p-3.5 ring-1 ring-inset ring-white/10">
                      <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-white/90">
                        {page.ocrText}
                      </p>
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

/** Item del toolbar de review (icono 24px + label 11px). */
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
      className="flex flex-col items-center gap-1 rounded-xl px-1 py-1.5 transition-opacity active:opacity-60"
    >
      <Icon
        className={cn(
          "h-6 w-6",
          danger ? "text-[#ff3b30]" : active ? "text-[#007aff]" : "text-[#8e8e93]"
        )}
        strokeWidth={active ? 2.2 : 1.8}
      />
      <span
        className={cn(
          "text-[11px]",
          danger
            ? "text-[#ff3b30]/80"
            : active
              ? "font-medium text-[#007aff]"
              : "text-[#8e8e93]"
        )}
      >
        {label}
      </span>
    </button>
  );
}
