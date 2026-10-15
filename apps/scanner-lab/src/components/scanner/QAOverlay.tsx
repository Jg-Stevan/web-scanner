"use client";

/**
 * QA — Overlay del Test estándar v1.3 (modos rápido/completo).
 *
 * Panel PERMANENTE y legible en claro/oscuro (vidrio oscuro sobre cualquier
 * vista) con: checklist por paso (pendiente / en curso / ✓ con ms), tiempo
 * acumulado, banner del paso (sostén / reencuadra / fallback manual) y
 * Abortar SIEMPRE disponible. No bloquea la app: solo el panel captura
 * eventos; el resto es pointer-events-none.
 *
 * Estados:
 *  · armado + cámara  → botón destacado «Iniciar test (3 páginas)» (paso 0:
 *    el dueño encuadra y dispara — decisión 2026-10-12).
 *  · corriendo        → checklist + banner + abortar (+ «sigue trabajando…»
 *    en pasos pesados; nunca aborta solo por timeout).
 *  · terminado        → tarjeta final: resumen, compartir informe (con
 *    reintento real por gesto) y cerrar.
 */

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleDashed, Loader2, Share2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  isAcquisitionActive,
  subscribeAcquisition,
} from "@/lib/burst-budget";
import {
  qaModeStepDefs,
  qaStandardTest,
  qaStepShortLabel,
  useQaTestStore,
  type QaStepDef,
  type QaStepLog,
} from "@/lib/qa-standard-test";
import { useScannerStore } from "@jg-stevan/scanner-core/store";

