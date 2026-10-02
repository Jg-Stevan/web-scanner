import { NextResponse } from "next/server";

/**
 * Estado del pipeline de digitalización.
 *
 * La lógica de precisión REAL del usuario (logica-deteccion.zip) vive 100% en
 * el CLIENTE dentro de un Web Worker clásico (`/scanner/detection-worker.js`)
 * con OpenCV.js 4.5.5 self-hosted (`/vendor/opencv-4.5.5.js`):
 *
 *   foto → detect (contornos → quads → score) → editor humano
 *        → warp (refine RANSAC + shrink 3.5px + homografía INTER_CUBIC)
 *        → enhance (modos text/bw/gray/raw con constantes exactas)
 *
 * El servidor NO participa del procesamiento de píxeles (así el pipeline
 * escala con el dispositivo y funciona offline). Este endpoint reporta la
 * disposición de los assets del worker para diagnósticos.
 */

export const runtime = "nodejs";

import { readFile } from "node:fs/promises";
import path from "node:path";

export async function GET() {
  const report: Record<string, unknown> = {
    pipeline: "client-side",
    worker: {
      url: "/scanner/detection-worker.js",
      protocol: ["detect", "warp", "enhance", "config"],
      bundle: "dist/detection-worker.js del zip (esbuild IIFE, self-contained)",
    },
    opencv: {
      vendorUrl: "/vendor/opencv-4.5.5.js",
      version: "4.5.5",
      source: "self-hosted (jsdelivr npm @techstark/opencv-js@4.5.5-release.2)",
    },
    endpoints: {
      ocr: "POST /api/ocr (glm-4.6v)",
    },
  };

  // Diagnóstico: ¿los assets están servibles?
  try {
    const workerPath = path.join(process.cwd(), "public", "scanner", "detection-worker.js");
    const cvPath = path.join(process.cwd(), "public", "vendor", "opencv-4.5.5.js");
    const [worker, cv] = await Promise.all([
      readFile(workerPath, "utf8"),
      readFile(cvPath, "utf8"),
    ]);
    report.assets = {
      workerBytes: worker.length,
      opencvBytes: cv.length,
      opencvLooksValid: cv.includes("onRuntimeInitialized"),
    };
  } catch {
    report.assets = { error: "assets no encontrados en public/" };
  }

  return NextResponse.json(report);
}

/** Compat: el flujo POST anterior devolvía 501 — ahora informa la ruta real. */
export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "El procesamiento de precisión se ejecuta en el cliente (Web Worker + OpenCV.js)",
      detail:
        "Usa src/lib/scanner/detector-client.ts desde el frontend. Este endpoint ya no procesa imágenes.",
    },
    { status: 410 }
  );
}
