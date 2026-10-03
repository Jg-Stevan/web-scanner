"use client";

/**
 * ⚙️ Ajustes — grupos estilo iOS (Captura, Procesamiento, Exportación,
 * Almacenamiento, Acerca de) con switches azules, select de calidad PDF
 * y borrado de todos los documentos con confirmación.
 */

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Copy, Download, FileText, Layers, Loader2, ScanText, Star, Tags, Trash2, HardDrive } from "lucide-react";
import { toast } from "sonner";

import { useScannerStore } from "@/lib/scanner/store";
import type { ScannerSettings } from "@/lib/scanner/types";
import { dataUrlBytes, formatBytes } from "@/lib/scanner/format";
import { countTagUsage } from "@/lib/scanner/tags";
import { getScannerWorker } from "@/lib/scanner/image-processor";
import { storageAvailable } from "@/lib/scanner/page-store";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Switch iOS: 51×31, thumb 25px, azul #007AFF cuando está activo. */
const SWITCH_IOS =  "h-[31px] w-[51px] data-[state=checked]:bg-[#007aff] data-[state=unchecked]:bg-[#e9e9ea] [&_[data-slot=switch-thumb]]:size-[25px]";

/** Snapshot del repositorio — nombre estable servido desde /downloads
 *  (archivo estático en public/, funciona en CUALQUIER despliegue) y vía
 *  /api/download (ruta de servidor, siempre la versión más fresca). */
const PROJECT_ZIP_NAME = "web-scanner-repo.zip";
const PROJECT_ZIP_STATIC = `/downloads/${PROJECT_ZIP_NAME}`;
const PROJECT_ZIP_API = `/api/download?file=${encodeURIComponent(PROJECT_ZIP_NAME)}`;

/** Atajos de teclado de escritorio (mostrados en Acerca de). */
const SHORTCUTS: { action: string; keys: string[]; hint?: string }[] = [
  { action: "Atrás / cerrar vista", keys: ["Esc"] },
  { action: "Salir de la selección múltiple", keys: ["Esc"] },
  { action: "Buscar en la biblioteca", keys: ["/"] },
  { action: "Página anterior · siguiente", keys: ["←", "→"] },
  { action: "Navegar y zoom en presentación", keys: ["←", "→", "+", "−"] },
  { action: "Salir de presentación", keys: ["Esc"] },
  { action: "Buscar en el texto del documento", keys: ["⌘F"], hint: "En el tab OCR" },
  { action: "Coincidencia anterior · siguiente", keys: ["⇧", "↩"] },
];

/** Gestos táctiles (documentados igual que los atajos). */
const GESTURES: { action: string; hint: string }[] = [
  { action: "Comparar con el original", hint: "Mantén pulsada la imagen del documento" },
  { action: "Reordenar páginas", hint: "Mantén pulsada una miniatura y arrastra" },
  { action: "Reordenar biblioteca", hint: "Orden Manual + asa ⠿ en la vista de lista" },
  { action: "Selección múltiple", hint: "Pulsación larga sobre un documento" },
];

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Mini-card de estadística (patrón widget de iOS: número grande + label). */
function StatCard({
  value,
  label,
  icon: Icon,
  color,
  delay = 0,
}: {
  value: string;
  label: string;
  icon: typeof FileText;
  color: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.32, delay, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col items-start gap-1 rounded-2xl bg-white px-3 pb-2.5 pt-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
    >
      <Icon className="size-[15px]" strokeWidth={2.2} style={{ color }} aria-hidden="true" />
      <span
        className="text-[20px] font-semibold leading-none tracking-[-0.3px] text-[#1c1c1e] tabular-nums"
      >
        {value}
      </span>
      <span className="text-[11px] font-medium leading-tight text-[#8e8e93]">{label}</span>
    </motion.div>
  );
}

