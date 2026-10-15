import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
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
  maximumScale: 1,
  userScalable: false,
  // F-MOBILE: sin viewport-fit=cover iOS no expone env(safe-area-*) y las
  // barras de la PWA instalada cubren contenido.
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
          <Toaster />
          <SonnerToaster />
          <PwaRegister />
        </Providers>
      </body>
    </html>
  );
}
