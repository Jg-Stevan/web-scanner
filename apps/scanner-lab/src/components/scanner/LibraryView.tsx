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
  ChevronLeft,
  ChevronRight,
  Clock,
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
  RotateCcw,
  ScanLine,
  ScanText,
  Search,
  Send,
  Settings,
  Share2,
  Star,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { useScannerStore } from "@jg-stevan/scanner-core/store";
import type { ScanDocument } from "@jg-stevan/scanner-core/types";
import { TRASH_RETENTION_DAYS, isTrashed, trashDaysLeft } from "@jg-stevan/scanner-core/types";
import { formatBytes, relativeTime } from "@jg-stevan/scanner-core/format";
import { buildDocPdf, buildLibraryPdf, downloadBlob, sanitizeFileName, toJpeg } from "@jg-stevan/scanner-core/pdf-export";
import { docHasOcrText, downloadOcrTxt, shareOcrText } from "@jg-stevan/scanner-core/text-export";
import { ocrTextIsValid, requestOcr } from "@jg-stevan/scanner-core/ocr";
import { countTagUsage, docTags, normalizeTag, tagColor } from "@jg-stevan/scanner-core/tags";
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
        // B11: si el down cae sobre un botón (estrella, menú ⋯, asa ⠿, etc.)
        // el hold NO arranca — antes entrar en selección Y marcaba favorito
        // a la vez (doble acción contradictoria).
        if ((e.target as HTMLElement | null)?.closest?.("button")) return;
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
      <div className={cn("flex items-center justify-center bg-[#f2f2f7] dark:bg-[#2c2c2e]", className)}>
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
      className={cn("bg-[#f2f2f7] dark:bg-[#2c2c2e] object-cover", className)}
    />
  );
}

