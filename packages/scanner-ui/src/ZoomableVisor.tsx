"use client";

/**
 * ZOOMABLE VISOR — capa React de la base de digitalización (@jg-stevan/scanner-ui).
 *
 * Máquina de gestos PROBADA en táctil real, portada del stage F-ZOOM del lab
 * de digitalización (pinza anclada al punto · pan con clamps contra el STAGE ·
 * doble toque 2.5× · rueda no-pasiva · comparación por pulsación larga —
 * FIX v3/v6/v8 incluidos) + modo card (ZOOM-INLINE: techo 3×, tap diferido,
 * sin chrome). Componente PURO (props + callbacks): cero store, cero red,
 * cero lógica de motor (esa vive en @jg-stevan/scanner-core).
 *
 * Mapa de portada (stage del lab → aquí):
 *   · Constantes ZOOM_MIN/ZOOM_MAX/ZOOM_DOUBLE_TAP + TAP_SLOP +
 *     COMPARE_HOLD_MS — LITERAL.
 *   · Estado zoom: refs + useMotionValue + zoomPct + zoomPointers +
 *     zoomGesture + zoomDownAt + zoomLastTap — LITERAL.
 *   · clampZoomPan — LITERAL (FIX v3 1.3: clamps contra el STAGE, no solo
 *     la imagen).
 *   · commitZoomScale / resetZoom — LITERAL; reset al cambiar `src`
 *     (equivalente al cambio de página del lab).
 *   · Guard touchmove no pasivo del stage (FIX v8 8.1) — LITERAL; deps []
 *     (el stage monta/desmonta con el propio componente).
 *   · zoomRelToCenter · zoomAtPoint — LITERAL.
 *   · onStagePointerDown — STRIP del bloque DIAG de telemetría del lab
 *     (tooling del lab, no del paquete); guard closest("button") +
 *     setPointerCapture try/catch + arranque de comparación intactos.
 *   · onStagePointerMove — pinch LITERAL; rama 1× ADAPTADA: sin carrusel el
 *     umbral TAP_SLOP cancela la comparación pendiente y retorna (a 1× no
 *     hay pan); CON `carousel` corre F-SWIPE (decisión de eje + goma
 *     elástica, LITERAL del lab).
 *   · onStagePointerUp — LITERAL; con `carousel` resuelve el swipe del lab
 *     (distancia mínima + muelle con animate). El tap limpio (cleanTap)
 *     alimenta el doble toque y el tap diferido (modal/card).
 *   · onStageWheel + listener nativo {passive:false} — LITERAL menos el
 *     DIAG (B10: el onWheel de React es pasivo).
 *   · JSX stage/wrapper/img/overlay/chip/hint — estructura LITERAL con la
 *     estética UNIVERSAL del lab (clases estándar + hex arbitrarios que
 *     Tailwind compila en cualquier consumidor).
 *
 * ZOOM-INLINE — MODO `card`: el MISMO componente monta inline en la tarjeta
 * del consumidor. La máquina de gestos (pinza/pan/clamps/rueda/FIX v3-v6-v8)
 * se reutiliza sin cambios — la geometría es agnóstica al contenedor. Solo
 * cambian: techo del zoom (ZOOM_MAX_CARD=3), stage relativo con clip de
 * esquinas de la tarjeta, chrome FUERA (chip %, hint y comparación NO se
 * montan — la tarjeta queda limpia; el fullscreen conserva los suyos) y la
 * semántica del TAP: a 1× abre fullscreen DIFERIDO DOBLE_TOQUE_MS (la
 * ventana del doble toque — si llega el 2º toque, es zoom y NO abre: mismo
 * trade-off del cierre diferido del modal, estándar Fotos de iOS); ampliado,
 * el tap vuelve a 1× (también diferido por la misma ventana).
 *
 * DECISIÓN de cierre por toque (modal): el cierre directo por tap mataría el
 * zoom (el 1er toque de un doble toque cerraría). Regla adoptada:
 *   · tap sobre el ÁREA del stage FUERA de la imagen = tap-fuera → cierra
 *     INMEDIATO (onClose);
 *   · tap LIMPIO sobre la IMAGEN a 1× y sin arrastre → cierra PERO diferido
 *     DOBLE_TOQUE_MS: si llega un 2º toque, es doble-toque (zoom 2.5×) y el
 *     cierre se cancela;
 *   · tap sobre un BOTÓN interno (chip Restablecer) → nunca cierra (guard
 *     closest("button"), conservado);
 *   · ampliado (>1×), tras arrastre/pinza o pulsación larga (comparación,
 *     ≥350 ms > ventana de 280 ms del cleanTap) → el toque NO cierra;
 *   · Esc/u otro cierre global los gestiona el consumidor.
 * Un pointerdown nuevo cancela el cierre diferido pendiente; el latch
 * post-pincha (rama «un dedo sigue») trata el dedo restante como
 * interactivo para que levantar una pinza nunca cierre el visor.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { AnimatePresence, animate, motion, useMotionValue } from "framer-motion";

/** F-ZOOM — límites del zoom del visor. */
const ZOOM_MIN = 1;
const ZOOM_MAX = 6;
/** ZOOM-INLINE — techo del zoom en la TARJETA (1×–3×; el modal conserva 6×). */
const ZOOM_MAX_CARD = 3;
const ZOOM_DOUBLE_TAP = 2.5;
/** Umbral de movimiento (px) para distinguir arrastre de toque. */
const TAP_SLOP = 8;
/** F-SWIPE: distancia mínima (px) para navegar el carrusel al soltar. */
const SWIPE_MIN_PX = 56;
/** F-SWIPE: desplazamiento máximo de la goma elástica (px). */
const SWIPE_RUBBER = 72;
/** Mantener pulsado el visor (ms) antes de mostrar el original. */
const COMPARE_HOLD_MS = 350;
/** Ventana ÚNICA del doble toque Y del tap diferido — UNA fuente de verdad
 *  para zoomLastTap, el cierre del modal y la apertura del card. */
