// Genera .publish/ — la carpeta que se publica de verdad.
// Motivo: ni bun publish ni npm publish aplican publishConfig.exports
// (comportamiento pnpm-specific) -> el mapa de exports hacia dist/ se
// aplica AQUI, manualmente y de forma verificable.
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
delete published.scripts;

writeFileSync(".publish/package.json", JSON.stringify(published, null, 2) + "\n");
cpSync("dist", ".publish/dist", { recursive: true });
cpSync("README.md", ".publish/README.md");

console.log(".publish/ listo - exports apuntan a dist/");
