"use client";

/**
 * PANTALLA 3/4 — DIGITALIZACIÓN (detalle del documento).
 * Fondo #F2F2F7 · header blanco sticky · tabs Página/OCR · badge de calidad ·
 * carrusel de miniaturas · exportación real a PDF (jsPDF) · barra de acciones.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, Reorder, useDragControls } from "framer-motion";
import { toast } from "sonner";
import { jsPDF } from "jspdf";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Copy,
  Crop,
  Eye,
  FileDown,
  FileText,
  GripHorizontal,
  ImageDown,
  Info,
  Loader2,
  Maximize2,
  Pencil,
  Plus,
  RotateCw,
  ScanText,
  Search,
  Share,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Trash2,
  X,
} from "lucide-react";

import { useActiveDocument, useScannerStore } from "@/lib/scanner/store";
import {
  FILTER_PRESETS,
  PNG_FILTERS,
  type PageFilter,
  type PagePrecision,
  type ScanPage,
} from "@/lib/scanner/types";
import {
  detectDocumentEdges,
  loadImage,
  processImage,
} from "@/lib/scanner/image-processor";
import { dataUrlBytes, formatBytes, fullDate, relativeTime } from "@/lib/scanner/format";
import {
  buildDocPdf,
  downloadBlob,
  MB,
  PDF_LONG_SIDE_MM,
  sanitizeFileName,
  toJpeg,
  type ExportQuality,
} from "@/lib/scanner/pdf-export";
import { ocrTextIsValid, requestOcr, findTextMatches, splitByMatches } from "@/lib/scanner/ocr";
import { docTags } from "@/lib/scanner/tags";
import { MiniTagRow, TagsDialog } from "@/components/scanner/TagsDialog";
import { PresentationView } from "@/components/scanner/PresentationView";
import { cn } from "@/lib/utils";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/** Filtro CSS aproximado para la vista previa en vivo del sheet de filtros. */
const FILTER_CSS: Record<PageFilter, string> = {
  original: "none",
  auto: "saturate(1.08) contrast(1.06)",
  natural: "brightness(1.07) contrast(1.03) saturate(1.02)",
  color: "saturate(1.4)",
  grayscale: "grayscale(1)",
  blackwhite: "grayscale(1) contrast(2.2)",
  whiteboard: "brightness(1.08) contrast(1.12)",
  document: "contrast(1.18)",
};

/** Etiqueta compacta del badge de calidad según el filtro activo. */
const FILTER_COLOR_LABEL: Record<PageFilter, string> = {
  original: "Color",
  auto: "Color",
  natural: "Color",
  color: "Color",
  grayscale: "Escala de grises",
  blackwhite: "Blanco y negro",
  whiteboard: "Color",
  document: "Color",
};

/** Stat del grid bajo la vista previa (tab Página). */
function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "ok" | "muted";
}) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-0.5 text-center">
      <span className="truncate text-[11px] text-[#8e8e93]">{label}</span>
      <span
        className={`truncate text-[13px] font-semibold ${
          tone === "ok"
            ? "text-[#34c759]"
            : tone === "muted"
              ? "text-[#8e8e93]"
              : "text-[#1c1c1e]"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/** Panel de stats del pipeline de precisión (solo páginas reales). */
function PrecisionPanel({
  precision,
  manual,
}: {
  precision: PagePrecision;
  manual: boolean;
}) {
  const worker = precision.engine === "worker";
  const solid = precision.cornersSolid;
  const refinedLabel = manual
    ? "Manual"
    : precision.refined
      ? "Sí"
      : worker
        ? "Grueso"
        : "—";
  return (
    <div className="mt-3 rounded-lg bg-[#f2f2f7] px-3 pb-2.5 pt-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Sparkles className="size-3.5 shrink-0 text-[#007aff]" aria-hidden="true" />
          <span className="truncate text-[11px] font-semibold uppercase tracking-[0.04em] text-[#8e8e93]">
            Precisión del motor
          </span>
        </div>
        {typeof precision.elapsedMs === "number" && (
          <span className="shrink-0 text-[10px] tabular-nums text-[#8e8e93]">
            enhance {Math.round(precision.elapsedMs)} ms
          </span>
        )}
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2">
        <Stat
          label="Motor"
          value={worker ? "OpenCV" : "Canvas"}
          tone={worker ? "ok" : "muted"}
        />
        <Stat
          label="RANSAC"
          value={refinedLabel}
          tone={manual ? "muted" : precision.refined ? "ok" : "default"}
        />
        <Stat
          label="Firmes"
          value={solid != null ? `${solid}/4` : "—"}
          tone={solid != null && solid >= 3 ? "ok" : solid != null ? "default" : "muted"}
        />
        <Stat
          label="Píxeles"
          value={`${precision.width}×${precision.height}`}
        />
      </div>
    </div>
  );
}

/** Botón de la barra inferior de acciones. */
function BarButton({
  label,
  icon,
  onClick,
  busy = false,
  disabled = false,
  danger = false,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-16 flex-col items-center justify-center gap-1 rounded-lg transition-opacity active:opacity-50 disabled:opacity-40"
    >
      {busy ? (
        <Loader2 className="size-6 animate-spin text-[#007aff]" />
      ) : (
        icon
      )}
      <span
        className={`text-[11px] font-medium ${
          danger ? "text-[#ff3b30]" : "text-[#007aff]"
        }`}
      >
        {label}
      </span>
    </button>
  );
}

/** Miniatura del carrusel: tap para seleccionar · mantener pulsado ~350 ms
 *  y arrastrar para reordenar (patrón iOS Fotos). El arrastre se activa con
 *  useDragControls para no interferir con el scroll horizontal del carrusel. */
const LONG_PRESS_MS = 350;

function CarouselTile({
  page,
  index,
  active,
  onActivate,
  onDragStart,
  onDragEnd,
  activeRef,
  disabled,
}: {
  page: ScanPage;
  index: number;
  active: boolean;
  onActivate: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  activeRef?: React.RefObject<HTMLDivElement | null>;
  disabled: boolean;
}) {
  const controls = useDragControls();
  const timerRef = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const suppressClickRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  return (
    <Reorder.Item
      value={page.id}
      dragListener={false}
      dragControls={controls}
      dragMomentum={false}
      layout
      onDragStart={() => {
        setDragging(true);
        suppressClickRef.current = true;
        onDragStart();
        if (typeof navigator !== "undefined" && "vibrate" in navigator) {
          navigator.vibrate?.(20);
        }
      }}
      onDragEnd={() => {
        setDragging(false);
        onDragEnd();
        // El click sintético tras soltar no debe cambiar de página.
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 80);
      }}
      style={{ position: "relative", zIndex: dragging ? 30 : 1 }}
      className={`relative h-[90px] w-[70px] shrink-0 touch-pan-y select-none overflow-hidden rounded-lg bg-white transition-[opacity,transform,box-shadow] duration-150 active:scale-[0.96] active:opacity-90 ${
        active
          ? "border-2 border-[#007aff] shadow-[0_2px_8px_rgba(0,122,255,0.25)]"
          : "border border-[#c7c7cc]"
      } ${dragging ? "scale-[1.06] opacity-100 shadow-[0_10px_24px_rgba(0,0,0,0.28)] ring-2 ring-[#007aff]" : ""}`}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return;
        // Mantener pulsado sin mover → activa el modo reordenar.
        clearTimer();
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          controls.start(e);
        }, LONG_PRESS_MS);
      }}
      onPointerUp={clearTimer}
      onPointerCancel={clearTimer}
      onPointerMove={(e) => {
        // Cualquier movimiento antes del umbral cancela el temporizador
        // (el gesto pertenece al scroll del carrusel).
        if (timerRef.current !== null && Math.abs(e.movementX + e.movementY) > 0) {
          clearTimer();
        }
      }}
      onClick={() => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        onActivate();
      }}
      aria-label={`Ir a la página ${index + 1}`}
      aria-current={active}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate();
        }
      }}
    >
      {active && activeRef ? (
        // Ref invisible para el scrollIntoView del efecto del padre.
        <span ref={activeRef as React.RefObject<HTMLSpanElement>} className="absolute inset-0" aria-hidden="true" />
      ) : null}
      <img
        src={page.thumbnail}
        alt=""
        draggable={false}
        className="pointer-events-none h-full w-full object-cover"
      />
      <span
        className={`absolute bottom-1 right-1 flex size-[18px] items-center justify-center rounded-full text-[10px] font-semibold text-white ${
          active || dragging ? "bg-[#007aff]" : "bg-black/60"
        }`}
      >
        {index + 1}
      </span>
    </Reorder.Item>
  );
}

/** Botón pill de acción secundaria (tab Página / OCR). */
function PillButton({
  label,
  icon,
  onClick,
  busy = false,
  primary = false,
  disabled = false,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  busy?: boolean;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition-all active:scale-[0.97] disabled:opacity-50 ${
        primary
          ? "border border-[#007aff] bg-[#007aff] text-white shadow-[0_4px_12px_rgba(0,122,255,0.28)]"
          : "border border-[#007aff] bg-white text-[#007aff]"
      }`}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : icon}
      {label}
    </button>
  );
}