const DOBLE_TOQUE_MS = 320;

/** Glifo de ojo (inline — el paquete no depende de librerías de iconos). */
function GlyphEye({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export interface ZoomableVisorProps {
  /** Imagen visible (procesada). El zoom se reinicia al cambiar. */
  src: string;
  alt: string;
  /** Original — SOLO si difiere de src (comparación por pulsación larga).
   *  Se ignora en modo card (la comparación vive SOLO en fullscreen). */
  compareSrc?: string;
  /** "modal" (default: fullscreen, cierre por toque) o "card" (inline en la
   *  tarjeta del consumidor, sin chrome). */
  mode?: "modal" | "card";
  /** SOLO card: abrir pantalla completa (tap simple a 1×, diferido
   *  DOBLE_TOQUE_MS para no matar el doble toque). */
  onOpenFullscreen?: () => void;
  /** SOLO modal: cierre del fullscreen (tap-fuera/imagen a 1×). */
  onClose?: () => void;
  /** F-SWIPE opcional — carrusel del consumidor: swipe horizontal a 1× con
   *  goma elástica en los bordes; la navegación la decide el consumidor vía
   *  callbacks (el componente solo gestiona el gesto). */
  carousel?: {
    canPrev: boolean;
    canNext: boolean;
    onPrev: () => void;
    onNext: () => void;
  };
  /** Gate del hint didáctico (default true). El visor también lo oculta al
   *  ampliar; el consumidor puede apagarlo tras su primera muestra. */
  showHint?: boolean;
}

export function ZoomableVisor({
  src,
  alt,
  compareSrc,
  mode = "modal",
  onOpenFullscreen,
  onClose,
  carousel,
  showHint = true,
}: ZoomableVisorProps) {
  const esCard = mode === "card";
  // ── F-ZOOM — zoom del visor (pinza · pan · doble toque · rueda) ────────
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
  /** F-SWIPE: eje decidido del gesto actual (null = aún sin decidir). */
  const swipeAxisRef = useRef<null | "x" | "y">(null);

  // ── Tap diferido (mecanismo ÚNICO, ver cabecera) ───────────────────────
  /** Timer del tap diferido: modal → cierre por tap a 1× sobre la imagen;
   *  card → tap a 1× abre fullscreen · tap ampliado vuelve a 1×. Un
   *  pointerdown nuevo SIEMPRE cancela lo pendiente. */
  const deferredTapRef = useRef<number | null>(null);
  const cancelDeferredTap = useCallback(() => {
    if (deferredTapRef.current !== null) {
      window.clearTimeout(deferredTapRef.current);
      deferredTapRef.current = null;
    }
  }, []);
  /** Dónde nació el toque (pointerdown) — decide el cierre en pointerup. */
  const downOnImgRef = useRef(false);
  const downOnBtnRef = useRef(false);

  // ── Comparación antes/después (mantener pulsado el visor a 1×) ──────────
  const [comparing, setComparing] = useState(false);
  const compareTimer = useRef<number | null>(null);

  /** Hint de zoom: visible ~6 s al montar (didáctico, luego se va solo). */
  const [zoomHintVisible, setZoomHintVisible] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setZoomHintVisible(false), 6000);
    return () => window.clearTimeout(t);
  }, []);

  // ── Comparación antes/después ───────────────────────────────────────────
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
  useEffect(() => () => cancelDeferredTap(), [cancelDeferredTap]);

  /* ── F-ZOOM — gestos de ampliación del visor ──────────────────────────
   * Pinza (2 dedos) 1×–6× anclada al punto medio · pan con 1 dedo ampliado
   * (acotado a los bordes de la IMAGEN) · doble toque alterna 1× ↔ 2,5×
   * centrado en el punto · rueda del ratón en escritorio. El chip flotante
   * muestra el %. */
  const clampZoomPan = useCallback(() => {
    const s = zoomScale.get();
    const img = zoomImgRef.current;
    // FIX v3 (1.3): límites contra el STAGE, no solo contra la imagen — la
    // fórmula vieja ((imgW × (s−1))/2) permitía sobre-paneo cuando la
    // imagen era más pequeña que el stage en algún eje (huecos negros,
    // imagen «cortada» flotando). (imgW × s − stageW)/2 clava el borde de
    // la imagen al del stage cuando se tocan.
    const stage = zoomStageRef.current;
    let bx = 0;
    let by = 0;
    if (img && stage && s > 1) {
      bx = Math.max(0, (img.offsetWidth * s - stage.clientWidth) / 2);
      by = Math.max(0, (img.offsetHeight * s - stage.clientHeight) / 2);
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

  // El zoom se reinicia al cambiar de imagen (cambio de página/documento en
  // el consumidor — como Fotos de iOS).
  useEffect(() => {
    resetZoom();
  }, [src, resetZoom]);

  // FIX v8 (8.1) — cinturón y tirantes: WebKit puede quedar con el gesto
  // (rubber-band residual / heurística de doble toque) y disparar
  // pointercancel a mitad del pan con zoom aunque toda la cadena tenga
  // touch-none. Este listener no pasivo lo mata. Dentro del stage no hay
  // nada scrollable → preventDefault es seguro. Deps []: el stage vive lo
  // mismo que el componente.
  useEffect(() => {
    const stage = zoomStageRef.current;
    if (!stage) return;
    const onTouchMove = (e: TouchEvent) => e.preventDefault();
    stage.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => stage.removeEventListener("touchmove", onTouchMove);
  }, []);

  /** Coordenadas del puntero relativas al CENTRO del stage (ancla de zoom). */
  const zoomRelToCenter = useCallback((cx: number, cy: number) => {
    const rect = zoomStageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: cx - (rect.left + rect.width / 2), y: cy - (rect.top + rect.height / 2) };
  }, []);

  /** Escala a `next` manteniendo bajo el punto `px,py` (relativo al centro)
   *  el mismo contenido que había (fórmula clásica de zoom anclado).
   *  ZOOM-INLINE: techo efectivo — 3× en la tarjeta (ZOOM_MAX_CARD), 6× en
   *  el modal (ZOOM_MAX). */
  const zoomAtPoint = useCallback(
    (px: number, py: number, next: number) => {
      const s = zoomScale.get();
      const clamped = Math.min(esCard ? ZOOM_MAX_CARD : ZOOM_MAX, Math.max(ZOOM_MIN, next));
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
    [zoomScale, zoomX, zoomY, commitZoomScale, clampZoomPan, esCard]
  );

  const onStagePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const el = zoomStageRef.current;
      if (!el) return;
      // Un toque nuevo anula el tap diferido pendiente (modal: tap suelto a
      // 1× esperando la ventana del doble toque; card: apertura/reset
      // pendiente) — simétrico, mismo mecanismo.
      cancelDeferredTap();
      // F-NAV (lección táctil del lab): solo capturar cuando el down cae en
      // el propio stage — si cae en un hijo interactivo (botón/chip) su
      // click debe vivir. ZOOM-INLINE: en card NO hay hijos interactivos →
      // captura SIEMPRE (el guard closest("button") es del modal).
      const onInteractive = esCard
        ? false
        : !!(e.target as HTMLElement | null)?.closest?.("button");
      // Memo de dónde nació el toque — el pointerup decide el cierre.
      downOnBtnRef.current = onInteractive;
      downOnImgRef.current = !!(e.target as HTMLElement | null)?.closest?.("img");
      if (!onInteractive) {
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
        // Además SOLO si hay original que mostrar (compareSrc). ZOOM-INLINE:
        // en card la comparación NO corre (la tarjeta queda limpia — el
        // «comparar original» es SOLO de fullscreen).
        if (
          !esCard &&
          zoomScale.get() <= 1.01 &&
          (e.button === 0 || e.pointerType !== "mouse") &&
          !onInteractive &&
          compareSrc != null
        ) {
          startCompareTimer();
        }
      }
    },
    [zoomRelToCenter, endCompare, startCompareTimer, zoomScale, zoomX, zoomY, compareSrc, cancelDeferredTap, esCard]
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
        // A 1× el arrastre no panea: o navega el carrusel (F-SWIPE, si el
        // consumidor pasó `carousel`) o cancela la comparación pendiente.
        if (zoomScale.get() <= 1.01) {
          if (carousel) {
            // F-SWIPE: el arrastre HORIZONTAL navega el carrusel (con goma
            // elástica); el vertical sigue sin hacer nada (hold-comparar).
            // La decisión de eje se toma UNA vez por gesto.
            const down0 = zoomDownAt.current;
            if (!down0) return;
            const dx = e.clientX - down0.x;
            const dy = e.clientY - down0.y;
            if (swipeAxisRef.current === null) {
              if (Math.hypot(dx, dy) > TAP_SLOP) {
                // Claramente horizontal → swipe.
                swipeAxisRef.current =
                  Math.abs(dx) > Math.abs(dy) * 1.2 ? "x" : "y";
                if (swipeAxisRef.current === "x") endCompare();
              }
              return;
            }
            if (swipeAxisRef.current !== "x") return;
            let rubber = dx;
            if ((dx > 0 && !carousel.canPrev) || (dx < 0 && !carousel.canNext)) {
              rubber = dx * 0.25;
            }
            zoomX.set(Math.max(-SWIPE_RUBBER, Math.min(SWIPE_RUBBER, rubber * 0.55)));
            return;
          }
          const down0 = zoomDownAt.current;
          if (!down0) return;
          if (Math.hypot(e.clientX - down0.x, e.clientY - down0.y) > TAP_SLOP) {
            endCompare();
          }
          return;
        }
        const down = zoomDownAt.current;
        if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > TAP_SLOP) {
          zoomGesture.current = { ...g, type: "pan", startX: g.startX, startY: g.startY };
        }
        zoomX.set(g.startX + (e.clientX - (down?.x ?? e.clientX)));
        zoomY.set(g.startY + (e.clientY - (down?.y ?? e.clientY)));
        clampZoomPan();
      }
    },
    [zoomAtPoint, clampZoomPan, zoomScale, zoomX, zoomY, endCompare, carousel]
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
        // ¿Toque limpio (sin arrastre)? → posible doble toque.
        const cleanTap =
          down &&
          g?.type === "pan" &&
          Math.hypot(e.clientX - down.x, e.clientY - down.y) <= TAP_SLOP &&
          performance.now() - down.t < 280;
        if (cleanTap && !wasPinch) {
          const now = performance.now();
          if (now - zoomLastTap.current < DOBLE_TOQUE_MS) {
            // Doble toque: alterna 1× ↔ 2,5× centrado en el punto.
            zoomLastTap.current = 0;
            // Era el 2º toque — el tap diferido del 1º se cancela
            // (modal: el cierre; card: la apertura/reset).
            cancelDeferredTap();
            const p = zoomRelToCenter(e.clientX, e.clientY);
            if (zoomScale.get() > 1.01) resetZoom();
            else zoomAtPoint(p.x, p.y, ZOOM_DOUBLE_TAP);
          } else if (esCard) {
            // ZOOM-INLINE — semántica del TAP en la TARJETA (tap diferido):
            // a 1× abre fullscreen tras DOBLE_TOQUE_MS (si llega el 2º toque,
            // el doble toque lo cancela y hace zoom — NO abre); ampliado,
            // vuelve a 1× tras la MISMA ventana (tampoco abre).
            zoomLastTap.current = now;
            cancelDeferredTap();
            deferredTapRef.current = window.setTimeout(() => {
              deferredTapRef.current = null;
              if (zoomScale.get() > 1.01) resetZoom();
              else onOpenFullscreen?.();
            }, DOBLE_TOQUE_MS);
          } else {
            zoomLastTap.current = now;
            // DECISIÓN de cierre (modal): tap limpio a 1×. Sobre la IMAGEN:
            // cierre diferido DOBLE_TOQUE_MS (protege el doble toque). Sobre
            // el ÁREA del stage fuera de la imagen (tap-fuera): inmediato.
            // Sobre un botón interno o ampliado (>1×): nunca cierra.
            if (!downOnBtnRef.current && zoomScale.get() <= 1.01) {
              if (downOnImgRef.current) {
                cancelDeferredTap();
                deferredTapRef.current = window.setTimeout(() => {
                  deferredTapRef.current = null;
                  onClose?.();
                }, DOBLE_TOQUE_MS);
              } else {
                onClose?.();
              }
            }
          }
        }
        // F-SWIPE: resolver el deslizamiento horizontal (solo a 1×, con
        // carrusel del consumidor).
        if (carousel && swipeAxisRef.current === "x" && down && g?.type === "pan") {
          const dx = e.clientX - down.x;
          let nav = 0;
          if (zoomScale.get() <= 1.01 && Math.abs(dx) >= SWIPE_MIN_PX) {
            if (dx < 0 && carousel.canNext) nav = 1;
            else if (dx > 0 && carousel.canPrev) nav = -1;
          }
          if (nav !== 0) {
            // Página nueva: el consumidor navega; el zoom se reinicia con el
            // cambio de src.
            zoomX.set(0);
            if (nav < 0) carousel.onPrev();
            else carousel.onNext();
          } else {
            // Sin navegación: la vista vuelve a su sitio con muelle.
            void animate(zoomX, 0, { type: "spring", stiffness: 500, damping: 42 });
          }
        }
        swipeAxisRef.current = null;
      } else if (zoomPointers.current.size === 1) {
        // Un dedo sigue en pantalla tras la pincha → pasa a pan desde aquí.
        // Se marca como "interactivo" para que levantar la pinza no dispare
        // el cierre por toque (latch post-pincha).
        const [a] = [...zoomPointers.current.values()];
        downOnBtnRef.current = true;
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
    [clampZoomPan, endCompare, zoomRelToCenter, zoomAtPoint, resetZoom, zoomScale, zoomX, zoomY, onClose, cancelDeferredTap, esCard, onOpenFullscreen, carousel]
  );

  /** Rueda del ratón (escritorio): zoom anclado al cursor. */
  const onStageWheel = useCallback(
    (e: WheelEvent) => {
      if (!e.deltaY) return;
      e.preventDefault();
      const p = zoomRelToCenter(e.clientX, e.clientY);
      const factor = Math.exp(-e.deltaY * 0.0016);
      zoomAtPoint(p.x, p.y, zoomScale.get() * factor);
    },
    [zoomRelToCenter, zoomAtPoint, zoomScale]
  );

  // B10: el `onWheel` de React es PASIVO (preventDefault = no-op) y el zoom
  // del navegador se colaba detrás del stage. Listener nativo {passive:false}.
  useEffect(() => {
    const el = zoomStageRef.current;
    if (!el) return;
    el.addEventListener("wheel", onStageWheel, { passive: false });
    return () => el.removeEventListener("wheel", onStageWheel);
  }, [onStageWheel]);

  const zoomed = zoomPct > 101;

  return (
    <div
      ref={zoomStageRef}
      /* ZOOM-INLINE: stage condicional — modal: absolute inset-0 (llena el
       * contenedor posicionado del consumidor, px-3); card: relativo h/w
       * completo con clip de esquinas (rounded-[14px]) — la imagen ampliada
       * NO se sale de la tarjeta (el clip lo pone el stage). */
      className={
        esCard
          ? "relative flex h-full w-full touch-none select-none items-center justify-center overflow-hidden rounded-[14px]"
          : "absolute inset-0 flex touch-none select-none items-center justify-center overflow-hidden px-3"
      }
      onPointerDown={onStagePointerDown}
      onPointerMove={onStagePointerMove}
      onPointerUp={onStagePointerUp}
      /* FIX v8 (8.2): leave SOLO para mouse — iOS dispara pointerleave espurios
       * a mitad del pan (recomposite del chip de zoom / capa will-change) y el
       * handler lo interpretaba como fin de gesto, matando el paneo. */
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") onStagePointerUp(e);
      }}
      onPointerCancel={onStagePointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <motion.div
        /* ZOOM-INLINE: SIN animación de entrada en card — la foto debe
         * aparecer al instante; el modal conserva su fade. */
        initial={esCard ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, ease: [0.65, 0, 0.35, 1] }}
        className="relative z-10 flex h-full w-full items-center justify-center overflow-hidden"
      >
        {/* Capa de zoom: scale/x/y por motion values. FIX v3 (1.5):
            will-change SOLO durante el gesto — una capa GPU con will-change
            permanente puede quedar rasterizada a baja resolución en iOS
            Safari (imagen suave/borrosa al ampliar). A 1× la capa se
            des-promociona. */}
        <motion.div
          ref={zoomWrapRef}
          style={{ scale: zoomScale, x: zoomX, y: zoomY, willChange: zoomed ? "transform" : "auto" }}
          /* FIX v6 (6.3): touch-none también en el WRAPPER del pan —
           * WebKit solo respeta el touch-action del elemento donde NACE el
           * toque, no el de los ancestros. */
          className="flex h-full w-full touch-none items-center justify-center"
        >
          <img
            ref={zoomImgRef}
            src={src}
            alt={alt}
            draggable={false}
            /* FIX v6 (6.3): el toque nace en el <img> — sin su touch-none,
             * Safari dispara pointercancel al iniciar el arrastre y el paneo
             * con zoom no responde al dedo. */
            /* ZOOM-INLINE: en card SIN rounded ni sombra — el clip y la
             * estética los pone la tarjeta; el modal conserva los suyos. */
            className={
              esCard
                ? "max-h-full max-w-full touch-none select-none object-contain"
                : "max-h-full max-w-full touch-none select-none rounded-[6px] object-contain shadow-[0_18px_60px_rgba(0,0,0,0.65)]"
            }
          />
          {/* Comparación antes/después: el ORIGINAL mientras se mantiene pulsado.
              ZOOM-INLINE: SOLO fullscreen — en card NO se monta. */}
          {!esCard && (
            <AnimatePresence>
              {comparing && compareSrc && (
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
                  src={compareSrc}
                  alt=""
                  draggable={false}
                  /* FIX v6 (6.3): mismo touch-none — al comparar, ESTE img
                   * cubre al del visor y el toque nace en él. */
                  className="max-h-full max-w-full touch-none select-none rounded-[6px] object-contain shadow-[0_18px_60px_rgba(0,0,0,0.65)]"
                />
                {/* Pill del original — estética universal del lab. */}
                <span className="absolute left-1/2 top-3 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-white/95 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[#1c1c1e] shadow-[0_2px_10px_rgba(0,0,0,0.35)] backdrop-blur-md">
                  <GlyphEye className="h-3.5 w-3.5" />
                  Original
                </span>
              </motion.div>
              )}
            </AnimatePresence>
          )}
        </motion.div>
      </motion.div>

      {/* F-ZOOM — chip de zoom con % y botón de reinicio (patrón Fotos).
          ZOOM-INLINE: SOLO fullscreen — en card NO se monta (sin chip % ni
          RESTABLECER en la tarjeta). */}
      {!esCard && (
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
      )}

      {/* Hint de zoom (una vez por montaje — 6 s; gate showHint del
          consumidor). ZOOM-INLINE: SOLO fullscreen — en card NO se monta. */}
      {!esCard && !zoomed && showHint && zoomHintVisible && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-6">
          <span className="rounded-full bg-black/45 px-3 py-1 text-[10.5px] font-medium text-white/70 backdrop-blur-md">
            {compareSrc
              ? "Pellizca para ampliar · mantén pulsado para ver el original"
              : "Pellizca para ampliar · doble toque = 2.5×"}
          </span>
        </div>
      )}
    </div>
  );
}
