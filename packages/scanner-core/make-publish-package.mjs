// Genera .publish/ — la carpeta que se publica de verdad.
// Motivo: ni bun publish ni npm publish aplican publishConfig.exports
// (comportamiento pnpm-specific) -> el mapa de exports hacia dist/ se
// aplica AQUI, manualmente y de forma verificable.
//
// PITFALL REAL (0.4.0, publicado roto el 2026-10-17): si corres
// `npm publish` DESDE ESTA CARPETA (packages/scanner-core/), npm usa el
// package.json de workspace (exports -> ./src/*.ts) y el tarball queda
// SIN consumir (metadata apunta a archivos que no viajan). El publish
// SIEMPRE es: `bun run publish:stage` y luego `cd .publish && npm publish`.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

rmSync(".publish", { recursive: true, force: true });
mkdirSync(".publish");

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

const published = {
  ...pkg,
  exports: pkg.publishConfig?.exports ?? {
    ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
    "./*": { types: "./dist/*.d.ts", default: "./dist/*.js" },
  },
  types: pkg.publishConfig?.types ?? "./dist/index.d.ts",
};
delete published.publishConfig;
// E-15 (kit limpieza-v1): preservar prepublishOnly en el paquete publicado —
// delete published.scripts a secas lo desactivaba en la publicación real.
const { prepublishOnly } = published.scripts ?? {};
if (prepublishOnly) published.scripts = { prepublishOnly };
else delete published.scripts;

writeFileSync(".publish/package.json", JSON.stringify(published, null, 2) + "\n");
cpSync("dist", ".publish/dist", { recursive: true });
cpSync("README.md", ".publish/README.md");

console.log(".publish/ listo - exports apuntan a dist/");