export default function LibraryView() {
  const documents = useScannerStore((s) => s.documents);
  const setView = useScannerStore((s) => s.setView);
  const openDocument = useScannerStore((s) => s.openDocument);
  const renameDocument = useScannerStore((s) => s.renameDocument);
  const deleteDocument = useScannerStore((s) => s.deleteDocument);
  const restoreDocument = useScannerStore((s) => s.restoreDocument);
  const purgeDocument = useScannerStore((s) => s.purgeDocument);
  const emptyTrash = useScannerStore((s) => s.emptyTrash);
  const toggleFavorite = useScannerStore((s) => s.toggleFavorite);
  const setOcrText = useScannerStore((s) => s.setOcrText);
  const setDocumentsOrder = useScannerStore((s) => s.setDocumentsOrder);
  const exportQuality = useScannerStore((s) => s.settings.exportQuality);
  const setPendingFindQuery = useScannerStore((s) => s.setPendingFindQuery);

  const [query, setQuery] = useState("");
  // C5: la búsqueda normaliza (NFD) TODO el corpus OCR en cada pulsación
  // (×2: ocrMatches + visible) → tartamudeo con bibliotecas grandes.
  // Debounce de 200 ms + caché del texto normalizado por página.
  const [searchQuery, setSearchQuery] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setSearchQuery(query), 200);
    return () => window.clearTimeout(t);
  }, [query]);
  const normCacheRef = useRef(new Map<string, { src: string; norm: string }>());
  const normOcr = useCallback((pageKey: string, text: string) => {
    if (!text) return "";
    const hit = normCacheRef.current.get(pageKey);
    if (hit && hit.src === text) return hit.norm;
    const norm = normalizeText(text);
    normCacheRef.current.set(pageKey, { src: text, norm });
    return norm;
  }, []);
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

  // F-TRASH: papelera «Eliminados» (pantalla propia dentro de la biblioteca).
  const [trashOpen, setTrashOpen] = useState(false);
  const [purging, setPurging] = useState<ScanDocument | null>(null);
  const [emptyTrashOpen, setEmptyTrashOpen] = useState(false);

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

  /* F-TRASH: la biblioteca VISIBLE excluye la papelera; la papelera se
   * ordena por fecha de borrado (más reciente arriba), patrón iOS Files. */
  const liveDocs = useMemo(() => documents.filter((d) => !isTrashed(d)), [documents]);
  const trashDocs = useMemo(
    () => documents.filter((d) => isTrashed(d)).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)),
    [documents]
  );

  const totalPages = useMemo(
    () => liveDocs.reduce((n, d) => n + d.pages.length, 0),
    [liveDocs]
  );

  /** Documentos exportables (con ≥1 página) y su nº total de páginas. */
  const exportableCount = useMemo(
    () => liveDocs.filter((d) => d.pages.length > 0).length,
    [liveDocs]
  );
  const exportablePages = useMemo(
    () => liveDocs.filter((d) => d.pages.length > 0).reduce((n, d) => n + d.pages.length, 0),
    [liveDocs]
  );

  /** Documentos con coincidencias en el texto OCR (para el badge de la card). */
  const ocrMatches = useMemo(() => {
    const q = normalizeText(searchQuery.trim());
    if (!q) return new Set<string>();
    const ids = new Set<string>();
    for (const d of liveDocs) {
      if (normalizeText(d.title).includes(q)) continue; // solo destacado de matches "ocultos"
      if (d.pages.some((p) => p.ocrText && normOcr(p.id, p.ocrText).includes(q))) {
        ids.add(d.id);
      }
    }
    return ids;
  }, [liveDocs, searchQuery, normOcr]);

  /** Etiquetas de la biblioteca con conteo de uso (chips de filtro). */
  const allTags = useMemo(() => countTagUsage(liveDocs), [liveDocs]);

  const visible = useMemo(() => {
    let docs = liveDocs;
    const q = normalizeText(searchQuery.trim());
    if (q) {
      // Busca en títulos, etiquetas Y en el texto reconocido por OCR.
      docs = docs.filter(
        (d) =>
          normalizeText(d.title).includes(q) ||
          docTags(d).some((t) => normalizeText(t).includes(q)) ||
          d.pages.some((p) => p.ocrText && normOcr(p.id, p.ocrText).includes(q))
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
      const pos = new Map(liveDocs.map((d, i) => [d.id, i] as const));
      sorted.sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0));
    } else {
      sorted.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return sorted;
  }, [liveDocs, searchQuery, sort, tagFilter, normOcr]);

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
    const storeIds = liveDocs.map((d) => d.id);
    const order = manualOrderIds;
    const changed =
      order.length === storeIds.length && order.some((id, i) => id !== storeIds[i]);
    if (changed) {
      setDocumentsOrder(order);
      toast.success("Orden guardado");
    }
  };

  /** Abre el documento en el EDITOR (F-NOVIEW: la 3ª interfaz desapareció —
   *  la biblioteca lleva directo a la revisión de sus páginas, como Adobe
   *  Scan). F-FIND: si la búsqueda activa matcheó por texto OCR (no por
   *  título/etiqueta), presta la consulta al editor — abre el sheet "Texto"
   *  en la 1ª página con coincidencias y las resalta en amarillo. */
  const openDocSmart = useCallback(
    (doc: ScanDocument) => {
      const q = query.trim();
      if (q && ocrMatches.has(doc.id)) {
        setPendingFindQuery(q);
      }
      openDocument(doc.id);
    },
    [openDocument, query, ocrMatches, setPendingFindQuery]
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
    () => liveDocs.filter((d) => selectedIds.has(d.id)),
    [liveDocs, selectedIds]
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
      `${plural(docs.length, "documento movido a", "documentos movidos a")} Eliminados`,
      {
        description: `Recuperables durante ${TRASH_RETENTION_DAYS} días desde la papelera.`,
      }
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
            (adjusted
              ? "El contenido excedía el presupuesto y se comprimió para caber"
              : "Dentro del presupuesto") +
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
          description: "Prueba con un filtro de mayor contraste (Texto claro o B/N) y vuelve a intentarlo.",
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
    const { id, title } = deleting;
    deleteDocument(id);
    // F-TRASH: el borrado es suave → «Deshacer» restaura al instante.
    toast.success(`«${title}» movido a Eliminados`, {
      description: `Podrás recuperarlo durante ${TRASH_RETENTION_DAYS} días.`,
      action: {
        label: "Deshacer",
        onClick: () => {
          restoreDocument(id);
          toast.success(`«${title}» restaurado`);
        },
      },
    });
    setDeleting(null);
  };

  /* ------------------------------ Papelera ------------------------------- */

  /** Restaura un documento de la papelera (botón de su fila). */
  const restoreFromTrash = (doc: ScanDocument) => {
    restoreDocument(doc.id);
    toast.success(`«${doc.title}» restaurado`, {
      description: "Ya está de vuelta en Mis documentos.",
    });
  };

  /** Borrado definitivo de un documento de la papelera (con confirmación). */
  const confirmPurge = () => {
    if (!purging) return;
    purgeDocument(purging.id);
    toast.success(`«${purging.title}» eliminado definitivamente`, {
      description: "Esta acción no se puede deshacer.",
    });
    setPurging(null);
  };

  /** Vacía la papelera completa (con confirmación). */
  const confirmEmptyTrash = () => {
    const count = trashDocs.length;
    if (count === 0) {
      setEmptyTrashOpen(false);
      return;
    }
    emptyTrash();
    toast.success(`Papelera vaciada · ${plural(count, "documento", "documentos")}`, {
      description: "Los eliminados se borraron definitivamente.",
    });
    setEmptyTrashOpen(false);
  };

  /* -------------------------- Atajos de escritorio ----------------------- */

  // «/» enfoca la búsqueda (patrón Gmail/GitHub) · Escape sale de la
  // selección o de la papelera.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (selecting || trashOpen)) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
        if (document.querySelector('[role="dialog"], [role="menu"]')) return;
        e.preventDefault();
        if (selecting) exitSelection();
        else setTrashOpen(false);
        return;
      }
      if (e.key !== "/") return;
      if (selecting || trashOpen) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [exitSelection, selecting, trashOpen]);

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
      const fileLabel = exportScope.label
        ? sanitizeFileName(
            exportScope.label.replace(/[«»·]/g, "").replace(/\s+/g, " ").trim()
          )
        : "";
      const fileName = exportScope.scoped
        ? `Biblioteca-${fileLabel}-${docCount}-documentos.pdf`
        : `Biblioteca-${docCount}-documentos.pdf`;
      pdf.save(fileName);
      toast.success(
        `PDF de biblioteca exportado · ${docCount} ${docCount === 1 ? "documento" : "documentos"} · ${pageCount} ${pageCount === 1 ? "página" : "páginas"} · ${formatBytes(bytes)}`,
        {
          id: progressId,
          description:
            (adjusted
              ? "El contenido excedía el presupuesto y se comprimió para caber"
              : "Dentro del presupuesto global") +
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
    if (liveDocs.length === 0) {
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
    // suppressHydrationWarning: las extensiones de navegador (p.ej. asistentes
    // de formularios como Protocompass) inyectan atributos data-* en el
    // contenedor del buscador ANTES de que React hidrate → desajuste SSR/cliente
    // puramente cosmético. Se tolera en este elemento (no afecta a los hijos).
    <div className="relative flex h-full w-full flex-col bg-[#f2f2f7] dark:bg-black" suppressHydrationWarning>
      {/* Header */}
      <header className="shrink-0 px-5 pb-3 pt-safe">
        {trashOpen ? (
          /* F-TRASH: cabecera de la papelera «Eliminados» con volver + vaciar */
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1.5">
              <button
                type="button"
                aria-label="Volver a Mis documentos"
                onClick={() => setTrashOpen(false)}
                className="-ml-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-opacity active:opacity-60"
              >
                <ChevronLeft className="h-[26px] w-[26px] text-[#007aff]" strokeWidth={2.2} />
              </button>
              <div className="min-w-0">
                <h1 className="truncate text-[28px] font-semibold leading-tight tracking-[-0.4px] text-black dark:text-white">
                  Eliminados
                </h1>
              </div>
            </div>
            <button
              type="button"
              disabled={trashDocs.length === 0}
              onClick={() => setEmptyTrashOpen(true)}
              className="shrink-0 text-[16px] font-normal text-[#ff3b30] transition-opacity active:opacity-60 disabled:opacity-40"
            >
              Vaciar
            </button>
          </div>
        ) : selecting ? (
          /* Modo selección: título con conteo + Cancelar */
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.4px] text-black dark:text-white">
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
              <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.4px] text-black dark:text-white">
                Mis documentos
              </h1>
              <p className="mt-1 text-[13px] text-[#8e8e93]">
                {plural(liveDocs.length, "documento", "documentos")} ·{" "}
                {plural(totalPages, "página", "páginas")}
              </p>
            </div>
            <div className="mt-1 flex shrink-0 items-center gap-1">
              {/* Seleccionar (modo selección múltiple, patrón Fotos de iOS) */}
              {liveDocs.length > 0 && (
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
              {liveDocs.filter((d) => d.pages.length > 0).length >= 2 && (
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
              {/* F-TRASH: papelera «Eliminados» (solo visible si hay algo) */}
              {trashDocs.length > 0 && (
                <button
                  type="button"
                  aria-label={`Ver Eliminados · ${plural(trashDocs.length, "documento", "documentos")}`}
                  onClick={() => setTrashOpen(true)}
                  className="relative flex h-10 w-10 items-center justify-center rounded-full transition-transform duration-150 active:scale-90"
                >
                  <Trash2 className="h-[21px] w-[21px] text-[#007aff]" strokeWidth={2} />
                  <span
                    aria-hidden="true"
                    className="absolute -right-0.5 -top-0.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[#ff3b30] px-[5px] text-[10px] font-bold leading-none text-white tabular-nums shadow-[0_1px_4px_rgba(255,59,48,0.45)]"
                  >
                    {trashDocs.length}
                  </span>
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

      {/* Búsqueda (oculta dentro de la papelera) */}
      {!trashOpen && (
      <>
      <div className="shrink-0 px-4 pb-3">
        <div className="flex h-11 items-center gap-2 rounded-xl border border-transparent bg-white dark:bg-[#1c1c1e] px-3 shadow-[0_1px_3px_rgba(0,0,0,0.05)] transition-[box-shadow,border-color] duration-200 focus-within:border-[#007aff]/30 focus-within:shadow-[0_0_0_3px_rgba(0,122,255,0.14),0_1px_3px_rgba(0,0,0,0.05)]">
          <Search className="h-[18px] w-[18px] shrink-0 text-[#8e8e93]" strokeWidth={2} aria-hidden="true" />
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar en títulos y texto OCR"
            aria-label="Buscar en títulos y texto OCR"
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-black dark:text-white outline-none placeholder:text-[#8e8e93]"
          />
          {query && (
            <button
              type="button"
              aria-label="Limpiar búsqueda"
              onClick={() => setQuery("")}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#c7c7cc] dark:bg-[#545456] text-white transition-transform active:scale-90"
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
                  ? "bg-black text-white dark:bg-white dark:text-black"
                  : "border border-[#e5e5ea] bg-white text-[#3c3c43] dark:border-[#3a3a3c] dark:bg-[#1c1c1e] dark:text-white active:opacity-70"
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
          className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#e5e5ea] bg-white text-[#8e8e93] dark:border-[#3a3a3c] dark:bg-[#1c1c1e] dark:text-[#8e8e93] transition-transform active:scale-90"
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
                ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                : "border-[#e5e5ea] bg-white text-[#3c3c43] dark:border-[#3a3a3c] dark:bg-[#1c1c1e] dark:text-white active:opacity-70"
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
                className={cn(
                  "flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-semibold transition-all duration-150 active:scale-95",
                  active
                    ? ""
                    : "border-[#e5e5ea] bg-white text-[#3c3c43] dark:border-[#3a3a3c] dark:bg-[#1c1c1e] dark:text-white"
                )}
                style={
                  active
                    ? { backgroundColor: c.soft, borderColor: c.dot, color: c.text }
                    : undefined
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
      </>
      )}

      {/* Contenido con scroll */}
      <div className="ios-scroll relative flex-1 overflow-y-auto overscroll-contain pb-32">
        {trashOpen ? (
          /* ⭐ F-TRASH: papelera «Eliminados» (iOS Files) */
          <div className="flex flex-col px-4 pt-1">
            <div className="mb-3 flex items-start gap-2 rounded-xl bg-white dark:bg-[#1c1c1e] px-3.5 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-[#8e8e93]" strokeWidth={2.2} aria-hidden="true" />
              <p className="text-[12px] leading-snug text-[#8e8e93]">
                Los documentos se guardan aquí durante{" "}
                <span className="font-semibold text-[#3c3c43] dark:text-white">
                  {TRASH_RETENTION_DAYS} días
                </span>{" "}
                y luego se borran definitivamente.
              </p>
            </div>
            {trashDocs.length === 0 ? (
              <EmptyState
                Icon={Trash2}
                title="La papelera está vacía"
                text={`Los documentos que elimines aparecerán aquí durante ${TRASH_RETENTION_DAYS} días.`}
                onScan={() => setTrashOpen(false)}
                scanLabel="Volver"
              />
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  {trashDocs.map((doc, i) => (
                    <TrashRow
                      key={doc.id}
                      doc={doc}
                      index={i}
                      onRestore={() => restoreFromTrash(doc)}
                      onPurge={() => setPurging(doc)}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setEmptyTrashOpen(true)}
                  className="mt-5 flex items-center justify-center gap-2 rounded-xl border border-[#ff3b30]/25 bg-[#ff3b30]/[0.06] px-4 py-3 text-[14px] font-semibold text-[#ff3b30] transition-transform active:scale-[0.98] dark:border-[#ff453a]/30 dark:bg-[#ff453a]/10"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
                  Vaciar papelera ({trashDocs.length})
                </button>
              </>
            )}
          </div>
        ) : empty ? (
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
                className="col-span-2 flex items-center justify-center gap-1.5 rounded-xl bg-white dark:bg-[#1c1c1e] px-3 py-2.5 text-[12px] font-medium text-[#007aff] shadow-[0_1px_3px_rgba(0,0,0,0.05)] transition-transform active:scale-[0.98]"
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
              {/* framer-motion Reorder exige renderizar los hijos en el ORDEN
                  de `values` — renderizar `visible` (orden del store) hace que
                  las demás filas no se desplacen durante el drag y haya un
                  snap-back al soltar. */}
              {manualOrderIds.map((id) => {
                const doc = visible.find((d) => d.id === id);
                if (!doc) return null;
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
                      <h2 className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-[#6d6d72] dark:text-[#98989e]">
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

      {/* FAB / Barra de selección (se intercambian con animación; en la
          papelera no hay nada que escanear desde aquí — se ocultan) */}
      <AnimatePresence initial={false} mode="wait">
        {trashOpen ? null : selecting ? (
          <motion.div
            key="selection-bar"
            initial={{ y: 90, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 90, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            className="pointer-events-none absolute inset-x-0 bottom-6 z-30 flex justify-center px-4"
          >
            <div className="pointer-events-auto w-full max-w-[360px] rounded-[26px] border border-black/5 dark:border-white/10 bg-white/92 dark:bg-[#1c1c1e]/92 px-4 pb-2.5 pt-2.5 shadow-[0_10px_40px_rgba(0,0,0,0.16)] backdrop-blur-xl">
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
                className="h-10 flex-1 rounded-full bg-[#f2f2f7] text-[15px] font-semibold text-[#3c3c43] transition-colors hover:bg-[#e5e5ea] dark:bg-[#2c2c2e] dark:text-white dark:hover:bg-[#3a3a3c]"
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

      {/* AlertDialog: Eliminar (uno) — F-TRASH: borrado suave */}
      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent className="max-w-[320px] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar documento?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleting?.title}” se moverá a «Eliminados» con todas sus páginas. Podrás
              recuperarlo durante {TRASH_RETENTION_DAYS} días.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2">
            <AlertDialogCancel className="mt-0 flex-1 rounded-full bg-[#f2f2f7] text-[15px] font-semibold text-[#3c3c43] hover:bg-[#e5e5ea] dark:bg-[#2c2c2e] dark:text-white dark:hover:bg-[#3a3a3c]">
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

      {/* AlertDialog: Eliminar la selección — F-TRASH: borrado suave */}
      <AlertDialog open={deleteManyOpen} onOpenChange={setDeleteManyOpen}>
        <AlertDialogContent className="max-w-[320px] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Eliminar {plural(selCount, "documento", "documentos")}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se moverán a «Eliminados»{" "}
              {plural(selCount, "documento y todas sus páginas", "documentos y todas sus páginas")}
              , donde podrás recuperarlos durante {TRASH_RETENTION_DAYS} días.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2">
            <AlertDialogCancel className="mt-0 flex-1 rounded-full bg-[#f2f2f7] text-[15px] font-semibold text-[#3c3c43] hover:bg-[#e5e5ea] dark:bg-[#2c2c2e] dark:text-white dark:hover:bg-[#3a3a3c]">
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
            <AlertDialogCancel className="mt-0 flex-1 rounded-full bg-[#f2f2f7] text-[15px] font-semibold text-[#3c3c43] hover:bg-[#e5e5ea] dark:bg-[#2c2c2e] dark:text-white dark:hover:bg-[#3a3a3c]">
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
            <AlertDialogCancel className="mt-0 flex-1 rounded-full bg-[#f2f2f7] text-[15px] font-semibold text-[#3c3c43] hover:bg-[#e5e5ea] dark:bg-[#2c2c2e] dark:text-white dark:hover:bg-[#3a3a3c]">
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

      {/* AlertDialog F-TRASH: borrado DEFINITIVO de un documento de la papelera */}
      <AlertDialog open={purging !== null} onOpenChange={(o) => !o && setPurging(null)}>
        <AlertDialogContent className="max-w-[320px] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar definitivamente?</AlertDialogTitle>
            <AlertDialogDescription>
              “{purging?.title}” se borrará para siempre con todas sus páginas y su texto
              reconocido. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2">
            <AlertDialogCancel className="mt-0 flex-1 rounded-full bg-[#f2f2f7] text-[15px] font-semibold text-[#3c3c43] hover:bg-[#e5e5ea] dark:bg-[#2c2c2e] dark:text-white dark:hover:bg-[#3a3a3c]">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmPurge}
              className="flex-1 rounded-full border-0 bg-[#ff3b30] text-[15px] font-semibold text-white hover:bg-[#ff453a]"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* AlertDialog F-TRASH: vaciar la papelera completa */}
      <AlertDialog open={emptyTrashOpen} onOpenChange={setEmptyTrashOpen}>
        <AlertDialogContent className="max-w-[320px] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Vaciar la papelera?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminarán definitivamente {plural(trashDocs.length, "documento", "documentos")}
              con todas sus páginas. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2">
            <AlertDialogCancel className="mt-0 flex-1 rounded-full bg-[#f2f2f7] text-[15px] font-semibold text-[#3c3c43] hover:bg-[#e5e5ea] dark:bg-[#2c2c2e] dark:text-white dark:hover:bg-[#3a3a3c]">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmEmptyTrash}
              className="flex-1 rounded-full border-0 bg-[#ff3b30] text-[15px] font-semibold text-white hover:bg-[#ff453a]"
            >
              Vaciar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog: etiquetas (documento individual desde el menú ··· o lote) */}
      <TagsDialog
        open={tagDialogIds !== null}
        onOpenChange={(o) => !o && setTagDialogIds(null)}
        docIds={tagDialogIds ?? []}
        documents={liveDocs}
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
          danger ? "text-[#ff3b30]" : "text-[#3c3c43] dark:text-white"
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
        "group cursor-pointer select-none overflow-hidden rounded-xl bg-white dark:bg-[#1c1c1e] shadow-[0_2px_8px_rgba(0,0,0,0.08)] outline-none transition-shadow duration-150 focus-visible:ring-2 focus-visible:ring-[#007aff]/60",
        selecting && selected && "ring-2 ring-[#007aff] ring-offset-0"
      )}
    >
      <div className="relative aspect-[3/4] overflow-hidden rounded-t-xl bg-[#f2f2f7] ring-1 ring-inset ring-black/[0.04] dark:bg-[#2c2c2e] dark:ring-white/[0.06]">
        <Thumb
          src={doc.pages[0]?.thumbnail}
          alt={doc.title}
          className="h-full w-full transition-transform duration-300 ease-out group-hover:scale-[1.03]"
        />
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
        {/* Badges · esquina inferior izquierda (fila flexible: sin offsets
         *  fijos que se rompían con contadores de 2 dígitos) */}
        <div className="absolute inset-x-1.5 bottom-1.5 flex items-center gap-1.5">
          <span
            className={cn(
              "flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-white backdrop-blur-sm",
              selecting && "opacity-70"
            )}
          >
            <FileText className="size-3" strokeWidth={2.4} aria-hidden="true" />
            {doc.pages.length}
          </span>
          {ocrPages > 0 && !selecting && (
            <span
              className="flex items-center gap-1 rounded-full bg-[#007aff]/85 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-white shadow-[0_2px_6px_rgba(0,122,255,0.35)] backdrop-blur-sm"
              aria-label={`Texto OCR en ${ocrPages} de ${doc.pages.length} páginas`}
            >
              <ScanText className="size-3" strokeWidth={2.4} aria-hidden="true" />
              {ocrPages === doc.pages.length ? "OCR" : `OCR ${ocrPages}/${doc.pages.length}`}
            </span>
          )}
        </div>
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
          <p className="min-w-0 flex-1 text-[14px] font-semibold leading-tight text-black dark:text-white [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [overflow:hidden]">
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
        {/* S-CARDS: micro-barra de cobertura OCR (azul, animada al cambiar) */}
        {doc.pages.length > 0 && ocrPages > 0 && (
          <div
            className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-[#e5e5ea] dark:bg-[#3a3a3c]"
            role="progressbar"
            aria-label={`Texto reconocido en ${ocrPages} de ${doc.pages.length} páginas`}
            aria-valuenow={ocrPages}
            aria-valuemin={0}
            aria-valuemax={doc.pages.length}
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#0a84ff] to-[#007aff] transition-[width] duration-500"
              style={{ width: `${(ocrPages / doc.pages.length) * 100}%` }}
            />
          </div>
        )}
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
        "flex cursor-pointer select-none items-center gap-3 rounded-xl bg-white dark:bg-[#1c1c1e] p-3 shadow-[0_2px_8px_rgba(0,0,0,0.08)] outline-none transition-shadow duration-150 focus-visible:ring-2 focus-visible:ring-[#007aff]/60",
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
          <p className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-tight text-black dark:text-white">
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
            doc.favorite ? "fill-[#ffce00] text-[#ffce00]" : "text-[#c7c7cc] dark:text-[#545456]"
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
            "-mr-1 flex h-9 w-7 shrink-0 cursor-grab touch-none flex-col items-center justify-center rounded-md text-[#c7c7cc] dark:text-[#545456] transition-colors active:cursor-grabbing active:bg-[#f2f2f7] dark:active:bg-[#2c2c2e] active:text-[#8e8e93]"
          )}
        >
          <GripVertical className="h-5 w-5" strokeWidth={2.2} />
        </button>
      ) : (
        <ChevronRight
          className={cn("h-5 w-5 shrink-0 text-[#c7c7cc] dark:text-[#545456] transition-opacity duration-150", selecting && "opacity-0")}
          strokeWidth={2}
          aria-hidden="true"
        />
      )}
    </motion.div>
  );
}

/** Menú contextual (···): etiquetar / seleccionar / renombrar / favorito /
 *  duplicar / EXPORTAR PDF / COMPARTIR / eliminar.
 *  F-NOVIEW: exportar y compartir vivían en la 3ª interfaz (Digitalización)
 *  — ahora cuelgan de aquí y del propio editor. */
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
  const exportQuality = useScannerStore((s) => s.settings.exportQuality);
  const [pdfBusy, setPdfBusy] = useState<"export" | "share" | "text" | "share-text" | null>(null);
  const hasOcr = docHasOcrText(doc);

  /** Exporta (descarga) el PDF adaptativo §8 del documento. */
  const exportPdf = async () => {
    if (pdfBusy || doc.pages.length === 0) return;
    setPdfBusy("export");
    try {
      const { pdf, bytes } = await buildDocPdf(doc, exportQuality);
      pdf.save(`${sanitizeFileName(doc.title)}.pdf`);
      toast.success(
        `PDF exportado · ${doc.pages.length} ${doc.pages.length === 1 ? "página" : "páginas"} · ${formatBytes(bytes)}`
      );
    } catch {
      toast.error("No se pudo exportar el PDF");
    } finally {
      setPdfBusy(null);
    }
  };

  /** Comparte el PDF con la hoja nativa (Web Share API nivel 2, archivos);
   *  fallback honesto: descarga directa cuando no se puede compartir. */
  const sharePdf = async () => {
    if (pdfBusy || doc.pages.length === 0) return;
    setPdfBusy("share");
    try {
      const { pdf, bytes } = await buildDocPdf(doc, exportQuality);
      const fileName = `${sanitizeFileName(doc.title)}.pdf`;
      const blob = pdf.output("blob");
      const file = new File([blob], fileName, { type: "application/pdf" });
      const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
      if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: doc.title });
        toast.success(`Documento compartido · ${formatBytes(bytes)}`);
      } else {
        downloadBlob(blob, fileName);
        toast.success("Compartir no está disponible aquí", {
          description: `El PDF (${formatBytes(bytes)}) se ha descargado en su lugar.`,
        });
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return; // el usuario canceló
      toast.error("No se pudo compartir el documento");
    } finally {
      setPdfBusy(null);
    }
  };

  /** F-TXT: exporta el texto OCR de todas las páginas como .txt (UTF-8 BOM
   *  — se abre bien en Windows). Sin OCR en el documento → ítem deshabilitado. */
  const exportText = () => {
    if (pdfBusy || !hasOcr) return;
    setPdfBusy("text");
    try {
      const { bytes, words } = downloadOcrTxt(doc);
      toast.success("Texto exportado", {
        description: `${words} ${words === 1 ? "palabra" : "palabras"} · ${formatBytes(bytes)} · .txt`,
      });
    } catch {
      toast.error("No se pudo exportar el texto");
    } finally {
      setPdfBusy(null);
    }
  };

  /** F-SHARE-TXT: comparte el texto OCR plano vía Web Share nivel 1 (hoja
   *  nativa en móvil). Sin navigator.share (escritorio/headless) cae a un
   *  .txt descargado — nunca rompe. */
  const shareText = async () => {
    if (pdfBusy || !hasOcr) return;
    setPdfBusy("share-text");
    try {
      const shared = await shareOcrText(doc);
      if (shared) {
        toast.success("Texto compartido", {
          description: `«${doc.title}» · ${doc.pages.filter((p) => p.ocrText?.trim()).length} ${doc.pages.filter((p) => p.ocrText?.trim()).length === 1 ? "página con texto" : "páginas con texto"}`,
        });
      } else {
        const { bytes, words } = downloadOcrTxt(doc);
        toast.info("Compartir texto no está disponible aquí", {
          description: `Se descargó como .txt · ${words} ${words === 1 ? "palabra" : "palabras"} · ${formatBytes(bytes)}`,
        });
      }
    } catch {
      toast.error("No se pudo compartir el texto");
    } finally {
      setPdfBusy(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Más opciones de ${doc.title}`}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full text-[#8e8e93] transition-colors hover:bg-[#f2f2f7] dark:hover:bg-[#2c2c2e] active:bg-[#e5e5ea] dark:active:bg-[#3a3a3c]",
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
        className="w-48 rounded-xl border-[#e5e5ea] dark:border-[#38383a]"
      >
        <DropdownMenuItem onSelect={onTags} className="gap-2.5 text-[14px]">
          <Tag className="h-4 w-4 text-[#8e8e93]" strokeWidth={2} />
          Etiquetas…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onSelect} className="gap-2.5 text-[14px]">
          <Check className="h-4 w-4 text-[#8e8e93]" strokeWidth={2} />
          Seleccionar
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => void exportPdf()}
          disabled={pdfBusy !== null || doc.pages.length === 0}
          className="gap-2.5 text-[14px]"
        >
          {pdfBusy === "export" ? (
            <Loader2 className="h-4 w-4 animate-spin text-[#8e8e93]" strokeWidth={2} />
          ) : (
            <FileDown className="h-4 w-4 text-[#8e8e93]" strokeWidth={2} />
          )}
          Exportar PDF
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => void sharePdf()}
          disabled={pdfBusy !== null || doc.pages.length === 0}
          className="gap-2.5 text-[14px]"
        >
          {pdfBusy === "share" ? (
            <Loader2 className="h-4 w-4 animate-spin text-[#8e8e93]" strokeWidth={2} />
          ) : (
            <Share2 className="h-4 w-4 text-[#8e8e93]" strokeWidth={2} />
          )}
          Compartir
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => exportText()}
          disabled={pdfBusy !== null || !hasOcr}
          className="gap-2.5 text-[14px]"
        >
          {pdfBusy === "text" ? (
            <Loader2 className="h-4 w-4 animate-spin text-[#8e8e93]" strokeWidth={2} />
          ) : (
            <FileText className="h-4 w-4 text-[#8e8e93]" strokeWidth={2} />
          )}
          Exportar texto
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => void shareText()}
          disabled={pdfBusy !== null || !hasOcr}
          className="gap-2.5 text-[14px]"
        >
          {pdfBusy === "share-text" ? (
            <Loader2 className="h-4 w-4 animate-spin text-[#8e8e93]" strokeWidth={2} />
          ) : (
            <Send className="h-4 w-4 text-[#8e8e93]" strokeWidth={2} />
          )}
          Compartir texto
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
        <DropdownMenuSeparator className="bg-[#f2f2f7] dark:bg-[#38383a]" />
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
  scanLabel,
}: {
  Icon: LucideIcon;
  title: string;
  text: string;
  onScan: () => void;
  /** Texto del botón (por defecto «Escanear primer documento»). */
  scanLabel?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="flex flex-col items-center px-8 pt-14 text-center"
    >
      <div className="flex h-24 w-24 items-center justify-center rounded-[28px] bg-[#e5e5ea]/60 dark:bg-[#2c2c2e]">
        <Icon className="h-12 w-12 text-[#8e8e93]" strokeWidth={1.5} aria-hidden="true" />
      </div>
      <h2 className="mt-5 text-[17px] font-semibold text-black dark:text-white">{title}</h2>
      <p className="mt-1.5 max-w-[260px] text-[14px] leading-relaxed text-[#8e8e93]">{text}</p>
      <button
        type="button"
        onClick={onScan}
        className="mt-6 rounded-full bg-[#007aff] px-6 py-3 text-[15px] font-semibold text-white shadow-[0_8px_24px_rgba(0,122,255,0.35)] transition-transform active:scale-95"
      >
        {scanLabel ?? "Escanear primer documento"}
      </button>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* ⭐ F-TRASH: fila de la papelera «Eliminados»                         */
/* ------------------------------------------------------------------ */

/** Fila de documento eliminado (patrón «Eliminados recientemente» de
 *  iOS Files): miniatura atenuada en escala de grises, badge rojo con los
 *  días restantes y acciones Restaurar / Eliminar definitivamente. */
function TrashRow({
  doc,
  index,
  onRestore,
  onPurge,
}: {
  doc: ScanDocument;
  index: number;
  onRestore: () => void;
  onPurge: () => void;
}) {
  const daysLeft = trashDaysLeft(doc);
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.04, 0.28), ease: "easeOut" }}
      exit={{ opacity: 0, scale: 0.96 }}
      className="flex items-center gap-3 overflow-hidden rounded-xl bg-white dark:bg-[#1c1c1e] p-2.5 shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
    >
      {/* Miniatura atenuada (en escala de grises — visual de «eliminado») */}
      <div className="relative h-[72px] w-[54px] shrink-0 overflow-hidden rounded-lg bg-[#f2f2f7] dark:bg-[#2c2c2e] ring-1 ring-inset ring-black/5 dark:ring-white/5">
        <Thumb src={doc.pages[0]?.thumbnail} alt="" className="h-full w-full opacity-55 grayscale" />
        {/* Badge de días restantes */}
        <span
          className={cn(
            "absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-[#ff3b30]/90 px-1 py-0.5 text-[9px] font-bold text-white tabular-nums backdrop-blur-[2px]",
            daysLeft <= 7 && "animate-pulse"
          )}
          aria-label={`Quedan ${daysLeft} días`}
        >
          <Clock className="size-2.5" strokeWidth={2.6} aria-hidden="true" />
          {daysLeft} d
        </span>
      </div>
      {/* Título + metadatos */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold leading-tight text-black/60 dark:text-white/60">
          {doc.title}
        </p>
        <p className="mt-1 truncate text-[12px] text-[#8e8e93]">
          {plural(doc.pages.length, "página", "páginas")} · eliminado{" "}
          {relativeTime(doc.deletedAt ?? doc.updatedAt)}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-[#8e8e93]/80">
          Quedan {daysLeft} {daysLeft === 1 ? "día" : "días"} para recuperarlo
        </p>
      </div>
      {/* Acciones */}
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          aria-label={`Restaurar ${doc.title}`}
          onClick={onRestore}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[#007aff]/10 text-[#007aff] transition-all duration-150 hover:bg-[#007aff]/16 active:scale-90 dark:bg-[#0a84ff]/15 dark:text-[#0a84ff]"
        >
          <RotateCcw className="h-[18px] w-[18px]" strokeWidth={2.2} />
        </button>
        <button
          type="button"
          aria-label={`Eliminar definitivamente ${doc.title}`}
          onClick={onPurge}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[#ff3b30]/10 text-[#ff3b30] transition-all duration-150 hover:bg-[#ff3b30]/16 active:scale-90 dark:bg-[#ff453a]/15 dark:text-[#ff453a]"
        >
          <Trash2 className="h-[18px] w-[18px]" strokeWidth={2.2} />
        </button>
      </div>
    </motion.div>
  );
}
