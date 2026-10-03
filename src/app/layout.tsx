import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { SonnerToaster } from "@/components/scanner/SonnerToaster";

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
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#007AFF",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#e9e9ee] text-foreground`}
        // suppressHydrationWarning: extensiones de navegador (Grammarly,
        // asistentes de formularios, etc.) inyectan atributos en <body> antes
        // de que React hidrate — mismo patrón defensivo que usa <html>.
        suppressHydrationWarning
      >
        {children}
        <Toaster />
        <SonnerToaster />
      </body>
    </html>
  );
}
