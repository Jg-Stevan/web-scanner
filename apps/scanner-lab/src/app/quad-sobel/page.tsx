"use client";

import { useCallback, useState } from "react";
import {
  detectDocumentEdgesDetail,
  UMBRAL_PICO,
  type DetalleBordes,
} from "@jg-stevan/scanner-core";

/**
 * LAB — validación del kit e14-quad-sobel-v1 (P1+P2 del core 0.4.0).
 * P1: detectDocumentEdgesDetail dice QUIÉN fabricó el quad (worker|sobel).
 * P2: el bottom del Sobel busca el borde del PAPEL (no el máximo de energía).
 *
 * Criterios de aceptación (§6 del kit):
 *  1) mesa-002 → origen:"sobel" · bottom ≥ 0.90 (ANTES del fix: 0.60 — rig T-C)
 *  2) mesa-001 → quad de campo preservado (trapecio, left/right/top sin mover)
 *  3) acta-e14-real → trapecio con tilt vía WORKER, ratio ≈ 2.9
 *  4) UMBRAL_PICO = 0.4 calibrado con los 3 casos (constante ÚNICA del core).
 */

type Fila = {
  nombre: string;
  nota: string;
  origen?: string;
  quad?: string;
  bottom?: number;
  ratio?: number;
  ms?: number;
  error?: string;
};

const FIXTURES = [
  { archivo: "mesa-001-original.jpg", nota: "campo control (zip1, lazo)" },
  {
    archivo: "mesa-002-original.jpg",
    nota: "campo objetivo (zip2, quad corto)",
  },
  { archivo: "acta-e14-real.jpg", nota: "sanidad rig T-C (Frankfurt P1)" },
];

function ratioDe(quad: DetalleBordes["quad"]): number {
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(b.x - a.x, b.y - a.y);
  const [tl, tr, br, bl] = quad;
  if (!tl || !tr || !br || !bl) return 0;
  const ancho = (dist(tl, tr) + dist(bl, br)) / 2;
  const alto = (dist(tl, bl) + dist(tr, br)) / 2;
  return ancho > 0 ? alto / ancho : 0;
}

export default function QuadSobelPage() {
  const [filas, setFilas] = useState<Fila[]>([]);
  const [corriendo, setCorriendo] = useState(false);

  const correr = useCallback(async () => {
    setCorriendo(true);
    const out: Fila[] = [];
    for (const f of FIXTURES) {
      const fila: Fila = { nombre: f.archivo, nota: f.nota };
      const t0 = performance.now();
      try {
        const d = await detectDocumentEdgesDetail(`/lab-fixtures/${f.archivo}`);
        const [tl, , br, bl] = d.quad;
        fila.origen = d.origen;
        fila.quad = d.quad
          .map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`)
          .join(" ");
        fila.bottom = Math.max(tl?.y ?? 0, bl?.y ?? 0);
        fila.ratio = ratioDe(d.quad);
        fila.ms = Math.round(performance.now() - t0);
        void br;
      } catch (e) {
        fila.error = e instanceof Error ? e.message : String(e);
      }
      out.push(fila);
      setFilas([...out]);
    }
    setCorriendo(false);
  }, []);

  return (
    <main className="min-h-screen bg-zinc-950 p-6 text-zinc-100">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="space-y-1">
          <h1 className="text-xl font-bold">
            Lab quad-sobel — origen del quad + bottom del papel (0.4.0)
          </h1>
          <p className="text-sm text-zinc-400">
            kit e14-quad-sobel-v1 §6 · UMBRAL_PICO={UMBRAL_PICO} (constante
            ÚNICA importada del core) · Aceptación: mesa-002{" "}
            <code>origen:sobel bottom≥0.90</code> · mesa-001 trapecio de campo ·
            control <code>origen:worker ratio≈2.9</code>
          </p>
        </header>

        <button
          onClick={correr}
          disabled={corriendo}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {corriendo ? "corriendo…" : "Correr los 3 fixtures"}
        </button>

        <div className="overflow-hidden rounded-lg border border-zinc-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-900 text-zinc-400">
              <tr>
                <th className="p-2">fixture</th>
                <th className="p-2">origen</th>
                <th className="p-2">quad</th>
                <th className="p-2">bottom</th>
                <th className="p-2">ratio</th>
                <th className="p-2">ms</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr
                  key={f.nombre}
                  className="border-t border-zinc-800 align-top"
                >
                  <td className="p-2">
                    <div className="font-semibold">{f.nombre}</div>
                    <div className="text-zinc-500">{f.nota}</div>
                    {f.error ? (
                      <div className="text-red-400">ERROR: {f.error}</div>
                    ) : null}
                  </td>
                  <td className="p-2 font-mono">
                    {f.origen === "sobel" ? (
                      <span className="text-amber-400">{f.origen}</span>
                    ) : f.origen === "worker" ? (
                      <span className="text-emerald-400">{f.origen}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="p-2 font-mono leading-5">{f.quad ?? "—"}</td>
                  <td className="p-2 font-mono">
                    {f.bottom?.toFixed(3) ?? "—"}
                  </td>
                  <td className="p-2 font-mono">{f.ratio?.toFixed(2) ?? "—"}</td>
                  <td className="p-2 font-mono">{f.ms ?? "—"}</td>
                </tr>
              ))}
              {filas.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-zinc-500">
                    pulsa «Correr los 3 fixtures»
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-xs text-zinc-400">
          <p className="font-semibold text-zinc-300">Referencia de campo</p>
          <p>
            mesa-002 campo: <code>[0.362,0.333 0.694,0.333 0.694,0.601
            0.362,0.601]</code> (Sobel VIEJO — bottom 0.60 = banda NIVELACIÓN) ·
            ideal: bottom ≈ 0.97 (borde papel/pupitre). mesa-001 campo:
            trapecio de campo (worker) — ver REPORTE rig T-C en digielect14{" "}
            <code>lab/resultados/</code>.
          </p>
        </section>
      </div>
    </main>
  );
}
