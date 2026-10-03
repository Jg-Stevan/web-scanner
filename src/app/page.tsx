"use client";

/**
 * Shell principal del escáner de documentos (estilo iOS).
 * Renderiza la vista activa del store dentro de un marco tipo teléfono
 * centrado en desktop. La barra inferior de navegación solo aparece en
 * Biblioteca y Ajustes (Cámara/Editor usan sus propias barras).
 * F-NOVIEW: la 3ª interfaz (Digitalización) desapareció — los documentos
 * guardados se abren en el propio Editor (modo revisión, como Adobe Scan).
 * Transición entre vistas: deslizamiento direccional sutil (push/pop de iOS).
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useScannerStore } from "@/lib/scanner/store";
import type { ScannerView } from "@/lib/scanner/types";
import { warmUpScannerWorker } from "@/lib/scanner/image-processor";
import LibraryView from "@/components/scanner/LibraryView";
import CameraView from "@/components/scanner/CameraView";
import EditorView from "@/components/scanner/EditorView";
import SettingsView from "@/components/scanner/SettingsView";
import BottomNav from "@/components/scanner/BottomNav";

/** Profundidad de navegación (para decidir dirección del slide). */
const VIEW_RANK: Record<ScannerView, number> = {
  library: 0,
  settings: 1,
  camera: 2,
  editor: 3,
};

export default function Home() {
  const view = useScannerStore((s) => s.view);

  // Vista previa para la dirección de la transición (ajuste de estado en
  // fase de render — patrón oficial de React, sin leer refs en render).
  const [viewMemo, setViewMemo] = useState<{ view: ScannerView; prev: ScannerView }>({
    view,
    prev: view,
  });
  if (viewMemo.view !== view) {
    setViewMemo({ view, prev: viewMemo.view });
  }

  // Precalienta el pipeline de precisión (worker + OpenCV.js self-hosted)
  // al montar la app: la primera detección ya es instantánea. También
  // hidrata documentos + ajustes desde IndexedDB/localStorage (§8 — la
  // biblioteca sobrevive al recargar; en instalación nueva conservan mocks).
  useEffect(() => {
    warmUpScannerWorker();
    void useScannerStore.getState().hydrateFromStorage();
  }, []);

  // Previene el scroll del body en vistas de cámara (negro) para simular app nativa
  useEffect(() => {
    const black = view === "camera" || view === "editor";
    document.body.style.overflow = black ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [view]);

  // Atajo global de escritorio: Escape = atrás contextual (patrón iOS).
  // Se ignora cuando un dialog/menú/hoja nativa está abierto (Radix los
  // cierra por sí mismo) — incluida la presentación (role=dialog propio).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (document.querySelector('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]')) return;
      const s = useScannerStore.getState();
      if (s.view === "settings" || s.view === "camera") {
        e.preventDefault();
        s.setView("library");
      } else if (s.view === "editor") {
        e.preventDefault();
        // F-NOVIEW: en modo revisión de documento el Escape fusiona y sale
        // a la biblioteca (auto-guardado); en sesión de captura vuelve a la cámara.
        if (s.reviewDocId) void s.exitReviewToLibrary();
        else s.setView("camera");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Dirección de la transición: hacia adelante (slide desde la derecha)
  // al navegar en profundidad, hacia atrás (slide desde la izquierda) al volver.
  const direction = VIEW_RANK[view] >= VIEW_RANK[viewMemo.prev] ? 1 : -1;

  const fullBleed = view === "camera" || view === "editor";

  return (
    // suppressHydrationWarning en los contenedores del marco: las extensiones
    // de navegador inyectan atributos data-* antes de que React hidrate
    // (p.ej. data-protocompass-form de asistentes de formularios) → mismatch
    // SSR/cliente cosmético que disparaba el overlay de hidratación.
    <div
      className="flex min-h-screen w-full items-stretch justify-center bg-[#e9e9ee] sm:items-center sm:py-6"
      suppressHydrationWarning
    >
      <div
        id="app-phone"
        suppressHydrationWarning
        className={[
          "relative flex w-full flex-col overflow-hidden bg-[#f2f2f7]",
          "h-[100svh] sm:h-[min(880px,94svh)] sm:max-w-[420px]",
          fullBleed ? "bg-black sm:rounded-[44px]" : "sm:rounded-[44px]",
          "sm:phone-frame",
        ].join(" ")}
      >
        <main className="relative flex min-h-0 flex-1 flex-col">
          <AnimatePresence initial={false}>
            <motion.div
              key={view}
              initial={{ opacity: 0, x: direction * 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direction * -20 }}
              transition={{ duration: 0.19, ease: [0.32, 0.72, 0, 1] }}
              className="absolute inset-0 flex flex-col"
            >
              {view === "library" && <LibraryView />}
              {view === "camera" && <CameraView />}
              {view === "editor" && <EditorView />}
              {view === "settings" && <SettingsView />}
            </motion.div>
          </AnimatePresence>
        </main>

        {(view === "library" || view === "settings") && <BottomNav />}
      </div>
    </div>
  );
}
