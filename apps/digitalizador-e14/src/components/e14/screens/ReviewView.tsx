"use client";

/**
 * REVISIÓN (§7.4–§7.5) — documento + banner por estado + CTAs.
 * Estados: ENVIADA · ADVERTENCIA · RECHAZADA (ILEGIBLE rica / GENERICO pill)
 * · EN_REVISION_HUMANA.
 * UX-REAL F1/F3 (SPEC-ux-real-bn-editor, D35–D37): el visor es ÚNICO y es la
 * FOTO REAL del core (el papel sintético/ActaDocument se retiró — petición
 * del dueño: «no la quiero volver a ver»). VER FOTO dejó de existir: la foto
 * procesada es el contenido por defecto de la tarjeta. L5 (§7 ReviewView):
 * RECORTAR abre el QuadEditor (§7.5) · ROTAR 90° gira la foto (horneada para
 * el PDF) · PANTALLA COMPLETA abre el visor modal. F5: barra de controles
 * FIJA en la parte inferior del editor (fuera de la tarjeta — D38).
 * F-OCR (SPEC-e14-texto-ocr-editor §F1-§F3, D39): 5º botón TEXTO (abre el
 * sheet «Texto reconocido» — el OCR corre dentro, igual que el lab) con
 * contadores, copiar al portapapeles y re-reconocer (B1-B6 del lab).
 */
import { useEffect, useMemo, useState } from "react";
import { useE14Store } from "@/lib/e14/store";
import { OCR_NO_TEXT } from "@jg-stevan/scanner-core/ocr";
import { defaultQuad, FILTER_PRESETS } from "@jg-stevan/scanner-core/types";
import type { PageFilter } from "@jg-stevan/scanner-core/types";
import { QuadEditor } from "../QuadEditor";
import { PanelClasificacion } from "../PanelClasificacion";
import { Chip, PrimaryBtn, ScoreBadge, ToolbarBtn } from "../primitives";
import { CopyIcon, CropIcon, DownloadIcon, FullscreenIcon, LoaderIcon, RefreshIcon, RotateIcon, ScanTextIcon, SlidersIcon, WarnTriangleIcon } from "../icons";

// Fuente: apps/scanner-lab/src/components/scanner/EditorView.tsx L89-L93
// (CSS_FILTERS — aproximación CSS de cada filtro para las previews en vivo:
// solo cosmética; el procesado real ocurre al elegir, vía store.cambiarFiltro).
const CSS_FILTERS: Record<PageFilter, string> = {
  original: "none",
  text: "brightness(1.12) contrast(1.35)",
  bw: "grayscale(1) contrast(2.6) brightness(1.05)",
};

/** Color de brackets según el estado del acta. */
function tonoBrackets(status: string) {
  if (status === "ADVERTENCIA" || status === "EN_REVISION_HUMANA") return "border-warn";
  if (status === "RECHAZADA") return "border-crit";
  return "border-ok-tint";
}

