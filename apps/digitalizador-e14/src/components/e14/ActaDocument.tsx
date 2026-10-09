"use client";

/**
 * ActaDocument (§7.3) — tarjeta CLARA del acta sobre UI oscura. Calca el
 * code.html de las pantallas de revisión. El papel usa la paleta clara del
 * documento (neutral/red/amber/blue de Tailwind, como el zip); el cromo de
 * la UI usa los tokens §5.
 */
import type { Acta } from "@/lib/e14/types";

/** Firma individual con variantes OK / TENUE (ámbar) / NO_DETECTADO (rojo). */
function Firma({
  nombre,
  jurado,
  estado,
}: {
  nombre: string;
  jurado: string;
  estado: "OK" | "NO_DETECTADO" | "TENUE";
}) {
  if (estado === "NO_DETECTADO") {
    return (
      <div className="text-center w-1/3 relative bg-red-500/10 rounded border border-dashed border-red-500/50 pb-0.5">
        <div className="absolute -top-3.5 inset-x-0 mx-auto text-[7px] font-bold text-red-700 bg-red-200/95 px-1 rounded-sm w-fit font-mono tracking-tight">
          NO DETECTADO
        </div>
        <div className="text-xs font-serif italic text-neutral-400 opacity-40 -mb-1">{nombre}</div>
        <div className="border-t border-red-400/60 pt-1 text-[8px] text-red-800 font-mono font-semibold">
          {jurado}
        </div>
      </div>
    );
  }
  if (estado === "TENUE") {
    return (
      <div className="text-center w-1/3 relative bg-amber-500/10 rounded border border-dashed border-amber-500/50 pb-0.5">
        <div className="absolute -top-3.5 inset-x-0 mx-auto text-[7px] font-bold text-amber-700 bg-amber-200/90 px-1 rounded-sm w-fit font-mono tracking-tight">
          TRAZO TENUE
        </div>
        <div className="text-xs font-serif italic text-neutral-400 opacity-60 -mb-1">{nombre}</div>
        <div className="border-t border-amber-400/60 pt-1 text-[8px] text-amber-800 font-mono font-semibold">
          {jurado}
        </div>
      </div>
    );
  }
  return (
    <div className="text-center w-1/3">
      <div className="text-xs font-serif italic text-blue-950 opacity-80 -mb-1">{nombre}</div>
      <div className="border-t border-neutral-400 pt-1 text-[8px] text-neutral-500 font-mono">
        {jurado}
      </div>
    </div>
  );
}

export function ActaDocument({ acta, rotacion = 0 }: { acta: Acta; rotacion?: number }) {
  const ilegible = acta.rechazo?.tipo === "ILEGIBLE";

  return (
    <article
      className="w-full max-w-sm h-full bg-[#EAEAEA] text-neutral-900 rounded-sm shadow-2xl overflow-hidden flex flex-col justify-between border border-neutral-300 transition-transform duration-300"
      style={{ transform: `rotate(${rotacion}deg)` }}
      data-purpose="acta-preview"
      aria-label={`Acta E-14 ${acta.titulo}`}
    >
      {/* Cabecera del acta */}
      <div className="p-3 border-b border-neutral-400 bg-[#F4F4F4] shrink-0 relative">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-black uppercase tracking-tight text-neutral-800">
            REGISTRADURÍA NACIONAL
          </span>
          <span
            className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
              ilegible
                ? "bg-red-200 text-red-800 border border-red-400"
                : "bg-neutral-200 text-neutral-700"
            }`}
          >
            {ilegible ? "CÓDIGO NO DETECTADO" : "ACTA E-14"}
          </span>
        </div>
        <div className={`w-full h-11 barcode-lines rounded-sm relative ${ilegible ? "opacity-60" : ""}`}>
          {ilegible && (
            <div className="absolute inset-0 bg-red-500/10 backdrop-blur-[2px] rounded-sm flex items-center justify-center">
              <span className="text-[8px] font-mono font-bold text-red-700 bg-red-100/95 border border-red-400 px-1.5 py-0.5 rounded shadow-sm">
                CÓDIGO ILEGIBLE / DESENFOCADO
              </span>
            </div>
          )}
        </div>
        <div className="flex justify-between items-center text-[9px] font-mono text-neutral-600 mt-1 px-0.5">
          <span>{acta.codigoBarras}</span>
          <span>
            PÁG {String(acta.pagina.index).padStart(2, "0")} DE {String(acta.pagina.total).padStart(2, "0")}
          </span>
        </div>
      </div>

      {/* Grid de ubicación */}
      <div className="px-3 py-2 text-[9px] uppercase font-mono grid grid-cols-2 gap-1.5 border-b border-neutral-300 bg-white shrink-0">
        <div>
          <strong className="text-neutral-500">DEP:</strong> {acta.ubicacion.departamento}
        </div>
        <div>
          <strong className="text-neutral-500">MUN:</strong> {acta.ubicacion.municipio}
        </div>
        <div>
          <strong className="text-neutral-500">ZONA:</strong> {acta.ubicacion.zona}&nbsp;&nbsp;
          <strong className="text-neutral-500">PUESTO:</strong> {acta.ubicacion.puesto}
        </div>
        <div>
          <strong className="text-neutral-500">MESA:</strong> {acta.ubicacion.mesa}
        </div>
      </div>

      {/* Tabla de resultados */}
      <div className="p-3 bg-neutral-100/90 text-center border-b border-neutral-300 flex-1 flex flex-col justify-center">
        <span className="text-[10px] font-bold tracking-tight uppercase block text-neutral-800 mb-2">
          {acta.tipo}
        </span>
        <div className="grid grid-cols-4 gap-2 text-[9px] text-neutral-600 font-mono">
          {acta.candidatos.map((c) => (
            <span
              key={c.codigo}
              className={`border border-neutral-300 bg-white py-2 font-bold shadow-sm ${
                ilegible ? "blur-[0.5px]" : ""
              }`}
            >
              {c.codigo} : {c.votos}
            </span>
          ))}
        </div>
      </div>

      {/* Firmas */}
      <div className="p-3 bg-white flex justify-around items-end h-20 border-t border-dashed border-neutral-400 shrink-0 relative">
        {acta.firmas.map((f) => (
          <Firma key={f.jurado} nombre={f.nombre} jurado={f.jurado} estado={f.estado} />
        ))}
      </div>
    </article>
  );
}
