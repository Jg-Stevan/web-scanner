"use client";

/**
 * REVISIÓN (§7.4–§7.5) — documento + banner por estado + CTAs.
 * Estados: ENVIADA · ADVERTENCIA · RECHAZADA (ILEGIBLE rica / GENERICO pill)
 * · EN_REVISION_HUMANA.
 */
import { useState } from "react";
import { useE14Store } from "@/lib/e14/store";
import { ActaDocument } from "../ActaDocument";
import { Chip, PrimaryBtn, ScoreBadge, ToolbarBtn } from "../primitives";
import { CropIcon, FullscreenIcon, RefreshIcon, RotateIcon, WarnTriangleIcon } from "../icons";

/** Color de brackets según el estado del acta. */
function tonoBrackets(status: string) {
  if (status === "ADVERTENCIA" || status === "EN_REVISION_HUMANA") return "border-warn";
  if (status === "RECHAZADA") return "border-crit";
  return "border-ok-tint";
}

/** Breadcrumb canónico (§7.4) bajo el header. */
function Breadcrumb({ mesa, tipo, pagina, total }: { mesa: string; tipo: string; pagina: number; total: number }) {
  return (
    <div className="shrink-0 py-1.5 flex justify-center">
      <span className="font-data text-[9px] text-ink-dim tracking-wide uppercase text-center">
        CONSULADOS &gt; ZONA 10 &gt; PUESTO 02 &gt; MESA {mesa} &gt; {tipo} &gt; PÁG {pagina} DE {total}
      </span>
    </div>
  );
}

/** Tarjeta rica flotante (7.2 / rechazada_1): título + badge + breadcrumb + chips. */
function TarjetaRica({
  tone,
  titulo,
  badge,
  detalle,
  chips,
  nota,
}: {
  tone: "warn" | "crit" | "ok";
  titulo: string;
  badge: React.ReactNode;
  detalle?: string;
  chips?: React.ReactNode;
  nota?: React.ReactNode;
}) {
  const borde = tone === "ok" ? "border-ok-tint/40" : tone === "warn" ? "border-warn/40" : "border-crit/40";
  const anillo = tone === "ok" ? "ring-ok-tint/25" : tone === "warn" ? "ring-warn/25" : "ring-crit/25";
  const separador =
    tone === "ok" ? "border-ok-tint/20" : tone === "warn" ? "border-warn/20" : "border-crit/20";
  return (
    <div
      className={`pointer-events-auto rounded-xl bg-surface-1/95 backdrop-blur-xl border ${borde} p-3 shadow-2xl shadow-black/80 ring-1 ${anillo} flex flex-col gap-2.5 max-w-md w-full mx-4`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`w-2 h-2 rounded-full shrink-0 animate-pulse-sync ${
              tone === "ok" ? "bg-ok-tint" : tone === "warn" ? "bg-warn" : "bg-crit"
            }`}
          />
          <h2 className="text-xs font-bold text-white tracking-wide uppercase truncate">{titulo}</h2>
        </div>
        {badge}
      </div>
      {detalle && (
        <div className="flex items-center gap-1.5 text-[9px] font-mono tracking-wide px-0.5">
          <span
            className={`font-semibold ${
              tone === "ok" ? "text-ok-tint" : tone === "warn" ? "text-warn" : "text-crit"
            }`}
          >
            {detalle}
          </span>
        </div>
      )}
      {(chips || nota) && (
        <div className={`flex items-center justify-between ${separador ? "" : ""} border-t ${separador} pt-2 text-[9px] font-mono flex-wrap gap-1`}>
          <div className="flex items-center gap-1.5 flex-wrap">{chips}</div>
          {nota}
        </div>
      )}
    </div>
  );
}

/** Pill simple flotante (ENVIADA / GENERICO). */
function Pill({ tone, children }: { tone: "ok" | "crit"; children: React.ReactNode }) {
  return (
    <div
      className={`pointer-events-auto flex items-center gap-2 backdrop-blur-xl px-3.5 py-1.5 rounded-full shadow-lg shadow-black/80 ${
        tone === "ok"
          ? "bg-ok-ink/95 border border-ok-tint/40 ring-1 ring-ok-tint/25"
          : "bg-crit-ink/95 border border-crit/40 ring-1 ring-crit/25"
      }`}
    >
      {children}
    </div>
  );
}

