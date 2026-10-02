"use client";

/**
 * 🏠 Biblioteca — "Mis documentos" (pantalla home estilo iOS).
 * Búsqueda en tiempo real (títulos + etiquetas + texto OCR), chips de orden
 * (Recientes/Favoritos/A-Z), FILTRO POR ETIQUETAS con contadores, vista
 * cuadrícula/lista, favoritos, menú contextual (etiquetar/renombrar/duplicar/
 * eliminar), exportación de TODA la biblioteca a un único PDF (multi-documento
 * con portada e índice) y SELECCIÓN MÚLTIPLE estilo Fotos/Files de iOS:
 * pulsación larga (o botón de la cabecera) para elegir varios documentos y
 * actuar en lote — etiquetado en lote, OCR por lotes, exportar subconjunto a
 * PDF, favoritos y eliminación masiva. FAB flotante "Nuevo escaneo".
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, Reorder, useDragControls } from "framer-motion";
import {
  Check,
  ChevronRight,
  Copy,
  FileDown,
  FileSearch,
  FileText,
  GripVertical,
  LayoutGrid,
  List,
  Loader2,
  MoreHorizontal,
  Pencil,
  ScanLine,
  ScanText,
  Search,
  Settings,
  Star,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { useScannerStore } from "@/lib/scanner/store";
import type { ScanDocument } from "@/lib/scanner/types";
import { formatBytes, relativeTime } from "@/lib/scanner/format";
import { buildLibraryPdf, sanitizeFileName, toJpeg } from "@/lib/scanner/pdf-export";
import { ocrTextIsValid, requestOcr } from "@/lib/scanner/ocr";
import { countTagUsage, docTags, normalizeTag, tagColor } from "@/lib/scanner/tags";
import { MiniTagRow, TagsDialog } from "@/components/scanner/TagsDialog";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type SortMode = "recientes" | "favorites" | "az" | "manual";

const SORT_CHIPS: { id: SortMode; label: string }[] = [
  { id: "recientes", label: "Recientes" },
  { id: "favorites", label: "Favoritos" },
  { id: "az", label: "A-Z" },
  { id: "manual", label: "Manual" },
];

/** Normaliza texto para búsqueda (minúsculas, sin tildes). */
function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/* ------------------------------------------------------------------ */
/* Secciones de la vista de lista (patrón Contactos/Fotos de iOS)       */
/* ------------------------------------------------------------------ */

interface ListSection {
  key: string;
  label: string;
  docs: ScanDocument[];
}

const SECTION_DAY_MS = 86400000;

/** Tramo temporal de un documento según su fecha de actualización. */
function timeSectionKey(ts: number, now: number): string {
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const t0 = startToday.getTime();
  if (ts >= t0) return "today";
  if (ts >= t0 - 6 * SECTION_DAY_MS) return "week";
  if (ts >= t0 - 30 * SECTION_DAY_MS) return "month";
  return "older";
}

const TIME_SECTION_LABELS: Record<string, string> = {
  today: "Hoy",
  week: "Los últimos 7 días",
  month: "Los últimos 30 días",
  older: "Más antiguos",
};

/** Inicial de sección (A-Z estilo Contactos: sin tildes, números → #). */
function letterSectionLabel(title: string): string {
  const ch = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .charAt(0)
    .toUpperCase();
  return /[A-Z]/.test(ch) ? ch : "#";
}

/** Agrupa los documentos visibles en secciones según el orden activo:
 *  · A-Z        → una sección por inicial (patrón Contactos).
 *  · Recientes/Favoritos → tramos temporales (patrón Fotos/Notas).
 *  · Manual      → lista plana sin agrupar (se reordena arrastrando).
 *  Con búsqueda o filtro de etiqueta activos no se agrupa (el usuario ya
 *  está mirando un conjunto concreto). */
function buildListSections(
  docs: ScanDocument[],
  sort: SortMode,
  hasActiveFilter: boolean
): ListSection[] {
  if (hasActiveFilter || sort === "manual" || docs.length === 0) {
    return docs.length === 0 ? [] : [{ key: "all", label: "", docs }];
  }
  const out: ListSection[] = [];
  if (sort === "az") {
    for (const d of docs) {
      const label = letterSectionLabel(d.title);
      const last = out[out.length - 1];
      if (last && last.label === label) last.docs.push(d);
      else out.push({ key: `letter-${label}`, label, docs: [d] });
    }
    return out;
  }
  for (const d of docs) {
    const key = timeSectionKey(d.updatedAt, Date.now());
    const last = out[out.length - 1];
    if (last && last.key === key) last.docs.push(d);
    else out.push({ key, label: TIME_SECTION_LABELS[key] ?? "", docs: [d] });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Pulsación larga (entrada al modo de selección, patrón Fotos de iOS)  */
/* ------------------------------------------------------------------ */

/**
 * Detecta una pulsación larga (450 ms) sin arrastre (>10 px cancela, para
 * no secuestrar el scroll). Tras dispararse, el click inmediato posterior
 * se traga (longFiredRef) para no abrir el documento.
 */
function useLongPress(onLongPress: () => void, ms = 450) {
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const longFiredRef = useRef(false);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startRef.current = null;
  }, []);

  const handlers = useMemo(
    () => ({
      onPointerDown: (e: React.PointerEvent) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        clear();
        startRef.current = { x: e.clientX, y: e.clientY };
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          longFiredRef.current = true;
          onLongPress();
        }, ms);
      },
      onPointerMove: (e: React.PointerEvent) => {
        if (!startRef.current || timerRef.current === null) return;
        const dx = e.clientX - startRef.current.x;
        const dy = e.clientY - startRef.current.y;
        if (dx * dx + dy * dy > 100) clear();
      },
      onPointerUp: clear,
      onPointerLeave: clear,
      onPointerCancel: clear,
    }),
    [clear, ms, onLongPress]
  );

  /** True una vez tras la pulsación larga — el click lo consume y resetea. */
  const consumeLongFired = useCallback(() => {
    const fired = longFiredRef.current;
    longFiredRef.current = false;
    return fired;
  }, []);

  return { handlers, consumeLongFired };
}

/* ------------------------------------------------------------------ */
/* Check de selección (círculo azul con check, patrón iOS)             */
/* ------------------------------------------------------------------ */

function SelectCheck({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-[24px] w-[24px] items-center justify-center rounded-full border-[1.5px] transition-all duration-150",
        checked
          ? "border-[#007aff] bg-[#007aff] text-white shadow-[0_2px_8px_rgba(0,122,255,0.5)]"
          : "border-white/90 bg-black/15 text-transparent backdrop-blur-sm"
      )}
    >
      <Check className="h-[14px] w-[14px]" strokeWidth={3.5} />
    </span>
  );
}

