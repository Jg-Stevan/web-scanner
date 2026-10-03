"use client";

/**
 * MODO PRESENTACIÓN — visor inmersivo a pantalla completa (patrón Fotos de iOS):
 * · Fondo negro puro, página centrada con object-contain.
 * · Pinza con dos dedos para ampliar (1×–6×), arrastrar para desplazar ampliado,
 *   doble toque para alternar 1× ↔ 2.5× centrado en el punto, rueda en escritorio.
 * · Deslizar horizontalmente (a 1×) cambia de página con slide direccional.
 * · Toque simple alterna el chrome (barras con degradado estilo iOS).
 * · Teclado: ←/→ páginas, +/- zoom, Escape cierra. El zoom se reinicia al
 *   cambiar de página y la panorámica se acota a los bordes de la imagen.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue } from "framer-motion";
import { ChevronLeft, ChevronRight, Eye, X } from "lucide-react";

import type { ScanPage } from "@/lib/scanner/types";

const IOS_EASE = [0.32, 0.72, 0, 1] as const;

/** Límites del zoom. */
const MIN_SCALE = 1;
const MAX_SCALE = 6;
const DOUBLE_TAP_SCALE = 2.5;
/** Umbral horizontal (px) para considerar un swipe de cambio de página. */
const SWIPE_THRESHOLD = 60;
/** Umbral de movimiento (px) bajo el cual un pointerup cuenta como toque. */
const TAP_SLOP = 8;

interface PointerState {
  x: number;
  y: number;
}

