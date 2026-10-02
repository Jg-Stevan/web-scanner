import type { NextConfig } from "next";

/**
 * Configuración DUAL para poder desplegar en GitHub Pages:
 *
 *  · Dev / servidor local:  `bun run dev` / `bun run build`  →  standalone (como siempre).
 *  · GitHub Pages (estático): `BUILD_STATIC=1 bunx next build`  →  genera `./out/`
 *    con HTML/CSS/JS estático servible desde cualquier hosting estático.
 *
 * GitHub Pages sirve el repo `web-scanner` bajo la subcarpeta /web-scanner/,
 * por eso el build estático activa `basePath` (Next prefija automáticamente
 * todos los chunks de _next/). Los archivos de public/ que se referencian a
 * mano (worker de detección) usan NEXT_PUBLIC_BASE_PATH — ver detector-client.ts.
 */
const isStatic = process.env.BUILD_STATIC === "1";
const basePath = isStatic ? "/web-scanner" : undefined;

const nextConfig: NextConfig = {
  ...(isStatic
    ? {
        output: "export" as const,
        trailingSlash: true,
        basePath,
      }
    : { output: "standalone" as const }),
  // Sin optimización de imágenes (los <img> del escáner son dataURLs/canvas).
  images: { unoptimized: true },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
