"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";

import { useIsHydrated } from "@/hooks/use-is-hydrated";

/** Toaster estilo iOS (sonner) para las vistas del escáner.
 *  · Material vítreo oscuro + blur 20px (idéntico en claro y oscuro —
 *    el toast de iOS es siempre vidrio oscuro sobre cualquier fondo).
 *  · En dark: se eleva a #2c2c2e (material "elevated" de iOS) y sonner
 *    recibe theme="dark" para sus estados internos (icons/loading).
 *  · Título blanco 500 · descripción blanco/75 (contraste AA sobre
 *    oscuro, el gris por defecto de sonner se perdía sobre la cámara).
 *  · El tema se lee tras la hidratación (resolvedTheme no existe en SSR). */
export function SonnerToaster() {
  const { resolvedTheme } = useTheme();
  const mounted = useIsHydrated();
  const dark = mounted && resolvedTheme === "dark";

  return (
    <Sonner
      position="top-center"
      theme={dark ? "dark" : "light"}
      toastOptions={{
        style: {
          borderRadius: "20px",
          background: dark ? "rgba(44,44,46,0.92)" : "rgba(20,20,20,0.88)",
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