// Fuente: apps/scanner-lab/src/components/scanner/EditorView.tsx L237-271
// (OcrHighlightedText — F-FIND: texto OCR con las coincidencias de la
// búsqueda resaltadas, marca amarilla #ffd60a estilo iOS, case-insensitive.
// Sin consulta activa se renderiza el texto plano). Copia COMPLETA aunque e14
// hoy siempre pasa query={null} (degrada a texto plano) — queda lista para
// F-FIND futuro. El <mark> amarillo se conserva literal (no hay token
// equivalente en e14 — re-vestido no aplica).
function OcrHighlightedText({
  text,
  query,
}: {
  text: string;
  query: string | null;
}) {
  const q = query?.trim();
  if (!q) {
    return (
      <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-white/90">
        {text}
      </p>
    );
  }
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  const needle = q.toLowerCase();
  return (
    <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-white/90">
      {parts.map((part, i) =>
        part.toLowerCase() === needle ? (
          <mark
            key={i}
            className="rounded-[3px] bg-[#ffd60a] px-0.5 font-semibold text-black"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </p>
  );
}

/** Breadcrumb canónico (§7.4) bajo el header. */
function Breadcrumb({
  mesa,
  tipo,
  pagina,
  total,
  ruta,
}: {
  mesa: string;
  tipo: string;
  pagina: number;
  total: number;
  /** §6: ruta REAL de la clasificación (cuando existe) en vez del seed fijo. */
  ruta?: string;
}) {
  return (
    <div className="shrink-0 py-1.5 flex justify-center">
      <span className="font-data text-[9px] text-ink-dim tracking-wide uppercase text-center">
        {ruta ?? `CONSULADOS > ZONA 10 > PUESTO 02 > MESA ${mesa} > ${tipo} > PÁG ${pagina} DE ${total}`}
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

/** Pill simple flotante (ENVIADA / GENERICO / ÓPTIMA rescatada). */
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
  const recortando = useE14Store((s) => s.recortando);
  const revelando = useE14Store((s) => s.revelando);
  const aplicarRecorte = useE14Store((s) => s.aplicarRecorte);
  const rotarFoto = useE14Store((s) => s.rotarFoto);
  const cambiarFiltro = useE14Store((s) => s.cambiarFiltro);
  const reconocerTextoActa = useE14Store((s) => s.reconocerTextoActa);
  const notificar = useE14Store((s) => s.notificar);
  // L5 §7.5: editor de recorte y visor a pantalla completa (estado local —
  // el acta solo cambia por store.aplicarRecorte al APLICAR).
  const [editando, setEditando] = useState(false);
  const [visorAbierto, setVisorAbierto] = useState(false);
  // F2 (§F2.2): sheet de filtros (copia del lab EditorView L2253-2309).
  const [filtrosAbierto, setFiltrosAbierto] = useState(false);
  // F-OCR (§F3.3, D39): sheet «Texto reconocido» (copia del lab EditorView
  // L2311-2416) + estado "corriendo" LOCAL (igual que el lab: ocrRunning es
  // del componente, L347 — el store no re-entra mientras esto esté true).
  const [textoAbierto, setTextoAbierto] = useState(false);
  const [ocrEjecutando, setOcrEjecutando] = useState(false);
  // Fuente: apps/scanner-lab/src/components/scanner/EditorView.tsx L1563-1578
  // (ocrStats — contadores del sheet de texto). ADAPTACIÓN: sin `matches`
  // (F-FIND excluido — e14 no tiene biblioteca buscable, §1 del spec).
  const ocrStats = useMemo(() => {
    const text = acta?.ocrTexto ?? "";
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return { words, chars: text.length };
  }, [acta?.ocrTexto]);

  // L5: Esc cierra el visor (tap en cualquier lado también).
  useEffect(() => {
    if (!visorAbierto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setVisorAbierto(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [visorAbierto]);

  if (!acta) return null;

  // Fase B (§6 — coherencia de display): clasificación AUTO resuelta → la
  // REVISIÓN muestra la ubicación REAL (tipo/mesa/página del acta), no la del
  // seed demo. Sin clasificación (flujo seed/C4) queda como estaba.
  const clasifAuto = acta.clasificacion?.nivel === "AUTO" ? acta.clasificacion : null;
  const tipo = clasifAuto?.tipo
    ? (clasifAuto.tipo === "TRANSMISION" ? "TRANSMISIÓN" : "DELEGADOS")
    : (paginaObjetivo?.tipo ?? "TRANSMISIÓN");
  const mesa =
    clasifAuto?.mesa !== null && clasifAuto?.mesa !== undefined
      ? String(clasifAuto.mesa).padStart(3, "0")
      : (paginaObjetivo?.mesaId.replace(/\D/g, "").padStart(3, "0") ?? acta.ubicacion.mesa);
  const paginaIdx = clasifAuto ? (clasifAuto.pagina?.index ?? 1) : acta.pagina.index;
  const paginaTotal = clasifAuto ? (clasifAuto.pagina?.total ?? 2) : acta.pagina.total;
  const detalleUbicacion = clasifAuto
    ? `${clasifAuto.departamento?.nombre ?? "—"} > ZONA ${clasifAuto.zona?.codigo ?? "—"} > ` +
      `PUESTO ${clasifAuto.puesto?.codigo ?? "—"} > MESA ${clasifAuto.mesa ?? "—"} > ${tipo} > ` +
      `PÁG ${paginaIdx} DE ${paginaTotal}`
    : "ITALIA > ZONA 10 > PUESTO 02 > MESA 001 > TRANSMISIÓN > PÁG 1 DE 2";
  const status = acta.status;
  const hayFoto = Boolean(acta.fotoProcesada);
  // D35: SIMULACIÓN produce fotos reales (pipeline real) — el gate es la foto, no la fuente.
  const esReal = Boolean(acta.fotoProcesada);
  // F-OCR (§F1.2, D39): TEXTO activo cuando ya hay texto válido (el pipeline
  // corre el OCR SIEMPRE — §1 del spec; OCR_NO_TEXT distingue el vacío que
  // pudo dejar el pipeline: ocr.ts L12 del core, PROHIBIDO re-declararlo).
  const hayTexto = Boolean(acta.ocrTexto) && acta.ocrTexto !== OCR_NO_TEXT;

  // Fuente: apps/scanner-lab/src/components/scanner/EditorView.tsx L1446-1455
  // (copyOcrText). Re-vestido: toasts e14 con títulos en mayúsculas
  // (descripciones verbatim del lab).
  const copiarTexto = async () => {
    const text = acta.ocrTexto ?? "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      notificar("ok", "TEXTO COPIADO", "Texto copiado al portapapeles");
    } catch {
      notificar("crit", "NO SE PUDO COPIAR", "No se pudo copiar el texto");
    }
  };

  // F-OCR (§F2, D39): el estado "corriendo" es LOCAL (ocrRunning del lab
  // L347) — envuelve el store action y lo apaga SIEMPRE (finally).
  const ejecutarOcr = async () => {
    setOcrEjecutando(true);
    try {
      await reconocerTextoActa();
    } finally {
      setOcrEjecutando(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Breadcrumb bajo el header (solo cuando el banner NO lo incluye) */}
      {status === "ENVIADA" || status === "EN_REVISION_HUMANA" || acta.rechazo?.tipo === "GENERICO" ? (
        <Breadcrumb
          mesa={mesa}
          tipo={tipo}
          pagina={paginaIdx}
          total={paginaTotal}
          ruta={clasifAuto ? detalleUbicacion : undefined}
        />
      ) : null}

      {/* Visor del documento — F5 (D38): la tarjeta es SOLO visual (sin
          toolbar dentro); mide lo que mida el documento. La barra de
          controles vive FUERA, anclada abajo con alto CONSTANTE. */}
      <main className="flex-1 relative overflow-hidden flex flex-col items-center px-4 py-2 max-w-md mx-auto w-full min-h-0">
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

          {status === "OPTIMA" && (
            <Pill tone="ok">
              <span className="w-2 h-2 rounded-full bg-ok-tint animate-pulse-sync" />
              <span className="text-[10px] font-bold text-ok-tint font-mono tracking-wide">
                ✓ {acta.score.toFixed(1)}/10 ÓPTIMA
              </span>
              <span className="text-ink-faint text-[10px]">•</span>
              <span className="text-[10px] font-semibold text-white tracking-wide uppercase">
                Recuperada — envío manual
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
              detalle={detalleUbicacion}
              chips={
                <>
                  <Chip tone="warn" solid>
                    {tipo}
                  </Chip>
                  <Chip tone="neutral">
                    PÁG {paginaIdx} DE {paginaTotal}
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

        {/* Visor con brackets — F3: la FOTO REAL es el visor ÚNICO (el papel
            sintético se retiró — petición del dueño). El placeholder (solo
            posible si el pipeline agotó el timeout sin procesar) es la MISMA
            caja con brackets y texto centrado font-data. F5: la tarjeta es SOLO
            visual (flex-1) — sin toolbar dentro (barra fija abajo, D38). */}
        <section className="relative bg-surface-1 rounded-xl border border-line p-3 flex items-center justify-center w-full flex-1 min-h-0">
          <div className="w-full h-full relative flex items-center justify-center py-2 px-1 min-h-0">
            <div className="absolute inset-x-1 inset-y-1 pointer-events-none z-10" aria-hidden>
              <div className={`absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 ${tonoBrackets(status)}`} />
              <div className={`absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 ${tonoBrackets(status)}`} />
              <div className={`absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 ${tonoBrackets(status)}`} />
              <div className={`absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 ${tonoBrackets(status)}`} />
            </div>
            {hayFoto ? (
              <img
                src={acta.fotoProcesada}
                alt="Foto real del acta procesada por el core"
                className="w-full h-full object-contain rounded-sm"
              />
            ) : (
              <div className="flex items-center justify-center w-full h-full">
                <span className="font-data text-[10px] tracking-[0.2em] text-ink-faint uppercase">
                  FOTO NO DISPONIBLE
                </span>
              </div>
            )}
          </div>
        </section>

        {/* Chips de envío automático (§7.4) — F5: quedan como están (ENVIADA
            no tiene barra: los CTAs de abajo ya dan EXPORTAR PDF/SEGUIR). */}
        {status === "ENVIADA" && (
          <div className="w-full max-w-sm flex items-center justify-center gap-1.5 pt-2 flex-wrap">
            <Chip tone="ok" solid>
              {tipo}
            </Chip>
            <Chip tone="neutral">
              PÁG {paginaIdx} DE {paginaTotal}
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

        {/* ── BARRA DE CONTROLES FIJA (F5/D38): full width del editor, shrink-0,
            alto CONSTANTE, anclada al borde inferior (justo encima de los
            CTAs/BottomNav que renderiza page.tsx). Al girar el documento
            RETRATO↔APAISADO la tarjeta absorbe el cambio (flex-1) — la barra
            NO se mueve ni un píxel. F2 (§F2.2): FILTROS → grid-cols-4.
            F-OCR (§F1, D39): TEXTO en 4ª posición (orden del lab L2200-2216:
            … Filtros · Texto · …) → grid-cols-5. */}
        {(status === "ADVERTENCIA" ||
          status === "RECHAZADA" ||
          (status === "OPTIMA" && esReal)) && (
          <div className="w-full grid grid-cols-5 gap-2 pt-2 shrink-0 z-20">
            <ToolbarBtn
              icon={<CropIcon />}
              label="Recortar"
              onClick={esReal && acta.fotoOriginal ? () => setEditando(true) : undefined}
            />
            <ToolbarBtn
              icon={<RotateIcon />}
              label="Rotar 90°"
              onClick={esReal ? () => void rotarFoto() : undefined}
            />
            {/* Fuente: apps/scanner-lab/src/components/scanner/EditorView.tsx
                L2200-2204 (gatillo «Filtros» del toolbar del lab). */}
            <ToolbarBtn
              icon={<SlidersIcon />}
              label="Filtros"
              onClick={
                esReal && acta.fotoOriginal && !revelando
                  ? () => setFiltrosAbierto(true)
                  : undefined
              }
            />
            {/* Fuente: apps/scanner-lab/src/components/scanner/EditorView.tsx
                L2205-2210 (ToolItem «Texto» del toolbar — active con OCR hecho;
                NO ejecuta el OCR: abre el sheet, el OCR corre dentro). */}
            <ToolbarBtn
              icon={<ScanTextIcon />}
              label="Texto"
              active={hayTexto}
              onClick={
                acta.fotoProcesada && !ocrEjecutando
                  ? () => setTextoAbierto(true)
                  : undefined
              }
            />
            <ToolbarBtn
              icon={<FullscreenIcon />}
              label="Pantalla completa"
              onClick={esReal && acta.fotoProcesada ? () => setVisorAbierto(true) : undefined}
            />
          </div>
        )}
      </main>

      {/* ── PANEL DE CORRECCIÓN §5 (SPEC-cabecera-clasificacion): SOLO cuando
          el acta está EN_REVISION_HUMANA con clasificación PENDIENTE (§4.2:
          calidad OK pero cabecera SUGERIDA/MANUAL — la foto era buena). El
          camino C4 (RECHAZADA → revisión humana) no lleva clasificación → el
          panel no aparece. Encima de las acciones actuales, sin quitar nada. */}
      {status === "EN_REVISION_HUMANA" &&
        acta.clasificacion &&
        acta.clasificacion.nivel !== "AUTO" && <PanelClasificacion />}

      {/* L5 §7.5 — EDITOR DE RECORTE (overlay a pantalla completa sobre la
          foto ORIGINAL; quad inicial = detección automática o defaultQuad).
          Puro por props (D19): el acta solo cambia vía store.aplicarRecorte
          al APLICAR; CANCELAR descarta sin tocar nada (rotaciones y
          detecciones del editor incluidas). F4/D37: APLICAR entrega
          quad + rotación LOCAL del editor → quedan horneadas. */}
      {editando && acta.fotoOriginal ? (
        <QuadEditor
          fotoOriginal={acta.fotoOriginal}
          quadInicial={acta.quadDetectado ?? defaultQuad()}
          rotation={acta.rotation ?? 0}
          aplicando={recortando}
          onCancelar={() => setEditando(false)}
          onAplicar={(quad, rotacion) => {
            void aplicarRecorte(quad, rotacion).then(() => setEditando(false));
          }}
        />
      ) : null}

      {/* ── F2 (§F2.2) — SHEET DE FILTROS: copia del sheet del lab
          (EditorView.tsx L2253-2309), re-vestida: vaul → fixed bottom sheet
          + animate-editor-enter (e14 NO instala deps nuevas — SPEC §C);
          #007AFF/#1c1c1e → tokens ok-tint/surface-1; page.original →
          acta.fotoOriginal; activo por acta.filtro (default "bw", D36). */}
      {filtrosAbierto && acta.fotoOriginal ? (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setFiltrosAbierto(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-label="Filtros del acta"
            className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md rounded-t-[22px] bg-surface-1 pb-safe outline-none animate-editor-enter"
          >
            <div className="mx-auto mt-2.5 h-1.5 w-9 rounded-full bg-white/25" />
            <h3 className="px-5 pb-1 pt-3 text-center text-[17px] font-semibold text-white">
              Filtros
            </h3>
            <p className="sr-only">Elige un filtro para el acta en edición</p>
            <div className="flex gap-3 overflow-x-auto px-5 pb-5 pt-2">
              {FILTER_PRESETS.map((f) => {
                const activo = acta.filtro === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    // Fuente: apps/scanner-lab/src/components/scanner/EditorView.tsx
                    // L1214-1218 (handleFilter — aplica y cierra; el toast
                    // «Filtro aplicado: …» lo emite el store.cambiarFiltro).
                    onClick={() => {
                      void cambiarFiltro(f.id);
                      setFiltrosAbierto(false);
                    }}
                    className="flex w-[78px] shrink-0 flex-col items-center gap-1.5"
                  >
                    <span
                      className={`block h-[104px] w-full overflow-hidden rounded-xl border-2 ${
                        activo
                          ? "border-ok-tint shadow-[0_0_0_3px_rgba(63,229,108,0.25)]"
                          : "border-white/10"
                      }`}
                    >
                      <img
                        src={acta.fotoOriginal}
                        alt=""
                        draggable={false}
                        style={{ filter: CSS_FILTERS[f.id] ?? "none" }}
                        className="h-full w-full object-cover"
                      />
                    </span>
                    <span
                      className={`text-[11px] ${
                        activo ? "font-medium text-white" : "text-ink-faint"
                      }`}
                    >
                      {f.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      ) : null}

      {/* ── F-OCR (§F3, D39) — SHEET «TEXTO RECONOCIDO»: copia del sheet de
          OCR del lab (Fuente: apps/scanner-lab/src/components/scanner/
          EditorView.tsx L2311-2416 — vaul → patrón del sheet de filtros e14),
          re-vestido: #007AFF → ok-tint; #8e8e93 → ink-faint; ring-white/10 →
          ring-line; motion.button → button con active:scale. F-FIND excluido
          (barra de coincidencias L2347-2366 — e14 no tiene biblioteca
          buscable); multi-página excluido (e14 = UN acta de UNA página). */}
      {textoAbierto && acta ? (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setTextoAbierto(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-label="Texto reconocido del acta"
            className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md rounded-t-[22px] bg-surface-1 pb-safe outline-none animate-editor-enter"
          >
            <div className="mx-auto mt-2.5 h-1.5 w-9 rounded-full bg-white/25" />
            {/* Fuente: apps/scanner-lab/src/components/scanner/EditorView.tsx
                L2327-2333 (título del sheet con ScanText en el acento). */}
            <h3 className="flex items-center justify-center gap-2 px-5 pb-1 pt-3 text-center text-[17px] font-semibold text-white">
              <ScanTextIcon className="size-[18px] text-ok-tint" />
              Texto reconocido
            </h3>
            <p className="sr-only">Texto extraído por OCR del acta</p>

            <div className="px-5 pb-4 pt-1">
              {/* Tres estados (lab L2336-2416 — idénticos). */}
              {ocrEjecutando ? (
                /* Ejecutando (lab L2336-2344 — sin la variante multi-página). */
                <div className="flex min-h-[140px] flex-col items-center justify-center gap-3">
                  <LoaderIcon className="h-6 w-6 animate-spin text-ok-tint" />
                  <span className="text-[13px] font-medium text-white/70">
                    Reconociendo texto…
                  </span>
                </div>
              ) : hayTexto ? (
                <>
                  {/* Caja de texto (lab L2367-2369). (?? "" solo satisface a
                      TS — hayTexto ya garantizó texto no vacío.) */}
                  <div className="max-h-[38vh] overflow-y-auto rounded-xl bg-black/40 p-3.5 ring-1 ring-inset ring-line">
                    <OcrHighlightedText text={acta.ocrTexto ?? ""} query={null} />
                  </div>
                  {/* Contadores informativos (lab L2370-2378, estilo chips iOS). */}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 px-0.5">
                    <span className="rounded-full bg-white/8 px-2.5 py-1 text-[11.5px] font-medium tabular-nums text-white/60">
                      {ocrStats.words} {ocrStats.words === 1 ? "palabra" : "palabras"}
                    </span>
                    <span className="rounded-full bg-white/8 px-2.5 py-1 text-[11.5px] font-medium tabular-nums text-white/60">
                      {ocrStats.chars} {ocrStats.chars === 1 ? "carácter" : "caracteres"}
                    </span>
                  </div>
                  {/* Fila de botones (lab L2379-2396). */}
                  <div className="mt-3 flex gap-2.5">
                    <button
                      type="button"
                      onClick={() => void ejecutarOcr()}
                      className="flex-1 rounded-full bg-white/10 py-2.5 text-[14px] font-semibold text-white/90 ring-1 ring-inset ring-white/15 transition-all active:scale-[0.97]"
                    >
                      Reconocer de nuevo
                    </button>
                    <button
                      type="button"
                      onClick={() => void copiarTexto()}
                      className="flex flex-[1.3] items-center justify-center gap-1.5 rounded-full bg-ok-tint py-2.5 text-[14px] font-semibold text-ok-ink shadow-[0_4px_16px_rgba(63,229,108,0.4)] transition-all active:scale-[0.97]"
                    >
                      <CopyIcon className="size-4" />
                      Copiar texto
                    </button>
                  </div>
                </>
              ) : (
                /* Vacío (lab L2398-2415 — hint adaptado §F3.2.3: e14 no tiene
                   biblioteca). */
                <div className="flex min-h-[140px] flex-col items-center justify-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/8">
                    <ScanTextIcon className="h-6 w-6 text-ink-faint" />
                  </div>
                  <span className="max-w-[260px] text-center text-[13px] leading-snug text-ink-faint">
                    Extrae el texto del acta para copiarlo.
                  </span>
                  <button
                    type="button"
                    onClick={() => void ejecutarOcr()}
                    className="rounded-full bg-ok-tint px-6 py-2.5 text-[14px] font-semibold text-ok-ink shadow-[0_4px_16px_rgba(63,229,108,0.4)] transition-all active:scale-[0.97]"
                  >
                    Reconocer texto
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      ) : null}

      {/* L5 §7 — PANTALLA COMPLETA: visor modal de la foto procesada
          (object-contain, tap en cualquier lado o Esc cierra). */}
      {visorAbierto && acta.fotoProcesada ? (
        <div
          role="dialog"
          aria-label="Foto del acta a pantalla completa"
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 animate-editor-enter"
          onClick={() => setVisorAbierto(false)}
        >
          <img
            src={acta.fotoProcesada}
            alt="Foto procesada del acta a pantalla completa"
            className="max-w-full max-h-full object-contain rounded-sm shadow-2xl shadow-black"
            draggable={false}
          />
          <span className="absolute top-3 inset-x-0 text-center font-data text-[9px] tracking-[0.2em] text-ink-dim uppercase">
            Toca o ESC para cerrar
          </span>
        </div>
      ) : null}
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
  const exportarPdfActa = useE14Store((s) => s.exportarPdfActa);

  if (!acta) return null;
  const status = acta.status;
  // D35: SIMULACIÓN produce fotos reales (pipeline real) — el gate es la foto, no la fuente.
  const esReal = Boolean(acta.fotoProcesada);

  if (status === "ENVIADA") {
    // L4 §6: EXPORTAR PDF junto a SEGUIR ESCANEANDO — actas con foto real
    // (D35: SIMULACIÓN incluida — el gate es la foto, no la fuente).
    if (esReal) {
      return (
        <div className="flex flex-row items-center gap-2 w-full">
          <PrimaryBtn variant="outline" onClick={() => void exportarPdfActa()}>
            <DownloadIcon className="w-4 h-4" />
            <span>EXPORTAR PDF</span>
          </PrimaryBtn>
          <button
            type="button"
            onClick={() => navegar("escanear")}
            className="flex-1 h-12 py-3 px-5 bg-ok-tint hover:bg-ok active:bg-ok text-ok-ink font-extrabold text-sm uppercase tracking-wider rounded-xl flex items-center justify-center gap-2.5 shadow-[0_0_12px_rgba(63,229,108,0.45)] transition-all transform active:scale-[0.98]"
          >
            <span>seguir escaneando</span>
          </button>
        </div>
      );
    }
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

  if (status === "OPTIMA") {
    // L5 D20: ÓPTIMA SOLO llega aquí tras un rescate por recorte (la ÓPTIMA
    // de captura se auto-envía D4) → CTAs de ENVÍO MANUAL (sin auto-envío:
    // evita la semántica de doble transmisión). "enviarActa" ya la acepta.
    return (
      <div className="flex flex-row items-center gap-2 w-full">
        <PrimaryBtn variant="ok" onClick={enviarActa}>
          <span>ENVIAR A TRANSMISIÓN</span>
        </PrimaryBtn>
        <PrimaryBtn variant="outline" onClick={repetirFoto}>
          <span>REPETIR</span>
        </PrimaryBtn>
      </div>
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
