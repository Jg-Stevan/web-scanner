"use client";

/**
 * Shell único (D3): TopBar (solo REVISIÓN) + vista activa por estado (zustand)
 * + BottomNav + overlay de notificaciones flotantes. Transiciones 150 ms.
 */
import { useE14Store } from "@/lib/e14/store";
import { TopBar } from "@/components/e14/TopBar";
import { BottomNav } from "@/components/e14/BottomNav";
import { FloatingBanner } from "@/components/e14/FloatingBanner";
import { ScanView } from "@/components/e14/screens/ScanView";
import { AnalyzingView } from "@/components/e14/screens/AnalyzingView";
import { ReviewView, ReviewCtas } from "@/components/e14/screens/ReviewView";
import { ActasView } from "@/components/e14/screens/ActasView";
import { ResumenView } from "@/components/e14/screens/ResumenView";

export default function Page() {
  const vista = useE14Store((s) => s.vista);

  return (
    <div className="min-h-dvh bg-bg text-ink flex flex-col font-sans">
      {vista === "revision" && <TopBar />}

      <main className="flex-1 min-h-0 flex flex-col relative overflow-hidden">
        <div key={vista} className="flex-1 min-h-0 flex flex-col animate-view-enter">
          {vista === "escanear" && <ScanView />}
          {vista === "analizando" && <AnalyzingView />}
          {vista === "revision" && <ReviewView />}
          {vista === "actas" && <ActasView />}
          {vista === "resumen" && <ResumenView />}
        </div>
      </main>

      {vista !== "analizando" && (
        <BottomNav mode={vista === "actas" || vista === "resumen" ? "app" : "dark"}>
          {vista === "revision" && <ReviewCtas />}
        </BottomNav>
      )}

      <FloatingBanner />
    </div>
  );
}
