"use client";

/**
 * ANALIZANDO (§7.2) — anillo de progreso + % + línea de escaneo + 4 barras
 * de paso + etapas canónicas.
 * FASE LÓGICA L1: event-driven — el % se deriva de `progresoAnalisis` (eventos
 * del bridge) ponderado por etapa (DETECTANDO .15 · RECORTANDO .15 ·
 * REALZANDO .20 · CALIDAD .15 · OCR .35 — el OCR domina) y se suaviza con un
 * lerp por rAF. Piso escénico D16: el % nunca llega a 100 hasta que el
 * pipeline resolvió Y pasaron ≥1200 ms del montaje; entonces anima a 100
 * (~350 ms) y navega a REVISIÓN (mismo feel de ~2.5 s de la fase gráfica).
 */
import { useEffect, useRef, useState } from "react";
import { useE14Store } from "@/lib/e14/store";
import type { EtapaAnalisis, ProgresoAnalisis } from "@/lib/e14/types";
import { DocScannerIcon, ShieldCheckIcon } from "../icons";

const ETAPAS = [
  "DETECTANDO BORDES",
  "LEYENDO CAMPOS",
  "CALCULANDO SCORE",
  "VALIDACIÓN COMPLETADA CON ÉXITO",
];

/** Pesos por etapa del pipeline (§7 AnalyzingView): el OCR domina. */
const PESOS: Record<EtapaAnalisis, number> = {
  DETECTANDO: 0.15,
  RECORTANDO: 0.15,
  REALZANDO: 0.2,
  CALIDAD: 0.15,
  OCR: 0.35,
};
const ORDEN_ETAPAS: readonly EtapaAnalisis[] = [
  "DETECTANDO",
  "RECORTANDO",
  "REALZANDO",
  "CALIDAD",
  "OCR",
];

/** Piso escénico (D16): mínimo en pantalla antes de poder cerrar al 100 %. */
const PISO_ESCENICO_MS = 1200;
/** Constante de tiempo del tween del % (suaviza los saltos de los eventos). */
const TAU_SUAVIZADO_MS = 140;

/** Progreso global 0..1: pesos de etapas completadas + peso × avance actual. */
function progresoPonderado(p: ProgresoAnalisis | null): number {
  if (!p) return 0;
  const avance = Math.min(1, Math.max(0, p.progreso));
  let acumulado = 0;
  for (const etapa of ORDEN_ETAPAS) {
    if (etapa === p.etapa) return acumulado + PESOS[etapa] * avance;
    acumulado += PESOS[etapa];
  }
  return acumulado;
}

const CIRCUNFERENCIA = 427.25; // 2π × r(68)