export default function SettingsView() {
  const settings = useScannerStore((s) => s.settings);
  const updateSettings = useScannerStore((s) => s.updateSettings);
  const documents = useScannerStore((s) => s.documents);
  const wipeLibrary = useScannerStore((s) => s.wipeLibrary);

  const [confirmWipe, setConfirmWipe] = useState(false);

  const totalPages = useMemo(
    () => documents.reduce((n, d) => n + d.pages.length, 0),
    [documents]
  );

  /** Uso estimado: suma de todos los data URLs (originales + procesadas + miniaturas). */
  const storageBytes = useMemo(() => {
    let total = 0;
    for (const d of documents) {
      for (const p of d.pages) {
        total += dataUrlBytes(p.original) + dataUrlBytes(p.processed) + dataUrlBytes(p.thumbnail);
      }
    }
    return total;
  }, [documents]);

  const wipeAll = () => {
    if (documents.length === 0) {
      toast("No hay documentos que borrar");
      setConfirmWipe(false);
      return;
    }
    wipeLibrary();
    toast.success("Se borraron todos los documentos");
    setConfirmWipe(false);
  };

  /* ── Estadísticas de la biblioteca (panel resumen) ── */
  const favoriteCount = useMemo(
    () => documents.filter((d) => d.favorite).length,
    [documents]
  );
  const tagCount = useMemo(() => countTagUsage(documents).length, [documents]);
  const ocrPages = useMemo(
    () => documents.reduce((n, d) => n + d.pages.filter((p) => p.ocrDone).length, 0),
    [documents]
  );

  return (
    <div className="flex h-full w-full flex-col bg-[#f2f2f7]">
      {/* Header */}
      <header className="shrink-0 px-5 pb-2 pt-safe">
        <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.4px] text-black">
          Ajustes
        </h1>
        <p className="mt-1 text-[13px] text-[#8e8e93]">Personaliza tu escáner</p>
      </header>

      {/* Grupos estilo iOS con scroll central */}
      <div className="ios-scroll flex-1 overflow-y-auto overscroll-contain pb-8">
        {/* Panel de estadísticas de la biblioteca */}
        <section aria-label="Estadísticas de la biblioteca" className="px-5 pb-1 pt-2">
          <h2 className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-[#6d6d72]">
            Tu biblioteca
          </h2>
          <div className="grid grid-cols-3 gap-2">
            <StatCard
              value={String(documents.length)}
              label={plural(documents.length, "documento", "documentos")}
              icon={FileText}
              color="#007aff"
              delay={0.03}
            />
            <StatCard
              value={String(totalPages)}
              label={plural(totalPages, "página", "páginas")}
              icon={Layers}
              color="#5856d6"
              delay={0.06}
            />
            <StatCard
              value={String(ocrPages)}
              label="con texto OCR"
              icon={ScanText}
              color="#34c759"
              delay={0.09}
            />
            <StatCard
              value={String(favoriteCount)}
              label={plural(favoriteCount, "favorito", "favoritos")}
              icon={Star}
              color="#ff9500"
              delay={0.12}
            />
            <StatCard
              value={String(tagCount)}
              label={plural(tagCount, "etiqueta", "etiquetas")}
              icon={Tags}
              color="#ff2d55"
              delay={0.15}
            />
            <StatCard
              value={formatBytes(storageBytes)}
              label="espacio usado"
              icon={HardDrive}
              color="#8e8e93"
              delay={0.18}
            />
          </div>
        </section>


        <SettingsGroup label="Procesamiento" delay={0.1}>
          <SettingsRow title="Mejora automática" subtitle="Aplica el mejor filtro">
            <Switch
              checked={settings.enhance}
              onCheckedChange={(v) => updateSettings({ enhance: v })}
              aria-label="Mejora automática"
              className={SWITCH_IOS}
            />
          </SettingsRow>
          <SettingsRow title="Reconocimiento OCR" subtitle="Extrae texto de las páginas">
            <Switch
              checked={settings.ocrEnabled}
              onCheckedChange={(v) => updateSettings({ ocrEnabled: v })}
              aria-label="Reconocimiento OCR"
              className={SWITCH_IOS}
            />
          </SettingsRow>
          <SettingsRow
            title="Motor de precisión"
            subtitle="OpenCV · contornos + RANSAC + homografía"
          >
            <EngineBadge />
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup label="Exportación" delay={0.15}>
          <SettingsRow title="Calidad PDF">
            <Select
              value={settings.exportQuality}
              onValueChange={(v) =>
                updateSettings({ exportQuality: v as ScannerSettings["exportQuality"] })
              }
            >
              <SelectTrigger
                aria-label="Calidad PDF"
                className="h-9 rounded-lg border-[#e5e5ea] bg-[#f2f2f7] px-3.5 text-[14px] font-medium text-[#3c3c43] shadow-none focus-visible:ring-[3px] focus-visible:ring-[#007aff]/25 focus-visible:border-[#007aff]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-[#e5e5ea]">
                <SelectItem value="standard" className="text-[14px]">
                  Estándar
                </SelectItem>
                <SelectItem value="alta" className="text-[14px]">
                  Alta
                </SelectItem>
                <SelectItem value="máxima" className="text-[14px]">
                  Máxima
                </SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup label="Almacenamiento" delay={0.15}>
          <SettingsRow
            title="Uso estimado"
            subtitle={`${plural(documents.length, "documento", "documentos")} · ${plural(
              totalPages,
              "página",
              "páginas"
            )}`}
          >
            <span className="shrink-0 text-[15px] text-[#8e8e93]">{formatBytes(storageBytes)}</span>
          </SettingsRow>
          <SettingsRow
            title="Persistencia local"
            subtitle="IndexedDB · los documentos sobreviven al recargar"
          >
            <span
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold",
                storageAvailable()
                  ? "bg-[#34c759]/12 text-[#248a3d]"
                  : "bg-[#8e8e93]/15 text-[#8e8e93]"
              )}
              role="status"
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  storageAvailable()
                    ? "bg-[#34c759] shadow-[0_0_5px_rgba(52,199,89,0.8)]"
                    : "bg-[#8e8e93]"
                )}
                aria-hidden="true"
              />
              {storageAvailable() ? "Activa" : "No disp."}
            </span>
          </SettingsRow>
          <SettingsRow
            title="Borrar todos los documentos"
            destructive
            disabled={documents.length === 0}
            onClick={documents.length > 0 ? () => setConfirmWipe(true) : undefined}
          >
            <Trash2 className="h-[18px] w-[18px] shrink-0 text-[#ff3b30]" strokeWidth={2} aria-hidden="true" />
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup label="Acerca de" delay={0.2}>
          <SettingsRow title="Versión">
            <span className="shrink-0 text-[15px] text-[#8e8e93]">2.0.0</span>
          </SettingsRow>
          <div className="border-t border-[#f2f2f7] px-4 py-3">
            <p className="text-[15px] text-[#1c1c1e]">Atajos de teclado</p>
            <div className="mt-2 flex flex-col gap-1.5">
              {SHORTCUTS.map((s) => (
                <div key={s.action} className="flex items-center justify-between gap-3">
                  <span className="text-[13px] leading-snug text-[#8e8e93]">
                    {s.action}
                    {s.hint && (
                      <span className="ml-1.5 text-[11px] text-[#c7c7cc]">{s.hint}</span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {s.keys.map((k) => (
                      <kbd
                        key={k}
                        className="flex h-[22px] min-w-[22px] items-center justify-center rounded-[6px] border border-[#d1d1d6] border-b-2 bg-white px-1.5 font-sans text-[11px] font-semibold text-[#3c3c43] shadow-[0_1px_0_rgba(0,0,0,0.04)]"
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="border-t border-[#f2f2f7] px-4 py-3">
            <p className="text-[15px] text-[#1c1c1e]">Gestos</p>
            <div className="mt-2 flex flex-col gap-1.5">
              {GESTURES.map((g) => (
                <div key={g.action} className="flex items-center justify-between gap-3">
                  <span className="text-[13px] leading-snug text-[#8e8e93]">{g.action}</span>
                  <span className="max-w-[190px] text-right text-[11px] leading-snug text-[#c7c7cc]">
                    {g.hint}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex min-h-[44px] items-center border-t border-[#f2f2f7] px-4 py-3">
            <p className="text-[15px] text-[#8e8e93]">Hecho con precisión</p>
          </div>
        </SettingsGroup>

        {/* Snapshot del repositorio — para actualizar el repo git externo */}
        <SettingsGroup label="Proyecto" delay={0.22}>
          <ProjectDownloadRow />
        </SettingsGroup>
      </div>

      {/* AlertDialog: borrar todos los documentos */}
      <AlertDialog open={confirmWipe} onOpenChange={setConfirmWipe}>
        <AlertDialogContent className="max-w-[320px] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar todos los documentos?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminarán {plural(documents.length, "documento", "documentos")} con todas sus
              páginas. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2">
            <AlertDialogCancel className="mt-0 flex-1 rounded-full bg-[#f2f2f7] text-[15px] font-semibold text-[#3c3c43] hover:bg-[#e5e5ea]">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={wipeAll}
              className="flex-1 rounded-full border-0 bg-[#ff3b30] text-[15px] font-semibold text-white hover:bg-[#ff453a]"
            >
              Borrar todo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Piezas de los grupos estilo iOS                                     */
/* ------------------------------------------------------------------ */

/** Fila de descarga del snapshot del repositorio (grupo Proyecto).
 *
 *  ⚠️ LECCIONES DEL ENTORNO REAL (panel de vista previa = iframe):
 *  · fetch con method HEAD puede BLOQUEARSE antes de salir del iframe
 *    (las sondas del usuario nunca llegaron al servidor) → la sonda de
 *    tamaño usa GET + AbortController (se cancela al llegar cabeceras)
 *    y su fallo es SILENCIOSO: la fila se muestra SIEMPRE.
 *  · La descarga nativa de un iframe puede descartarse en silencio.
 *  → Al tocar, 3 capas: fetch→blob→<a download> → window.open (pestaña
 *    nueva) → fila «Copiar enlace» siempre visible como plan C. */
function ProjectDownloadRow() {
  const [busy, setBusy] = useState(false);
  const [framed, setFramed] = useState(false);
  const [sizeLabel, setSizeLabel] = useState("");

  useEffect(() => {
    // Iframe tras el montaje (server renderiza false → hidratación OK).
    try {
      setFramed(window.self !== window.top);
    } catch {
      setFramed(true); // acceso cross-origin bloqueado = está embebido
    }

    // Sonda de tamaño OPCIONAL: GET + abort justo tras las cabeceras
    // (HEAD puede estar bloqueado por el proxy del iframe). Si falla,
    // simplemente no se muestra el tamaño — la fila sigue activa.
    let stop = false;
    void (async () => {
      for (const url of [PROJECT_ZIP_API, PROJECT_ZIP_STATIC]) {
        try {
          const ctl = new AbortController();
          const r = await fetch(url, { signal: ctl.signal, cache: "no-store" });
          const bytes = Number(r.headers.get("Content-Length"));
          try {
            ctl.abort(); // ya tenemos las cabeceras — cancelar el cuerpo
          } catch {
            /* abort ya lanzado */
          }
          if (Number.isFinite(bytes) && bytes > 0) {
            if (!stop) setSizeLabel(` · ${formatBytes(bytes)}`);
            return;
          }
          if (!r.ok) continue; // probar la siguiente fuente
        } catch {
          /* sonda silenciosa — siguiente fuente */
        }
      }
    })();

    return () => {
      stop = true;
    };
  }, []);

  /** Descarga por código: 3 capas (blob → pestaña nueva → copiar enlace). */
  const onDownload = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      // Capa 1 — fetch → blob → <a download> programático (API → estático).
      let blob: Blob | null = null;
      for (const url of [PROJECT_ZIP_API, PROJECT_ZIP_STATIC]) {
        try {
          const r = await fetch(url, { cache: "no-store" });
          if (r.ok) {
            const b = await r.blob();
            if (b.size > 0) {
              blob = b;
              break;
            }
          }
        } catch {
          /* fetch bloqueado o ruta inexistente → siguiente fuente */
        }
      }
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = PROJECT_ZIP_NAME;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 8000);
        toast.success(
          framed
            ? "Descarga iniciada — si no ves el archivo, usa Copiar enlace"
            : `Descarga iniciada · ${formatBytes(blob.size)}`
        );
        return;
      }

      // Capa 2 — fetch bloqueado por el entorno: abrir en pestaña nueva
      // (el navegador gestiona la descarga de forma nativa ahí).
      const win = window.open(PROJECT_ZIP_STATIC, "_blank", "noopener,noreferrer");
      if (win) {
        toast("Se abrió una pestaña nueva con la descarga");
      } else {
        toast.error("Tu entorno bloquea la descarga — usa «Copiar enlace»");
      }
    } finally {
      setBusy(false);
    }
  };

  /** Plan C para entornos restrictivos: copiar el enlace directo. */
  const onCopyLink = async () => {
    const href = `${window.location.origin}${PROJECT_ZIP_STATIC}`;
    try {
      await navigator.clipboard.writeText(href);
      toast.success("Enlace copiado — ábrelo en una pestaña nueva");
    } catch {
      // Fallback sin Clipboard API (iframes restrictivos).
      try {
        const ta = document.createElement("textarea");
        ta.value = href;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        toast.success("Enlace copiado — ábrelo en una pestaña nueva");
      } catch {
        toast.error(href, { duration: 12000 });
      }
    }
  };

  return (
    <div>
      <a
        href={PROJECT_ZIP_STATIC}
        download={PROJECT_ZIP_NAME}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Descargar el código fuente del proyecto en ZIP"
        onClick={onDownload}
        className="flex min-h-[44px] w-full items-center justify-between gap-3 border-t border-[#f2f2f7] px-4 py-3 text-left transition-colors active:bg-[#f7f7f9]"
      >
        <div className="min-w-0">
          <p className="text-[15px] leading-snug font-medium text-[#007aff]">
            Descargar código fuente
          </p>
          <p className="mt-0.5 text-[12px] leading-snug text-[#8e8e93]">
            Repositorio completo en ZIP{sizeLabel}
            {framed ? " · si no inicia, usa Copiar enlace" : ""}
          </p>
        </div>
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#007aff]/10"
          aria-hidden="true"
        >
          {busy ? (
            <Loader2 className="size-[18px] animate-spin text-[#007aff]" strokeWidth={2.2} />
          ) : (
            <Download className="size-[18px] text-[#007aff]" strokeWidth={2.2} />
          )}
        </span>
      </a>
      <button
        type="button"
        onClick={onCopyLink}
        className="flex min-h-[44px] w-full items-center gap-2.5 border-t border-[#f2f2f7] px-4 py-3 text-left transition-colors active:bg-[#f7f7f9]"
        aria-label="Copiar enlace de descarga"
      >
        <Copy className="size-4 shrink-0 text-[#8e8e93]" strokeWidth={2.2} aria-hidden="true" />
        <span className="text-[13px] font-medium text-[#3c3c43]">Copiar enlace de descarga</span>
        <span className="ml-auto text-[12px] text-[#c7c7cc]">para pestaña nueva</span>
      </button>
    </div>
  );
}

/** Badge vivo del motor de precisión (worker + OpenCV) en Ajustes. */
function EngineBadge() {
  const [state, setState] = useState<"checking" | "on" | "off">("checking");
  useEffect(() => {
    let stop = false;
    const apply = (s: "on" | "off") => {
      if (!stop) setState(s);
    };
    const c = getScannerWorker();
    if (c && !c.isDead) {
      void c.waitReady().then((ok) => {
        if (ok) apply("on");
      });
    }
    const iv = window.setInterval(() => {
      const cc = getScannerWorker();
      if (cc?.isReady) {
        apply("on");
        window.clearInterval(iv);
      } else if (cc?.isDead) {
        apply("off");
        window.clearInterval(iv);
      }
    }, 800);
    return () => {
      stop = true;
      window.clearInterval(iv);
    };
  }, []);
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold",
        state === "on"
          ? "bg-[#34c759]/12 text-[#248a3d]"
          : state === "checking"
            ? "bg-[#8e8e93]/15 text-[#8e8e93]"
            : "bg-[#ff3b30]/10 text-[#ff3b30]"
      )}
      role="status"
      aria-label={`Motor de precisión ${state === "on" ? "activo" : state === "checking" ? "cargando" : "no disponible"}`}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          state === "on"
            ? "bg-[#34c759] shadow-[0_0_5px_rgba(52,199,89,0.8)]"
            : state === "checking"
              ? "animate-pulse bg-[#8e8e93]"
              : "bg-[#ff3b30]"
        )}
        aria-hidden="true"
      />
      {state === "on" ? "Activo" : state === "checking" ? "Cargando…" : "No disp."}
    </span>
  );
}

function SettingsGroup({
  label,
  delay = 0,
  children,
}: {
  label: string;
  delay?: number;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      aria-label={label}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay, ease: "easeOut" }}
    >
      <h2 className="px-5 pb-1.5 pt-4 text-[13px] font-medium uppercase tracking-[0.04em] text-[#8e8e93]">
        {label}
      </h2>
      <div className="mx-4 overflow-hidden rounded-xl bg-white shadow-[0_2px_8px_rgba(0,0,0,0.08)]">
        {children}
      </div>
    </motion.section>
  );
}

function SettingsRow({
  title,
  subtitle,
  destructive,
  disabled,
  onClick,
  children,
}: {
  title: string;
  subtitle?: string;
  destructive?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  const className = cn(
    "flex min-h-[44px] w-full items-center justify-between gap-3 border-t border-[#f2f2f7] px-4 py-3 text-left first:border-t-0 transition-colors",
    onClick && "cursor-pointer active:bg-[#f7f7f9]",
    disabled && "cursor-default opacity-40"
  );

  const content = (
    <>
      <div className="min-w-0">
        <p
          className={cn(
            "text-[15px] leading-snug",
            destructive ? "font-medium text-[#ff3b30]" : "text-black"
          )}
        >
          {title}
        </p>
        {subtitle ? (
          <p className="mt-0.5 text-[12px] leading-snug text-[#8e8e93]">{subtitle}</p>
        ) : null}
      </div>
      {children}
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} disabled={disabled} className={className}>
        {content}
      </button>
    );
  }
  return <div className={className}>{content}</div>;
}
