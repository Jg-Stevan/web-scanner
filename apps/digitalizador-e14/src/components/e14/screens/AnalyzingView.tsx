"use client";

/**
 * ANALIZANDO (§7.2) — anillo de progreso + % + línea de escaneo + 4 barras
 * de paso + etapas canónicas. Duración total ~2.5 s → auto-navega a REVISIÓN.
 */
import { useEffect, useRef, useState } from "react";
import { useE14Store } from "@/lib/e14/store";
import { DocScannerIcon, ShieldCheckIcon } from "../icons";

const ETAPAS = [
  "DETECTANDO BORDES",
  "LEYENDO CAMPOS",
  "CALCULANDO SCORE",
  "VALIDACIÓN COMPLETADA CON ÉXITO",
];

const CIRCUNFERENCIA = 427.25; // 2π × r(68)

export function AnalyzingView() {
  const analisisCompletado = useE14Store((s) => s.analisisCompletado);
  const [progreso, setProgreso] = useState(0);
  const [latencia, setLatencia] = useState(18);
  const terminado = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setProgreso((p) => {
        const siguiente = p + 7 + Math.floor(Math.random() * 6);
        if (siguiente >= 100) {
          clearInterval(timer);
          return 100;
        }
        return siguiente;
      });
      setLatencia(14 + Math.floor(Math.random() * 7));
    }, 180);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (progreso >= 100 && !terminado.current) {
      terminado.current = true;
      const t = setTimeout(() => analisisCompletado(), 350);
      return () => clearTimeout(t);
    }
  }, [progreso, analisisCompletado]);

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
