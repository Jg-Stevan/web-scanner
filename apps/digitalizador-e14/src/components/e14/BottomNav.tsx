"use client";

/**
 * BottomNav — 3 ítems label-caps con el estilo activo v2 (C6):
 *  · modo "dark" (REVISIÓN/ESCANEAR): contenedor suave verde (bg-ok-tint/15
 *    + borde) con icono verde — pie negro translúcido + slot de CTA encima.
 *  · modo "app" (ACTAS/RESUMEN): bloque verde sólido con icono oscuro y
 *    borde superior verde — pie surface-container-lowest (como el zip).
 */
import type { ReactNode } from "react";
import { useE14Store, type Vista } from "@/lib/e14/store";
import { CameraNavIcon, DocumentNavIcon, GridNavIcon } from "./icons";

const ITEMS: { vista: Vista; label: string; Icon: typeof CameraNavIcon }[] = [
  { vista: "escanear", label: "ESCANEAR", Icon: CameraNavIcon },
  { vista: "actas", label: "ACTAS", Icon: DocumentNavIcon },
  { vista: "resumen", label: "RESUMEN", Icon: GridNavIcon },
];

export function BottomNav({ mode = "dark", children }: { mode?: "dark" | "app"; children?: ReactNode }) {
  const vista = useE14Store((s) => s.vista);
  const navegar = useE14Store((s) => s.navegar);
  const actasSesion = useE14Store((s) => s.actasSesion);

  if (mode === "dark") {
    return (
      <footer className="relative z-40 bg-bg/95 backdrop-blur-xl border-t border-line pb-safe shrink-0">
        <div className="max-w-md mx-auto px-4 pt-3 pb-2 flex flex-col gap-2.5">
          {children}
          <nav className="grid grid-cols-3 pt-1 text-center border-t border-line/60" aria-label="Navegación principal">
            {ITEMS.map(({ vista: v, label, Icon }) => {
              const activo = vista === v;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => navegar(v)}
                  aria-current={activo ? "page" : undefined}
                  className="flex flex-col items-center py-1 group"
                >
                  <div
                    className={`w-10 h-7 rounded-lg flex items-center justify-center mb-0.5 transition-colors ${
                      activo
                        ? "bg-ok-tint/20 border border-ok-tint/40 text-ok-tint"
                        : "text-ink-faint border border-transparent"
                    }`}
                  >
                    <Icon />
                  </div>
                  <span
                    className={`text-[10px] tracking-wider uppercase ${
                      activo ? "text-ok-tint font-semibold" : "text-ink-faint font-medium"
                    }`}
                  >
                    {v === "actas" ? `Actas (${actasSesion})` : label}
                  </span>
                </button>
              );
            })}
          </nav>
          <div className="w-32 h-1 bg-white/30 rounded-full mx-auto mt-1 mb-0.5" aria-hidden />
        </div>
      </footer>
    );
  }

  return (
    <footer className="relative z-40 bg-surface-1 border-t-2 border-outline-dim pb-safe shrink-0">
      <nav className="max-w-md mx-auto flex justify-around items-center h-16" aria-label="Navegación principal">
        {ITEMS.map(({ vista: v, label, Icon }) => {
          const activo = vista === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => navegar(v)}
              aria-current={activo ? "page" : undefined}
              className={`flex flex-col items-center justify-center h-full w-full transition-colors duration-100 ${
                activo
                  ? "bg-ok-tint text-ok-ink border-t-2 border-ok-tint -mt-[2px]"
                  : "text-ink-dim hover:bg-surface-5"
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="label-caps mt-1">
                {v === "actas" ? `ACTAS (${actasSesion})` : label}
              </span>
            </button>
          );
        })}
      </nav>
    </footer>
  );
}
