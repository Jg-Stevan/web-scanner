"use client";

/**
 * QUAD EDITOR (§7.5, D19 rev.2) — COPIA del subsistema CROP del lab
 * (apps/scanner-lab/src/components/scanner/EditorView.tsx, ~2.554 líneas):
 * NO se re-inventa; se copia el subsistema de recorte PROBADO en táctil real
 * y se re-veste con la estética Precision Monitor (ok-tint / surface tokens /
 * font-data). Fuera de la copia (fuera de alcance del modelo de 1 acta):
 * zoom 1×–6×, sheet OCR, sheet de filtros (drawer), modo DOC multi-página,
 * carrusel de miniaturas.
 *
 * Mapa de copia aplicado (SPEC §7.5):
 *   · clampN (L127) · loupeCenterAt (L135) · quadsClose (L143) — LITERAL.
 *   · Estado del editor: quad/drag/loupe (~L310–420, parte crop) — COPIA
 *     (mode desaparece: ReviewView lo monta con `editando: boolean`).
 *   · pointerToNormalized · updateLoupe · onHandleDown · onContainerPointerMove
 *     · onContainerPointerUp (~L950–1050) — LITERAL (React puro).
 *   · JSX asas 4 esquinas + 4 medios (~L2005–2040) — estructura COPIADA,
 *     re-vestida: #007AFF → tokens ok-tint; hit-area 44×44 como el origen.
 *   · Lupa 3× (~L2087–2130) — COPIADA, re-vestida (crosshair → warn).
 *   · Tween del quad (L39/L873–887, animador del lab) → REEMPLAZADO: el
 *     aterrizaje del quad corre por rAF propio del lab (easeOutCubic,
 *     TWEEN_MS=280) y las animaciones de contenedor/pulso pasan a CSS
 *     (~280 ms, keyframes en globals.css). e14 NO agrega la lib de animación.
 *   · D19: PROHIBIDO el store del core — el editor es PURO: recibe
 *     fotoOriginal/quadInicial/rotation y devuelve el quad por onAplicar(quad).
 *
 * UX-REAL F4 (SPEC-ux-real-bn-editor §F4, D37): ROTAR 90° y DETECCIÓN
 * AUTOMÁTICA dentro del editor — handleDetect del lab (EditorView.tsx
 * L1198–1212: detectDocumentEdges → quad) + botón pill L2123–2141 con
 * spinner mientras detecta. La rotación es LOCAL (rotLocal) y solo llega al
 * acta al APLICAR: onAplicar(quad, rotacion) (ReviewView → store).
 *
 * Convención de coordenadas (idéntica al lab + core): quad en fracciones
 * 0–1 de la imagen ORIGINAL sin rotar; processImage(fotoOriginal, quad,
 * filtro, rotation) aplica la rotación POST-warp — la misma convención
 * que F5-MANUAL respeta al píxel (sin refine). El overlay y las asas viven
 * en el div rotado → rotan solidariamente (el quad NO se remapea).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { detectDocumentEdges, loadImage } from "@jg-stevan/scanner-core/image-processor";
import { defaultQuad } from "@jg-stevan/scanner-core/types";
import type { Point, Quad } from "@jg-stevan/scanner-core/types";
import { RotateIcon, SparklesIcon } from "./icons";

/** Tween de aterrizaje del quad (lab TWEEN_MS — 280 ms). */
const TWEEN_MS = 280;

/** Lupa 3× durante el arrastre de un handle (puerto fiel del AdjustEditor F4:
 *  LOUPE_SCALE=3 + LOUPE_RADIUS=84 — la lupa aparece en el lado opuesto al
 *  dedo y el crosshair marca el punto de corte real, no el dedo). */
const LOUPE_SCALE = 3;
const LOUPE_RADIUS = 84;
const LOUPE_GAP = 14;

// ── Funciones puras del lab (L127–L147, LITERAL) ───────────────────────────

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

// ── Componente ──────────────────────────────────────────────────────────────

