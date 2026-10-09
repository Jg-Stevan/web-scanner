import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/** Estructura: Hanken Grotesk (interfaz) + JetBrains Mono (datos/telemetría). */
const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jbmono = JetBrains_Mono({
  variable: "--font-jbmono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Digitalizador E-14 — Precisión electoral",
  description:
    "Digitalizador de actas E-14: escaneo con score de calidad, control de mesas y transmisión verificada. Interfaz Precision Monitor.",
  applicationName: "Digitalizador E-14",
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0e1414",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // Sin viewport-fit=cover iOS no expone env(safe-area-*) (mismo patrón que scanner-lab).
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body
        className={`${hanken.variable} ${jbmono.variable} antialiased bg-bg text-ink font-sans`}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