export function PresentationView({
  pages,
  title,
  initialIndex,
  onClose,
  onIndexChange,
}: {
  pages: ScanPage[];
  title: string;
  initialIndex: number;
  onClose: () => void;
  onIndexChange?: (index: number) => void;
}) {
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(0, initialIndex), pages.length - 1)
  );
  const [dir, setDir] = useState(0);
  const [chrome, setChrome] = useState(true);
  const [zoomPct, setZoomPct] = useState(100);
  const [hintVisible, setHintVisible] = useState(true);
  // Comparación antes/después: mantener pulsado (1×, un dedo) muestra la
  // foto ORIGINAL; al soltar vuelve al resultado procesado.
  const [comparing, setComparing] = useState(false);
  const compareTimerRef = useRef<number | null>(null);
  const comparingRef = useRef(false);
  useEffect(() => {
    comparingRef.current = comparing;
  }, [comparing]);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const imgWrapRef = useRef<HTMLDivElement | null>(null);

  // Zoom/pan como motion values (transform del wrapper de la página).
  const scale = useMotionValue(1);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  // Gestos: punteros activos + estado del gesto en curso.
  const pointers = useRef(new Map<number, PointerState>());
  const gesture = useRef<
    | null
    | {
        type: "pan" | "pinch";
        startScale: number;
        startDist: number;
        startX: number;
        startY: number;
        startMid: PointerState;
      }
  >(null);
  const downAt = useRef<{ x: number; y: number; t: number } | null>(null);
  /** F-NAV: true cuando el pointerdown cayó sobre un botón hijo (flechas /
   * miniaturas) — su click no debe contar como tap del stage (no alterna
   * el chrome ni dispara swipe). */
  const downOnChild = useRef(false);
  const lastTap = useRef(0);
  /** Toque simple diferido: espera 300 ms por si llega un doble toque. */
  const tapTimer = useRef<number | null>(null);
  const interacted = useRef(false);

  const totalPages = pages.length;
  const page = pages[index];

  /* ── Utilidades de geometría ─────────────────────────────────────────── */

  /** Coordenadas del puntero relativas al CENTRO del stage. */
  const relToCenter = useCallback((cx: number, cy: number): PointerState => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: cx - (rect.left + rect.width / 2), y: cy - (rect.top + rect.height / 2) };
  }, []);

  const clampPan = useCallback(() => {
    const el = imgWrapRef.current;
    const s = scale.get();
    let bx = 0;
    let by = 0;
    if (el && s > 1) {
      bx = Math.max(0, (el.offsetWidth * (s - 1)) / 2);
      by = Math.max(0, (el.offsetHeight * (s - 1)) / 2);
    }
    if (x.get() > bx) x.set(bx);
    if (x.get() < -bx) x.set(-bx);
    if (y.get() > by) y.set(by);
    if (y.get() < -by) y.set(-by);
  }, [scale, x, y]);

  /** Zoom manteniendo el punto `rel` (relativo al centro) fijo bajo el puntero. */
  const zoomAt = useCallback(
    (rel: PointerState, nextScale: number) => {
      const s0 = scale.get();
      const s1 = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
      if (s1 === s0) return;
      // punto de contenido bajo rel: c = (rel - t) / s0
      const cX = (rel.x - x.get()) / s0;
      const cY = (rel.y - y.get()) / s0;
      scale.set(s1);
      x.set(rel.x - cX * s1);
      y.set(rel.y - cY * s1);
      if (s1 === 1) {
        x.set(0);
        y.set(0);
      } else {
        clampPan();
      }
      setZoomPct(Math.round(s1 * 100));
      if (!interacted.current) {
        interacted.current = true;
        setHintVisible(false);
      }
    },
    [scale, x, y, clampPan]
  );

  /** Resetea el zoom a 1×. */
  const resetZoom = useCallback(() => {
    scale.set(1);
    x.set(0);
    y.set(0);
    setZoomPct(100);
  }, [scale, x, y]);

  /* ── Cambio de página ────────────────────────────────────────────────── */

  const goTo = useCallback(
    (next: number) => {
      if (next < 0 || next >= totalPages || next === index) return;
      setDir(next > index ? 1 : -1);
      resetZoom();
      setIndex(next);
      onIndexChange?.(next);
    },
    [index, totalPages, resetZoom, onIndexChange]
  );

  /* ── Teclado ─────────────────────────────────────────────────────────── */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowRight" && scale.get() === 1) {
        goTo(index + 1);
      } else if (e.key === "ArrowLeft" && scale.get() === 1) {
        goTo(index - 1);
      } else if (e.key === "+" || e.key === "=") {
        zoomAt({ x: 0, y: 0 }, scale.get() * 1.3);
      } else if (e.key === "-" || e.key === "_") {
        zoomAt({ x: 0, y: 0 }, scale.get() / 1.3);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, goTo, onClose, zoomAt, scale]);

  /* ── Pointer events: tap / doble tap / swipe / pan / pinch ───────────── */

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    // F-NAV: la captura mantiene los move/up llegando al stage aunque el
    // puntero salga del elemento — pero SOLO cuando el down es directamente
    // sobre el stage: si es sobre un botón hijo (flechas de página), la
    // captura robaría el click y la navegación no funcionaría.
    // Con punteros sintéticos/inactivos lanza → try/catch.
    if (e.target === e.currentTarget) {
      try {
        stageRef.current?.setPointerCapture?.(e.pointerId);
      } catch {
        /* los listeners del stage siguen recibiendo los eventos */
      }
    }
    const p = relToCenter(e.clientX, e.clientY);
    pointers.current.set(e.pointerId, p);
    downOnChild.current = e.target !== e.currentTarget;
    downAt.current = { x: p.x, y: p.y, t: Date.now() };

    // Comparación: solo con un dedo a escala 1× (pinza/pan la cancelan).
    if (pointers.current.size === 1 && scale.get() === 1) {
      if (compareTimerRef.current !== null) window.clearTimeout(compareTimerRef.current);
      compareTimerRef.current = window.setTimeout(() => {
        compareTimerRef.current = null;
        setComparing(true);
        navigator.vibrate?.(18);
      }, 300);
    } else {
      if (compareTimerRef.current !== null) {
        window.clearTimeout(compareTimerRef.current);
        compareTimerRef.current = null;
      }
      setComparing(false);
    }

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = {
        type: "pinch",
        startScale: scale.get(),
        startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        startX: x.get(),
        startY: y.get(),
        startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
    } else if (pointers.current.size === 1 && scale.get() > 1) {
      gesture.current = {
        type: "pan",
        startScale: scale.get(),
        startDist: 0,
        startX: x.get(),
        startY: y.get(),
        startMid: p,
      };
    } else {
      gesture.current = null;
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = relToCenter(e.clientX, e.clientY);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;

    // Un desplazamiento real antes del umbral cancela la comparación
    // (el gesto será swipe o pan).
    if (!g && pointers.current.size === 1 && !comparing) {
      const d = downAt.current;
      if (d && Math.hypot(p.x - d.x, p.y - d.y) > TAP_SLOP) {
        if (compareTimerRef.current !== null) {
          window.clearTimeout(compareTimerRef.current);
          compareTimerRef.current = null;
        }
      }
    }
    if (!g) return;

    if (g.type === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, g.startScale * (dist / g.startDist)));
      // Zoom anclado al punto de contenido que estaba bajo el midpoint inicial.
      const cX = (g.startMid.x - g.startX) / g.startScale;
      const cY = (g.startMid.y - g.startY) / g.startScale;
      scale.set(next);
      x.set(mid.x - cX * next);
      y.set(mid.y - cY * next);
      clampPan();
      if (next <= 1) {
        x.set(0);
        y.set(0);
      }
      setZoomPct(Math.round(next * 100));
      if (!interacted.current) {
        interacted.current = true;
        setHintVisible(false);
      }
    } else if (g.type === "pan") {
      x.set(g.startX + (p.x - g.startMid.x));
      y.set(g.startY + (p.y - g.startMid.y));
      clampPan();
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const wasPinch = gesture.current?.type === "pinch";
    // La comparación termina aquí: limpia el temporizador y (si estaba
    // activa) consume el gesto para no alternar el chrome con el release.
    if (compareTimerRef.current !== null) {
      window.clearTimeout(compareTimerRef.current);
      compareTimerRef.current = null;
    }
    const wasComparing = comparingRef.current;
    if (wasComparing) setComparing(false);
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      const g = gesture.current;
      gesture.current = null;

      // Resorte de vuelta a 1× si el zoom quedó por debajo.
      if (scale.get() < 1) resetZoom();
      if (scale.get() === 1) {
        x.set(0);
        y.set(0);
      }
      clampPan();

      const d = downAt.current;
      downAt.current = null;
      if (!d || wasPinch || wasComparing || downOnChild.current) return;

      const p = relToCenter(e.clientX, e.clientY);
      const moved = Math.hypot(p.x - d.x, p.y - d.y);
      const elapsed = Date.now() - d.t;

      // Un arrastre real (pan con movimiento) no cuenta como toque.
      if (g?.type === "pan" && moved > TAP_SLOP) return;

      if (moved <= TAP_SLOP && elapsed < 350) {
        // ¿Doble toque?
        const now = Date.now();
        if (now - lastTap.current < 300) {
          lastTap.current = 0;
          if (tapTimer.current !== null) {
            window.clearTimeout(tapTimer.current);
            tapTimer.current = null;
          }
          if (scale.get() > 1) {
            resetZoom();
          } else {
            zoomAt(d, DOUBLE_TAP_SCALE);
          }
          return;
        }
        lastTap.current = now;
        // Toque simple: alterna el chrome tras la ventana de doble toque.
        if (tapTimer.current !== null) window.clearTimeout(tapTimer.current);
        tapTimer.current = window.setTimeout(() => {
          tapTimer.current = null;
          setChrome((c) => !c);
        }, 310);
        return;
      }

      // Swipe horizontal a 1× → cambio de página.
      if (scale.get() === 1 && elapsed < 600 && Math.abs(p.x - d.x) > SWIPE_THRESHOLD) {
        const horizontal = Math.abs(p.x - d.x) > Math.abs(p.y - d.y) * 1.3;
        if (horizontal) {
          if (p.x - d.x < 0) goTo(index + 1);
          else goTo(index - 1);
        }
      }
    } else if (pointers.current.size === 1 && gesture.current?.type === "pinch") {
      // Un dedo quedó tras la pinza → pasa a pan.
      const [p] = [...pointers.current.values()];
      gesture.current = {
        type: "pan",
        startScale: scale.get(),
        startDist: 0,
        startX: x.get(),
        startY: y.get(),
        startMid: p,
      };
    }
  };

  /* ── Rueda (escritorio) ──────────────────────────────────────────────── */

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rel = relToCenter(e.clientX, e.clientY);
      const factor = Math.exp(-e.deltaY * 0.0016);
      zoomAt(rel, scale.get() * factor);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
     
  }, [zoomAt, scale]);

  // Limpieza defensiva al desmontar (pointers y temporizadores no sobreviven).
  useEffect(
    () => () => {
      pointers.current.clear();
      if (tapTimer.current !== null) window.clearTimeout(tapTimer.current);
      if (compareTimerRef.current !== null) window.clearTimeout(compareTimerRef.current);
    },
    []
  );

  if (!page) return null;

  const showPrev = index > 0;
  const showNext = index < totalPages - 1;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
      className="absolute inset-0 z-[80] flex flex-col bg-black select-none"
      role="dialog"
      aria-modal="true"
      aria-label={`Modo presentación: ${title}`}
    >
      {/* ── Stage (zona de gestos) ─────────────────────────────────────── */}
      <div
        ref={stageRef}
        className="relative flex-1 cursor-zoom-in touch-none overflow-hidden"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <AnimatePresence mode="popLayout" custom={dir} initial={false}>
          <motion.div
            key={page.id}
            custom={dir}
            initial={{ x: dir === 0 ? 0 : dir * 80, opacity: dir === 0 ? 1 : 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: dir === 0 ? 0 : -dir * 80, opacity: 0 }}
            transition={{ duration: 0.24, ease: IOS_EASE }}
            className="absolute inset-0 flex items-center justify-center p-4"
          >
            <motion.div
              ref={imgWrapRef}
              style={{ scale, x, y, willChange: "transform" }}
              className="relative flex max-h-full max-w-full items-center justify-center"
            >
              <img
                src={page.processed}
                alt={`Página ${index + 1} de ${totalPages} de ${title}`}
                draggable={false}
                className="max-h-full max-w-full rounded-sm object-contain shadow-[0_8px_40px_rgba(0,0,0,0.6)]"
              />
              {/* Overlay ORIGINAL (comparación antes/después) */}
              <AnimatePresence>
                {comparing && (
                  <motion.div
                    key="pres-compare"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.14 }}
                    className="absolute inset-0 flex items-center justify-center"
                    aria-hidden="true"
                  >
                    <img
                      src={page.original}
                      alt=""
                      draggable={false}
                      className="max-h-full max-w-full rounded-sm object-contain shadow-[0_8px_40px_rgba(0,0,0,0.6)]"
                    />
                    <span className="absolute -top-1 left-1/2 inline-flex -translate-x-1/2 -translate-y-full items-center gap-1.5 rounded-full bg-white/95 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[#1c1c1e] shadow-[0_2px_10px_rgba(0,0,0,0.35)] backdrop-blur-md">
                      <Eye className="size-3.5" strokeWidth={2.4} />
                      Original
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        </AnimatePresence>

        {/* Indicador de zoom (solo ampliado) */}
        <AnimatePresence>
          {zoomPct > 100 && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-white backdrop-blur-md"
            >
              {zoomPct}%
            </motion.div>
          )}
        </AnimatePresence>

        {/* Flechas de navegación — F-NAV: SIEMPRE visibles (también en
            móvil); antes solo aparecían en escritorio y navegar en el teléfono
            era incómodo (había que hacer swipe impreciso). Touch target 44px. */}
        {totalPages > 1 && (
          <>
            <button
              type="button"
              aria-label="Página anterior"
              onClick={() => goTo(index - 1)}
              disabled={!showPrev}
              className={`absolute left-1.5 top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition-all active:scale-90 active:bg-black/70 ${
                showPrev ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
            >
              <ChevronLeft className="size-6" strokeWidth={2.6} />
            </button>
            <button
              type="button"
              aria-label="Página siguiente"
              onClick={() => goTo(index + 1)}
              disabled={!showNext}
              className={`absolute right-1.5 top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition-all active:scale-90 active:bg-black/70 ${
                showNext ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
            >
              <ChevronRight className="size-6" strokeWidth={2.6} />
            </button>
          </>
        )}

        {/* Hint inicial */}
        <AnimatePresence>
          {hintVisible && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ delay: 0.6 }}
              className="pointer-events-none absolute bottom-[86px] left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/45 px-3.5 py-1.5 text-[11px] font-medium text-white/85 backdrop-blur-md"
            >
              Pellizca para ampliar · desliza o usa las flechas para cambiar de página
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* ── Chrome superior (auto-ocultable) ───────────────────────────── */}
      <AnimatePresence>
        {chrome && (
          <motion.header
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.22, ease: IOS_EASE }}
            className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/70 to-transparent px-3 pb-8 pt-safe"
          >
            <div className="pointer-events-auto flex h-11 items-center justify-between gap-2">
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar modo presentación"
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md transition-transform active:scale-90"
              >
                <X className="size-5" strokeWidth={2.4} />
              </button>
              <div className="flex min-w-0 flex-col items-center">
                <span className="truncate text-[14px] font-semibold text-white">
                  {title}
                </span>
                <span className="text-[11px] tabular-nums text-white/60">
                  {index + 1} de {totalPages}
                </span>
              </div>
              <span className="w-9 shrink-0" aria-hidden="true" />
            </div>
          </motion.header>
        )}
      </AnimatePresence>

      {/* ── Chrome inferior: MINIATURAS de páginas (F-NAV — antes solo puntos,
          saltar a una página concreta era imposible en móvil) ──────────── */}
      <AnimatePresence>
        {chrome && (
          <motion.footer
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 14 }}
            transition={{ duration: 0.22, ease: IOS_EASE }}
            className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 to-transparent px-3 pb-safe pt-10"
          >
            <div
              className="pointer-events-auto no-scrollbar mx-auto flex max-w-full items-center gap-2 overflow-x-auto pb-3"
              role="tablist"
              aria-label="Páginas del documento"
            >
              {pages.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={i === index}
                  aria-label={`Ir a la página ${i + 1}`}
                  onClick={() => goTo(i)}
                  className={`relative h-[52px] w-[40px] shrink-0 overflow-hidden rounded-md border-2 transition-all duration-200 active:scale-95 ${
                    i === index
                      ? "border-[#0a84ff] shadow-[0_0_0_2px_rgba(10,132,255,0.35)]"
                      : "border-white/20 opacity-60 hover:opacity-90"
                  }`}
                >
                  <img
                    src={p.thumbnail || p.processed}
                    alt=""
                    draggable={false}
                    className="h-full w-full object-cover"
                  />
                  <span
                    className={`absolute bottom-0 right-0 flex h-[15px] min-w-[15px] items-center justify-center rounded-tl-[4px] px-[3px] text-[9px] font-bold tabular-nums ${
                      i === index ? "bg-[#0a84ff] text-white" : "bg-black/65 text-white/85"
                    }`}
                  >
                    {i + 1}
                  </span>
                </button>
              ))}
            </div>
          </motion.footer>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