export interface QuadEditorProps {
  /** data URL cruda del acta (la fuente de verdad del recorte). */
  fotoOriginal: string;
  /** Esquinas de la detección automática (o defaultQuad() si no hubo). */
  quadInicial: Quad;
  /** 0|90|180|270 — horneada en fotoProcesada; el editor la aplica en CSS. */
  rotation: number;
  /** Descarta: cierra SIN tocar el acta (rotaciones/detecciones locales incluidas). */
  onCancelar: () => void;
  /** Aplica (F4/D37): entrega quad final + rotación LOCAL del editor —
   *  ReviewView → store.aplicarRecorte(quad, rotacion) hornea ambas. */
  onAplicar: (quad: Quad, rotacion: number) => void;
  /** true mientras el pipeline re-corre (botón APLICAR → "PROCESANDO…"). */
  aplicando?: boolean;
}

export function QuadEditor({
  fotoOriginal,
  quadInicial,
  rotation: rotationProp,
  onCancelar,
  onAplicar,
  aplicando = false,
}: QuadEditorProps) {
  // ── Estado local (lab ~L310–420, parte CROP) ─────────────────────────────
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [displayQuad, setDisplayQuad] = useState<Quad>(() => quadInicial);
  // F4/D37: rotación LOCAL (inicial = prop) — solo llega al acta al APLICAR;
  // DETECCIÓN AUTOMÁTICA mientras vuela (spinner del botón, patrón lab L2132-2135).
  const [rotLocal, setRotLocal] = useState(rotationProp);
  const [detectando, setDetectando] = useState(false);
  /** Mensaje inline de error de detección en el readout del header (~2 s) —
   *  `notificar` NO está disponible en el componente puro (D19). */
  const [mensajeReadout, setMensajeReadout] = useState<string | null>(null);
  /** Lupa 3× durante el arrastre: {x,y} = centro en coords del contenedor del
   *  preview; {fx,fy} = punto de corte en fracciones de la imagen ORIGINAL
   *  (sin rotar — la lupa siempre muestra los píxeles que se van a cortar). */
  const [loupe, setLoupe] = useState<{
    x: number;
    y: number;
    fx: number;
    fy: number;
  } | null>(null);
  /** Handle activo (para el readout font-data del header). */
  const [handleActivo, setHandleActivo] = useState<
    { kind: "corner" | "mid"; index: number } | null
  >(null);

  // ── Refs ─────────────────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const displayRef = useRef<Quad>(displayQuad);
  const rafRef = useRef(0);
  const draggingRef = useRef(false);
  const dragRef = useRef<{ kind: "corner" | "mid"; index: number } | null>(null);

  // F4/D37: la rotación del editor es LOCAL (rotLocal) — se hornea al APLICAR.
  const rotation = ((rotLocal % 360) + 360) % 360;

  // ── Dimensiones naturales (loadImage UNA vez — regla anti re-decodes 12MP) ─
  useEffect(() => {
    let cancelled = false;
    setNatural(null);
    loadImage(fotoOriginal)
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
  }, [fotoOriginal]);

  // ── Medición del contenedor (ResizeObserver, lab L810–826) ────────────────
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

  // ── Aterrizaje del quad inicial (tween del lab L873–887, rAF propio) ──────
  // El marco provisional (defaultQuad) interpola hacia la detección real en
  // ~280 ms con easeOutCubic — el reemplazo del tween animado del lab (D29).
  // F4 (§F4.3): el tween se EXTRAE a `animarQuadHacia` para reusarlo en
  // DETECCIÓN AUTOMÁTICA (misma curva, mismo feel que el aterrizaje).
  const animarQuadHacia = useCallback((target: Quad) => {
    cancelAnimationFrame(rafRef.current);
    const from = displayRef.current.map((p) => ({ x: p.x, y: p.y })) as Quad;
    if (quadsClose(from, target)) {
      displayRef.current = target;
      setDisplayQuad(target);
      return;
    }
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
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    const target = quadInicial;
    const from = defaultQuad();
    displayRef.current = from;
    setDisplayQuad(from);
    animarQuadHacia(target);
    return () => cancelAnimationFrame(rafRef.current);
  }, [quadInicial, animarQuadHacia]);

  // ── F4 (§F4.3) — DETECCIÓN AUTOMÁTICA: handleDetect del lab ───────────────
  // Fuente: apps/scanner-lab/src/components/scanner/EditorView.tsx L1198-1212
  // (detectDocumentEdges(page.original) → actualiza el quad). Sin store (D19):
  // el quad SOLO llega al acta al APLICAR; si falla → mensaje inline en el
  // readout del header ~2 s (prohibido alert; `notificar` no existe aquí).
  const detectar = useCallback(async () => {
    if (detectando || aplicando) return;
    setDetectando(true);
    try {
      const quad = await detectDocumentEdges(fotoOriginal);
      animarQuadHacia(quad);
    } catch {
      setMensajeReadout("NO SE PUDO DETECTAR");
      window.setTimeout(() => setMensajeReadout(null), 2000);
    } finally {
      setDetectando(false);
    }
  }, [detectando, aplicando, fotoOriginal, animarQuadHacia]);

  // ── Geometría del preview (lab L905–926) ─────────────────────────────────
  const swapped = rotation === 90 || rotation === 270;

  const fit = useMemo(() => {
    if (!natural || box.w < 8 || box.h < 8) return null;
    const dw = swapped ? natural.h : natural.w;
    const dh = swapped ? natural.w : natural.h;
    const scale = Math.min(box.w / dw, box.h / dh);
    return { w: dw * scale, h: dh * scale };
  }, [natural, box, swapped]);

  // El contenedor interior mantiene el aspecto natural y rota (CSS estático);
  // el exterior ocupa el hueco del aspecto ya rotado.
  const innerW = fit ? (swapped ? fit.h : fit.w) : 0;
  const innerH = fit ? (swapped ? fit.w : fit.h) : 0;

  const polygonPoints = useMemo(
    () =>
      displayQuad.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(" "),
    [displayQuad]
  );

  // ── Arrastre de handles (lab L928–1049, LITERAL) ─────────────────────────
  /** Convierte coordenadas de pantalla a coords normalizadas de la imagen
   *  (invirtiendo la rotación CSS del contenedor interior). */
  const pointerToNormalized = useCallback(
    (clientX: number, clientY: number): Point | null => {
      const el = innerRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return null;
      const r = rotation;
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
    [rotation]
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
      const r = rotation;
      const isSwapped = r === 90 || r === 270;
      // Dims display de la imagen SIN rotar (el div interior):
      const iw = isSwapped ? ir.height : ir.width;
      const ih = isSwapped ? ir.width : ir.height;
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
    [rotation]
  );

  const onHandleDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>, kind: "corner" | "mid", index: number) => {
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* algunos navegadores lanzan si el puntero ya se soltó */
      }
      dragRef.current = { kind, index };
      draggingRef.current = true;
      setHandleActivo({ kind, index });
      updateLoupe(displayRef.current, kind, index);
    },
    [updateLoupe]
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
    setHandleActivo(null);
    setLoupe(null);
    // (el lab persiste aquí al store del core; D19: e14 NO — el quad se
    // entrega al APLICAR y el acta solo cambia por store.aplicarRecorte).
  }, []);

  // ── Escape: cancela (lab L1185–1196) — bloqueado mientras aplica ──────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (aplicando) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onCancelar();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [aplicando, onCancelar]);

  // ── Readout del handle activo (font-data, Precision Monitor) ──────────────
  const puntoActivo = useMemo(() => {
    if (!handleActivo) return null;
    if (handleActivo.kind === "corner") return displayQuad[handleActivo.index];
    const a = displayQuad[handleActivo.index];
    const b = displayQuad[(handleActivo.index + 1) % 4];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }, [handleActivo, displayQuad]);

  return (
    <div
      role="dialog"
      aria-label="Ajuste de bordes del acta"
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex flex-col animate-editor-enter"
    >
      {/* Header propio del modo CROP (lab L1666–1691, re-vestido) */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-3 pt-safe pb-2">
        <button
          type="button"
          aria-label="Cancelar el ajuste de bordes"
          onClick={aplicando ? undefined : onCancelar}
          disabled={aplicando}
          className="rounded-lg px-3 py-1.5 font-data text-[11px] font-bold tracking-widest text-ink-dim bg-surface-2 border border-outline-dim/40 transition-all active:scale-95 disabled:opacity-40"
        >
          CANCELAR
        </button>
        <span className="font-data text-[11px] font-bold tracking-[0.2em] text-ink uppercase">
          Ajustar bordes
        </span>
        <span
          className={`font-data text-[10px] tracking-wider tabular-nums min-w-[92px] text-right ${
            mensajeReadout ? "text-crit" : "text-ok-tint"
          }`}
          aria-live={mensajeReadout ? "assertive" : "off"}
        >
          {mensajeReadout
            ? mensajeReadout
            : puntoActivo
              ? `X ${puntoActivo.x.toFixed(3)} · Y ${puntoActivo.y.toFixed(3)}`
              : "8 ASAS · 3×"}
        </span>
      </header>

      {/* ── CROP: editor de perspectiva (lab L1933–2121, re-vestido) ── */}
      <section aria-label="Ajuste de bordes de la página" className="relative min-h-0 flex-1 px-4 py-3">
        <div
          ref={containerRef}
          onPointerMove={onContainerPointerMove}
          onPointerUp={onContainerPointerUp}
          onPointerCancel={onContainerPointerUp}
          className="relative flex h-full w-full items-center justify-center"
        >
          {!fit || !natural ? (
            <div className="flex flex-col items-center gap-3" aria-label="Cargando imagen">
              <span className="block h-7 w-7 rounded-full border-[3px] border-line border-t-ok-tint animate-spin" />
              <span className="font-data text-[10px] tracking-widest text-ink-faint uppercase">
                Decodificando foto…
              </span>
            </div>
          ) : (
            <div
              className="relative shrink-0 rounded-sm shadow-[0_18px_60px_rgba(0,0,0,0.65)]"
              style={{ width: fit.w, height: fit.h }}
            >
              {/* Contenedor interior: aspecto natural + rotación (CSS — reemplazo
                  del motion.div rotado del lab). El overlay y los handles viven
                  aquí dentro, por lo que rotan solidariamente con la imagen. */}
              <div
                ref={innerRef}
                className="absolute left-1/2 top-1/2 select-none transition-transform duration-300"
                style={{
                  width: innerW,
                  height: innerH,
                  transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
                }}
              >
                <img
                  src={fotoOriginal}
                  alt="Foto original del acta en edición"
                  draggable={false}
                  className="block h-full w-full"
                />

                {/* Marco de perspectiva (coordenadas normalizadas 0-1) —
                    ok-tint en vez de #007aff */}
                <svg
                  className="pointer-events-none absolute inset-0 h-full w-full"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <polygon
                    points={polygonPoints}
                    fill="rgba(63,229,108,0.05)"
                    stroke="var(--color-ok-tint)"
                    strokeWidth={2.5}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>

                {/* Handles de punto medio (aristas) — arrastrables.
                    Pad táctil 44×44 (EDITOR_TOUCH_PX=44 del lab) con punto
                    visual pequeño — el dedo agarra bien sin tapar. */}
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
                      <span className="pointer-events-none block h-3 w-3 rounded-full border-[1.5px] border-ok-tint bg-white shadow-[0_1px_4px_rgba(0,0,0,0.4)]" />
                    </button>
                  );
                })}

                {/* Handles de esquina — arrastrables. Pad táctil 44×44 con el
                    punto visual pulsante dentro (pulso framer → CSS keyframe). */}
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
                    <span className="pointer-events-none relative block h-4 w-4 rounded-full border-2 border-ok-tint bg-white shadow-[0_2px_8px_rgba(0,0,0,0.4)]">
                      <span
                        aria-hidden="true"
                        className="absolute inset-0 rounded-full border-2 border-ok-tint animate-handle-pulse"
                      />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Lupa 3× durante el arrastre (lab L2087–2130, re-vestida) ──
              Círculo Ø168 en el lado opuesto al dedo; contenido = imagen
              ORIGINAL ampliada 3× (los píxeles que se van a cortar, sin
              rotar); crosshair ámbar = punto de corte real. */}
          {loupe && natural && fit ? (() => {
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
                  src={fotoOriginal}
                  alt=""
                  draggable={false}
                  className="absolute max-w-none select-none"
                  style={{
                    width: lw,
                    height: lh,
                    left: LOUPE_RADIUS - loupe.fx * lw,
                    top: LOUPE_RADIUS - loupe.fy * lh,
                  }}
                />
                {/* Crosshair: marca el punto de corte real (F4) — ámbar del tema */}
                <span className="absolute left-1/2 top-0 h-full w-[1.5px] -translate-x-1/2 bg-warn/95" />
                <span className="absolute left-0 top-1/2 h-[1.5px] w-full -translate-y-1/2 bg-warn/95" />
              </div>
            );
          })() : null}
        </div>
      </section>

      {/* Footer de confirmación — F4 (§F4.6): fila FIJA de ROTAR 90° +
          DETECCIÓN AUTOMÁTICA sobre el hint, mismo estilo del footer
          (border-outline-dim, font-data, alto táctil 44px). */}
      <footer className="shrink-0 border-t border-line bg-surface-1/90 backdrop-blur-md px-4 pt-2.5 pb-safe flex flex-col gap-1.5">
        <div className="flex gap-2">
          {/* F4 (§F4.2): rotación LOCAL — el quad NO se remapea (vive en
              fracciones de la imagen sin rotar; overlay rota solidario). */}
          <button
            type="button"
            aria-label="Rotar la imagen 90 grados"
            onClick={aplicando ? undefined : () => setRotLocal((r) => (r + 90) % 360)}
            disabled={aplicando}
            className="flex-1 min-w-0 h-11 rounded-xl bg-surface-4/90 hover:bg-surface-5 border border-outline-dim/40 font-data text-[10px] font-bold tracking-widest uppercase text-ink flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-40"
          >
            <RotateIcon className="w-4 h-4 text-ok-tint shrink-0" />
            <span className="truncate">ROTAR 90°</span>
          </button>
          {/* Fuente: apps/scanner-lab/src/components/scanner/EditorView.tsx
              L2123-2141 (botón pill «Detección automática» — spinner dentro
              mientras detecta, patrón L2132-2135). */}
          <button
            type="button"
            aria-label="Detectar automáticamente los bordes del acta"
            onClick={aplicando || detectando ? undefined : () => void detectar()}
            disabled={aplicando || detectando}
            className="flex-1 min-w-0 h-11 rounded-xl bg-surface-4/90 hover:bg-surface-5 border border-outline-dim/40 font-data text-[10px] font-bold tracking-widest uppercase text-ink flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-40"
          >
            {detectando ? (
              <span className="h-4 w-4 shrink-0 rounded-full border-2 border-outline-dim border-t-ok-tint animate-spin" />
            ) : (
              <SparklesIcon className="w-4 h-4 text-ok-tint shrink-0" />
            )}
            <span className="truncate">DETECCIÓN AUTOMÁTICA</span>
          </button>
        </div>
        <span className="font-data text-[9px] tracking-[0.18em] text-ink-faint uppercase text-center">
          Arrastra las asas · la lupa amplía 3× el punto de corte
        </span>
        <button
          type="button"
          aria-label="Aplicar el recorte"
          onClick={aplicando ? undefined : () => onAplicar(displayRef.current, rotLocal)}
          disabled={aplicando}
          className="w-full h-12 py-3 px-5 bg-ok-tint hover:bg-ok active:bg-ok text-ok-ink font-extrabold text-sm uppercase tracking-wider rounded-xl flex items-center justify-center gap-2.5 shadow-[0_0_12px_rgba(63,229,108,0.45)] transition-all transform active:scale-[0.98] disabled:opacity-70 disabled:cursor-wait"
        >
          {aplicando ? (
            <>
              <span className="block h-4 w-4 rounded-full border-2 border-ok-ink/30 border-t-ok-ink animate-spin" />
              <span>PROCESANDO…</span>
            </>
          ) : (
            <span>APLICAR RECORTE</span>
          )}
        </button>
      </footer>
    </div>
  );
}
