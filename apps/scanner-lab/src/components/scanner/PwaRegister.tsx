"use client";

/**
 * F-PWA — montaje único: registra el Service Worker y activa los listeners
 * de instalación. No renderiza nada.
 */
import { useEffect } from "react";
import { registerServiceWorker, setupPwaListeners } from "@jg-stevan/scanner-core/pwa";

export default function PwaRegister() {
  useEffect(() => {
    setupPwaListeners();
    registerServiceWorker();
  }, []);
  return null;
}
