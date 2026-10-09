"use client";

/**
 * TopBar — solo en REVISIÓN (SPEC §8): ← + "REVISIÓN DE ACTA" + pill de
 * conexión (clic alterna EN LÍNEA/OFFLINE con toast). En ACTAS/RESUMEN el
 * título vive dentro de la propia pantalla.
 */
import { useE14Store } from "@/lib/e14/store";
import { StatusPill } from "./primitives";
import { ArrowLeftIcon, CloudCheckIcon, CloudOffIcon } from "./icons";

export function TopBar() {
  const online = useE14Store((s) => s.online);
  const alternarConexion = useE14Store((s) => s.alternarConexion);
  const navegar = useE14Store((s) => s.navegar);

  return (
    <header className="relative z-40 bg-bg/95 backdrop-blur-md border-b border-line pt-safe shrink-0">
      <div className="max-w-md mx-auto px-4 h-14 flex items-center justify-between">
        <button
          aria-label="Volver al menú de escaneo"
          type="button"
          onClick={() => navegar("escanear")}
          className="w-11 h-11 -ml-2 rounded-full flex items-center justify-center text-ok-tint active:bg-white/10 active:scale-95 transition-transform duration-150"
        >
          <ArrowLeftIcon />
        </button>
        <div className="flex flex-col items-center">
          <h1 className="text-base font-extrabold tracking-wider text-ok-tint uppercase text-center flex items-center gap-1.5">
            REVISIÓN DE ACTA
          </h1>
          <span className="text-[10px] text-ink-faint uppercase tracking-widest font-mono">
            E-14&nbsp;
          </span>
        </div>
        <div className="w-11 h-11 -mr-2 flex items-center justify-center">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-ok-ink/60 border border-ok-tint/40">
            <span
              className={`w-2 h-2 rounded-full animate-pulse-sync ${online ? "bg-ok-tint" : "bg-warn"}`}
            />
            {online ? <CloudCheckIcon className="w-3.5 h-3.5 text-ok-tint" /> : <CloudOffIcon className="w-3.5 h-3.5 text-warn" />}
          </div>
        </div>
      </div>
      {/* La pill del header también alterna la conexión (§7.4). */}
      <button type="button" aria-hidden tabIndex={-1} className="sr-only" onClick={alternarConexion}>
        Alternar conexión
      </button>
    </header>
  );
}