function fmtSec(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** Resultado de un paso (v1.3): ms + modo/espera de capturas y decode/tier
 *  de los pasos editor (v1.2 — solo cuando el mark los trajo). */
function fmtStepResult(l: QaStepLog): string {
  let s = fmtSec(l.ms);
  if (l.mode) s += ` · ${l.mode}`;
  if (l.waitMs != null) s += ` (espera ${fmtSec(l.waitMs)})`;
  if (l.decodeMs != null) s += ` · decode ${Math.round(l.decodeMs)} ms`;
  if (l.tier) s += ` · tier ${l.tier}`;
  return s;
}

export default function QAOverlay() {
  const view = useScannerStore((s) => s.view);
  const armed = useQaTestStore((s) => s.armed);
  const running = useQaTestStore((s) => s.running);
  const finished = useQaTestStore((s) => s.finished);
  const aborted = useQaTestStore((s) => s.aborted);
  const step = useQaTestStore((s) => s.step);
  const log = useQaTestStore((s) => s.log);
  const hint = useQaTestStore((s) => s.hint);
  const manualPrompt = useQaTestStore((s) => s.manualPrompt);
  const slow = useQaTestStore((s) => s.slow);
  const startedAt = useQaTestStore((s) => s.startedAt);
  const shareResult = useQaTestStore((s) => s.shareResult);
  const runId = useQaTestStore((s) => s.runId);
  const mode = useQaTestStore((s) => s.mode);
  // v1.3 — checklist y contadores SIEMPRE del modo activo (rápido: 2 filas).
  const modeSteps: QaStepDef[] = qaModeStepDefs(mode);

  // Reloj del tiempo acumulado (solo mientras corre — re-render por segundo).
  // v2-A13 Fase B (§4.2) — CONGELADO durante la adquisición (fired→shot):
  // en gama baja cada re-render compite por el hilo que pelea por la foto y
  // desliza los timers del muro (lote 4). El checklist no cambia a mitad de
  // la adquisición: se actualiza al inicio y al fin del paso — el reloj se
  // refresca YA cuando la ventana se cierra (capture_shot).
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!running || startedAt === null) return;
    const update = () => {
      if (isAcquisitionActive()) return; // ventana abierta: cero re-renders
      setElapsedMs(performance.now() - startedAt);
    };
    update();
    const t = window.setInterval(update, 1000);
    const unsubAcquisition = subscribeAcquisition(() => {
      if (!isAcquisitionActive()) update(); // fin de la adquisición → refresca
    });
    return () => {
      window.clearInterval(t);
      unsubAcquisition();
    };
  }, [running, startedAt]);

  // «Listo» oculta la tarjeta PERO el estado del guión (log) persiste: el
  // informe de Diagnóstico sigue llevando la sección qa. Se re-arma la
  // tarjeta en cada nueva corrida (runId).
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    setDismissed(false);
  }, [runId]);

  // Paso «report»: intentar compartir YA (con fallback a descarga); el
  // botón del panel queda para reintentar con gesto real del usuario.
  const reportTriedRef = useRef(false);
  useEffect(() => {
    if (running && step === "report" && !reportTriedRef.current) {
      reportTriedRef.current = true;
      void qaStandardTest.runReportShare();
    }
    if (step !== "report") reportTriedRef.current = false;
  }, [running, step]);

  // ── Nada que pintar ──
  if (!armed && !running && !finished) return null;
  if (armed && !running && !finished && view !== "camera") return null;
  if (!running && finished && dismissed) return null;

  // ── Paso 0: cámara armada → botón destacado «Iniciar test» ──
  if (armed && !running && !finished) {
    const isQuick = mode === "quick";
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-[118px] z-30 flex flex-col items-center gap-2 px-6">
        <button
          type="button"
          data-qa-start
          onClick={() => qaStandardTest.start()}
          className="pointer-events-auto flex min-h-[52px] items-center justify-center gap-2 rounded-full bg-[#007aff] px-7 text-[16px] font-semibold text-white shadow-[0_8px_28px_rgba(0,122,255,0.55)] transition-transform active:scale-[0.97]"
        >
          <CircleDashed className="h-5 w-5" strokeWidth={2.4} aria-hidden="true" />
          {isQuick ? "Iniciar test (1 captura)" : "Iniciar test (3 páginas)"}
        </button>
        <p className="max-w-[300px] rounded-2xl bg-black/70 px-3.5 py-2 text-center text-[12px] leading-snug text-white/85 backdrop-blur-sm">
          {isQuick
            ? "Encuadra una página con texto legible y pulsa. El resto corre solo (captura → editor)."
            : "Encuadra una página con texto legible y pulsa. El resto corre solo (capturas automáticas → editor → filtros → OCR → PDF)."}
        </p>
      </div>
    );
  }

  // ── Tarjeta final ──
  if (!running && finished) {
    const okCount = log.filter((l) => l.ok).length;
    return (
      <div className="absolute inset-0 z-[80] flex items-center justify-center bg-black/60 px-6 backdrop-blur-[2px]">
        <div
          role="dialog"
          aria-label={aborted ? "Test abortado" : "Test completado"}
          className="w-full max-w-[330px] rounded-3xl bg-[#1c1c1e] p-5 text-white shadow-2xl ring-1 ring-white/10"
        >
          <div className="flex flex-col items-center gap-1.5 text-center">
            {aborted ? (
              <X className="h-9 w-9 text-[#ff9f0a]" strokeWidth={2.4} aria-hidden="true" />
            ) : (
              <CheckCircle2 className="h-9 w-9 text-[#34c759]" strokeWidth={2.2} aria-hidden="true" />
            )}
            <h2 className="text-[18px] font-semibold tracking-tight">
              {aborted ? "Test abortado" : "Test estándar completado"}
            </h2>
            <p className="text-[12.5px] leading-snug text-white/60">
              {aborted
                ? `Informe parcial: ${okCount} de ${modeSteps.length} pasos. Sigue compartible.`
                : `${modeSteps.length} pasos · guiño qa-standard-v1.3 en el informe.`}
            </p>
          </div>

          <div className="my-3.5 max-h-44 overflow-y-auto rounded-2xl bg-black/40 p-1 [scrollbar-width:thin]">
            <ul className="flex flex-col gap-0.5">
              {log.map((l, i) => (
                <li
                  key={`${l.id}-${i}`}
                  className="flex items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-[12.5px]"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    {l.ok ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#34c759]" aria-hidden="true" />
                    ) : (
                      <X className="h-3.5 w-3.5 shrink-0 text-[#ff453a]" aria-hidden="true" />
                    )}
                    <span className="truncate text-white/85">{l.label}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-white/55">
                    {l.ok ? fmtStepResult(l) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              data-qa-share
              onClick={() => void qaStandardTest.shareAgain()}
              className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-2xl bg-[#007aff] text-[15px] font-semibold text-white transition-transform active:scale-[0.98]"
            >
              <Share2 className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden="true" />
              Compartir informe
            </button>
            <button
              type="button"
              data-qa-dismiss
              onClick={() => setDismissed(true)}
              className="flex min-h-[40px] w-full items-center justify-center rounded-2xl bg-white/10 text-[14px] font-medium text-white/80 ring-1 ring-inset ring-white/10 transition-transform active:scale-[0.98]"
            >
              Listo
            </button>
          </div>
          {shareResult === "downloaded" && (
            <p className="mt-2 text-center text-[11px] leading-snug text-white/50">
              Compartir no estaba disponible: el informe TXT se descargó para
              enviarlo por WhatsApp.
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Corriendo: checklist superior + banner + abortar ──
  const stepIdx = modeSteps.findIndex((s) => s.id === step);
  return (
    <div className="pointer-events-none absolute inset-0 z-[80] flex flex-col">
      {/* Banner del paso (cámara: sostén/reencuadra · fallback manual) */}
      {hint && (
        <div className="absolute inset-x-0 top-[30%] z-[81] flex justify-center px-6">
          <div
            role="status"
            className={cn(
              "flex items-center gap-2.5 rounded-[20px] px-4 py-2.5 text-[14px] font-medium text-white shadow-lg backdrop-blur-md",
              manualPrompt ? "bg-[#ff9f0a]/90" : "bg-black/75"
            )}
          >
            {manualPrompt ? (
              <X className="h-4 w-4 shrink-0" strokeWidth={2.6} aria-hidden="true" />
            ) : (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
            )}
            <span className="text-center">{hint}</span>
          </div>
        </div>
      )}

      {/* Panel: checklist + tiempo + abortar */}
      <div className="pointer-events-auto absolute inset-x-3 top-3 z-[82] rounded-2xl bg-black/80 p-3 text-white shadow-xl ring-1 ring-white/10 backdrop-blur-md">
        <div className="flex items-center justify-between gap-2 pb-2">
          <span className="text-[12.5px] font-semibold tracking-wide text-white/90">
            {`TEST QA v1.3 · ${mode === "quick" ? "rápido" : "completo"}`}
            <span className="ml-2 font-normal tabular-nums text-white/55">
              {fmtSec(elapsedMs)}
            </span>
          </span>
          <button
            type="button"
            data-qa-abort
            onClick={() => qaStandardTest.abort()}
            className="flex h-8 items-center gap-1 rounded-full bg-[#ff453a]/90 px-3 text-[12.5px] font-semibold text-white transition-transform active:scale-95"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.8} aria-hidden="true" />
            Abortar
          </button>
        </div>

        <div className="max-h-36 overflow-y-auto pr-0.5 [scrollbar-width:thin]">
          <ol className="flex flex-col gap-[3px]">
            {modeSteps.map((s, i) => {
              const done = log.find((l) => l.id === s.id);
              const active = i === stepIdx;
              return (
                <li
                  key={s.id}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-lg px-2 py-[5px] text-[12px]",
                    active ? "bg-[#007aff]/25" : "opacity-90"
                  )}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    {done?.ok ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#34c759]" aria-hidden="true" />
                    ) : active ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#0a84ff]" aria-hidden="true" />
                    ) : (
                      <CircleDashed className="h-3.5 w-3.5 shrink-0 text-white/30" aria-hidden="true" />
                    )}
                    <span className={cn("truncate", active ? "text-white" : "text-white/60")}>
                      {qaStepShortLabel(s.id, mode)}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums text-white/55">
                    {done?.ok
                      ? fmtStepResult(done)
                      : active && slow
                        ? "sigue trabajando…"
                        : ""}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        {slow && (
          <p className="pt-1.5 text-center text-[11px] leading-snug text-white/55">
            Sigue trabajando… en gama baja el OCR puede tardar hasta 1 min.
          </p>
        )}
      </div>
    </div>
  );
}
