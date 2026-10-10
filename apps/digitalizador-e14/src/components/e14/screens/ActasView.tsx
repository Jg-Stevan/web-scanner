"use client";

/**
 * ACTAS (§7.6 / C1) — "CONTROL ACTAS E-14": puesto actual, alerta de mesas
 * incompletas y acordeón de mesas con chips de página (DELEGADOS/TRANSMISIÓN
 * × P1/P2). MESA 01 expandida por defecto; solo una a la vez.
 * Fase B (SPEC-cabecera-clasificacion §6): la lista ya NO es solo el seed
 * del modo demo — las mesas REALES se construyen de las clasificaciones
 * guardadas (título `standName · MESA {mesa}`; la foto clasificada ocupa su
 * hueco DELEGADOS|TRANSMISIÓN × pág 1/2 según «Ver/Pag/de»).
 */
import { useMemo, useState } from "react";
import { useE14Store } from "@/lib/e14/store";
import type { Mesa, MesaPagina } from "@/lib/e14/types";
import { ChevronDownIcon, MapPinIcon, SensorsIcon, WarnTriangleIcon } from "../icons";

function chipPagina(p: MesaPagina): { label: string; clases: string } {
  switch (p.estado) {
    case "OK":
      return { label: `P${p.pagina} ✓`, clases: "px-2 py-0.5 bg-ok-tint/20 text-ok-tint font-data" };
    case "RESCANEO":
      return { label: `P${p.pagina} ⚠ Rescaneo`, clases: "px-2 py-0.5 bg-crit/20 text-crit font-data" };
    case "EN_PROCESO":
      return { label: `P${p.pagina} ⏳`, clases: "px-2 py-0.5 bg-warn/20 text-warn font-data" };
    default:
      return { label: `P${p.pagina}`, clases: "px-2 py-0.5 bg-surface-5 text-ink-dim font-data" };
  }
}

function estadoMesa(mesa: Mesa): { label: string; clases: string } {
  switch (mesa.estado) {
    case "COMPLETADA":
      return { label: `COMPLETADA ${mesa.progresoPct}%`, clases: "text-ok-tint" };
    case "EN_PROCESO":
      return { label: "EN PROCESO", clases: "text-warn" };
    default:
      return { label: "PENDIENTE", clases: "text-ink-dim" };
  }
}

