"use client";

/**
 * PANTALLA 2 — EDITOR (post-captura, fondo NEGRO puro).
 * Clon pixel-perfect del diseño 2 del usuario (design-specs.md):
 *
 * - Top bar: "< Editor" + pill "Continuar ✓" (#007AFF).
 * - Miniatura flotante circular 80x80 "ORIGINAL" (top-right, bajo Continuar).
 * - Preview central aspect-fit con marco de perspectiva #007AFF arrastrable:
 *   4 handles de esquina (22px) + 4 handles de punto medio (12px) con pointer
 *   events. El overlay vive dentro de un contenedor que rota junto a la imagen,
 *   de modo que el quad siempre se dibuja en coordenadas de la imagen original.
 * - Badge "Bordes detectados" (2s, con fade) cerca del vértice superior-izquierdo.
 * - Botón "Detección automática" (recalcula con transición suave).
 * - Carrusel de miniaturas de páginas (si hay más de una).
 * - Toolbar inferior de 2 filas (Retocar bordes / Rotar / Limpiar / Filtros +
 *   Repetir / Seguir escaneando / Guardar ✓) + home indicator.
 * - Sheet de filtros con vaul, portaleado dentro del marco del teléfono.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Drawer as DrawerPrimitive } from "vaul";
import {
  Check,
  ChevronLeft,
  Crop,
  Loader2,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  Wand2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { nextId, useScannerStore } from "@/lib/scanner/store";
import {
  detectDocumentEdges,
  evaluateQuality,
  generateDemoPage,
  loadImage,
} from "@/lib/scanner/image-processor";
import {
  FILTER_PRESETS,
  defaultQuad,
} from "@/lib/scanner/types";
import type { CapturePage, PageFilter, Point, Quad } from "@/lib/scanner/types";
import { cn } from "@/lib/utils";
import { SaveSuccessOverlay } from "@/components/scanner/SaveSuccessOverlay";

/** Aproximación CSS de cada filtro para las previews en vivo. */
const CSS_FILTERS: Record<PageFilter, string> = {
  original: "none",
  auto: "contrast(1.06) brightness(1.05) saturate(1.05)",
  natural: "brightness(1.07) contrast(1.03) saturate(1.02)",
  color: "saturate(1.4) brightness(1.03)",
  grayscale: "grayscale(1)",
  blackwhite: "grayscale(1) contrast(2.4) brightness(1.05)",
  whiteboard: "brightness(1.2) contrast(1.5) saturate(0.85)",
  document: "contrast(1.35) brightness(1.1) grayscale(0.15)",
};

const TWEEN_MS = 280;

function clampN(v: number) {
  return Math.min(0.98, Math.max(0.02, v));
}