export default function DocumentDetailView() {
  const doc = useActiveDocument();
  const documents = useScannerStore((s) => s.documents);
  const setView = useScannerStore((s) => s.setView);
  const renameDocument = useScannerStore((s) => s.renameDocument);
  const deleteDocument = useScannerStore((s) => s.deleteDocument);
  const deletePageFromDocument = useScannerStore((s) => s.deletePageFromDocument);
  const reorderPages = useScannerStore((s) => s.reorderPages);
  const setFilterOnPage = useScannerStore((s) => s.setFilterOnPage);
  const setOcrText = useScannerStore((s) => s.setOcrText);
  const exportQuality = useScannerStore((s) => s.settings.exportQuality);
  const unsharpOriginal = useScannerStore((s) => s.settings.unsharpOriginal);
  /** E2c: reabrir el editor de bordes manual sobre esta página guardada. */
  const beginEditSavedPage = useScannerStore((s) => s.beginEditSavedPage);

  // Página activa por ID (robusto frente a reordenaciones y borrados).
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [tab, setTab] = useState<"page" | "ocr">("page");
  const [exporting, setExporting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrAll, setOcrAll] = useState<{ i: number; n: number } | null>(null);
  const [rotating, setRotating] = useState(false);
  const [cropping, setCropping] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Orden local del carrusel (ids) — se sincroniza con doc.pages y se
  // confirma en el store al soltar la miniatura arrastrada.
  const [orderIds, setOrderIds] = useState<string[]>([]);
  const orderIdsRef = useRef<string[]>([]);
  orderIdsRef.current = orderIds;
  const [dragActive, setDragActive] = useState(false);
  const activeThumbRef = useRef<HTMLDivElement | null>(null);

  // Modo presentación (visor inmersivo).
  const [presenting, setPresenting] = useState(false);
  // Edición del texto OCR de la página actual.
  const [editingOcr, setEditingOcr] = useState(false);
  const [ocrDraft, setOcrDraft] = useState("");
  const ocrTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Hoja de información del documento.
  const [infoOpen, setInfoOpen] = useState(false);
  // Diálogo de etiquetas del documento.
  const [tagsOpen, setTagsOpen] = useState(false);

  // Buscador del texto OCR (resaltado + navegación entre coincidencias).
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findGlobal, setFindGlobal] = useState(0);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const lastFindQueryRef = useRef("");

  // Comparación antes/después: mantener pulsada la imagen muestra la foto
  // ORIGINAL capturada (patrón de apps de escaneo); al soltar vuelve al
  // resultado procesado. Umbral de movimiento para no secuestrar el swipe.
  const [comparing, setComparing] = useState(false);
  const compareTimerRef = useRef<number | null>(null);
  const compareStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  /** true desde que el temporizador disparó la comparación hasta el release
   *  — determinista al margen del batching de React (el click residual tras
   *  soltar NO debe abrir la presentación). */
  const compareFiredRef = useRef(false);

  // Documento no encontrado (o sin páginas) → volver a Biblioteca.
  useEffect(() => {
    if (!doc || doc.pages.length === 0) setView("library");
  }, [doc, setView]);

  // Sincroniza el orden local cuando cambian las páginas del documento
  // (nueva página, borrado, reordenación confirmada…).
  useEffect(() => {
    if (!doc) return;
    setOrderIds((prev) => {
      const nextSet = new Set(doc.pages.map((p) => p.id));
      const same =
        prev.length === doc.pages.length && prev.every((id) => nextSet.has(id));
      // Sin cambios de miembros → conserva el orden previo (drag en curso).
      if (same) return prev;
      return doc.pages.map((p) => p.id);
    });
  }, [doc]);

  // Ajusta la página activa si la actual desapareció.
  useEffect(() => {
    if (!doc) return;
    if (!doc.pages.some((p) => p.id === currentId)) {
      setCurrentId(doc.pages[0]?.id ?? null);
    }
  }, [doc, currentId]);

  // Centra la miniatura activa en el carrusel.
  useEffect(() => {
    if (!dragActive) {
      activeThumbRef.current?.scrollIntoView({
        behavior: "smooth",
        inline: "center",
        block: "nearest",
      });
    }
  }, [currentId, dragActive]);

  // La biblioteca "presta" su consulta de búsqueda: abre el buscador del
  // texto OCR ya relleno y salta a la primera página con coincidencias.
  useEffect(() => {
    const s = useScannerStore.getState();
    const q = s.pendingFindQuery;
    if (!q || !doc) return;
    s.setPendingFindQuery(null);
    lastFindQueryRef.current = q;
    setFindQuery(q);
    setFindGlobal(0);
    setFindOpen(true);
    setTab("ocr");
    // Salta a la primera página que tenga una coincidencia (la actual puede
    // no tener texto OCR y el buscador vive en la vista de lectura).
    for (const p of doc.pages) {
      if (findTextMatches(p.ocrText ?? "", q).length > 0) {
        setCurrentId(p.id);
        break;
      }
    }
  }, [doc]);

  /* ── Buscador del texto OCR (hooks antes del early-return) ── */

  /** Coincidencias por página para la consulta activa (insensible a
   *  mayúsculas/tildes, rangos sobre el texto original). */
  const findPages = doc?.pages ?? [];
  const pageMatches = useMemo(
    () => findPages.map((p) => findTextMatches(p.ocrText ?? "", findQuery)),
    [findPages, findQuery]
  );
  /** Lista global aplanada: { pageIdx, localIdx } en orden de lectura. */
  const flatMatches = useMemo(() => {
    const out: { pageIdx: number; localIdx: number }[] = [];
    pageMatches.forEach((ms, pageIdx) => {
      ms.forEach((_, localIdx) => out.push({ pageIdx, localIdx }));
    });
    return out;
  }, [pageMatches]);
  const matchCount = flatMatches.length;

  // Al cambiar la consulta → resetea el activo y salta a la 1ª coincidencia.
  useEffect(() => {
    if (!findOpen) return;
    if (lastFindQueryRef.current === findQuery) return;
    lastFindQueryRef.current = findQuery;
    setFindGlobal(0);
    if (matchCount > 0 && doc) {
      const target = flatMatches[0]!;
      const pid = doc.pages[target.pageIdx]?.id;
      if (pid && pid !== currentId) setCurrentId(pid);
    }
  }, [findOpen, findQuery, matchCount, flatMatches, doc, currentId]);

  // Centra la coincidencia activa cuando se navega o cambia la página.
  useEffect(() => {
    if (!findOpen || tab !== "ocr" || matchCount === 0) return;
    const t = window.setTimeout(() => {
      document
        .getElementById("ocr-find-active")
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 90);
    return () => window.clearTimeout(t);
  }, [findOpen, findGlobal, findQuery, tab, currentId, matchCount]);

  // Atajo de escritorio: ←/→ cambia de página (tab Página, sin diálogos,
  // sin presentación ni edición — cada uno gestiona sus propias teclas).
  // ⌘F/Ctrl+F abre el buscador del texto OCR (patrón Buscar de escritorio).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "f" || e.key === "F")) {
        if (presenting || editingOcr || infoOpen || renameOpen || filtersOpen) return;
        if (document.querySelector('[role="dialog"], [role="menu"]')) return;
        e.preventDefault();
        setTab("ocr");
        setFindOpen(true);
        requestAnimationFrame(() => findInputRef.current?.focus());
        return;
      }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (presenting || editingOcr || infoOpen || renameOpen || filtersOpen) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      const s = useScannerStore.getState();
      const d = s.documents.find((x) => x.id === s.activeDocumentId);
      if (!d) return;
      const cur = d.pages.findIndex((p) => p.id === currentId);
      const i = cur >= 0 ? cur : 0;
      const next = e.key === "ArrowLeft" ? i - 1 : i + 1;
      if (next < 0 || next >= d.pages.length) return;
      e.preventDefault();
      setCurrentId(d.pages[next]!.id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentId, presenting, editingOcr, infoOpen, renameOpen, filtersOpen]);

  if (!doc || doc.pages.length === 0) return null;

  // ── Derivados ──────────────────────────────────────────────────────────
  const foundIdx = doc.pages.findIndex((p) => p.id === currentId);
  const idx = foundIdx >= 0 ? foundIdx : 0;
  const page = doc.pages[idx]!;
  const totalPages = doc.pages.length;
  const reprocessing = rotating || cropping || filtering;
  const busy = reprocessing || exporting || sharing;

  // Miniaturas en el orden local del carrusel (para el drag & drop).
  const byId = new Map(doc.pages.map((p) => [p.id, p] as const));
  const orderedPages = orderIds
    .map((id) => byId.get(id))
    .filter((p): p is ScanPage => p !== undefined);
  const orderComplete = orderedPages.length === totalPages;

  const pendingOcr = doc.pages.filter((p) => !p.ocrDone);
  const showOcrAll =
    totalPages > 1 &&
    pendingOcr.length > 0 &&
    !(pendingOcr.length === 1 && pendingOcr[0].id === page.id);

  const headerTitle =
    doc.title.trim() !== ""
      ? doc.title.trim()
      : `Digitalización ${Math.max(1, documents.findIndex((d) => d.id === doc.id) + 1)}`;

  const totalBytes = doc.pages.reduce((acc, p) => acc + dataUrlBytes(p.processed), 0);
  const anyOcr = doc.pages.some((p) => p.ocrDone);

  /** DPI honesto: píxeles del lado mayor sobre los 297 mm de la página PDF
   *  (tamaño adaptativo §8). Mocks sin precisión → 100 DPI del diseño. */
  const dpi = page.precision
    ? Math.max(
        72,
        Math.round(
          Math.max(page.precision.width, page.precision.height) /
            (PDF_LONG_SIDE_MM / 25.4)
        )
      )
    : 100;

  /* ── Buscador del texto OCR (derivados tras el early-return) ── */

  /** Índice global del match activo (acotado si la lista se encoge). */
  const activeGlobal = matchCount === 0 ? 0 : Math.min(findGlobal, matchCount - 1);
  /** Coincidencias de la página ACTIVA (para el render con <mark>). */
  const currentPageMatches = pageMatches[idx] ?? [];
  /** Base global de la página activa (para saber cuál es el match activo). */
  const currentPageBase = pageMatches
    .slice(0, idx)
    .reduce((n, ms) => n + ms.length, 0);

  /** Salta a la coincidencia global g (circular), cambia de página si hace
   *  falta y centra el tab en OCR. */
  const goMatch = (g: number) => {
    if (matchCount === 0) return;
    const wrapped = ((g % matchCount) + matchCount) % matchCount;
    setFindGlobal(wrapped);
    const target = flatMatches[wrapped]!;
    setTab("ocr");
    const pid = doc.pages[target.pageIdx]?.id;
    if (pid) setCurrentId(pid);
  };

  // ── Acciones ───────────────────────────────────────────────────────────
  const openRename = (open: boolean) => {
    setRenameOpen(open);
    if (open) setRenameValue(doc.title);
  };

  const confirmRename = () => {
    const title = renameValue.trim();
    if (title === "" || title === doc.title) {
      setRenameOpen(false);
      return;
    }
    renameDocument(doc.id, title);
    setRenameOpen(false);
    toast.success("Documento renombrado");
  };

  /** Construye el PDF adaptativo (§8) SIN descargarlo. Compartido por
   *  «Guardar PDF» (descarga) y «Compartir» (Web Share API). Lógica §8
   *  en la lib compartida pdf-export.ts. */
  const buildPdf = () => buildDocPdf(doc, exportQuality);

  const exportPdf = async () => {
    if (exporting || totalPages === 0) return;
    setExporting(true);
    try {
      const { pdf, bytes, adjusted } = await buildPdf();
      pdf.save(`${sanitizeFileName(doc.title)}.pdf`);
      toast.success(
        `PDF exportado · ${totalPages} ${totalPages === 1 ? "página" : "páginas"} · ${formatBytes(bytes)}` +
          (adjusted ? " · ajustado al presupuesto" : " · dentro del presupuesto"),
        { description: `Presupuesto §8: ${formatBytes(Math.min(Math.max(totalPages, 3), 8) * MB)}` }
      );
    } catch {
      toast.error("No se pudo exportar el PDF");
    } finally {
      setExporting(false);
    }
  };

  /** Comparte el PDF con la hoja nativa del sistema (Web Share API · nivel 2
   *  con archivos). Fallback honesto: descarga el PDF cuando el navegador o
   *  el contexto (p. ej. escritorio sin soporte) no permiten compartir. */
  const sharePdf = async () => {
    if (sharing || exporting || totalPages === 0) return;
    setSharing(true);
    try {
      const { pdf, bytes } = await buildPdf();
      const fileName = `${sanitizeFileName(doc.title)}.pdf`;
      const blob = pdf.output("blob");
      const file = new File([blob], fileName, { type: "application/pdf" });
      const nav = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
      };
      if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: doc.title });
        toast.success(
          `Documento compartido · ${formatBytes(bytes)}`
        );
      } else {
        // Fallback: descarga directa con el mismo PDF adaptativo §8.
        downloadBlob(blob, fileName);
        toast.success("Compartir no está disponible aquí", {
          description: `El PDF (${formatBytes(bytes)}) se ha descargado en su lugar.`,
        });
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return; // el usuario canceló la hoja
      toast.error("No se pudo compartir el documento");
    } finally {
      setSharing(false);
    }
  };

  /** Exporta la página actual como archivo de imagen (PNG tal cual para los
   *  filtros sin pérdida; JPEG en el resto) con nombre descriptivo. */
  const exportPageImage = () => {
    const isPng = page.processed.startsWith("data:image/png");
    const ext = isPng ? "png" : "jpg";
    const fileName = `${sanitizeFileName(doc.title)}-p${idx + 1}.${ext}`;
    const a = document.createElement("a");
    a.href = page.processed;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.success(`Página ${idx + 1} exportada como ${ext.toUpperCase()}`);
  };

  /** Actualiza una página del documento en el store (reprocesa fuera de setFilterOnPage). */
  const patchPage = (pageId: string, patch: Partial<typeof page>) => {
    useScannerStore.setState((s) => ({
      documents: s.documents.map((d) =>
        d.id === doc.id
          ? {
              ...d,
              updatedAt: Date.now(),
              pages: d.pages.map((p) => (p.id === pageId ? { ...p, ...patch } : p)),
            }
          : d
      ),
    }));
  };

  const rotatePage = async () => {
    if (busy) return;
    setRotating(true);
    try {
      const rotation = (page.rotation + 90) % 360;
      let processed = page.processed;
      let thumbnail = page.thumbnail;
      let precision = page.precision;
      try {
        const res = await processImage(page.original, page.quad, page.filter, rotation, {
          manual: page.quadManual === true,
          unsharpOriginal,
        });
        processed = res.processed;
        thumbnail = res.thumbnail;
        precision = res.precision;
      } catch {
        /* conserva la imagen actual */
      }
      patchPage(page.id, { rotation, processed, thumbnail, precision });
    } finally {
      setRotating(false);
    }
  };

  const cropPage = async () => {
    if (busy) return;
    setCropping(true);
    try {
      const quad = await detectDocumentEdges(page.original);
      let processed = page.processed;
      let thumbnail = page.thumbnail;
      let precision = page.precision;
      try {
        const res = await processImage(page.original, quad, page.filter, page.rotation, {
          unsharpOriginal,
        });
        processed = res.processed;
        thumbnail = res.thumbnail;
        precision = res.precision;
      } catch {
        /* conserva la imagen actual */
      }
      patchPage(page.id, { quad, quadManual: false, processed, thumbnail, precision });
      toast.success("Página recortada");
    } catch {
      toast.error("No se pudo recortar la página");
    } finally {
      setCropping(false);
    }
  };

  const applyFilter = async (filter: PageFilter) => {
    if (filtering) return;
    if (page.filter === filter) {
      setFiltersOpen(false);
      return;
    }
    setFiltering(true);
    try {
      await setFilterOnPage(doc.id, page.id, filter);
      const label = FILTER_PRESETS.find((f) => f.id === filter)?.label ?? filter;
      toast.success(`Filtro «${label}» aplicado`);
    } finally {
      setFiltering(false);
      setFiltersOpen(false);
    }
  };

  const runOcr = async () => {
    if (ocrLoading || ocrAll) return;
    setOcrLoading(true);
    try {
      const { dataUrl } = await toJpeg(page.processed);
      const text = await requestOcr(dataUrl);
      if (!ocrTextIsValid(text)) {
        toast.error("No se detectó texto legible en esta página", {
          description: "Prueba con un filtro de mayor contraste (Documento o B/N) y vuelve a intentarlo.",
        });
        return;
      }
      setOcrText(doc.id, page.id, text);
      toast.success("Texto reconocido");
    } catch {
      toast.error("No se pudo reconocer el texto");
    } finally {
      setOcrLoading(false);
    }
  };

  const runOcrAll = async () => {
    if (ocrLoading || ocrAll || pendingOcr.length === 0) return;
    const targets = doc.pages.filter((p) => !p.ocrDone);
    setOcrAll({ i: 1, n: targets.length });
    let ok = 0;
    try {
      for (let i = 0; i < targets.length; i += 1) {
        setOcrAll({ i: i + 1, n: targets.length });
        const p = targets[i];
        try {
          const { dataUrl } = await toJpeg(p.processed);
          const text = await requestOcr(dataUrl);
          if (ocrTextIsValid(text)) {
            setOcrText(doc.id, p.id, text);
            ok += 1;
          }
        } catch {
          /* continúa con la siguiente página */
        }
      }
      if (ok > 0) toast.success(`OCR completado · ${ok} de ${targets.length} páginas`);
      else toast.error("No se pudo reconocer el texto");
    } finally {
      setOcrAll(null);
    }
  };

  const copyOcr = async () => {
    if (!page.ocrText) return;
    try {
      await navigator.clipboard.writeText(page.ocrText);
      toast.success("Texto copiado al portapapeles");
    } catch {
      toast.error("No se pudo copiar el texto");
    }
  };

  /** Comparte el texto OCR reconocido (Web Share API nivel 1; fallback al
   *  portapapeles cuando el navegador no ofrece la hoja de compartir). */
  const shareOcrText = async () => {
    if (!page.ocrText) return;
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    try {
      if (typeof nav.share === "function") {
        await nav.share({ title: doc.title, text: page.ocrText });
        return;
      }
      await navigator.clipboard.writeText(page.ocrText);
      toast.success("Compartir no está disponible aquí", {
        description: "El texto se ha copiado al portapapeles en su lugar.",
      });
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      toast.error("No se pudo compartir el texto");
    }
  };

  const confirmDeletePage = () => {
    if (totalPages <= 1) {
      deleteDocument(doc.id); // el store devuelve a Biblioteca
      toast.success("Documento eliminado");
    } else {
      deletePageFromDocument(doc.id, page.id);
      toast.success("Página eliminada");
    }
  };

  /** Confirma el orden local del carrusel en el store (al soltar el drag). */
  const commitOrder = () => {
    setDragActive(false);
    const order = orderIdsRef.current;
    const storeOrder = doc.pages.map((p) => p.id);
    const changed =
      order.length === storeOrder.length && order.some((id, i) => id !== storeOrder[i]);
    if (changed) {
      reorderPages(doc.id, order);
      toast.success("Páginas reordenadas");
    }
  };

  /** Edición del texto OCR: abre el textarea con el texto actual (o vacío). */
  const startEditOcr = () => {
    setOcrDraft(typeof page.ocrText === "string" ? page.ocrText : "");
    setEditingOcr(true);
    requestAnimationFrame(() => {
      ocrTextareaRef.current?.focus();
      ocrTextareaRef.current?.setSelectionRange(
        ocrTextareaRef.current.value.length,
        ocrTextareaRef.current.value.length
      );
    });
  };

  /* ── Comparación antes/después (mantener pulsada la imagen) ── */

  const clearCompareTimer = () => {
    if (compareTimerRef.current !== null) {
      window.clearTimeout(compareTimerRef.current);
      compareTimerRef.current = null;
    }
  };

  const endCompare = () => {
    clearCompareTimer();
    compareStartRef.current = null;
    if (compareFiredRef.current) {
      compareFiredRef.current = false;
      // El click residual tras la comparación no debe abrir la presentación.
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 420);
    }
    setComparing(false);
  };

  /** pointerdown sobre la vista previa: arranca el temporizador de 280 ms;
   *  si el dedo se mueve >12 px antes (swipe de página) se cancela. */
  const onComparePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    compareStartRef.current = { x: e.clientX, y: e.clientY };
    clearCompareTimer();
    compareTimerRef.current = window.setTimeout(() => {
      compareFiredRef.current = true;
      setComparing(true);
      navigator.vibrate?.(18);
    }, 280);
  };

  const onComparePointerMove = (e: React.PointerEvent) => {
    const start = compareStartRef.current;
    if (!start || comparing) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 12) {
      clearCompareTimer();
      compareStartRef.current = null;
    }
  };

  /* ── Exportar texto OCR a .txt ── */

  /** Descarga un .txt con el texto de TODAS las páginas con OCR (título,
  *  fecha y separadores de página — útil para editar en otro lugar). */
  const exportOcrTxt = () => {
    const withText = doc.pages
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => typeof p.ocrText === "string" && p.ocrText.trim() !== "");
    if (withText.length === 0) {
      toast.error("Ninguna página tiene texto reconocido", {
        description: "Ejecuta el OCR antes de exportar el texto.",
      });
      return;
    }
    const body = withText
      .map(
        ({ p, i }) =>
          `── Página ${i + 1} ${"─".repeat(Math.max(0, 46))}\n\n${(p.ocrText ?? "").trim()}`
      )
      .join("\n\n\n");
    const content = `${headerTitle}\n${new Date(doc.updatedAt).toLocaleDateString("es-CO", {
      year: "numeric",
      month: "long",
      day: "numeric",
    })}\n${"=".repeat(52)}\n\n${body}\n`;
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    downloadBlob(blob, `${sanitizeFileName(headerTitle)}.txt`);
    toast.success(
      `Texto exportado · ${withText.length} ${
        withText.length === 1 ? "página" : "páginas"
      }`,
      { description: `${sanitizeFileName(headerTitle)}.txt` }
    );
  };

  const confirmEditOcr = () => {
    setOcrText(doc.id, page.id, ocrDraft);
    setEditingOcr(false);
    toast.success("Texto actualizado");
  };

  const ocrAllLabel =
    ocrAll !== null
      ? `Reconociendo ${ocrAll.i}/${ocrAll.n}`
      : `OCR en todas las páginas (${pendingOcr.length})`;

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="relative flex h-full w-full flex-col bg-[#f2f2f7]">
      {/* Header blanco sticky */}
      <header className="flex-shrink-0 border-b border-[#e5e5ea] bg-white">
        <div className="flex h-[54px] items-center gap-1 pl-1.5 pr-2.5">
          <button
            type="button"
            onClick={() => setView("library")}
            aria-label="Volver a la biblioteca"
            className="-ml-1 flex h-11 w-9 shrink-0 items-center justify-center rounded-lg transition-opacity active:opacity-50"
          >
            <ChevronLeft className="size-[22px] text-[#007aff]" strokeWidth={2.5} />
          </button>

          <div className="flex min-w-0 flex-1 items-center gap-0.5">
            <h1 className="truncate px-0.5 text-[17px] font-semibold text-black">
              {headerTitle}
            </h1>
            <button
              type="button"
              onClick={() => openRename(true)}
              aria-label="Renombrar documento"
              className="flex h-11 w-8 shrink-0 items-center justify-center rounded-lg transition-opacity active:opacity-50"
            >
              <Pencil className="size-[18px] text-[#8e8e93]" />
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[15px] tabular-nums text-[#8e8e93]">
              {idx + 1}/{totalPages}
            </span>
            <button
              type="button"
              onClick={exportPdf}
              disabled={exporting}
              className="flex h-11 items-center gap-1 rounded-lg px-1 text-[17px] font-semibold text-[#007aff] transition-opacity active:opacity-50 disabled:opacity-50"
            >
              {exporting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" strokeWidth={2.5} />
              )}
              <span>{exporting ? "Exportando…" : "Guardar PDF"}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Sección central con scroll */}
      <div className="ios-scroll flex-1 overflow-y-auto overscroll-contain">
        <div className="space-y-3 px-4 pt-3 pb-6">
          {/* Badge de calidad */}
          <div className="flex justify-center">
            <div className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[#f2f2f7] px-3 py-1.5">
              <Check className="size-3.5 shrink-0 text-[#34c759]" strokeWidth={3} />
              <span className="truncate text-xs text-[#8e8e93]">
                Líneas nítidas: {page.quality.label} · {FILTER_COLOR_LABEL[page.filter]} · {dpi} DPI
              </span>
            </div>
          </div>

          {/* Segmented control + DPI */}
          <div className="flex items-center gap-3">
            <div
              role="tablist"
              aria-label="Vistas del documento"
              className="flex flex-1 rounded-lg bg-[#e5e5ea] p-0.5"
            >
              <button
                type="button"
                role="tab"
                aria-selected={tab === "page"}
                onClick={() => setTab("page")}
                className="relative flex flex-1 items-center justify-center gap-1.5 rounded-md py-[7px]"
              >
                {tab === "page" && (
                  <motion.span
                    layoutId="docdetail-seg-thumb"
                    className="absolute inset-0 rounded-md bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)]"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                )}
                <FileText
                  className={`relative z-10 size-4 ${
                    tab === "page" ? "text-[#007aff]" : "text-[#8e8e93]"
                  }`}
                />
                <span
                  className={`relative z-10 text-[13px] ${
                    tab === "page"
                      ? "font-semibold text-black"
                      : "font-medium text-[#8e8e93]"
                  }`}
                >
                  Página
                </span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "ocr"}
                onClick={() => setTab("ocr")}
                className="relative flex flex-1 items-center justify-center gap-1.5 rounded-md py-[7px]"
              >
                {tab === "ocr" && (
                  <motion.span
                    layoutId="docdetail-seg-thumb"
                    className="absolute inset-0 rounded-md bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)]"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                )}
                <ScanText
                  className={`relative z-10 size-4 ${
                    tab === "ocr" ? "text-[#007aff]" : "text-[#8e8e93]"
                  }`}
                />
                <span
                  className={`relative z-10 text-[13px] ${
                    tab === "ocr"
                      ? "font-semibold text-black"
                      : "font-medium text-[#8e8e93]"
                  }`}
                >
                  Reconocimiento OCR
                </span>
              </button>
            </div>
            <span className="shrink-0 text-[11px] tabular-nums text-[#8e8e93]">{dpi} DPI</span>
          </div>

          {/* Card principal */}
          <section className="rounded-xl bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.08)]">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={`${tab}-${page.id}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16 }}
              >
                {tab === "page" ? (
                  <div>
                    <div className="relative">
                      {/* Swipe horizontal → cambia de página (touch-action pan-y
                          de framer-motion: el scroll vertical sigue vivo).
                          Mantener pulsada la imagen → compara con el original. */}
                      <motion.div
                        drag={totalPages > 1 && !busy ? "x" : false}
                        dragConstraints={{ left: 0, right: 0 }}
                        dragElastic={0.16}
                        onDragEnd={(_, info) => {
                          if (Math.abs(info.offset.x) < 55) return;
                          if (Math.abs(info.offset.x) < Math.abs(info.offset.y) * 1.4) return;
                          const nextIdx = info.offset.x < 0 ? idx + 1 : idx - 1;
                          if (nextIdx >= 0 && nextIdx < totalPages) {
                            setCurrentId(doc.pages[nextIdx]!.id);
                          }
                        }}
                        onPointerDown={onComparePointerDown}
                        onPointerMove={onComparePointerMove}
                        onPointerUp={endCompare}
                        onPointerCancel={endCompare}
                        onPointerLeave={endCompare}
                        onContextMenu={(e) => {
                          // Sin menú contextual en la pulsación larga móvil.
                          if (comparing) e.preventDefault();
                        }}
                        className="cursor-zoom-in select-none"
                        style={{ WebkitTouchCallout: "none" }}
                      >
                        <img
                          src={page.processed}
                          alt={`Página ${idx + 1} de ${headerTitle}`}
                          onClick={() => {
                            if (suppressClickRef.current) return;
                            if (!busy) setPresenting(true);
                          }}
                          draggable={false}
                          className="w-full rounded-lg border border-[#e5e5ea] bg-white"
                        />
                        {/* Overlay ORIGINAL (comparación antes/después) */}
                        <AnimatePresence>
                          {comparing && (
                            <motion.div
                              key="compare-original"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              transition={{ duration: 0.14 }}
                              className="absolute inset-0 z-10 select-none overflow-hidden rounded-lg"
                              aria-hidden="true"
                            >
                              <img
                                src={page.original}
                                alt=""
                                draggable={false}
                                className="h-full w-full object-cover"
                              />
                              <div className="absolute inset-x-0 top-0 flex justify-center pt-2.5">
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[#1c1c1e] shadow-[0_2px_8px_rgba(0,0,0,0.25)] backdrop-blur-md">
                                  <Eye className="size-3.5" strokeWidth={2.4} />
                                  Original
                                </span>
                              </div>
                              <span className="absolute inset-x-0 bottom-2.5 flex justify-center">
                                <span className="inline-flex items-center rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-medium text-white backdrop-blur-md">
                                  Suelta para volver al resultado procesado
                                </span>
                              </span>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                      {reprocessing && (
                        <div className="absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-white/60">
                          <Loader2 className="size-7 animate-spin text-[#007aff]" />
                        </div>
                      )}
                      {/* Indicador de página flotante (más de 1 página) */}
                      {totalPages > 1 && !comparing && (
                        <span className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-white backdrop-blur-md">
                          {idx + 1}/{totalPages}
                        </span>
                      )}
                      {/* Affordance de presentación */}
                      <button
                        type="button"
                        onClick={() => setPresenting(true)}
                        aria-label="Abrir modo presentación"
                        className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md transition-transform active:scale-90"
                      >
                        <Maximize2 className="size-4" />
                      </button>
                    </div>
                    {/* Hint de comparación (patrón de apps de escaneo) */}
                    <p className="mt-1.5 flex items-center justify-center gap-1 text-center text-[11px] text-[#8e8e93]">
                      <Eye className="size-3 shrink-0" strokeWidth={2.2} aria-hidden="true" />
                      Mantén pulsada la imagen para ver el original
                    </p>
                    <div className="mt-3 grid grid-cols-4 gap-2 border-t border-[#e5e5ea] pt-3">
                      <Stat label="Páginas" value={String(totalPages)} />
                      <Stat label="Tamaño" value={formatBytes(totalBytes)} />
                      <Stat
                        label="OCR"
                        value={anyOcr ? "✓" : "—"}
                        tone={anyOcr ? "ok" : "muted"}
                      />
                      <Stat label="Calidad" value={page.quality.label} />
                    </div>
                    {page.precision && (
                      <PrecisionPanel
                        precision={page.precision}
                        manual={page.quadManual === true}
                      />
                    )}
                    <div className="mt-3 flex flex-wrap items-center justify-center gap-2.5 border-t border-[#e5e5ea] pt-3">
                      <PillButton
                        label={sharing ? "Compartiendo…" : "Compartir PDF"}
                        icon={<Share className="size-4" />}
                        onClick={sharePdf}
                        busy={sharing}
                        primary
                        disabled={busy}
                      />
                      <PillButton
                        label="Exportar imagen"
                        icon={<ImageDown className="size-4" />}
                        onClick={exportPageImage}
                        disabled={busy}
                      />
                      <PillButton
                        label="Presentar"
                        icon={<Maximize2 className="size-4" />}
                        onClick={() => setPresenting(true)}
                        disabled={busy}
                      />
                      <PillButton
                        label="Etiquetas"
                        icon={<Tag className="size-4" />}
                        onClick={() => setTagsOpen(true)}
                        disabled={busy}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setInfoOpen(true)}
                      className="mx-auto mt-2.5 inline-flex items-center gap-1 text-[12px] font-medium text-[#007aff] transition-opacity active:opacity-60"
                    >
                      <Info className="size-3.5" />
                      Información del documento
                    </button>
                  </div>
                ) : typeof page.ocrText === "string" ? (
                  <div className="space-y-3">
                    {editingOcr ? (
                      /* ── Modo edición del texto OCR ── */
                      <div className="space-y-3">
                        <div className="relative">
                          <textarea
                            ref={ocrTextareaRef}
                            value={ocrDraft}
                            onChange={(e) => setOcrDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") {
                                e.preventDefault();
                                setEditingOcr(false);
                              }
                            }}
                            rows={9}
                            aria-label="Editar texto reconocido"
                            className="ios-scroll w-full resize-none rounded-lg border border-[#007aff]/50 bg-white p-3 text-[14px] leading-[1.6] text-[#1c1c1e] outline-none ring-[#007aff]/30 focus:ring-2 select-text"
                            placeholder="Escribe o corrige el texto…"
                          />
                          <span className="absolute bottom-2 right-2.5 rounded-full bg-[#f2f2f7] px-2 py-0.5 text-[10px] tabular-nums text-[#8e8e93]">
                            {ocrDraft.length} car.
                          </span>
                        </div>
                        <div className="flex items-center gap-2.5">
                          <button
                            type="button"
                            onClick={() => setEditingOcr(false)}
                            className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full border border-[#e5e5ea] bg-white px-4 text-[13px] font-semibold text-[#8e8e93] transition-all active:scale-[0.97]"
                          >
                            <X className="size-4" />
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={confirmEditOcr}
                            className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full border border-[#007aff] bg-[#007aff] px-4 text-[13px] font-semibold text-white shadow-[0_4px_12px_rgba(0,122,255,0.28)] transition-all active:scale-[0.97]"
                          >
                            <Check className="size-4" strokeWidth={3} />
                            Guardar
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* ── Vista de lectura + acciones ── */
                      <>
                        {/* Buscador en el texto (estilo Buscar de iOS) */}
                        <AnimatePresence initial={false}>
                          {findOpen && (
                            <motion.div
                              initial={{ opacity: 0, y: -6, height: 0 }}
                              animate={{ opacity: 1, y: 0, height: "auto" }}
                              exit={{ opacity: 0, y: -6, height: 0 }}
                              transition={{ duration: 0.18, ease: "easeOut" }}
                              className="overflow-hidden"
                            >
                              <div className="flex h-10 items-center gap-1.5 rounded-full border border-[#e5e5ea] bg-white pl-3 pr-1.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                                <Search className="size-4 shrink-0 text-[#8e8e93]" strokeWidth={2.2} aria-hidden="true" />
                                <input
                                  ref={findInputRef}
                                  type="text"
                                  value={findQuery}
                                  onChange={(e) => setFindQuery(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      goMatch(activeGlobal + (e.shiftKey ? -1 : 1));
                                    } else if (e.key === "Escape") {
                                      e.preventDefault();
                                      setFindOpen(false);
                                    }
                                  }}
                                  placeholder="Buscar en el texto…"
                                  aria-label="Buscar en el texto reconocido"
                                  className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-black outline-none placeholder:text-[#8e8e93]"
                                />
                                <span
                                  aria-live="polite"
                                  className="shrink-0 text-[12px] font-medium tabular-nums text-[#8e8e93]"
                                >
                                  {findQuery.trim()
                                    ? matchCount > 0
                                      ? `${activeGlobal + 1}/${matchCount}`
                                      : "0"
                                    : ""}
                                </span>
                                <button
                                  type="button"
                                  aria-label="Coincidencia anterior"
                                  disabled={matchCount === 0}
                                  onClick={() => goMatch(activeGlobal - 1)}
                                  className="flex size-7 shrink-0 items-center justify-center rounded-full text-[#007aff] transition-colors hover:bg-[#007aff]/10 active:scale-90 disabled:opacity-30"
                                >
                                  <ChevronUp className="size-4" strokeWidth={2.5} />
                                </button>
                                <button
                                  type="button"
                                  aria-label="Coincidencia siguiente"
                                  disabled={matchCount === 0}
                                  onClick={() => goMatch(activeGlobal + 1)}
                                  className="flex size-7 shrink-0 items-center justify-center rounded-full text-[#007aff] transition-colors hover:bg-[#007aff]/10 active:scale-90 disabled:opacity-30"
                                >
                                  <ChevronDown className="size-4" strokeWidth={2.5} />
                                </button>
                                <button
                                  type="button"
                                  aria-label="Cerrar el buscador"
                                  onClick={() => setFindOpen(false)}
                                  className="flex size-7 shrink-0 items-center justify-center rounded-full text-[#8e8e93] transition-colors hover:bg-[#f2f2f7] active:scale-90"
                                >
                                  <X className="size-4" strokeWidth={2.5} />
                                </button>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        <div className="ios-scroll select-text max-h-96 overflow-y-auto rounded-lg border border-[#e5e5ea] bg-[#fcfcfd] p-3">
                          <p className="whitespace-pre-wrap break-words text-[14px] leading-[1.6] text-[#1c1c1e]">
                            {findOpen && findQuery.trim()
                              ? (() => {
                                  let hitIdx = -1;
                                  return splitByMatches(
                                    page.ocrText ?? "",
                                    currentPageMatches
                                  ).map((seg, i) => {
                                    if (!seg.hit) {
                                      return <span key={i}>{seg.text}</span>;
                                    }
                                    hitIdx += 1;
                                    const globalIdx = currentPageBase + hitIdx;
                                    const isActive = globalIdx === activeGlobal;
                                    return (
                                      <mark
                                        key={i}
                                        id={isActive ? "ocr-find-active" : undefined}
                                        className={
                                          isActive
                                            ? "rounded-[3px] bg-[#ff9500] px-[1px] font-semibold text-white"
                                            : "rounded-[3px] bg-[#ffce00]/85 px-[1px] font-medium text-[#1c1c1e]"
                                        }
                                      >
                                        {seg.text}
                                      </mark>
                                    );
                                  });
                                })()
                              : page.ocrText}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2.5">
                          <button
                            type="button"
                            onClick={copyOcr}
                            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#007aff] bg-white px-4 text-[13px] font-semibold text-[#007aff] transition-all active:scale-[0.97]"
                          >
                            <Copy className="size-4" />
                            Copiar texto
                          </button>
                          <button
                            type="button"
                            onClick={startEditOcr}
                            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#e5e5ea] bg-white px-4 text-[13px] font-medium text-[#007aff] transition-all active:scale-[0.97]"
                          >
                            <Pencil className="size-3.5" />
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setFindOpen(true);
                              requestAnimationFrame(() => findInputRef.current?.focus());
                            }}
                            aria-pressed={findOpen}
                            className={cn(
                              "inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-[13px] font-medium transition-all active:scale-[0.97]",
                              findOpen
                                ? "border-[#007aff] bg-[#007aff]/10 text-[#007aff]"
                                : "border-[#e5e5ea] bg-white text-[#007aff]"
                            )}
                          >
                            <Search className="size-4" />
                            Buscar
                          </button>
                          <button
                            type="button"
                            onClick={shareOcrText}
                            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#e5e5ea] bg-white px-4 text-[13px] font-medium text-[#007aff] transition-all active:scale-[0.97]"
                          >
                            <Share className="size-4" />
                            Compartir
                          </button>
                          <button
                            type="button"
                            onClick={exportOcrTxt}
                            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#e5e5ea] bg-white px-4 text-[13px] font-medium text-[#007aff] transition-all active:scale-[0.97]"
                          >
                            <FileDown className="size-4" />
                            Exportar .txt
                          </button>
                          {showOcrAll && (
                            <button
                              type="button"
                              onClick={runOcrAll}
                              disabled={ocrAll !== null || ocrLoading}
                              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#e5e5ea] bg-white px-4 text-[13px] font-medium text-[#007aff] transition-opacity active:opacity-60 disabled:opacity-60"
                            >
                              {ocrAll !== null ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <ScanText className="size-4" />
                              )}
                              {ocrAllLabel}
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 py-7 text-center">
                    <div className="flex size-16 items-center justify-center rounded-full bg-[#f2f2f7]">
                      <ScanText className="size-8 text-[#8e8e93]" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-[15px] font-semibold text-black">
                        Sin texto reconocido
                      </p>
                      <p className="mx-auto max-w-[250px] text-[13px] leading-snug text-[#8e8e93]">
                        Reconoce el texto de esta página para copiarlo y usarlo donde
                        quieras.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={runOcr}
                      disabled={ocrLoading || ocrAll !== null}
                      className="inline-flex h-11 items-center gap-2 rounded-full bg-[#007aff] px-5 text-[15px] font-semibold text-white shadow-[0_4px_14px_rgba(0,122,255,0.35)] transition-opacity active:opacity-80 disabled:opacity-60"
                    >
                      {ocrLoading ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <ScanText className="size-4" />
                      )}
                      {ocrLoading ? "Reconociendo…" : "Reconocer texto (OCR)"}
                    </button>
                    {showOcrAll && (
                      <button
                        type="button"
                        onClick={runOcrAll}
                        disabled={ocrAll !== null || ocrLoading}
                        className="inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium text-[#007aff] transition-opacity active:opacity-60 disabled:opacity-60"
                      >
                        {ocrAll !== null ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <ScanText className="size-4" />
                        )}
                        {ocrAllLabel}
                      </button>
                    )}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </section>

          {/* Carrusel de miniaturas — reordenable con mantener pulsado + arrastrar */}
          <section aria-label="Páginas del documento">
            <div className="no-scrollbar relative overflow-x-auto">
              {/* Degradados de scroll: indican que hay más miniaturas a los lados */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-0 z-10 w-4 bg-gradient-to-r from-[#f2f2f7] to-transparent"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 right-0 z-10 w-4 bg-gradient-to-l from-[#f2f2f7] to-transparent"
              />
              <div className="flex w-max items-center gap-2.5 py-1">
                <button
                  type="button"
                  onClick={() => setView("camera")}
                  className="flex h-[90px] w-[70px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-[#c7c7cc] bg-[#fafafa] transition-opacity active:opacity-60"
                >
                  <span className="flex size-7 items-center justify-center rounded-full bg-[#e5e5ea]">
                    <Plus className="size-4 text-[#8e8e93]" strokeWidth={2.5} />
                  </span>
                  <span className="text-[10px] leading-none text-[#8e8e93]">
                    Añadir página
                  </span>
                </button>

                <Reorder.Group
                  as="div"
                  axis="x"
                  values={orderIds}
                  onReorder={(next) => {
                    if (orderComplete) setOrderIds(next as string[]);
                  }}
                  className="flex items-center gap-2.5"
                >
                  {orderedPages.map((p, i) => (
                    <CarouselTile
                      key={p.id}
                      page={p}
                      index={i}
                      active={p.id === page.id}
                      onActivate={() => setCurrentId(p.id)}
                      onDragStart={() => setDragActive(true)}
                      onDragEnd={commitOrder}
                      activeRef={activeThumbRef}
                      disabled={busy || dragActive}
                    />
                  ))}
                </Reorder.Group>
              </div>
            </div>
            {totalPages > 1 && (
              <p className="mt-2 flex items-center justify-center gap-1 text-center text-[11px] text-[#8e8e93]">
                <GripHorizontal className="size-3.5 shrink-0" aria-hidden="true" />
                Mantén pulsada una página y arrastra para reordenar
              </p>
            )}
          </section>
        </div>
      </div>

      {/* Bottom bar blanca sticky */}
      <footer className="flex-shrink-0 border-t border-[#e5e5ea] bg-white pb-safe">
        <nav className="grid grid-cols-5 px-1.5 pt-1" aria-label="Acciones de la página">
          <BarButton
            label="Editar bordes"
            onClick={() => beginEditSavedPage(doc.id, page.id)}
            disabled={busy}
            icon={<Pencil className="size-6 text-[#007aff]" />}
          />
          <BarButton
            label="Recortar"
            onClick={cropPage}
            busy={cropping}
            disabled={busy}
            icon={<Crop className="size-6 text-[#007aff]" />}
          />
          <BarButton
            label="Rotar"
            onClick={rotatePage}
            busy={rotating}
            disabled={busy}
            icon={<RotateCw className="size-6 text-[#007aff]" />}
          />
          <BarButton
            label="Filtros"
            onClick={() => setFiltersOpen(true)}
            disabled={busy}
            icon={<SlidersHorizontal className="size-6 text-[#007aff]" />}
          />
          <BarButton
            label="Eliminar"
            onClick={() => setDeleteOpen(true)}
            disabled={busy}
            danger
            icon={<Trash2 className="size-6 text-[#ff3b30]" />}
          />
        </nav>
      </footer>

      {/* Dialog: renombrar documento */}
      <Dialog open={renameOpen} onOpenChange={openRename}>
        <DialogContent className="max-w-[320px] rounded-2xl bg-white p-5">
          <DialogHeader className="gap-1 text-left">
            <DialogTitle className="text-[17px] font-semibold text-black">
              Renombrar documento
            </DialogTitle>
            <DialogDescription className="sr-only">
              Escribe un nuevo nombre para el documento.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            autoFocus
            maxLength={60}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmRename();
            }}
            placeholder="Nombre del documento"
            className="h-11 rounded-xl border-[#e5e5ea] bg-[#f2f2f7] text-[15px]"
          />
          <DialogFooter className="flex-row gap-2.5 sm:justify-end">
            <Button
              variant="outline"
              onClick={() => setRenameOpen(false)}
              className="h-10 flex-1 rounded-full border-[#e5e5ea] text-[15px]"
            >
              Cancelar
            </Button>
            <Button
              onClick={confirmRename}
              disabled={renameValue.trim() === ""}
              className="h-10 flex-1 rounded-full bg-[#007aff] text-[15px] font-semibold hover:bg-[#0070e0]"
            >
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AlertDialog: eliminar página / documento */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="max-w-[320px] rounded-2xl bg-white p-5">
          <AlertDialogHeader className="gap-2 text-left">
            <AlertDialogTitle className="text-[17px] font-semibold text-black">
              {totalPages <= 1 ? "¿Eliminar documento?" : "¿Eliminar página?"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] leading-snug text-[#8e8e93]">
              {totalPages <= 1
                ? `«${headerTitle}» se eliminará permanentemente de tu biblioteca.`
                : `Se eliminará la página ${idx + 1} de ${totalPages}. Esta acción no se puede deshacer.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2.5 sm:justify-end">
            <AlertDialogCancel className="mt-0 h-10 flex-1 rounded-full border-[#e5e5ea] text-[15px]">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeletePage}
              className="h-10 flex-1 rounded-full bg-[#ff3b30] text-[15px] font-semibold text-white hover:bg-[#ff453a]"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Sheet: filtros de la página */}
      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl border-t-0 bg-white px-4 pt-3 pb-safe"
        >
          <SheetHeader className="gap-0 text-center">
            <SheetTitle className="text-center text-[16px] font-semibold text-black">
              Filtros
            </SheetTitle>
            <SheetDescription className="sr-only">
              Elige un filtro para la página actual.
            </SheetDescription>
          </SheetHeader>
          <div className="grid grid-cols-4 gap-x-3 gap-y-4 px-1 pb-4 pt-3">
            {FILTER_PRESETS.map((f) => {
              const active = page.filter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  disabled={filtering}
                  onClick={() => applyFilter(f.id)}
                  aria-pressed={active}
                  className="flex flex-col items-center gap-1.5 transition-opacity active:opacity-60 disabled:opacity-50"
                >
                  <span
                    className={`relative block h-[74px] w-full overflow-hidden rounded-lg bg-[#f2f2f7] ${
                      active ? "border-2 border-[#007aff]" : "border border-[#e5e5ea]"
                    }`}
                  >
                    <img
                      src={page.thumbnail}
                      alt=""
                      draggable={false}
                      className="h-full w-full object-cover"
                      style={{ filter: FILTER_CSS[f.id] }}
                    />
                    {active && (
                      <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-[#007aff] shadow-sm">
                        <Check className="size-2.5 text-white" strokeWidth={3.5} />
                      </span>
                    )}
                  </span>
                  <span
                    className={`text-center text-[11px] leading-tight ${
                      active ? "font-semibold text-[#007aff]" : "text-[#8e8e93]"
                    }`}
                  >
                    {f.label}
                  </span>
                </button>
              );
            })}
          </div>
          {filtering && (
            <div className="flex items-center justify-center gap-2 pb-4 text-[13px] text-[#8e8e93]">
              <Loader2 className="size-4 animate-spin" />
              Aplicando filtro…
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Sheet: información del documento (metadatos) */}
      <DocumentInfoSheet
        open={infoOpen}
        onOpenChange={setInfoOpen}
        title={headerTitle}
        docId={doc.id}
        tags={docTags(doc)}
        onOpenTags={() => {
          setInfoOpen(false);
          setTagsOpen(true);
        }}
        createdAt={doc.createdAt}
        updatedAt={doc.updatedAt}
        pages={doc.pages}
      />

      {/* Dialog: etiquetas del documento */}
      <TagsDialog
        open={tagsOpen}
        onOpenChange={setTagsOpen}
        docIds={[doc.id]}
        documents={documents}
      />

      {/* Modo presentación (visor inmersivo a pantalla completa) */}
      <AnimatePresence>
        {presenting && (
          <PresentationView
            key="presentation"
            pages={doc.pages}
            title={headerTitle}
            initialIndex={idx}
            onClose={() => setPresenting(false)}
            onIndexChange={(i) => setCurrentId(doc.pages[i]?.id ?? page.id)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** Fila de la hoja de información. */
function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-[11px]">
      <span className="shrink-0 text-[14px] text-[#8e8e93]">{label}</span>
      <span className="min-w-0 truncate text-right text-[14px] font-medium text-[#1c1c1e]">
        {value}
      </span>
    </div>
  );
}

/** Hoja inferior con los metadatos del documento: etiquetas, fechas,
 *  páginas, tamaño, filtros usados, estado del OCR y motor de precisión
 *  por página. */
function DocumentInfoSheet({
  open,
  onOpenChange,
  title,
  docId,
  tags,
  onOpenTags,
  createdAt,
  updatedAt,
  pages,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  docId: string;
  tags: string[];
  onOpenTags: () => void;
  createdAt: number;
  updatedAt: number;
  pages: ScanPage[];
}) {
  const removeTagFromDocument = useScannerStore((s) => s.removeTagFromDocument);
  const totalBytes = pages.reduce((acc, p) => acc + dataUrlBytes(p.processed), 0);
  const ocrPages = pages.filter((p) => p.ocrDone).length;

  // Filtros usados con conteo (p. ej. «Documento ×2 · B/N ×1»).
  const filterCounts = new Map<PageFilter, number>();
  for (const p of pages) filterCounts.set(p.filter, (filterCounts.get(p.filter) ?? 0) + 1);
  const filtersLabel = [...filterCounts.entries()]
    .map(([f, n]) => {
      const label = FILTER_PRESETS.find((preset) => preset.id === f)?.label ?? f;
      return n > 1 ? `${label} ×${n}` : label;
    })
    .join(" · ");

  // Motor de precisión por página.
  const workerPages = pages.filter((p) => p.precision?.engine === "worker").length;
  const canvasPages = pages.filter((p) => p.precision?.engine === "canvas").length;
  const mockPages = pages.length - workerPages - canvasPages;
  const engineLabel =
    (workerPages > 0 ? `OpenCV ×${workerPages}` : "") +
    (canvasPages > 0 ? `${workerPages > 0 ? " · " : ""}Canvas ×${canvasPages}` : "") +
    (mockPages > 0 ? `${workerPages + canvasPages > 0 ? " · " : ""}Demo ×${mockPages}` : "");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-2xl border-t-0 bg-white px-0 pt-3 pb-safe"
      >
        <SheetHeader className="gap-0 px-4 text-center">
          <SheetTitle className="truncate text-center text-[16px] font-semibold text-black">
            {title}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Metadatos del documento digitalizado.
          </SheetDescription>
        </SheetHeader>
        <div className="ios-scroll mt-2 max-h-[62vh] divide-y divide-[#f2f2f7] overflow-y-auto pb-4">
          {/* Etiquetas (edición rápida: quitar o abrir el diálogo) */}
          <div className="px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[14px] text-[#8e8e93]">Etiquetas</span>
              <button
                type="button"
                onClick={onOpenTags}
                className="text-[13px] font-semibold text-[#007aff] transition-opacity active:opacity-60"
              >
                Editar
              </button>
            </div>
            <div className="mt-2 min-h-[24px]">
              {tags.length > 0 ? (
                <MiniTagRow
                  tags={tags}
                  max={8}
                  onRemove={(t) => removeTagFromDocument(docId, t)}
                />
              ) : (
                <p className="text-[13px] text-[#8e8e93]">
                  Sin etiquetas — úsalas para agrupar documentos en la biblioteca.
                </p>
              )}
            </div>
          </div>
          <InfoRow label="Creado" value={fullDate(createdAt)} />
          <InfoRow label="Última modificación" value={relativeTime(updatedAt)} />
          <InfoRow label="Páginas" value={String(pages.length)} />
          <InfoRow label="Tamaño" value={formatBytes(totalBytes)} />
          <InfoRow label="Filtros" value={<span className="select-text">{filtersLabel}</span>} />
          <InfoRow
            label="Texto OCR"
            value={
              ocrPages > 0 ? (
                <span className="text-[#34c759]">
                  {ocrPages} de {pages.length}
                </span>
              ) : (
                "Sin reconocer"
              )
            }
          />
          <InfoRow label="Motor" value={<span className="select-text">{engineLabel}</span>} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
