"use client";

/**
 * Barra de navegación inferior estilo iOS (3 tabs + FAB "Nuevo escaneo").
 * Fondo blanco translúcido con blur, borde superior #E5E5EA, safe-area.
 */

import { FileText, ScanLine, Settings } from "lucide-react";
import { useScannerStore } from "@/lib/scanner/store";
import { cn } from "@/lib/utils";

export default function BottomNav() {
  const view = useScannerStore((s) => s.view);
  const setView = useScannerStore((s) => s.setView);
  const documents = useScannerStore((s) => s.documents);

  const tabs = [
    {
      id: "library" as const,
      label: "Documentos",
      icon: FileText,
      badge: documents.length,
    },
    { id: "settings" as const, label: "Ajustes", icon: Settings },
  ];

  return (
    <footer className="ios-blur-bar-light relative z-20 shrink-0 pb-safe">
      <nav aria-label="Navegación principal" className="relative px-2 pt-2">
        <div className="flex items-end justify-around">
          {tabs.slice(0, 1).map((t) => (
            <NavTab key={t.id} tab={t} active={view === t.id} onSelect={setView} />
          ))}

          {/* Botón central de escaneo (actúa como FAB integrado) */}
          <button
            type="button"
            aria-label="Escanear nuevo documento"
            onClick={() => setView("camera")}
            className="group relative -mt-6 flex w-24 flex-col items-center gap-1 outline-none"
          >
            <span
              className={cn(
                "flex h-14 w-14 items-center justify-center rounded-full bg-[#007aff] text-white",
                "shadow-[0_8px_24px_rgba(0,122,255,0.4)] transition-transform duration-150",
                "active:scale-90 group-hover:scale-105"
              )}
            >
              <ScanLine className="h-7 w-7" strokeWidth={2.2} />
            </span>
            <span className="text-[10px] font-semibold tracking-wide text-[#8e8e93]">
              Escanear
            </span>
          </button>

          {tabs.slice(1).map((t) => (
            <NavTab key={t.id} tab={t} active={view === t.id} onSelect={setView} />
          ))}
        </div>

        {/* Home indicator iOS */}
        <div className="home-indicator home-indicator-dark mt-2 mb-1" aria-hidden="true" />
      </nav>
    </footer>
  );
}

function NavTab({
  tab,
  active,
  onSelect,
}: {
  tab: { id: "library" | "settings"; label: string; icon: typeof FileText; badge?: number };
  active: boolean;
  onSelect: (v: "library" | "settings") => void;
}) {
  const Icon = tab.icon;
  return (
    <button
      type="button"
      aria-label={tab.label}
      aria-current={active ? "page" : undefined}
      onClick={() => onSelect(tab.id)}
      className="flex w-24 flex-col items-center gap-1 rounded-xl py-1 outline-none transition-opacity active:opacity-60"
    >
      <span className="relative">
        <Icon
          className={cn("h-6 w-6", active ? "text-[#007aff]" : "text-[#8e8e93]")}
          strokeWidth={active ? 2.2 : 1.8}
        />
        {typeof tab.badge === "number" && tab.id === "library" && tab.badge > 0 && (
          <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#007aff] px-1 text-[10px] font-bold leading-none text-white">
            {tab.badge}
          </span>
        )}
      </span>
      <span
        className={cn(
          "text-[10px] font-semibold tracking-wide",
          active ? "text-[#007aff]" : "text-[#8e8e93]"
        )}
      >
        {tab.label}
      </span>
    </button>
  );
}
