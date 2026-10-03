import type { NextConfig } from "next";
import path from "node:path";

// ⚠ CRÍTICO PARA DESPLEGAR: fijamos el workspace root de Turbopack de forma
// explícita. Sin esto, si el proyecto se construye junto a OTRO lockfile (p.ej.
// en un pipeline de despliegue que lo envuelve), Next 16 infiere un root
// equivocado y genera un .next/standalone CORRUPTO (sin server.js) → el
// servidor de producción no arranca → "problem deploying the code".
// Ver: https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack#root-directory
const workspaceRoot = path.resolve(__dirname);

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
  // Raíz de workspace explícita — ver comentario del import path.
  turbopack: { root: workspaceRoot },
  ...(isStatic
    ? {
        output: "export" as const,
        trailingSlash: true,
        basePath,
      }
    : { output: "standalone" as const }),
  // Preview del sandbox: el gateway sirve la app bajo un dominio distinto al
  // interno — sin esto, Next 16 bloquea/warnear las peticiones de _next/*.
  allowedDevOrigins: ["*.space-z.ai", "localhost"],
  // Sin optimización de imágenes (los <img> del escáner son dataURLs/canvas).
  images: { unoptimized: true },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
