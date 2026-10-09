import type { NextConfig } from "next";
import path from "node:path";

// Raíz del monorepo (workspaces): igual que scanner-lab, evita que Turbopack
// infiera un root equivocado al construir junto al lockfile raíz.
const workspaceRoot = path.resolve(__dirname, "../..");

/**
 * Configuración DUAL para GitHub Pages (igual que scanner-lab):
 *
 *  · Dev / servidor local:  `bun run dev` (:3001) → standalone.
 *  · GitHub Pages (estático): `BUILD_STATIC=1 bunx next build` → `./out/`.
 *    El repo web-scanner sirve bajo /web-scanner/ → basePath condicional.
 */
const isStatic = process.env.BUILD_STATIC === "1";
const basePath = isStatic ? "/web-scanner" : undefined;

const nextConfig: NextConfig = {
  turbopack: { root: workspaceRoot },
  // El core del workspace sirve TS crudo: Turbopack lo compila en dev y en
  // build. SIN esto el build falla (SPEC fase lógica §8 L0).
  transpilePackages: ["@jg-stevan/scanner-core"],
  ...(isStatic
    ? {
        output: "export" as const,
        trailingSlash: true,
        basePath,
      }
    : { output: "standalone" as const }),
  allowedDevOrigins: ["*.space-z.ai", "localhost", "127.0.0.1"],
  images: { unoptimized: true },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