function quadsClose(a: Quad, b: Quad) {
  return a.every(
    (p, i) => Math.abs(p.x - b[i].x) < 5e-4 && Math.abs(p.y - b[i].y) < 5e-4
  );
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
  const openDocument = useScannerStore((s) => s.openDocument);
  const saveSessionAsDocument = useScannerStore((s) => s.saveSessionAsDocument);
  const startBatchDocument = useScannerStore((s) => s.startBatchDocument);
  const batchSavedCount = useScannerStore((s) => s.batchSavedCount);

  const page: CapturePage | undefined =
    capturePages[editingIndex] ?? capturePages[capturePages.length - 1];
  const activeIdx = page ? capturePages.indexOf(page) : -1;

  // ── Estado local ─────────────────────────────────────────────────────────
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [displayQuad, setDisplayQuad] = useState<Quad>(
    () => page?.quad ?? defaultQuad()
  );
  const [edgeMode, setEdgeMode] = useState(true);
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

  // ── Medición del contenedor del preview (ResizeObserver) ─────────────────
  useEffect(() => {
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
  }, []);

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
  }, [activeIdx]);

  // ── Geometría del preview ────────────────────────────────────────────────
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
    },
    [page]
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
    },
    [pointerToNormalized]
  );

  const onContainerPointerUp = useCallback(() => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    draggingRef.current = false;
    if (page) {
      manualIds.current.add(page.id);
      updateCapturePage(page.id, { quad: displayRef.current, quadManual: true });
    }
  }, [page, updateCapturePage]);

  // ── Acciones ─────────────────────────────────────────────────────────────
  const handleRotate = () => {
    if (!page) return;
    updateCapturePage(page.id, { rotation: (page.rotation + 90) % 360 });
  };

  const handleClean = () => {
    if (!page) return;
    updateCapturePage(page.id, { filter: "whiteboard" });
    toast.success("Limpieza aplicada");
  };

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
    toast.success(`Filtro aplicado: ${label}`);
    setFiltersOpen(false);
  };

  const handleRepeat = () => {
    if (page) removeCapturePage(page.id);
    setView("camera");
  };

  /** Procesa TODAS las páginas de la sesión, guarda el documento, muestra
   *  el overlay de éxito (check dibujado) y navega a la Digitalización. */
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
  }, [saving, savedInfo]);

  /** Al cerrarse el overlay de éxito → navega a la Digitalización. */
  const finishSave = useCallback(() => {
    const info = savedInfoRef.current;
    setSavedInfo(null);
    if (info) openDocument(info.docId);
  }, [openDocument]);

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

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="relative flex h-full w-full flex-col bg-black">
      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <header className="relative z-20 flex shrink-0 items-center justify-between px-4 pb-2 pt-safe">
        <button
          type="button"
          aria-label="Volver a la cámara"
          onClick={() => setView("camera")}
          className="flex items-center gap-0.5 rounded-lg py-1 pr-2 text-white transition-opacity active:opacity-60"
        >
          <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2.5} />
          <span className="text-[17px] font-semibold tracking-tight">Editor</span>
        </button>
        <motion.button
          type="button"
          whileTap={{ scale: 0.95 }}
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-full bg-[#007aff] px-4 py-[7px] text-[15px] font-semibold text-white shadow-[0_4px_14px_rgba(0,122,255,0.35)] disabled:opacity-60"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" strokeWidth={3} />
          )}
          Continuar
        </motion.button>
      </header>

      {/* ── Preview central ──────────────────────────────────────────────── */}
      <section
        aria-label="Vista previa de la página"
        className="relative min-h-0 flex-1 px-4"
      >
        <div
          ref={containerRef}
          onPointerMove={onContainerPointerMove}
          onPointerUp={onContainerPointerUp}
          onPointerCancel={onContainerPointerUp}
          className="flex h-full w-full items-center justify-center"
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

                {/* Handles de punto medio (aristas) — arrastrables */}
                {edgeMode &&
                  displayQuad.map((p, i) => {
                    const q = displayQuad[(i + 1) % 4];
                    return (
                      <button
                        key={`mid-${i}`}
                        type="button"
                        aria-label={`Punto medio de la arista ${i + 1}`}
                        onPointerDown={(e) => onHandleDown(e, "mid", i)}
                        className="absolute z-10 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border-[1.5px] border-[#007aff] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.4)] outline-none transition-transform active:cursor-grabbing active:scale-125"
                        style={{
                          left: `${((p.x + q.x) / 2) * 100}%`,
                          top: `${((p.y + q.y) / 2) * 100}%`,
                          width: 12,
                          height: 12,
                        }}
                      />
                    );
                  })}

                {/* Handles de esquina — arrastrables */}
                {displayQuad.map((p, i) => (
                  <button
                    key={`corner-${i}`}
                    type="button"
                    aria-label={`Vértice ${i + 1} del marco`}
                    onPointerDown={(e) => onHandleDown(e, "corner", i)}
                    className="absolute z-10 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border-2 border-[#007aff] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.4)] outline-none transition-[width,height] duration-200 active:cursor-grabbing"
                    style={{
                      left: `${p.x * 100}%`,
                      top: `${p.y * 100}%`,
                      width: edgeMode ? 26 : 22,
                      height: edgeMode ? 26 : 22,
                    }}
                  >
                    {edgeMode && (
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
                    )}
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
        </div>

        {/* Miniatura flotante "ORIGINAL" (80x80, bajo el botón Continuar) */}
        {page && (
          <div
            aria-label="Original de la página"
            className="absolute right-2 top-2 z-20 h-20 w-20 overflow-hidden rounded-full shadow-[0_6px_18px_rgba(0,0,0,0.45)] ring-1 ring-white/15"
          >
            <img
              src={page.original}
              alt=""
              draggable={false}
              className="h-full w-full object-cover"
            />
            <span className="absolute inset-x-0 bottom-0 bg-black/55 py-[3px] text-center text-[10px] font-semibold tracking-[0.08em] text-white">
              ORIGINAL
            </span>
          </div>
        )}
      </section>

      {/* ── Detección automática ─────────────────────────────────────────── */}
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

      {/* ── Carrusel de páginas ──────────────────────────────────────────── */}
      {capturePages.length > 1 && (
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
              onClick={() => setEditingIndex(i)}
              className={cn(
                "relative h-16 w-12 shrink-0 overflow-hidden rounded-lg border-2 transition-transform active:scale-95",
                i === activeIdx
                  ? "border-[#007aff] shadow-[0_0_0_3px_rgba(0,122,255,0.25)]"
                  : "border-white/15"
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

      {/* ── Bottom toolbar (2 filas) ─────────────────────────────────────── */}
      <div className="relative z-10 shrink-0 bg-black pb-safe">
        {/* Fila 1 */}
        <div className="grid grid-cols-4 gap-1 px-3">
          <ToolItem
            icon={Crop}
            label="Retocar bordes"
            active={edgeMode}
            onClick={() => setEdgeMode((v) => !v)}
          />
          <ToolItem icon={RotateCw} label="Rotar" onClick={handleRotate} />
          <ToolItem icon={Wand2} label="Limpiar" onClick={handleClean} />
          <ToolItem
            icon={SlidersHorizontal}
            label="Filtros"
            onClick={() => setFiltersOpen(true)}
          />
        </div>

        {/* Fila 2 */}
        <div className="flex items-center justify-between px-6 pb-2 pt-1.5">
          <button
            type="button"
            onClick={handleRepeat}
            className="rounded-lg px-2 py-1.5 text-[15px] font-medium text-[#ff3b30] transition-opacity active:opacity-60"
          >
            Repetir
          </button>
          <button
            type="button"
            onClick={() => setView("camera")}
            className="rounded-lg px-2 py-1.5 text-[15px] font-medium text-white transition-opacity active:opacity-60"
          >
            Seguir escaneando
          </button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-full bg-[#007aff] px-5 py-2 text-[15px] font-semibold text-white shadow-[0_4px_14px_rgba(0,122,255,0.35)] disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" strokeWidth={3} />
            )}
            Guardar
          </motion.button>
        </div>

        <div className="home-indicator mb-1.5 mt-0.5" aria-hidden="true" />
      </div>

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
                Procesando y guardando…
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
            batchCount={batchSavedCount + 1}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** Item de la fila 1 del toolbar (icono 24px + label 11px). */
function ToolItem({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
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
        className={cn("h-6 w-6", active ? "text-[#007aff]" : "text-[#8e8e93]")}
        strokeWidth={active ? 2.2 : 1.8}
      />
      <span
        className={cn(
          "text-[11px]",
          active ? "font-medium text-[#007aff]" : "text-[#8e8e93]"
        )}
      >
        {label}
      </span>
    </button>
  );
}
