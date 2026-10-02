"use client";

import { Toaster as Sonner } from "sonner";

/** Toaster estilo iOS (sonner) para las vistas del escáner.
 *  · Fondo oscuro 88% + blur 20px (material vítreo iOS).
 *  · Título blanco 500 · descripción blanco/75 (contraste AA sobre oscuro,
 *    el gris por defecto de sonner se perdía sobre el visor de cámara). */
export function SonnerToaster() {
  return (
    <Sonner
      position="top-center"
      toastOptions={{
        style: {
          borderRadius: "20px",
          background: "rgba(20,20,20,0.88)",
          color: "#fff",
          border: "0.5px solid rgba(255,255,255,0.12)",
          backdropFilter: "blur(20px)",
          fontSize: "14px",
          fontWeight: 500,
        },
        classNames: {
          description: "!text-white/75 !text-[13px] !font-normal",
          title: "!text-white",
        },
      }}
    />
  );
}
