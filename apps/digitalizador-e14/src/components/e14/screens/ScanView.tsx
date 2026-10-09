"use client";

/**
 * ESCANEAR (§7.1) — placeholder de visor (no hay mock de cámara en el zip):
 * marco con corner brackets, retícula central, botón disparo, ghost import
 * y PANEL DE SIMULACIÓN para forzar el resultado del próximo escaneo.
 */
import { useRef } from "react";
import { useE14Store } from "@/lib/e14/store";
import type { Forzado } from "@/lib/e14/bridge";
import { ImportIcon } from "../icons";

const CHIPS: { valor: Forzado; label: string }[] = [
  { valor: "ALEATORIO", label: "ALEATORIO" },
  { valor: "OPTIMA", label: "ÓPTIMA" },
  { valor: "ADVERTENCIA", label: "ADVERTENCIA" },
  { valor: "RECHAZADA", label: "RECHAZADA" },
];

export function ScanView() {
  const dispararEscaneo = useE14Store((s) => s.dispararEscaneo);
  const forzado = useE14Store((s) => s.forzado);
  const setForzado = useE14Store((s) => s.setForzado);
  const online = useE14Store((s) => s.online);
  const alternarConexion = useE14Store((s) => s.alternarConexion);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex-1 flex flex-col bg-bg pt-safe">
      {/* Marco tipo visor */}
      <div className="flex-1 min-h-0 px-4 pt-4 pb-2 flex">
        <div className="relative flex-1 rounded-xl border border-line bg-surface-1 flex items-center justify-center overflow-hidden">
          {/* Corner brackets (2px, 24px) */}
          <div className="absolute inset-3 pointer-events-none" aria-hidden>
            <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-ok-tint" />
            <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-ok-tint" />
            <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-ok-tint" />
            <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-ok-tint" />
          </div>
          {/* Retícula central */}
          <div className="flex flex-col items-center gap-3 select-none" aria-hidden>
            <div className="relative w-16 h-16">
              <div className="absolute inset-x-0 top-1/2 h-px bg-outline-dim" />
              <div className="absolute inset-y-0 left-1/2 w-px bg-outline-dim" />
              <div className="absolute inset-[22px] border border-outline-dim rounded-sm" />
            </div>
            <span className="font-data text-[10px] tracking-[0.2em] text-ink-faint">
              ESPERANDO CAPTURA · MODO SIMULACIÓN
            </span>
          </div>
        </div>
      </div>

      {/* Botón disparo: círculo blanco (72px) con anillo verde */}
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

      {/* Ghost IMPORTAR IMAGEN (el mock la ignora) */}
      <div className="px-4 pb-3 flex justify-center">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label="Importar imagen"
          onChange={() => inputRef.current && (inputRef.current.value = "")}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-outline-dim text-ink-dim hover:bg-hover active:scale-95 transition-all"
        >
          <ImportIcon className="w-4 h-4" />
          <span className="label-caps !text-[10px]">IMPORTAR IMAGEN</span>
        </button>
      </div>

      {/* Panel de simulación (MOCK) — discreto: border-line + tint 10% */}
      <div className="px-4 pb-4">
        <div className="rounded-lg border border-line bg-surface-1/60 px-2.5 py-2">
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
        </div>
      </div>
    </div>
  );
}
