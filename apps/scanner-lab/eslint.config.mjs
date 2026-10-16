import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // E-02: reglas de CORRECCIÓN reactivadas en warn (la deuda se reporta
    // con conteo, no rompe el gate). Estilo/opinión siguen off: no-explicit-any,
    // prefer-as-const, no-unused-disable-directive, display-name, prop-types,
    // no-img-element (los <img> del escáner son dataURLs/canvas — intencional),
    // no-html-link-for-pages, no-console (telemetría), formato (irregular-
    // whitespace, mixed-spaces-and-tabs). react-compiler/react-compiler TAMBIÉN
    // off: su plugin no está instalado y añadirlo tocaría package.json (prohibido
    // por el kit).
    // TypeScript rules
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "warn",
    "@typescript-eslint/no-non-null-assertion": "warn",
    "@typescript-eslint/ban-ts-comment": "warn",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",
    
    // React rules
    "react-hooks/exhaustive-deps": "warn",
    "react-hooks/purity": "warn",
    // Reglas nuevas de eslint-plugin-react-hooks 7.1.x (traídas por el
    // lockfile regenerado del monorepo): mismo criterio que purity/deps.
    "react-hooks/refs": "warn",
    "react-hooks/set-state-in-effect": "warn",
    "react/no-unescaped-entities": "warn",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",
    
    // Next.js rules
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",
    
    // General JavaScript rules
    "prefer-const": "warn",
    "no-unused-vars": "warn",
    "no-console": "off",
    "no-debugger": "warn",
    "no-empty": "warn",
    "no-irregular-whitespace": "off",
    "no-case-declarations": "warn",
    "no-fallthrough": "warn",
    "no-mixed-spaces-and-tabs": "off",
    "no-redeclare": "warn",
    "no-undef": "warn",
    "no-unreachable": "warn",
    "no-useless-escape": "warn",
  },
}, {
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills", "public/vendor/**", "public/scanner/**", "download/**", "scripts/**"]
}];

export default eslintConfig;
