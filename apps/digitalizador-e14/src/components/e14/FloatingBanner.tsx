"use client";

/**
 * Notificaciones flotantes compartidas (§7.8): superpuestas arriba del
 * contenido, auto-dismiss 4 s o al tocar. Variantes ok/warn/crit con
 * borde 40% + tint 10% + blur backdrop (estructura del code.html v2).
 */
import { useEffect } from "react";
import { useE14Store } from "@/lib/e14/store";
import { CheckIcon, WarnTriangleIcon } from "./icons";

function IconoNoti({ tone }: { tone: "ok" | "warn" | "crit" }) {
  if (tone === "ok") return <CheckIcon className="w-4 h-4 text-ok-tint" />;
    return <WarnTriangleIcon className={`w-4 h-4 ${tone === "warn" ? "text-warn" : "text-crit"}`} />;
}

function Noti({ id, tone, titulo, descripcion }: { id: number; tone: "ok" | "warn" | "crit"; titulo: string; descripcion?: string }) {
  const descartar = useE14Store((s) => s.descartarNotificacion);

  useEffect(() => {
    const t = setTimeout(() => descartar(id), 4000);
    return () => clearTimeout(t);
  }, [id, descartar]);

  return (
    <button
      type="button"
      onClick={() => descartar(id)}
      className={`animate-banner-in pointer-events-auto flex items-center gap-2.5 rounded-xl backdrop-blur-xl px-3 py-2.5 text-left shadow-lg shadow-black/70 w-full ${
        tone === "ok"
          ? "bg-ok-ink/90 border border-ok-tint/40"
          : tone === "warn"
            ? "bg-warn-ink/90 border border-warn/40"
            : "bg-crit-ink/90 border border-crit/40"
      }`}
    >
      <span className="shrink-0">
        <IconoNoti tone={tone} />
      </span>
      <span className="flex flex-col min-w-0">
        <span className="font-mono text-[11px] font-bold tracking-wide uppercase text-white truncate">
          {titulo}
        </span>
        {descripcion && (
          <span className="text-[10px] text-ink-dim font-mono truncate">{descripcion}</span>
        )}
      </span>
    </button>
  );
}

export function FloatingBanner() {
  const notificaciones = useE14Store((s) => s.notificaciones);
  if (notificaciones.length === 0) return null;
  return (
    <div
      className="fixed top-3 inset-x-0 z-50 flex justify-center px-4 pointer-events-none"
      role="status"
      aria-live="polite"
    >
      <div className="max-w-md w-full flex flex-col gap-2">
        {notificaciones.map((n) => (
          <Noti key={n.id} {...n} />
        ))}
      </div>
    </div>
  );
}