function CardMesa({ mesa, abierta, onToggle }: { mesa: Mesa; abierta: boolean; onToggle: () => void }) {
  const grupos: { tipo: "DELEGADOS" | "TRANSMISIÓN"; paginas: MesaPagina[] }[] = [
    { tipo: "DELEGADOS", paginas: mesa.paginas.filter((p) => p.tipo === "DELEGADOS") },
    { tipo: "TRANSMISIÓN", paginas: mesa.paginas.filter((p) => p.tipo === "TRANSMISIÓN") },
  ];
  const estado = estadoMesa(mesa);

  return (
    <div className="bg-surface-3 border-2 border-outline-dim p-2 flex flex-col gap-2 rounded-md">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={abierta}
        className="flex justify-between items-center cursor-pointer select-none w-full"
      >
        <span className="text-lg font-bold text-ink flex items-center gap-2">
          {mesa.id}
          <ChevronDownIcon
            className={`w-4 h-4 text-ink-dim transition-transform duration-100 ease-linear ${
              abierta ? "rotate-180" : ""
            }`}
          />
        </span>
        <span className={`label-caps ${estado.clases}`}>{estado.label}</span>
      </button>
      {abierta && (
        <div className="grid grid-cols-2 gap-1 text-[12px] pt-1">
          {grupos.map(({ tipo, paginas }) => (
            <div key={tipo} className="p-2 bg-surface-5/60 border border-outline-dim rounded-sm flex flex-col gap-1">
              <span className="label-caps !text-[10px] text-ink-dim">{tipo}</span>
              <div className="flex gap-1 flex-wrap">
                {paginas.map((p) => {
                  const chip = chipPagina(p);
                  return (
                    <span key={`${p.tipo}-${p.pagina}`} className={`${chip.clases} rounded-sm text-[10px]`}>
                      {chip.label}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ActasView() {
  const mesas = useE14Store((s) => s.mesas);
  const archivadas = useE14Store((s) => s.archivadas);
  const online = useE14Store((s) => s.online);
  const alternarConexion = useE14Store((s) => s.alternarConexion);
  const colaOffline = useE14Store((s) => s.colaOffline);
  const [mesaAbierta, setMesaAbierta] = useState<string | null>("MESA 01");

  // Fase B (§6): mesas reales derivadas de las clasificaciones guardadas —
  // cada entrada `archivadas` es una mesa con su(s) hueco(s) ocupado(s).
  const mesasReales = useMemo<Mesa[]>(() => {
    return Object.entries(archivadas).map(([clave, { clasificacion: c, huecos }]) => {
      // Formato de la mesa: «Ver/Pag/de» leído (default 2 páginas).
      const total = Math.min(2, c.pagina?.total ?? 2);
      const paginas: MesaPagina[] = [];
      for (const tipo of ["DELEGADOS", "TRANSMISIÓN"] as const) {
        for (let p = 1; p <= total; p += 1) {
          paginas.push({
            tipo,
            pagina: p as 1 | 2,
            estado: huecos.some((h) => h.tipo === tipo && h.pagina === p)
              ? ("OK" as const)
              : ("PENDIENTE" as const),
          });
        }
      }
      const ocupadas = paginas.filter((p) => p.estado === "OK").length;
      return {
        // §6: tarjeta nueva con título `standName · MESA {mesa}` (la clave
        // DIVIPOL queda como id único de la tarjeta).
        id: `${c.puesto?.nombre ?? "PUESTO"} · MESA ${c.mesa ?? "?"}`,
        estado: ocupadas === paginas.length ? "COMPLETADA" : "EN_PROCESO",
        progresoPct: Math.round((ocupadas / paginas.length) * 100),
        paginas,
        clave,
      };
    });
  }, [archivadas]);

  const todas = useMemo(() => [...mesasReales, ...mesas], [mesasReales, mesas]);
  const incompletas = todas.filter((m) => m.estado !== "COMPLETADA");
  const detalleIncompletas = incompletas
    .map((m) => `${m.id} (${m.estado === "EN_PROCESO" ? "En proceso" : "Pendiente"})`)
    .join(", ");

  return (
    <div className="flex-1 min-h-0 overflow-y-auto thin-scroll bg-bg bg-scanline flex flex-col">
      {/* Header propio de la pantalla (§8) */}
      <header className="sticky top-0 z-40 w-full bg-bg border-b-2 border-outline-dim flex items-center justify-between px-4 h-14 shrink-0">
        <h1 className="text-2xl font-extrabold text-ok-tint tracking-tighter uppercase">
          CONTROL ACTAS E-14
        </h1>
      </header>

      <div className="flex-grow flex flex-col gap-6 px-4 pt-4 pb-6 max-w-md mx-auto w-full">
        {/* Puesto actual */}
        <section className="flex justify-between items-end border-b-2 border-outline-dim pb-2">
          <div className="flex flex-col gap-1 w-full">
            <span className="label-caps text-ink-dim">PUESTO ACTUAL</span>
            <h2 className="text-2xl font-extrabold text-ok-tint tracking-tighter uppercase">
              ROMA - CONSULADO
            </h2>
            <div className="flex items-center justify-between mt-1">
              <span className="font-data text-[12px] text-ink-dim">
                ITALIA &gt; ZONA 10 &gt; PUESTO 02
              </span>
              <button
                type="button"
                onClick={alternarConexion}
                className={`label-caps flex items-center gap-1 ${
                  online ? "text-ok" : "text-warn"
                }`}
                aria-pressed={!online}
              >
                <SensorsIcon className={`w-3 h-3 ${online ? "text-ok animate-pulse-sync" : "text-warn"}`} />
                {online ? "EN LÍNEA" : "OFFLINE"}
              </button>
            </div>
          </div>
        </section>

        {/* Alerta de mesas incompletas */}
        {incompletas.length > 0 && (
          <div
            className="bg-crit/10 border border-crit/40 p-2.5 flex items-center justify-between gap-2 rounded-md"
            role="alert"
          >
            <div className="flex items-center gap-2 min-w-0">
              <WarnTriangleIcon className="w-[18px] h-[18px] text-crit shrink-0" />
              <div className="flex flex-col min-w-0">
                <span className="label-caps text-crit tracking-wider">
                  {incompletas.length} MESAS INCOMPLETAS
                  {online ? "" : ` · ${colaOffline} EN COLA`}
                </span>
                <span className="font-data text-[11px] text-ink-dim truncate">
                  {detalleIncompletas}
                </span>
              </div>
            </div>
            <span className="label-caps !text-[11px] bg-crit/20 text-crit px-2 py-0.5 border border-crit/30 uppercase tracking-wider shrink-0">
              ATENCIÓN
            </span>
          </div>
        )}

        {/* Acordeón de mesas: PRIMERO las reales (Fase B §6 — "dónde va" cada
            foto clasificada), luego el seed del modo demo. */}
        <div className="flex flex-col gap-4">
          {mesasReales.length > 0 && (
            <div className="flex items-center gap-2 pt-1">
              <MapPinIcon className="w-3.5 h-3.5 text-ok-tint shrink-0" />
              <span className="label-caps !text-[10px] text-ok-tint">
                MESAS CLASIFICADAS ({mesasReales.length})
              </span>
              <span className="h-px flex-1 bg-outline-dim" />
            </div>
          )}
          {todas.map((mesa) => (
            <CardMesa
              key={mesa.id}
              mesa={mesa}
              abierta={mesaAbierta === mesa.id}
              onToggle={() => setMesaAbierta(mesaAbierta === mesa.id ? null : mesa.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
