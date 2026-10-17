import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SonnerToaster } from "@/components/scanner/SonnerToaster";
import { Providers } from "@/components/scanner/Providers";
import PwaRegister from "@/components/scanner/PwaRegister";

/** F-PWA: GitHub Pages sirve bajo /web-scanner/ — el manifest y los iconos
 *  se referencian con el basePath del build (vacío en dev). */
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Escáner — Digitaliza documentos con precisión",
  description:
    "Escáner móvil de documentos con captura precisa, detección de bordes, filtros y OCR. Estilo iOS.",
  manifest: `${BASE}/manifest.webmanifest`,
  applicationName: "Escáner",
  appleWebApp: {
    capable: true,
    title: "Escáner",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      {
        url: `${BASE}/icon-192.png`,
        sizes: "192x192",
        type: "image/png",
      },
      {
        url: `${BASE}/icon-512.png`,
        sizes: "512x512",
        type: "image/png",
      },
    ],
    apple: `${BASE}/apple-touch-icon.png`,
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#007aff",
  width: "device-width",
  initialScale: 1,
  // Lote D (D-2, COMP-1): pinch-zoom permitido (WCAG 1.4.4). maximumScale:1
  // y userScalable:false eliminados — el zoom de página vuelve a estar
  // disponible en toda la app (biblioteca/ajustes incluidos). HALLAZGO D-2
  // (verificado con grep, docs/lab/fix-loteD-decisiones-v1.md): el
  // touch-action de FORT 6.3 vive SOLO en PresentationView; el stage de
  // cámara/editor gestiona sus gestos con pointer events (captura +
  // preventDefault en las asas del quad) pero NO bloquea el pinch de
  // página — si molesta en cámara, el fix (touch-action en el stage) queda
  // propuesto y FUERA de la whitelist de este lote (kit §1.1).
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
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#e9e9ee] dark:bg-[#111111] text-foreground`}
        // suppressHydrationWarning: extensiones de navegador (Grammarly,
        // asistentes de formularios, etc.) inyectan atributos en <body> antes
        // de que React hidrate — mismo patrón defensivo que usa <html>.
        suppressHydrationWarning
      >
        <Providers>
          {children}
          <SonnerToaster />
          <PwaRegister />
        </Providers>
      </body>
    </html>
  );
}
