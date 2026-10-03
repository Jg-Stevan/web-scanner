"use client";

/**
 * Proveedores de la app — tema claro/oscuro/sistema (next-themes).
 *  · attribute="class" → añade/quita .dark en <html> (Tailwind dark:).
 *  · defaultTheme="system" + enableSystem → sigue el SO del usuario.
 *  · disableTransitionOnChange → sin flash de transición al cambiar.
 *  · next-themes persiste la preferencia en localStorage (clave "theme")
 *    e inyecta un script pre-hidratación → suppressHydrationWarning en
 *    <html> es el patrón canónico (evita el mismatch de SSR).
 */

import { ThemeProvider } from "next-themes";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}
