/**
 * @jg-stevan/scanner-core — Contrato público del motor de escaneo.
 *
 * REGLAS DEL CORE:
 * 1. Nada de React, Next.js ni imports de UI. Solo TS + zustand + jspdf.
 * 2. Los assets (worker, OpenCV, SW) viven en el public/ de cada app;
 *    este core los localiza vía process.env.NEXT_PUBLIC_BASE_PATH.
 * 3. Agregar exports es seguro; renombrar o quitar ROMPE apps consumidoras.
 */
export * from "./store";
export * from "./types";
export * from "./image-processor";
export * from "./device-capability";
export * from "./quality";
export * from "./ocr";
export * from "./pdf-export";
export * from "./text-export";
export * from "./format";
export * from "./tags";
export * from "./page-store";
export * from "./sensor-profiler";
export * from "./motion-stabilizer";
export * from "./frame-loop";
export * from "./detector-client";
export * from "./pwa";