/** Miniatura del documento con fallback si no tiene páginas. */
function Thumb({ src, alt, className }: { src?: string; alt: string; className?: string }) {
  if (!src) {
    return (
      <div className={cn("flex items-center justify-center bg-[#f2f2f7]", className)}>
        <FileText className="h-6 w-6 text-[#c7c7cc]" strokeWidth={1.5} aria-hidden="true" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      draggable={false}
      className={cn("bg-[#f2f2f7] object-cover", className)}
    />
  );
}

export default function LibraryView() {
  const documents = useScannerStore((s) => s.documents);
  const setView = useScannerStore((s) => s.setView);
  const openDocument = useScannerStore((s) => s.openDocument);
  const setPendingFindQuery = useScannerStore((s) => s.setPendingFindQuery);
  const renameDocument = useScannerStore((s) => s.renameDocument);
  const deleteDocument = useScannerStore((s) => s.deleteDocument);
  const toggleFavorite = useScannerStore((s) => s.toggleFavorite);
  const setOcrText = useScannerStore((s) => s.setOcrText);
  const setDocumentsOrder = useScannerStore((s) => s.setDocumentsOrder);
  const exportQuality = useScannerStore((s) => s.settings.exportQuality);

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("recientes");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Filtro por etiqueta (null = "Todas") y diálogo de etiquetado (uno o lote).
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [tagDialogIds, setTagDialogIds] = useState<string[] | null>(null);

  // Renombrar / eliminar (menú contextual)
  const [renaming, setRenaming] = useState<ScanDocument | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<ScanDocument | null>(null);

  // Exportar toda la biblioteca a un único PDF
  const [exportAllOpen, setExportAllOpen] = useState(false);
  const [exportingAll, setExportingAll] = useState(false);

  // Selección múltiple (patrón Fotos/Files de iOS)
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteManyOpen, setDeleteManyOpen] = useState(false);
  const [exportSelOpen, setExportSelOpen] = useState(false);
  const [exportingSel, setExportingSel] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);

  const totalPages = useMemo(
    () => documents.reduce((n, d) => n + d.pages.length, 0),
    [documents]
  );

  /** Documentos exportables (con ≥1 página) y su nº total de páginas. */
  const exportableCount = useMemo(
    () => documents.filter((d) => d.pages.length > 0).length,
    [documents]
  );
  const exportablePages = useMemo(
    () => documents.filter((d) => d.pages.length > 0).reduce((n, d) => n + d.pages.length, 0),
    [documents]
  );

  /** Documentos con coincidencias en el texto OCR (para el badge de la card). */
  const ocrMatches = useMemo(() => {
    const q = normalizeText(query.trim());
    if (!q) return new Set<string>();
    const ids = new Set<string>();
    for (const d of documents) {
      if (normalizeText(d.title).includes(q)) continue; // solo destacado de matches "ocultos"
      if (d.pages.some((p) => p.ocrText && normalizeText(p.ocrText).includes(q))) {
        ids.add(d.id);
      }
    }
    return ids;
  }, [documents, query]);

  /** Etiquetas de la biblioteca con conteo de uso (chips de filtro). */
  const allTags = useMemo(() => countTagUsage(documents), [documents]);

  const visible = useMemo(() => {
    let docs = documents;
    const q = normalizeText(query.trim());
    if (q) {
      // Busca en títulos, etiquetas Y en el texto reconocido por OCR.
      docs = docs.filter(
        (d) =>
          normalizeText(d.title).includes(q) ||
          docTags(d).some((t) => normalizeText(t).includes(q)) ||
          d.pages.some((p) => p.ocrText && normalizeText(p.ocrText).includes(q))
      );
    }
    if (tagFilter) {
      docs = docs.filter((d) =>
        docTags(d).some((t) => normalizeTag(t) === normalizeTag(tagFilter))
      );
    }
    if (sort === "favorites") docs = docs.filter((d) => d.favorite);
    const sorted = [...docs];
    if (sort === "az") {
      sorted.sort((a, b) => a.title.localeCompare(b.title, "es", { sensitivity: "base" }));
    } else if (sort === "manual") {
      // El orden del array del store ES el orden manual (persistido en meta).
      // Solo rellena los ausentes (p. ej. filtro activo) — sin re-sortear.
      const pos = new Map(documents.map((d, i) => [d.id, i] as const));
      sorted.sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0));
    } else {
      sorted.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return sorted;
  }, [documents, query, sort, tagFilter]);

  /** ¿El modo manual admite arrastre aquí? (vista lista, sin selección,
   *  sin búsqueda ni etiqueta — con filtros el subconjunto se reordena raro). */
  const manualDragEnabled =
    sort === "manual" &&
    viewMode === "list" &&
    !selecting &&
    !query.trim() &&
    tagFilter === null;

  /** Orden local de la lista manual (ids) — confirma en el store al soltar. */
  const [manualOrderIds, setManualOrderIds] = useState<string[]>([]);
  useEffect(() => {
    setManualOrderIds((prev) => {
      const nextSet = new Set(visible.map((d) => d.id));
      const same =
        prev.length === visible.length && prev.every((id) => nextSet.has(id));
      if (same) return prev;
      return visible.map((d) => d.id);
    });
  }, [visible]);

  /** Confirma el orden local en el store (drag & drop de la lista manual). */
  const commitManualOrder = () => {
    const storeIds = documents.map((d) => d.id);
    const order = manualOrderIds;
    const changed =
      order.length === storeIds.length && order.some((id, i) => id !== storeIds[i]);
    if (changed) {
      setDocumentsOrder(order);
      toast.success("Orden guardado");
    }
  };

  /** Abre el documento; si la búsqueda activa tiene coincidencias OCR en él,
   *  "presta" la consulta al detalle para abrir el buscador ya relleno. */
  const openDocSmart = useCallback(
    (doc: ScanDocument) => {
      const q = query.trim();
      if (q && ocrMatches.has(doc.id)) setPendingFindQuery(q);
      else setPendingFindQuery(null);
      openDocument(doc.id);
    },
    [ocrMatches, openDocument, query, setPendingFindQuery]
  );

  /** Secciones de la vista de lista (A-Z → inicial, Recientes/Favoritos →
   *  tramos temporales; sin agrupar si hay búsqueda/etiqueta activa). */
  const listSections = useMemo(
    () =>
      buildListSections(visible, sort, Boolean(query.trim()) || tagFilter !== null),
    [visible, sort, query, tagFilter]
  );

  /** Índice global de una fila (para la animación escalonada continua
   *  entre secciones). */
  const rowIndexById = useMemo(() => {
    const m = new Map<string, number>();
    visible.forEach((d, i) => m.set(d.id, i));
    return m;
  }, [visible]);
  const globalRowIndex = useCallback(
    (id: string) => rowIndexById.get(id) ?? 0,
    [rowIndexById]
  );

  /* ------------------------- Selección múltiple ------------------------- */

  const selectedDocs = useCallback(
    () => documents.filter((d) => selectedIds.has(d.id)),
    [documents, selectedIds]
  );

  const enterSelection = useCallback((firstId?: string) => {
    setSelecting(true);
    setSelectedIds(firstId ? new Set([firstId]) : new Set());
  }, []);

  const exitSelection = useCallback(() => {
    setSelecting(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allVisibleSelected =
    visible.length > 0 && visible.every((d) => selectedIds.has(d.id));

  const selectAllVisible = useCallback(() => {
    setSelectedIds((prev) => {
      if (allVisibleSelected) {
        // Deselecciona solo los visibles (conserva selección de filtrados previos).
        const next = new Set(prev);
        for (const d of visible) next.delete(d.id);
        return next;
      }
      const next = new Set(prev);
      for (const d of visible) next.add(d.id);
      return next;
    });
  }, [allVisibleSelected, visible]);

  /** Favorito en lote: si alguno no es favorito → todos a favoritos;
   *  si ya lo eran todos → se quitan (patrón Fotos de iOS). */
  const favoriteSelected = useCallback(() => {
    const docs = selectedDocs();
    if (docs.length === 0) return;
    const anyNotFav = docs.some((d) => !d.favorite);
    const targets = docs.filter((d) => (anyNotFav ? !d.favorite : d.favorite));
    for (const d of targets) toggleFavorite(d.id);
    toast.success(
      anyNotFav
        ? `${plural(targets.length, "documento añadido a", "documentos añadidos a")} favoritos`
        : `${plural(targets.length, "documento quitado de", "documentos quitados de")} favoritos`
    );
  }, [selectedDocs, toggleFavorite]);

  const confirmDeleteMany = useCallback(() => {
    const docs = selectedDocs();
    if (docs.length === 0) return;
    for (const d of docs) deleteDocument(d.id);
    toast.success(
      plural(docs.length, "documento eliminado", "documentos eliminados")
    );
    setDeleteManyOpen(false);
    exitSelection();
  }, [deleteDocument, exitSelection, selectedDocs]);

  /** Exporta la SELECCIÓN a un único PDF con portada e índice. */
  const runExportSelected = async () => {
    if (exportingSel) return;
    const docs = selectedDocs().filter((d) => d.pages.length > 0);
    if (docs.length === 0) {
      toast.error("Los documentos seleccionados no tienen páginas");
      setExportSelOpen(false);
      return;
    }
    setExportSelOpen(false);
    setExportingSel(true);
    const progressId = "export-selection";
    let lastShown = 0;
    try {
      const { pdf, bytes, adjusted, pageCount, docCount } = await buildLibraryPdf(
        docs,
        exportQuality,
        ({ docIndex, docCount: total, title }) => {
          const now = Date.now();
          if (now - lastShown > 350 || docIndex === total) {
            lastShown = now;
            toast.loading(`Generando PDF · documento ${docIndex} de ${total}`, {
              id: progressId,
              description: title,
            });
          }
        },
        { cover: true, coverTitle: "Documentos seleccionados" }
      );
      pdf.save(`seleccion-${docCount}-documentos.pdf`);
      toast.success(
        `Selección exportada · ${docCount} ${docCount === 1 ? "documento" : "documentos"} · ${pageCount} ${pageCount === 1 ? "página" : "páginas"} · ${formatBytes(bytes)}`,
        {
          id: progressId,
          description:
            (adjusted ? "Ajustado al presupuesto" : "Dentro del presupuesto") +
            " · portada con índice y marcador por documento",
        }
      );
      exitSelection();
    } catch {
      toast.error("No se pudo exportar la selección", { id: progressId });
    } finally {
      setExportingSel(false);
    }
  };

  /** OCR por lotes: recorre las páginas SIN texto reconocido de la selección
   *  (las que ya lo tienen no se re-procesan). Toast de progreso por página. */
  const runBatchOcr = async () => {
    if (ocrRunning) return;
    const docs = selectedDocs();
    const targets = docs.flatMap((d) =>
      d.pages
        .filter((p) => !p.ocrDone)
        .map((p) => ({ docId: d.id, pageId: p.id, processed: p.processed, title: d.title }))
    );
    if (targets.length === 0) {
      toast.info("Sin páginas pendientes", {
        description:
          docs.length === 1
            ? "El documento seleccionado ya tiene su texto reconocido."
            : "Los documentos seleccionados ya tienen su texto reconocido.",
      });
      return;
    }
    setOcrRunning(true);
    const progressId = "batch-ocr";
    let ok = 0;
    try {
      for (let i = 0; i < targets.length; i += 1) {
        const t = targets[i]!;
        toast.loading("Reconociendo texto", {
          id: progressId,
          description: `Página ${i + 1} de ${targets.length} · ${t.title}`,
        });
        try {
          const { dataUrl } = await toJpeg(t.processed);
          const text = await requestOcr(dataUrl);
          if (ocrTextIsValid(text)) {
            setOcrText(t.docId, t.pageId, text);
            ok += 1;
          }
        } catch {
          /* continúa con la siguiente página */
        }
      }
      if (ok > 0) {
        toast.success(`OCR completado · ${ok} de ${targets.length} ${targets.length === 1 ? "página con texto" : "páginas con texto"}`, {
          id: progressId,
        });
      } else {
        toast.error("No se reconoció texto en las páginas", {
          id: progressId,
          description: "Prueba con un filtro de mayor contraste (Documento o B/N) y vuelve a intentarlo.",
        });
      }
    } finally {
      setOcrRunning(false);
    }
  };

  /* ------------------------------ Renombrar ------------------------------ */

  const openRename = (doc: ScanDocument) => {
    setRenaming(doc);
    setRenameValue(doc.title);
  };

  const submitRename = (e: React.FormEvent) => {
    e.preventDefault();
    if (!renaming) return;
    if (renameValue.trim()) {
      renameDocument(renaming.id, renameValue);
      toast.success("Documento renombrado");
    }
    setRenaming(null);
  };

  const confirmDelete = () => {
    if (!deleting) return;
    deleteDocument(deleting.id);
    toast.success("Documento eliminado");
    setDeleting(null);
  };

  /* -------------------------- Atajos de escritorio ----------------------- */

  // «/» enfoca la búsqueda (patrón Gmail/GitHub) · Escape sale de la selección.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selecting) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
        if (document.querySelector('[role="dialog"], [role="menu"]')) return;
        e.preventDefault();
        exitSelection();
        return;
      }
      if (e.key !== "/") return;
      if (selecting) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [exitSelection, selecting]);

  /** Exporta la biblioteca (o el subconjunto filtrado) a un único PDF
   *  multi-documento (portada con índice, marcadores por documento,
   *  presupuesto global escalado §8). El título de la portada y el nombre
   *  del archivo se sincronizan con el filtro/etiqueta/búsqueda activos. */
  const exportScope = useMemo(() => {
    // El botón exporta lo que se ESTÁ VIENDO: con filtro/búsqueda/favoritos
    // activos, el PDF refleja exactamente ese subconjunto.
    const docs = visible.filter((d) => d.pages.length > 0);
    const q = query.trim();
    let label: string | null = null;
    if (q && tagFilter) label = `${tagFilter} · «${q}»`;
    else if (q) label = `Resultados de «${q}»`;
    else if (tagFilter) label = `Etiqueta ${tagFilter}`;
    else if (sort === "favorites") label = "Favoritos";
    return { docs, label, scoped: label !== null };
  }, [visible, query, tagFilter, sort]);

  const runExportAll = async () => {
    if (exportingAll) return;
    const docs = exportScope.docs;
    if (docs.length === 0) {
      toast.error("No hay páginas que exportar");
      setExportAllOpen(false);
      return;
    }
    setExportAllOpen(false);
    setExportingAll(true);
    const progressId = "export-all";
    let lastShown = 0;
    try {
      const { pdf, bytes, adjusted, pageCount, docCount } = await buildLibraryPdf(
        docs,
        exportQuality,
        ({ docIndex, docCount: total, title }) => {
          // Toast de progreso reutilizado (throttle simple para no spamear).
          const now = Date.now();
          if (now - lastShown > 350 || docIndex === total) {
            lastShown = now;
            toast.loading(
              `Generando PDF · documento ${docIndex} de ${total}`,
              { id: progressId, description: title }
            );
          }
        },
        { cover: true, coverTitle: exportScope.label ?? undefined }
      );
      const fileLabel = sanitizeFileName(
        exportScope.label!.replace(/[«»·]/g, "").replace(/\s+/g, " ").trim()
      );
      const fileName = exportScope.scoped
        ? `Biblioteca-${fileLabel}-${docCount}-documentos.pdf`
        : `Biblioteca-${docCount}-documentos.pdf`;
      pdf.save(fileName);
      toast.success(
        `PDF de biblioteca exportado · ${docCount} ${docCount === 1 ? "documento" : "documentos"} · ${pageCount} ${pageCount === 1 ? "página" : "páginas"} · ${formatBytes(bytes)}`,
        {
          id: progressId,
          description:
            (adjusted ? "Ajustado al presupuesto global" : "Dentro del presupuesto global") +
            " · portada con índice y marcador por documento",
        }
      );
    } catch {
      toast.error("No se pudo exportar la biblioteca", { id: progressId });
    } finally {
      setExportingAll(false);
    }
  };

  /** Páginas pendientes de OCR en la selección (para el diálogo de confirmación). */
  const selPendingOcr = useMemo(
    () =>
      selectedDocs().reduce(
        (n, d) => n + d.pages.filter((p) => !p.ocrDone).length,
        0
      ),
    [selectedDocs]
  );

  /** Documentos seleccionados con páginas (para exportar/eliminar). */
  const selCount = selectedIds.size;

  /** Alcance del botón “Exportar todo”: total de la biblioteca o el
   *  subconjunto filtrado (para el texto del diálogo de confirmación). */
  const exportScopeCount = exportScope.docs.length;
  const exportScopePages = exportScope.docs.reduce((n, d) => n + d.pages.length, 0);

  // Estado vacío: sin documentos, sin favoritos o sin resultados de búsqueda
  let empty: { Icon: LucideIcon; title: string; text: string } | null = null;
  if (visible.length === 0) {
    if (documents.length === 0) {
      empty = {
        Icon: FileSearch,
        title: "Aún no hay documentos",
        text: "Escanea tu primer documento y aparecerá aquí.",
      };
    } else if (query.trim()) {
      empty = {
        Icon: FileSearch,
        title: "Sin resultados",
        text: `No se encontraron documentos para “${query.trim()}”.`,
      };
    } else if (tagFilter) {
      empty = {
        Icon: Tag,
        title: "Sin documentos con esta etiqueta",
        text: `Ningún documento lleva la etiqueta “${tagFilter}”.`,
      };
    } else {
      empty = {
        Icon: Star,
        title: "Sin favoritos",
        text: "Toca la estrella de un documento para verlo aquí.",
      };
    }
  }

  return (
    <div className="relative flex h-full w-full flex-col bg-[#f2f2f7]">
      {/* Header */}
      <header className="shrink-0 px-5 pb-3 pt-safe">
        {selecting ? (
          /* Modo selección: título con conteo + Cancelar */
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.4px] text-black">
              {selCount === 0
                ? "Seleccionar"
                : `${selCount} ${selCount === 1 ? "seleccionado" : "seleccionados"}`}
            </h1>
            <button
              type="button"
              onClick={exitSelection}
              className="mt-1 shrink-0 text-[16px] font-normal text-[#007aff] transition-opacity active:opacity-60"
            >
              Cancelar
            </button>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.4px] text-black">
                Mis documentos
              </h1>
              <p className="mt-1 text-[13px] text-[#8e8e93]">
                {plural(documents.length, "documento", "documentos")} ·{" "}
                {plural(totalPages, "página", "páginas")}
              </p>
            </div>
            <div className="mt-1 flex shrink-0 items-center gap-1">
              {/* Seleccionar (modo selección múltiple, patrón Fotos de iOS) */}
              {documents.length > 0 && (
                <button
                  type="button"
                  aria-label="Seleccionar documentos"
                  onClick={() => enterSelection()}
                  className="flex h-10 w-10 items-center justify-center rounded-full transition-transform duration-150 active:scale-90"
                >
                  <Check
                    className="h-[22px] w-[22px] text-[#007aff]"
                    strokeWidth={2}
                  />
                </button>
              )}
              {/* Exportar toda la biblioteca a un único PDF (≥2 documentos con páginas) */}
              {documents.filter((d) => d.pages.length > 0).length >= 2 && (
                <button
                  type="button"
                  aria-label="Exportar todos los documentos en un PDF"
                  onClick={() => setExportAllOpen(true)}
                  disabled={exportingAll}
                  className="flex h-10 w-10 items-center justify-center rounded-full transition-transform duration-150 active:scale-90 disabled:opacity-40"
                >
                  {exportingAll ? (
                    <Loader2 className="h-[22px] w-[22px] animate-spin text-[#007aff]" />
                  ) : (
                    <FileDown className="h-[22px] w-[22px] text-[#007aff]" strokeWidth={2} />
                  )}
                </button>
              )}
              <button
                type="button"
                aria-label="Ajustes"
                onClick={() => setView("settings")}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-opacity active:opacity-60"
              >
                <Settings className="h-[22px] w-[22px] text-[#007aff]" strokeWidth={2} />
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Búsqueda */}
      <div className="shrink-0 px-4 pb-3">
        <div className="flex h-11 items-center gap-2 rounded-xl bg-white px-3 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
          <Search className="h-[18px] w-[18px] shrink-0 text-[#8e8e93]" strokeWidth={2} aria-hidden="true" />
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar en títulos y texto OCR"
            aria-label="Buscar en títulos y texto OCR"
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-black outline-none placeholder:text-[#8e8e93]"
          />
          {query && (
            <button
              type="button"
              aria-label="Limpiar búsqueda"
              onClick={() => setQuery("")}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#c7c7cc] text-white transition-transform active:scale-90"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>

      {/* Chips de orden + toggle de vista */}
      <div className="flex shrink-0 items-center gap-2 px-4 pb-3">
        {SORT_CHIPS.map((chip) => {
          const active = sort === chip.id;
          return (
            <button
              key={chip.id}
              type="button"
              aria-pressed={active}
              onClick={() => setSort(chip.id)}
              className={cn(
                "flex h-8 shrink-0 items-center rounded-full px-4 text-[13px] font-semibold transition-all duration-150 active:scale-95",
                active
                  ? "bg-black text-white"
                  : "border border-[#e5e5ea] bg-white text-[#3c3c43] active:opacity-70"
              )}
            >
              {chip.label}
            </button>
          );
        })}
        <button
          type="button"
          aria-label={viewMode === "grid" ? "Cambiar a vista de lista" : "Cambiar a vista de cuadrícula"}
          onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")}
          className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#e5e5ea] bg-white text-[#8e8e93] transition-transform active:scale-90"
        >
          {viewMode === "grid" ? (
            <LayoutGrid className="h-[18px] w-[18px]" strokeWidth={2} />
          ) : (
            <List className="h-[18px] w-[18px]" strokeWidth={2} />
          )}
        </button>
      </div>

      {/* Chips de etiquetas (scroll horizontal, solo si hay etiquetas) */}
      {allTags.length > 0 && (
        <div className="no-scrollbar flex shrink-0 items-center gap-1.5 overflow-x-auto px-4 pb-3">
          <button
            type="button"
            aria-pressed={tagFilter === null}
            onClick={() => setTagFilter(null)}
            className={cn(
              "flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold transition-all duration-150 active:scale-95",
              tagFilter === null
                ? "border-black bg-black text-white"
                : "border-[#e5e5ea] bg-white text-[#3c3c43] active:opacity-70"
            )}
          >
            Todas
          </button>
          {allTags.map(({ tag, count }) => {
            const c = tagColor(tag);
            const active = tagFilter !== null && normalizeTag(tagFilter) === normalizeTag(tag);
            return (
              <button
                key={normalizeTag(tag)}
                type="button"
                aria-pressed={active}
                onClick={() => setTagFilter(active ? null : tag)}
                className="flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-semibold transition-all duration-150 active:scale-95"
                style={
                  active
                    ? { backgroundColor: c.soft, borderColor: c.dot, color: c.text }
                    : { borderColor: "#e5e5ea", backgroundColor: "#ffffff", color: "#3c3c43" }
                }
              >
                <span
                  aria-hidden="true"
                  className="size-[7px] shrink-0 rounded-full"
                  style={{ backgroundColor: c.dot }}
                />
                <span className="max-w-[110px] truncate">{tag}</span>
                <span
                  className={cn(
                    "rounded-full px-1 text-[10px] font-bold leading-4 tabular-nums",
                    active ? "opacity-80" : "text-[#8e8e93]"
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Contenido con scroll */}
      <div className="ios-scroll relative flex-1 overflow-y-auto overscroll-contain pb-32">
        {empty ? (
          <EmptyState
            Icon={empty.Icon}
            title={empty.title}
            text={empty.text}
            onScan={() => setView("camera")}
          />
        ) : viewMode === "grid" ? (
          <div key={`grid-${sort}`} className="grid grid-cols-2 gap-3 px-4 pt-1">
            {sort === "manual" && !selecting && (
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className="col-span-2 flex items-center justify-center gap-1.5 rounded-xl bg-white px-3 py-2.5 text-[12px] font-medium text-[#007aff] shadow-[0_1px_3px_rgba(0,0,0,0.05)] transition-transform active:scale-[0.98]"
              >
                <List className="size-3.5 shrink-0" strokeWidth={2.2} aria-hidden="true" />
                Cambia a la vista de lista para reordenar arrastrando
              </button>
            )}
            {visible.map((doc, i) => (
              <GridCard
                key={doc.id}
                doc={doc}
                index={i}
                ocrMatch={ocrMatches.has(doc.id)}
                selecting={selecting}
                selected={selectedIds.has(doc.id)}
                onOpen={() => openDocSmart(doc)}
                onRename={() => openRename(doc)}
                onDelete={() => setDeleting(doc)}
                onTags={() => setTagDialogIds([doc.id])}
                onToggleSelect={() => toggleSelect(doc.id)}
                onStartSelection={() => enterSelection(doc.id)}
              />
            ))}
          </div>
        ) : manualDragEnabled ? (
          /* Vista lista + orden MANUAL: filas reordenables con asa de arrastre
             (patrón “Editar lista” de iOS — el asa activa el drag). */
          <div key="list-manual" className="flex flex-col px-4 pt-1">
            <p className="mb-2 flex items-center justify-center gap-1.5 text-[11px] font-medium text-[#8e8e93]">
              <GripVertical className="size-3 shrink-0" strokeWidth={2.4} aria-hidden="true" />
              Arrastra el asa para reordenar · el orden se guarda
            </p>
            <Reorder.Group
              axis="y"
              values={manualOrderIds}
              onReorder={setManualOrderIds}
              className="flex flex-col gap-2"
            >
              {visible.map((doc) => {
                const i = globalRowIndex(doc.id);
                return (
                  <ManualListRow
                    key={doc.id}
                    doc={doc}
                    index={i}
                    ocrMatch={ocrMatches.has(doc.id)}
                    onOpen={() => openDocSmart(doc)}
                    onRename={() => openRename(doc)}
                    onDelete={() => setDeleting(doc)}
                    onTags={() => setTagDialogIds([doc.id])}
                    onStartSelection={() => enterSelection(doc.id)}
                    onCommit={commitManualOrder}
                  />
                );
              })}
            </Reorder.Group>
          </div>
        ) : (
          <div key={`list-${sort}`} className="flex flex-col px-4 pt-1">
            {listSections.map(
              (sec, si) =>
                sec.docs.length > 0 && (
                  <section
                    key={sec.key}
                    aria-label={sec.label || "Documentos"}
                    className={si === 0 ? "pt-0" : "pt-5"}
                  >
                    {sec.label && (
                      <h2 className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-[#6d6d72]">
                        {sec.label}
                        <span className="ml-1.5 text-[11px] font-medium normal-case tracking-normal text-[#8e8e93]/70 tabular-nums">
                          {sec.docs.length}
                        </span>
                      </h2>
                    )}
                    <div className="flex flex-col gap-2">
                      {sec.docs.map((doc) => {
                        const i = globalRowIndex(doc.id);
                        return (
                          <ListRow
                            key={doc.id}
                            doc={doc}
                            index={i}
                            ocrMatch={ocrMatches.has(doc.id)}
                            selecting={selecting}
                            selected={selectedIds.has(doc.id)}
                            onOpen={() => openDocSmart(doc)}
                            onRename={() => openRename(doc)}
                            onDelete={() => setDeleting(doc)}
                            onTags={() => setTagDialogIds([doc.id])}
                            onToggleSelect={() => toggleSelect(doc.id)}
                            onStartSelection={() => enterSelection(doc.id)}
                          />
                        );
                      })}
                    </div>
                  </section>
                )
            )}
          </div>
        )}
      </div>

      {/* FAB / Barra de selección (se intercambian con animación) */}
      <AnimatePresence initial={false} mode="wait">
        {selecting ? (
          <motion.div
            key="selection-bar"
            initial={{ y: 90, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 90, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            className="pointer-events-none absolute inset-x-0 bottom-6 z-30 flex justify-center px-4"
          >
            <div className="pointer-events-auto w-full max-w-[360px] rounded-[26px] border border-black/5 bg-white/92 px-4 pb-2.5 pt-2.5 shadow-[0_10px_40px_rgba(0,0,0,0.16)] backdrop-blur-xl">
              {/* Fila 1: conteo + seleccionar todo */}
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-[13px] font-semibold text-[#8e8e93]">
                  {selCount === 0
                    ? "Elige documentos"
                    : `${selCount} ${selCount === 1 ? "seleccionado" : "seleccionados"}`}
                </p>
                <button
                  type="button"
                  onClick={selectAllVisible}
                  disabled={visible.length === 0}
                  className="shrink-0 text-[13px] font-semibold text-[#007aff] transition-opacity active:opacity-60 disabled:opacity-40"
                >
                  {allVisibleSelected ? "Deseleccionar todo" : "Seleccionar todo"}
                </button>
              </div>
              {/* Fila 2: acciones en lote (5) */}
              <div className="mt-1 grid grid-cols-5 gap-0.5">
                <SelectionAction
                  icon={Tag}
                  label="Etiquetar"
                  disabled={ocrRunning || exportingSel || selCount === 0}
                  onClick={() => setTagDialogIds([...selectedIds])}
                />
                <SelectionAction
                  icon={ocrRunning ? Loader2 : ScanText}
                  label="OCR"
                  spin={ocrRunning}
                  disabled={ocrRunning || exportingSel || selCount === 0}
                  onClick={runBatchOcr}
                />
                <SelectionAction
                  icon={FileDown}
                  label="Exportar"
                  disabled={ocrRunning || exportingSel || selCount === 0}
                  onClick={() => setExportSelOpen(true)}
                />
                <SelectionAction
                  icon={Star}
                  label="Favorito"
                  disabled={ocrRunning || exportingSel || selCount === 0}
                  onClick={favoriteSelected}
                />
                <SelectionAction
                  icon={Trash2}
                  label="Eliminar"
                  danger
                  disabled={ocrRunning || exportingSel || selCount === 0}
                  onClick={() => setDeleteManyOpen(true)}
                />
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="fab"
            initial={{ opacity: 0, y: 16, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 400, damping: 28, delay: 0.12 }}
            className="pointer-events-none absolute inset-x-0 bottom-6 z-30 flex justify-center"
          >
            <motion.button
              type="button"
              whileTap={{ scale: 0.95 }}
              onClick={() => setView("camera")}
              className="pointer-events-auto flex items-center gap-2 rounded-full bg-[#007aff] px-5 py-3 text-white shadow-[0_8px_24px_rgba(0,122,255,0.35)] outline-none focus-visible:ring-2 focus-visible:ring-[#007aff]/50"
            >
              <ScanLine className="h-5 w-5" strokeWidth={2.2} />
              <span className="text-[15px] font-semibold">Nuevo escaneo</span>
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dialog: Renombrar */}
      <Dialog open={renaming !== null} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent className="max-w-[320px] rounded-2xl">
          <DialogHeader>
            <DialogTitle>Renombrar documento</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitRename} className="flex flex-col gap-4">
            <Input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="Nombre del documento"
              aria-label="Nombre del documento"
              maxLength={60}
              className="h-11 rounded-xl text-[15px]"
            />
            <DialogFooter className="flex-row gap-2">
              <button
                type="button"
                onClick={() => setRenaming(null)}
                className="h-10 flex-1 rounded-full bg-[#f2f2f7] text-[15px] font-semibold text-[#3c3c43] transition-colors hover:bg-[#e5e5ea]"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="h-10 flex-1 rounded-full bg-[#007aff] text-[15px] font-semibold text-white transition-colors hover:bg-[#0071e8]"
              >
                Guardar
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* AlertDialog: Eliminar (uno) */}
      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent className="max-w-[320px] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar documento?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleting?.title}” se eliminará permanentemente con todas sus páginas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2">
            <AlertDialogCancel className="mt-0 flex-1 rounded-full bg-[#f2f2f7] text-[15px] font-semibold text-[#3c3c43] hover:bg-[#e5e5ea]">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="flex-1 rounded-full border-0 bg-[#ff3b30] text-[15px] font-semibold text-white hover:bg-[#ff453a]"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* AlertDialog: Eliminar la selección */}
      <AlertDialog open={deleteManyOpen} onOpenChange={setDeleteManyOpen}>
        <AlertDialogContent className="max-w-[320px] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Eliminar {plural(selCount, "documento", "documentos")}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminarán permanentemente{" "}
              {plural(selCount, "documento y todas sus páginas", "documentos y todas sus páginas")}
              . Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2">
            <AlertDialogCancel className="mt-0 flex-1 rounded-full bg-[#f2f2f7] text-[15px] font-semibold text-[#3c3c43] hover:bg-[#e5e5ea]">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteMany}
              className="flex-1 rounded-full border-0 bg-[#ff3b30] text-[15px] font-semibold text-white hover:bg-[#ff453a]"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* AlertDialog: Exportar toda la biblioteca a un único PDF */}
      <AlertDialog open={exportAllOpen} onOpenChange={setExportAllOpen}>
        <AlertDialogContent className="max-w-[320px] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {exportScope.scoped
                ? `¿Exportar “${exportScope.label}” en un PDF?`
                : "¿Exportar todo en un PDF?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {exportScope.scoped ? (
                <>
                  Se unirán los {exportScopeCount}{" "}
                  {exportScopeCount === 1 ? "documento visible" : "documentos visibles"} (
                  {exportScopePages} {exportScopePages === 1 ? "página" : "páginas"}) en un
                  único PDF con una portada de índice titulada “{exportScope.label}” y un
                  marcador por documento.
                </>
              ) : (
                <>
                  Se unirán {exportableCount} {exportableCount === 1 ? "documento" : "documentos"} (
                  {exportablePages} {exportablePages === 1 ? "página" : "páginas"}) en un único PDF
                  con una portada de índice y un marcador por documento.
                </>
              )}{" "}
              Cada página mantiene su tamaño y calidad adaptativos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2">
            <AlertDialogCancel className="mt-0 flex-1 rounded-full bg-[#f2f2f7] text-[15px] font-semibold text-[#3c3c43] hover:bg-[#e5e5ea]">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={runExportAll}
              className="flex-1 rounded-full border-0 bg-[#007aff] text-[15px] font-semibold text-white hover:bg-[#0071e8]"
            >
              Exportar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* AlertDialog: Exportar la selección a un único PDF */}
      <AlertDialog open={exportSelOpen} onOpenChange={setExportSelOpen}>
        <AlertDialogContent className="max-w-[320px] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Exportar la selección en un PDF?</AlertDialogTitle>
            <AlertDialogDescription>
              Se unirán {selCount} {selCount === 1 ? "documento" : "documentos"} (
              {selectedDocs().reduce((n, d) => n + d.pages.length, 0)}{" "}
              {selectedDocs().reduce((n, d) => n + d.pages.length, 0) === 1 ? "página" : "páginas"}
              ) en un único PDF con una portada de índice y un marcador por documento.
              {selPendingOcr > 0 &&
                ` Puedes ejecutar OCR antes (${plural(selPendingOcr, "página pendiente", "páginas pendientes")}).`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2">
            <AlertDialogCancel className="mt-0 flex-1 rounded-full bg-[#f2f2f7] text-[15px] font-semibold text-[#3c3c43] hover:bg-[#e5e5ea]">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={runExportSelected}
              className="flex-1 rounded-full border-0 bg-[#007aff] text-[15px] font-semibold text-white hover:bg-[#0071e8]"
            >
              Exportar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog: etiquetas (documento individual desde el menú ··· o lote) */}
      <TagsDialog
        open={tagDialogIds !== null}
        onOpenChange={(o) => !o && setTagDialogIds(null)}
        docIds={tagDialogIds ?? []}
        documents={documents}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Acción de la barra de selección                                     */
/* ------------------------------------------------------------------ */

function SelectionAction({
  icon: Icon,
  label,
  onClick,
  disabled,
  danger,
  spin,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  spin?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-2xl px-1 py-1.5 transition-all duration-150 active:scale-95 disabled:opacity-40",
        danger ? "active:bg-[#ff3b30]/10" : "active:bg-[#007aff]/10"
      )}
    >
      <Icon
        className={cn("h-[22px] w-[22px]", spin && "animate-spin", danger ? "text-[#ff3b30]" : "text-[#007aff]")}
        strokeWidth={2}
        aria-hidden="true"
      />
      <span
        className={cn(
          "text-[11px] font-semibold leading-none",
          danger ? "text-[#ff3b30]" : "text-[#3c3c43]"
        )}
      >
        {label}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Cards                                                              */
/* ------------------------------------------------------------------ */

function GridCard({
  doc,
  index,
  ocrMatch,
  selecting,
  selected,
  onOpen,
  onRename,
  onDelete,
  onTags,
  onToggleSelect,
  onStartSelection,
}: {
  doc: ScanDocument;
  index: number;
  ocrMatch?: boolean;
  selecting: boolean;
  selected: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onTags: () => void;
  onToggleSelect: () => void;
  onStartSelection: () => void;
}) {
  const toggleFavorite = useScannerStore((s) => s.toggleFavorite);
  const ocrPages = doc.pages.filter((p) => p.ocrDone).length;
  const tags = docTags(doc);
  const { handlers, consumeLongFired } = useLongPress(onStartSelection);

  return (
    <motion.div
      role="button"
      tabIndex={0}
      aria-label={selecting ? (selected ? `Quitar selección de ${doc.title}` : `Seleccionar ${doc.title}`) : `Abrir ${doc.title}`}
      aria-pressed={selecting ? selected : undefined}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.04, 0.28), ease: "easeOut" }}
      whileTap={{ scale: 0.97 }}
      whileHover={
        selecting
          ? undefined
          : {
              y: -2,
              boxShadow: "0 8px 22px rgba(0,0,0,0.13)",
              transition: { duration: 0.18 },
            }
      }
      onContextMenu={(e) => {
        // La pulsación larga es selección: evita el menú contextual nativo.
        e.preventDefault();
      }}
      onClick={() => {
        if (consumeLongFired()) return;
        if (selecting) onToggleSelect();
        else onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (selecting) onToggleSelect();
          else onOpen();
        }
      }}
      {...handlers}
      className={cn(
        "cursor-pointer select-none overflow-hidden rounded-xl bg-white shadow-[0_2px_8px_rgba(0,0,0,0.08)] outline-none transition-shadow duration-150 focus-visible:ring-2 focus-visible:ring-[#007aff]/60",
        selecting && selected && "ring-2 ring-[#007aff] ring-offset-0"
      )}
    >
      <div className="relative aspect-[3/4] overflow-hidden rounded-t-xl bg-[#f2f2f7]">
        <Thumb src={doc.pages[0]?.thumbnail} alt={doc.title} className="h-full w-full" />
        {/* Degradado inferior para legibilidad de los badges */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/35 to-transparent"
        />
        {/* Tinte azul de selección (encima de la miniatura) */}
        {selecting && selected && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[#007aff]/18" />
        )}
        {/* Check de selección · esquina superior izquierda */}
        {selecting && (
          <span className="absolute left-1.5 top-1.5 z-10">
            <SelectCheck checked={selected} />
          </span>
        )}
        {/* Badge de páginas · esquina inferior izquierda */}
        <span
          className={cn(
            "absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm",
            selecting && "opacity-70"
          )}
        >
          <FileText className="size-3" strokeWidth={2.4} aria-hidden="true" />
          {doc.pages.length}
        </span>
        {ocrPages > 0 && !selecting && (
          <span
            className="absolute bottom-1.5 left-[60px] flex items-center gap-1 rounded-full bg-[#007aff]/85 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm"
            aria-label="Texto OCR disponible"
          >
            <ScanText className="size-3" strokeWidth={2.4} aria-hidden="true" />
            OCR
          </span>
        )}
        {ocrMatch && (
          <span className="absolute inset-x-0 top-0 flex justify-center pt-1.5">
            <span className="flex items-center gap-1 rounded-full bg-[#007aff] px-2 py-0.5 text-[10px] font-semibold text-white shadow-[0_2px_6px_rgba(0,122,255,0.4)]">
              <ScanText className="size-3" strokeWidth={2.4} aria-hidden="true" />
              Coincidencia en texto
            </span>
          </span>
        )}
        {/* Estrella (oculta en modo selección) */}
        <button
          type="button"
          aria-label={doc.favorite ? "Quitar de favoritos" : "Añadir a favoritos"}
          aria-pressed={doc.favorite}
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(doc.id);
          }}
          className={cn(
            "absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full transition-all duration-150 active:scale-75",
            selecting && "pointer-events-none scale-75 opacity-0"
          )}
          tabIndex={selecting ? -1 : 0}
        >
          <Star
            className={cn(
              "h-[18px] w-[18px] drop-shadow-sm",
              doc.favorite ? "fill-[#ffce00] text-[#ffce00]" : "text-white/80"
            )}
            strokeWidth={2}
          />
        </button>
      </div>
      <div className="px-3 pb-2.5 pt-2">
        <div className="flex items-start gap-0.5">
          <p className="min-w-0 flex-1 text-[14px] font-semibold leading-tight text-black [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [overflow:hidden]">
            {doc.title}
          </p>
          {/* Menú ··· (oculto en modo selección) */}
          <span className={cn("transition-opacity duration-150", selecting && "pointer-events-none opacity-0")}>
            <DocMenu doc={doc} onRename={onRename} onDelete={onDelete} onTags={onTags} onSelect={onStartSelection} compact />
          </span>
        </div>
        <MiniTagRow tags={tags} max={2} className="mt-1" />
        <p className="mt-1 truncate text-[12px] text-[#8e8e93]">
          {plural(doc.pages.length, "página", "páginas")} · {relativeTime(doc.updatedAt)}
        </p>
      </div>
    </motion.div>
  );
}

/** Fila reordenable del modo MANUAL: Reorder.Item cuyo drag se activa
 *  desde el asa ⠿ de la propia fila (patrón “Editar lista” de iOS). */
function ManualListRow({
  doc,
  index,
  ocrMatch,
  onOpen,
  onRename,
  onDelete,
  onTags,
  onStartSelection,
  onCommit,
}: {
  doc: ScanDocument;
  index: number;
  ocrMatch?: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onTags: () => void;
  onStartSelection: () => void;
  onCommit: () => void;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={doc.id}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onCommit}
      whileDrag={{
        scale: 1.02,
        zIndex: 30,
        boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
        position: "relative",
      }}
      className="list-none"
    >
      <ListRow
        doc={doc}
        index={index}
        ocrMatch={ocrMatch}
        selecting={false}
        selected={false}
        onOpen={onOpen}
        onRename={onRename}
        onDelete={onDelete}
        onTags={onTags}
        onToggleSelect={() => onStartSelection()}
        onStartSelection={onStartSelection}
        showHandle
        onHandlePointerDown={(e) => {
          controls.start(e);
          navigator.vibrate?.(12);
        }}
      />
    </Reorder.Item>
  );
}

function ListRow({
  doc,
  index,
  ocrMatch,
  selecting,
  selected,
  onOpen,
  onRename,
  onDelete,
  onTags,
  onToggleSelect,
  onStartSelection,
  showHandle = false,
  onHandlePointerDown,
}: {
  doc: ScanDocument;
  index: number;
  ocrMatch?: boolean;
  selecting: boolean;
  selected: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onTags: () => void;
  onToggleSelect: () => void;
  onStartSelection: () => void;
  /** Modo manual: muestra el asa ⠿ y arrastra con ella. */
  showHandle?: boolean;
  onHandlePointerDown?: (e: React.PointerEvent) => void;
}) {
  const toggleFavorite = useScannerStore((s) => s.toggleFavorite);
  const ocrPages = doc.pages.filter((p) => p.ocrDone).length;
  const tags = docTags(doc);
  const { handlers, consumeLongFired } = useLongPress(onStartSelection);

  return (
    <motion.div
      role="button"
      tabIndex={0}
      aria-label={selecting ? (selected ? `Quitar selección de ${doc.title}` : `Seleccionar ${doc.title}`) : `Abrir ${doc.title}`}
      aria-pressed={selecting ? selected : undefined}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: Math.min(index * 0.03, 0.24), ease: "easeOut" }}
      whileTap={{ scale: 0.98 }}
      onContextMenu={(e) => {
        e.preventDefault();
      }}
      onClick={() => {
        if (consumeLongFired()) return;
        if (selecting) onToggleSelect();
        else onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (selecting) onToggleSelect();
          else onOpen();
        }
      }}
      {...handlers}
      className={cn(
        "flex cursor-pointer select-none items-center gap-3 rounded-xl bg-white p-3 shadow-[0_2px_8px_rgba(0,0,0,0.08)] outline-none transition-shadow duration-150 focus-visible:ring-2 focus-visible:ring-[#007aff]/60",
        selecting && selected && "ring-2 ring-[#007aff]"
      )}
    >
      <div className="relative shrink-0">
        <Thumb
          src={doc.pages[0]?.thumbnail}
          alt={doc.title}
          className="h-16 w-12 rounded-lg"
        />
        {/* Tinte azul + check sobre la miniatura */}
        {selecting && selected && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-lg bg-[#007aff]/25" />
        )}
        {selecting && (
          <span className="absolute -left-1 top-1/2 z-10 -translate-y-1/2">
            <SelectCheck checked={selected} />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-tight text-black">
            {doc.title}
          </p>
          {ocrMatch && (
            <span
              className="flex shrink-0 items-center gap-1 rounded-full bg-[#007aff]/10 px-2 py-0.5 text-[10px] font-semibold text-[#007aff]"
              aria-label="Coincidencia en texto OCR"
            >
              <ScanText className="size-3" strokeWidth={2.4} aria-hidden="true" />
              Texto
            </span>
          )}
        </div>
        <MiniTagRow tags={tags} max={2} className="mt-1" />
        <div className="mt-0.5 flex items-center gap-1.5">
          <p className="min-w-0 flex-1 truncate text-[12px] text-[#8e8e93]">
            {plural(doc.pages.length, "página", "páginas")} · {relativeTime(doc.updatedAt)}
          </p>
          {ocrPages > 0 && (
            <span className="flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-[#8e8e93]">
              <ScanText className="size-3" strokeWidth={2.2} aria-hidden="true" />
              OCR
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        aria-label={doc.favorite ? "Quitar de favoritos" : "Añadir a favoritos"}
        aria-pressed={doc.favorite}
        onClick={(e) => {
          e.stopPropagation();
          toggleFavorite(doc.id);
        }}
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-150 active:scale-75",
          selecting && "pointer-events-none opacity-0"
        )}
        tabIndex={selecting ? -1 : 0}
      >
        <Star
          className={cn(
            "h-[18px] w-[18px]",
            doc.favorite ? "fill-[#ffce00] text-[#ffce00]" : "text-[#c7c7cc]"
          )}
          strokeWidth={2}
        />
      </button>
      <span className={cn("shrink-0 transition-opacity duration-150", selecting && "pointer-events-none opacity-0")}>
        <DocMenu doc={doc} onRename={onRename} onDelete={onDelete} onTags={onTags} onSelect={onStartSelection} />
      </span>
      {showHandle ? (
        <button
          type="button"
          aria-label={`Reordenar ${doc.title}`}
          onPointerDown={(e) => {
            e.preventDefault();
            onHandlePointerDown?.(e);
          }}
          className={cn(
            "-mr-1 flex h-9 w-7 shrink-0 cursor-grab touch-none flex-col items-center justify-center rounded-md text-[#c7c7cc] transition-colors active:cursor-grabbing active:bg-[#f2f2f7] active:text-[#8e8e93]"
          )}
        >
          <GripVertical className="h-5 w-5" strokeWidth={2.2} />
        </button>
      ) : (
        <ChevronRight
          className={cn("h-5 w-5 shrink-0 text-[#c7c7cc] transition-opacity duration-150", selecting && "opacity-0")}
          strokeWidth={2}
          aria-hidden="true"
        />
      )}
    </motion.div>
  );
}

/** Menú contextual (···): etiquetar / seleccionar / renombrar / favorito /
 *  duplicar / eliminar. */
function DocMenu({
  doc,
  onRename,
  onDelete,
  onTags,
  onSelect,
  compact,
}: {
  doc: ScanDocument;
  onRename: () => void;
  onDelete: () => void;
  onTags: () => void;
  onSelect: () => void;
  compact?: boolean;
}) {
  const toggleFavorite = useScannerStore((s) => s.toggleFavorite);
  const duplicateDocument = useScannerStore((s) => s.duplicateDocument);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Más opciones de ${doc.title}`}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full text-[#8e8e93] transition-colors hover:bg-[#f2f2f7] active:bg-[#e5e5ea]",
            compact ? "h-7 w-7" : "h-8 w-8"
          )}
        >
          <MoreHorizontal className="h-[18px] w-[18px]" strokeWidth={2} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={4}
        onClick={(e) => e.stopPropagation()}
        className="w-48 rounded-xl border-[#e5e5ea]"
      >
        <DropdownMenuItem onSelect={onTags} className="gap-2.5 text-[14px]">
          <Tag className="h-4 w-4 text-[#8e8e93]" strokeWidth={2} />
          Etiquetas…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onSelect} className="gap-2.5 text-[14px]">
          <Check className="h-4 w-4 text-[#8e8e93]" strokeWidth={2} />
          Seleccionar
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onRename()} className="gap-2.5 text-[14px]">
          <Pencil className="h-4 w-4 text-[#8e8e93]" strokeWidth={2} />
          Renombrar
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => toggleFavorite(doc.id)}
          className="gap-2.5 text-[14px]"
        >
          <Star
            className={cn(
              "h-4 w-4",
              doc.favorite ? "fill-[#ffce00] text-[#ffce00]" : "text-[#8e8e93]"
            )}
            strokeWidth={2}
          />
          {doc.favorite ? "Quitar de favoritos" : "Añadir a favoritos"}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            duplicateDocument(doc.id);
            toast.success(`«${doc.title}» duplicado`, {
              description: `${doc.pages.length} ${doc.pages.length === 1 ? "página copiada" : "páginas copiadas"}`,
            });
          }}
          className="gap-2.5 text-[14px]"
        >
          <Copy className="h-4 w-4 text-[#8e8e93]" strokeWidth={2} />
          Duplicar
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-[#f2f2f7]" />
        <DropdownMenuItem
          onSelect={() => onDelete()}
          className="gap-2.5 text-[14px] text-[#ff3b30] focus:bg-[#ff3b30]/10 focus:text-[#ff3b30]"
        >
          <Trash2 className="h-4 w-4 text-[#ff3b30]" strokeWidth={2} />
          Eliminar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Estado vacío estilo iOS. */
function EmptyState({
  Icon,
  title,
  text,
  onScan,
}: {
  Icon: LucideIcon;
  title: string;
  text: string;
  onScan: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="flex flex-col items-center px-8 pt-14 text-center"
    >
      <div className="flex h-24 w-24 items-center justify-center rounded-[28px] bg-[#e5e5ea]/60">
        <Icon className="h-12 w-12 text-[#8e8e93]" strokeWidth={1.5} aria-hidden="true" />
      </div>
      <h2 className="mt-5 text-[17px] font-semibold text-black">{title}</h2>
      <p className="mt-1.5 max-w-[260px] text-[14px] leading-relaxed text-[#8e8e93]">{text}</p>
      <button
        type="button"
        onClick={onScan}
        className="mt-6 rounded-full bg-[#007aff] px-6 py-3 text-[15px] font-semibold text-white shadow-[0_8px_24px_rgba(0,122,255,0.35)] transition-transform active:scale-95"
      >
        Escanear primer documento
      </button>
    </motion.div>
  );
}
