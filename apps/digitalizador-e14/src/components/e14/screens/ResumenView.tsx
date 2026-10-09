"use client";

/**
 * RESUMEN (§7.7 / C2) — "RESUMEN DE TRABAJO": progreso del puesto (barra
 * segmentada de 12), tarjetas de estadística (cola offline / rescaneos) e
 * historial de envíos con barra de acento por estado. Reactivo en vivo.
 */
import { useE14Store } from "@/lib/e14/store";
import type { HistorialRow } from "@/lib/e14/types";
import { SegmentedBar } from "../primitives";

function badgeEstado(estado: HistorialRow["estado"]) {
  switch (estado) {
    case "ENVIADO":
      return {
        label: "ENVIADO ✓",
        clases: "px-2 py-0.5 bg-ok-tint/20 text-ok-tint font-data text-[11px]",
        barra: "bg-ok-tint",
      };
    case "RESCANEO_REQUERIDO":
      return {
        label: "RESCANEO REQUERIDO ⚠️",
        clases: "px-2 py-0.5 bg-warn/20 text-warn font-data text-[11px]",
        barra: "bg-warn",
      };
    default:
      return {
        label: "REVISIÓN HUMANA",
        clases: "px-2 py-0.5 bg-warn/20 text-warn font-data text-[11px]",
        barra: "bg-warn",
      };
  }
}

export function ResumenView() {
  const completadas = useE14Store((s) => s.completadas);
  const asignadasHoy = useE14Store((s) => s.asignadasHoy);
  const colaOffline = useE14Store((s) => s.colaOffline);
  const solicitudesRescaneo = useE14Store((s) => s.solicitudesRescaneo);
  const historial = useE14Store((s) => s.historial);

  const pct = Math.round((completadas / asignadasHoy) * 100);
  const ultimaActividad = historial[0]?.hora ?? "—";

  return (
    <div className="flex-1 min-h-0 overflow-y-auto thin-scroll bg-bg bg-scanline flex flex-col">
      {/* Header propio de la pantalla (estructura de ACTAS, §7.7; H1 corregido — ver D12) */}
      <header className="sticky top-0 z-40 w-full bg-bg border-b-2 border-outline-dim flex items-center justify-between px-4 h-14 shrink-0">
        <h1 className="text-2xl font-extrabold text-ok-tint tracking-tighter uppercase">
          RESUMEN DE TRABAJO
        </h1>
      </header>

      <div className="flex-grow flex flex-col gap-6 px-4 pt-4 pb-6 max-w-md mx-auto w-full">
        {/* Puesto actual */}
        <section className="flex justify-between items-end border-b-2 border-outline-dim pb-2">
          <div className="flex flex-col gap-1">
            <span className="label-caps text-ink-dim">PUESTO ACTUAL</span>
            <h2 className="text-xl font-bold text-ink uppercase">ROMA - CONSULADO</h2>
          </div>
        </section>

        {/* Progreso del puesto */}
        <div className="bg-surface-3 border-2 border-ok-tint p-2.5 flex flex-col gap-2 rounded-md">
          <div className="flex justify-between items-center">
            <span className="text-lg font-bold text-ink">PROGRESO DEL PUESTO: {pct}%</span>
          </div>
          <SegmentedBar total={asignadasHoy} filled={completadas} tone="ok" />
          <span className="text-sm text-ink-dim">
            Has completado {completadas} de {asignadasHoy} páginas asignadas hoy.
          </span>
        </div>

        {/* Tarjetas de estadística */}
        <div className="grid grid-cols-2 gap-1">
          <div className="bg-surface-3 border-2 border-warn p-2.5 flex flex-col gap-1 rounded-md">
            <span className="stats-number text-warn">
              {String(colaOffline).padStart(2, "0")}
            </span>
            <span className="label-caps !text-[10px] text-ink-dim">PENDIENTES EN COLA (OFFLINE)</span>
          </div>
          <div className="bg-surface-3 border-2 border-crit p-2.5 flex flex-col gap-1 rounded-md">
            <span className="stats-number text-crit">
              {String(solicitudesRescaneo).padStart(2, "0")}
            </span>
            <span className="label-caps !text-[10px] text-ink-dim">SOLICITUD DE RESCANEO</span>
          </div>
        </div>

        {/* Historial de envíos */}
        <div className="flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <span className="label-caps text-ink-dim">ÚLTIMOS ENVÍOS (HISTORIAL)</span>
            <span className="font-data text-[12px] text-ink-dim">ÚLT. ACT.: {ultimaActividad}</span>
          </div>
          <div className="flex flex-col max-h-96 overflow-y-auto thin-scroll rounded-md">
            {historial.map((fila) => {
              const badge = badgeEstado(fila.estado);
              return (
                <div
                  key={fila.id}
                  className="min-h-12 bg-surface-3 flex items-center justify-between gap-2 px-3 py-2 border-b border-line last:border-b-0 relative overflow-hidden"
                >
                  <span className={`absolute left-0 top-0 bottom-0 w-1 ${badge.barra}`} aria-hidden />
                  <span className="font-data text-[13px] text-ink pl-1 min-w-0 truncate">
                    {fila.titulo}
                  </span>
                  <span className={`${badge.clases} whitespace-nowrap shrink-0 rounded-sm`}>
                    {badge.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
