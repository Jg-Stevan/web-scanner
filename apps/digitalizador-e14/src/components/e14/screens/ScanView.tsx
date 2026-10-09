"use client";

/**
 * ESCANEAR (§7.1) — marco con corner brackets, retícula central, botón
 * disparo, ghost IMPORTAR y PANEL DE SIMULACIÓN para forzar el resultado.
 * FASE LÓGICA L2 (§7 ScanView): fila de chips de FUENTE (SIMULACIÓN ·
 * CÁMARA · IMPORTAR) encima del panel; IMPORTAR IMAGEN pasa a REAL (input
 * file oculto → setArchivoPendiente → setFuente ARCHIVO → análisis
 * inmediato); CÁMARA avisa que llega en L3 (chip visible, no muerto);
 * warmUp del worker OpenCV al montar (§9 — la 1ª detección no paga el
 * arranque). Los chips de RESULTADO solo existen en SIMULACIÓN.
 */
import { useEffect, useRef } from "react";
import { warmUpScannerWorker } from "@jg-stevan/scanner-core/detector-client";
import { useE14Store } from "@/lib/e14/store";
import type { Forzado } from "@/lib/e14/bridge";
import type { FuenteCaptura } from "@/lib/e14/types";
import { ImportIcon } from "../icons";

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

export function ScanView() {
  const dispararEscaneo = useE14Store((s) => s.dispararEscaneo);
  const forzado = useE14Store((s) => s.forzado);
  const setForzado = useE14Store((s) => s.setForzado);
  const fuente = useE14Store((s) => s.fuente);
  const setFuente = useE14Store((s) => s.setFuente);
  const setArchivoPendiente = useE14Store((s) => s.setArchivoPendiente);
  const notificar = useE14Store((s) => s.notificar);
  const online = useE14Store((s) => s.online);
  const alternarConexion = useE14Store((s) => s.alternarConexion);
  const inputRef = useRef<HTMLInputElement>(null);

  // §9: precarga OpenCV.js del worker sin bloquear la UI.
  useEffect(() => {
    warmUpScannerWorker();
  }, []);

  /** Elegir imagen = fuente ARCHIVO + análisis inmediato (§7 ScanView). */
  const alElegirArchivo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    e.target.value = ""; // permite re-elegir el MISMO archivo (REPETIR FOTO)
    if (!archivo) return;
    setArchivoPendiente(archivo);
    setFuente("ARCHIVO");
    void dispararEscaneo();
  };

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
              {fuente === "ARCHIVO"
                ? "ESPERANDO IMAGEN · IMPORTAR ARCHIVO"
                : "ESPERANDO CAPTURA · MODO SIMULACIÓN"}
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

      {/* IMPORTAR IMAGEN — REAL en L2: input file oculto + click programático */}
      <div className="px-4 pb-3 flex justify-center">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label="Importar imagen"
          onChange={alElegirArchivo}
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
                    // L2: chip visible pero no muerto — la cámara llega en L3.
                    notificar("warn", "CÁMARA LLEGA EN LA FASE L3", "La captura en vivo se conecta en la siguiente fase.");
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
                    : "CÁMARA · NO DISPONIBLE EN ESTA FASE"}
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