export function AnalyzingView() {
  const progresoAnalisis = useE14Store((s) => s.progresoAnalisis);
  const analisisResuelto = useE14Store((s) => s.analisisResuelto);
  const analisisCompletado = useE14Store((s) => s.analisisCompletado);
  const [progreso, setProgreso] = useState(0);
  const [latencia, setLatencia] = useState(0);

  // Últimos datos del store, leídos por el loop de rAF (no se re-crea).
  const datosRef = useRef({ ponderado: 0, resuelto: false });
  useEffect(() => {
    datosRef.current.ponderado = progresoPonderado(progresoAnalisis);
    datosRef.current.resuelto = analisisResuelto;
  }, [progresoAnalisis, analisisResuelto]);

  useEffect(() => {
    const inicioReloj = performance.now();
    const inicioFecha = Date.now();
    let raf = 0;
    let anterior = performance.now();
    let mostrado = 0; // fracción 0..1 mostrada (suavizada)
    let ultimoPct = 0;
    let cerrado = false; // ya se disparó analisisCompletado
    let cierre: ReturnType<typeof setTimeout> | undefined;

    const tick = (t: number) => {
      const dt = Math.min(Math.max(t - anterior, 1), 120);
      anterior = t;
      const { ponderado, resuelto } = datosRef.current;
      // Piso escénico D16: nunca 100 hasta (pipeline resuelto && ≥1200 ms).
      const puedeCerrar = resuelto && t - inicioReloj >= PISO_ESCENICO_MS;
      const objetivo = puedeCerrar ? 1 : Math.min(ponderado, 0.99);
      // Tween corto hacia el objetivo (anti saltos a golpes).
      mostrado += (objetivo - mostrado) * (1 - Math.exp(-dt / TAU_SUAVIZADO_MS));
      mostrado = Math.min(mostrado, puedeCerrar ? 1 : 0.99);

      if (puedeCerrar && mostrado >= 0.995) {
        // Cierre escénico: snap a 100 y navega tras 350 ms (patrón actual).
        if (!cerrado) {
          cerrado = true;
          setProgreso(100);
          cierre = setTimeout(() => analisisCompletado(), 350);
        }
        raf = requestAnimationFrame(tick);
        return;
      }

      const pct = Math.round(mostrado * 100);
      if (pct !== ultimoPct) {
        ultimoPct = pct;
        setProgreso(pct);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // Latencia del beacon: ms REALES desde el montaje (~cada 180 ms).
    const latenciaTimer = setInterval(() => {
      setLatencia(Date.now() - inicioFecha);
    }, 180);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(latenciaTimer);
      if (cierre) clearTimeout(cierre);
    };
  }, [analisisCompletado]);

  const etapa = Math.min(Math.floor((progreso / 100) * ETAPAS.length), ETAPAS.length - 1);
  const offset = CIRCUNFERENCIA - (progreso / 100) * CIRCUNFERENCIA;
  const barras = Math.ceil((progreso / 100) * 4);

  return (
    <div className="flex-1 flex flex-col bg-bg pt-safe pb-6 select-none">
      <div className="flex-1 flex flex-col justify-between items-center w-full max-w-md mx-auto px-4">
        {/* Beacon superior: EN PROCESO + latencia */}
        <div className="w-full flex items-center justify-between pt-4">
          <div className="flex items-center gap-2 bg-surface-2 px-4 py-1 rounded-full">
            <span className="inline-block w-2 h-2 rounded-full bg-ok-tint animate-pulse" />
            <span className="label-caps text-ink-dim uppercase tracking-widest">EN PROCESO</span>
          </div>
          <span className="font-data text-xs text-ink-faint">{latencia}ms</span>
        </div>

        {/* Área focal: anillo concéntrico */}
        <div className="flex flex-col items-center justify-center my-auto w-full max-w-xs">
          <div className="relative flex items-center justify-center w-48 h-48 mb-6">
            {/* Glow ambiental */}
            <div className="absolute inset-0 rounded-full bg-ok-tint/10 blur-xl" aria-hidden />
            {/* Pista + anillo de progreso */}
            <svg
              className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none"
              viewBox="0 0 160 160"
              aria-hidden
            >
              <circle
                className="text-surface-5/40"
                cx="80"
                cy="80"
                fill="none"
                r="68"
                stroke="currentColor"
                strokeWidth="2"
              />
              <circle
                className="text-ok-tint transition-all duration-200 ease-out"
                cx="80"
                cy="80"
                fill="none"
                r="68"
                stroke="currentColor"
                strokeDasharray={CIRCUNFERENCIA}
                strokeDashoffset={offset}
                strokeLinecap="round"
                strokeWidth="3"
              />
            </svg>
            {/* Anillo medio */}
            <div className="absolute w-36 h-36 rounded-full bg-surface-4 flex items-center justify-center">
              {/* Núcleo de escaneo */}
              <div className="relative w-28 h-28 rounded-full bg-surface-3 flex flex-col items-center justify-center overflow-hidden">
                <div
                  className="absolute inset-x-0 h-1 bg-gradient-to-b from-transparent via-ok-tint to-transparent opacity-75 animate-scan-sweep"
                  aria-hidden
                />
                <div className="relative z-10 flex items-center justify-center">
                  <DocScannerIcon className="w-9 h-9 text-ok-tint drop-shadow-[0_0_8px_rgba(63,229,108,0.45)]" />
                </div>
                <span className="absolute bottom-2 z-10 font-data text-xs text-ok-tint">
                  {Math.round(progreso)}%
                </span>
              </div>
            </div>
            {/* Micro marcas de esquina */}
            <div className="absolute -top-1 -left-1 w-2.5 h-2.5 border-t border-l border-ok-tint/40 pointer-events-none" aria-hidden />
            <div className="absolute -top-1 -right-1 w-2.5 h-2.5 border-t border-r border-ok-tint/40 pointer-events-none" aria-hidden />
            <div className="absolute -bottom-1 -left-1 w-2.5 h-2.5 border-b border-l border-ok-tint/40 pointer-events-none" aria-hidden />
            <div className="absolute -bottom-1 -right-1 w-2.5 h-2.5 border-b border-r border-ok-tint/40 pointer-events-none" aria-hidden />
          </div>

          {/* Jerarquía tipográfica */}
          <div className="flex flex-col items-center text-center gap-1">
            <h1 className="headline-lg text-ink tracking-tight">Analizando acta</h1>
            <p className="font-data text-xs text-ink-dim max-w-[260px] min-h-[18px] transition-opacity duration-200">
              {progreso >= 100 ? "VALIDACIÓN COMPLETADA CON ÉXITO" : ETAPAS[etapa]}
            </p>
          </div>

          {/* 4 barras de paso (4px) */}
          <div className="w-40 flex items-center justify-between gap-1 mt-4">
            {Array.from({ length: 4 }, (_, i) => (
              <span
                key={i}
                className={`h-1 flex-1 rounded ${i < barras ? "bg-ok-tint" : "bg-surface-5"}`}
              />
            ))}
          </div>
        </div>

        {/* Sello de integridad */}
        <div className="w-full flex flex-col items-center gap-1">
          <div className="flex items-center gap-2 bg-surface-1 px-4 py-1 rounded-full">
            <ShieldCheckIcon className="w-4 h-4 text-ink-faint" />
            <span className="label-caps text-ink-faint tracking-wider">E-14 DIGITALIZADOR</span>
          </div>
          <span className="font-data text-xs text-outline-dim text-center">
            HASH SHA-256 EN COLA · MODO BA
          </span>
        </div>
      </div>
    </div>
  );
}