export function ReviewView() {
  const acta = useE14Store((s) => s.actaActual);
  const paginaObjetivo = useE14Store((s) => s.paginaObjetivo);
  const [rotacion, setRotacion] = useState(0);

  if (!acta) return null;

  const tipo = paginaObjetivo?.tipo ?? "TRANSMISIÓN";
  const mesa = paginaObjetivo?.mesaId.replace(/\D/g, "").padStart(3, "0") ?? acta.ubicacion.mesa;
  const status = acta.status;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Breadcrumb bajo el header (solo cuando el banner NO lo incluye) */}
      {status === "ENVIADA" || status === "EN_REVISION_HUMANA" || acta.rechazo?.tipo === "GENERICO" ? (
        <Breadcrumb mesa={mesa} tipo={tipo} pagina={acta.pagina.index} total={acta.pagina.total} />
      ) : null}

      {/* Visor del documento */}
      <main className="flex-1 relative overflow-hidden flex flex-col items-center justify-center px-4 py-2 max-w-md mx-auto w-full min-h-0">
        {/* Banner flotante superpuesto (no desplaza el visor) */}
        <div className="absolute top-2 inset-x-0 z-30 flex justify-center pointer-events-none">
          {status === "ENVIADA" && (
            <Pill tone="ok">
              <span className="w-2 h-2 rounded-full bg-ok-tint animate-pulse-sync" />
              <span className="text-[10px] font-bold text-ok-tint font-mono tracking-wide">
                ✓ {acta.score.toFixed(1)}/10{" "}
                {acta.score >= 8 ? "ÓPTIMA" : "ENVIADA CON ADVERTENCIA"}
              </span>
              <span className="text-ink-faint text-[10px]">•</span>
              <span className="text-[10px] font-semibold text-white tracking-wide uppercase">
                Enviado correctamente
              </span>
            </Pill>
          )}

          {status === "ADVERTENCIA" && (
            <TarjetaRica
              tone="warn"
              titulo={acta.titulo}
              badge={
                <ScoreBadge tone="warn">
                  <span>⚠️</span>
                  <span>
                    {acta.score.toFixed(1)}/10 MODERADA
                  </span>
                </ScoreBadge>
              }
              detalle="ITALIA &gt; ZONA 10 &gt; PUESTO 02 &gt; MESA 001 &gt; TRANSMISIÓN &gt; PAG 1 DE 2"
              chips={
                <>
                  <Chip tone="warn" solid>
                    {tipo}
                  </Chip>
                  <Chip tone="neutral">
                    PÁG {acta.pagina.index} DE {acta.pagina.total}
                  </Chip>
                </>
              }
              nota={
                <span className="flex items-center gap-1 text-warn font-medium shrink-0">
                  <span>⚠️</span>
                  <span className="font-bold tracking-tight">REVISIÓN REQUERIDA (CONTRASTE)</span>
                </span>
              }
            />
          )}

          {status === "RECHAZADA" && acta.rechazo?.tipo === "ILEGIBLE" && (
            <TarjetaRica
              tone="crit"
              titulo="ACTA NO RECONOCIDA"
              badge={
                <ScoreBadge tone="crit">
                  <span>✕</span>
                  <span>{acta.score.toFixed(1)}/10 RECHAZADA</span>
                </ScoreBadge>
              }
              detalle="⚠️ CÓDIGO DE BARRAS Y CABECERA NO DETECTADOS"
              chips={
                <>
                  <span className="font-bold uppercase tracking-wider text-ink-dim bg-surface-4 border border-outline-dim px-2 py-0.5 rounded font-mono">
                    MESA DESCONOCIDA
                  </span>
                  <Chip tone="neutral">PÁG ? DE ?</Chip>
                </>
              }
              nota={
                <span className="flex items-center gap-1 text-crit font-medium shrink-0">
                  <span>✕</span>
                  <span className="font-bold tracking-tight">ERROR: CÓDIGO E-14 ILEGIBLE (REINTENTAR)</span>
                </span>
              }
            />
          )}

          {status === "RECHAZADA" && acta.rechazo?.tipo === "GENERICO" && (
            <Pill tone="crit">
              <span className="w-2 h-2 rounded-full bg-crit animate-pulse-sync" />
              <span className="text-[10px] font-bold text-crit font-mono tracking-wide">
                ✕ {acta.score.toFixed(1)}/10 RECHAZADA
              </span>
              <span className="text-ink-faint text-[10px]">•</span>
              <span className="text-[10px] font-semibold text-white tracking-wide uppercase">
                Obligatorio repetir
              </span>
            </Pill>
          )}

          {status === "EN_REVISION_HUMANA" && (
            <div className="pointer-events-auto rounded-xl bg-warn-ink/95 backdrop-blur-xl border border-warn/40 ring-1 ring-warn/25 px-3.5 py-2.5 shadow-2xl shadow-black/80 max-w-md w-full mx-4 flex items-center gap-2.5">
              <WarnTriangleIcon className="w-4 h-4 text-warn shrink-0" />
              <div className="flex flex-col min-w-0">
                <span className="font-mono text-[11px] font-bold tracking-wide uppercase text-white">
                  ENVIADA A REVISIÓN HUMANA
                </span>
                <span className="text-[10px] text-ink-dim font-mono">
                  Un auditor validará esta acta
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Visor con brackets */}
        <section className="relative bg-surface-1 rounded-xl border border-line p-3 flex flex-col items-center justify-between w-full h-full min-h-0 max-h-[calc(100vh-260px)]">
          <div className="w-full flex-1 relative flex items-center justify-center py-2 px-1 min-h-0">
            <div className="absolute inset-x-1 inset-y-1 pointer-events-none z-10" aria-hidden>
              <div className={`absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 ${tonoBrackets(status)}`} />
              <div className={`absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 ${tonoBrackets(status)}`} />
              <div className={`absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 ${tonoBrackets(status)}`} />
              <div className={`absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 ${tonoBrackets(status)}`} />
            </div>
            <ActaDocument acta={acta} rotacion={rotacion} />
          </div>

          {/* Toolbar (solo ADVERTENCIA y RECHAZADA — code.html) */}
          {(status === "ADVERTENCIA" || status === "RECHAZADA") && (
            <div className="w-full max-w-sm grid grid-cols-3 gap-2 pt-2 shrink-0 z-20">
              <ToolbarBtn icon={<CropIcon />} label="Recortar" />
              <ToolbarBtn
                icon={<RotateIcon />}
                label="Rotar 90°"
                onClick={() => setRotacion((r) => (r + 90) % 360)}
              />
              <ToolbarBtn icon={<FullscreenIcon />} label="Pantalla completa" />
            </div>
          )}
        </section>

        {/* Chips de envío automático (§7.4) */}
        {status === "ENVIADA" && (
          <div className="w-full max-w-sm flex items-center justify-center gap-1.5 pt-2 flex-wrap">
            <Chip tone="ok" solid>
              {tipo}
            </Chip>
            <Chip tone="neutral">
              PÁG {acta.pagina.index} DE {acta.pagina.total}
            </Chip>
            {acta.enviadoAutomaticamente && (
              <span className="flex items-center gap-1.5 font-data text-[9px]">
                <span className="text-ok-tint font-bold">✓ ENVIADO AUTOMÁTICAMENTE</span>
                <span className="text-ink-dim">{acta.enviadoAutomaticamente}</span>
              </span>
            )}
            {acta.hashSha256 && (
              <span className="font-data text-[8px] text-ink-faint">
                SHA-256: {acta.hashSha256}
              </span>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

/** CTAs del footer por estado (se anclan sobre el BottomNav, §7.4/§7.5). */
export function ReviewCtas() {
  const acta = useE14Store((s) => s.actaActual);
  const navegar = useE14Store((s) => s.navegar);
  const enviarActa = useE14Store((s) => s.enviarActa);
  const repetirFoto = useE14Store((s) => s.repetirFoto);
  const enviarRevisionHumana = useE14Store((s) => s.enviarRevisionHumana);

  if (!acta) return null;
  const status = acta.status;

  if (status === "ENVIADA") {
    return (
      <button
        type="button"
        onClick={() => navegar("escanear")}
        className="w-full h-12 py-3 px-5 bg-ok-tint hover:bg-ok active:bg-ok text-ok-ink font-extrabold text-sm uppercase tracking-wider rounded-xl flex items-center justify-center gap-2.5 shadow-[0_0_12px_rgba(63,229,108,0.45)] transition-all transform active:scale-[0.98]"
      >
        <span>seguir escaneando</span>
      </button>
    );
  }

  if (status === "ADVERTENCIA") {
    return (
      <div className="flex flex-row items-center gap-2 w-full">
        <PrimaryBtn variant="warn" onClick={enviarActa}>
          <span>⚠ ENVIAR A TRANSMISIÓN</span>
        </PrimaryBtn>
        <PrimaryBtn variant="outline" onClick={repetirFoto}>
          <span>REPETIR</span>
        </PrimaryBtn>
      </div>
    );
  }

  if (status === "RECHAZADA") {
    return (
      <div className="flex items-center gap-2 w-full">
        <PrimaryBtn
          variant="crit"
          onClick={repetirFoto}
          icon={<RefreshIcon className="w-3.5 h-3.5" />}
        >
          <span>
            OBLIGATORIO REPETIR FOTO (INTENTO {acta.intento} DE {acta.maxIntentos})
          </span>
        </PrimaryBtn>
        <PrimaryBtn
          variant="outline-crit"
          onClick={enviarRevisionHumana}
          icon={<WarnTriangleIcon className="w-3.5 h-3.5 text-crit" />}
        >
          <span>⚠ ENVIAR A REVISIÓN HUMANA</span>
        </PrimaryBtn>
      </div>
    );
  }

  if (status === "EN_REVISION_HUMANA") {
    return (
      <div className="flex items-center gap-2 w-full">
        <PrimaryBtn variant="outline" onClick={() => navegar("escanear")}>
          <span>VOLVER AL ESCÁNER</span>
        </PrimaryBtn>
      </div>
    );
  }

  return null;
}
