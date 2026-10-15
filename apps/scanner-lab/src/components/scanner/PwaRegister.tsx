"use client";

/**
 * F-PWA — montaje único: registra el Service Worker y activa los listeners
 * de instalación. No renderiza nada.
 */
import { useEffect } from "react";
import { registerServiceWorker, setupPwaListeners } from "@jg-stevan/scanner-core/pwa";
import { warmUpOcr } from "@jg-stevan/scanner-core/ocr";
import { useScannerStore } from "@jg-stevan/scanner-core/store";

export default function PwaRegister() {
  useEffect(() => {
    setupPwaListeners();
    registerServiceWorker();

    // F2-B — warm-up idle (~2 s post-mount) solo si online y OCR está activo
    const timer = setTimeout(() => {
      try {
        const ocrEnabled = useScannerStore.getState().settings.ocrEnabled === true;
        if (typeof navigator !== "undefined" && navigator.onLine && ocrEnabled) {
          void warmUpOcr();
        }
      } catch {
        /* no-op */
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  return null;
}
