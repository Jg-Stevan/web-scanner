"use client";

/**
 * 🏷️ Editor de etiquetas — reutilizable en biblioteca (diálogo para uno o
 * varios documentos) y en la hoja de información del detalle.
 *
 * Semántica tipo iOS Notas/Archivos:
 *  - Chip marcado (✓) = TODOS los documentos tienen la etiqueta → tocar la quita.
 *  - Chip sin marcar = ninguno o algunos la tienen → tocar la añade a todos.
 *  - La entrada crea una etiqueta nueva y la añade a todos los documentos.
 * El color del chip es determinista por nombre (tags.ts) → una etiqueta se
 * ve igual en cualquier parte de la app.
 */

import { useMemo, useState } from "react";
import { Check, Plus, Tag as TagIcon, X } from "lucide-react";
import { toast } from "sonner";

import { useScannerStore } from "@/lib/scanner/store";
import type { ScanDocument } from "@/lib/scanner/types";
import {
  addTag,
  cleanTagInput,
  countTagUsage,
  docTags,
  MAX_TAGS,
  MAX_TAG_LEN,
  normalizeTag,
  tagColor,
} from "@/lib/scanner/tags";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/* ------------------------------------------------------------------ */
/* Piezas presentacionales                                             */
/* ------------------------------------------------------------------ */

/** Punto de color de una etiqueta (compartido por todos los estilos de chip). */
function TagDot({ tag, className }: { tag: string; className?: string }) {
  const c = tagColor(tag);
  return (
    <span
      aria-hidden="true"
      className={cn("size-[7px] shrink-0 rounded-full", className)}
      style={{ backgroundColor: c.dot }}
    />
  );
}

/** Chip compacto de solo lectura (cards de la biblioteca, hoja de info). */
export function MiniTag({ tag, onRemove }: { tag: string; onRemove?: (tag: string) => void }) {
  const c = tagColor(tag);
  return (
    <span
      className="inline-flex h-[19px] max-w-full items-center gap-1 rounded-full border px-2 text-[10.5px] font-semibold leading-none"
      style={{
        backgroundColor: c.soft,
        borderColor: c.softBorder,
        color: c.text,
      }}
    >
      <TagDot tag={tag} />
      <span className="min-w-0 truncate">{tag}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Quitar etiqueta ${tag}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove(tag);
          }}
          className="-mr-1 ml-0.5 flex size-3.5 items-center justify-center rounded-full transition-transform active:scale-75"
          style={{ backgroundColor: `${c.softBorder}` }}
        >
          <X className="size-2.5" strokeWidth={3} style={{ color: c.text }} />
        </button>
      )}
    </span>
  );
}

/** Fila de mini-etiquetas (máx. `max` visibles + “+N”). */
export function MiniTagRow({
  tags,
  max = 2,
  onRemove,
  className,
}: {
  tags: string[];
  max?: number;
  onRemove?: (tag: string) => void;
  className?: string;
}) {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, max);
  const rest = tags.length - shown.length;
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-1", className)}>
      {shown.map((t) => (
        <MiniTag key={normalizeTag(t)} tag={t} onRemove={onRemove} />
      ))}
      {rest > 0 && (
        <span className="text-[10.5px] font-semibold leading-none text-[#8e8e93]">
          +{rest}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Diálogo de edición (uno o varios documentos)                        */
/* ------------------------------------------------------------------ */

export function TagsDialog({
  open,
  onOpenChange,
  docIds,
  documents,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  docIds: string[];
  documents: ScanDocument[];
}) {
  const addTagToDocument = useScannerStore((s) => s.addTagToDocument);
  const removeTagFromDocument = useScannerStore((s) => s.removeTagFromDocument);
  const [value, setValue] = useState("");

  const docs = useMemo(
    () => documents.filter((d) => docIds.includes(d.id)),
    [documents, docIds]
  );

  /** Etiquetas presentes en ≥1 documento del lote, con estado all/some. */
  const present = useMemo(() => {
    const map = new Map<string, { tag: string; all: boolean; some: boolean }>();
    for (const d of docs) {
      for (const t of docTags(d)) {
        const key = normalizeTag(t);
        const prev = map.get(key);
        if (prev) {
          // all solo se mantiene si TODOS los docs la llevan (se evalúa abajo).
          prev.some = true;
        } else {
          map.set(key, { tag: t, all: false, some: true });
        }
      }
    }
    // Recalcula “all” contando documentos que la tienen.
    for (const entry of map.values()) {
      const withTag = docs.filter((d) =>
        docTags(d).some((t) => normalizeTag(t) === normalizeTag(entry.tag))
      ).length;
      entry.all = docs.length > 0 && withTag === docs.length;
    }
    return [...map.values()].sort((a, b) =>
      a.tag.localeCompare(b.tag, "es", { sensitivity: "base" })
    );
  }, [docs]);

  /** Sugerencias: etiquetas de la biblioteca que NO están en el lote. */
  const suggestions = useMemo(
    () =>
      countTagUsage(documents)
        .map((u) => u.tag)
        .filter((t) => !present.some((p) => normalizeTag(p.tag) === normalizeTag(t)))
        .slice(0, 8),
    [documents, present]
  );

  const anyFull = docs.some((d) => docTags(d).length >= MAX_TAGS);

  const addEverywhere = (tag: string) => {
    const clean = cleanTagInput(tag, []);
    if (!clean) return;
    let added = 0;
    for (const d of docs) {
      if (addTag(docTags(d), clean)) added += 1;
    }
    if (added > 0) {
      for (const d of docs) addTagToDocument(d.id, clean);
      toast.success(
        docIds.length === 1
          ? `Etiqueta «${clean}» añadida`
          : `Etiqueta «${clean}» añadida a ${added} ${added === 1 ? "documento" : "documentos"}`
      );
    }
  };

  const submit = () => {
    if (!value.trim()) return;
    if (anyFull) {
      toast.error("Alguno de los documentos ya tiene el máximo de etiquetas", {
        description: `Máximo ${MAX_TAGS} por documento.`,
      });
      return;
    }
    addEverywhere(value);
    setValue("");
  };

  const many = docIds.length > 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[340px] rounded-2xl bg-white dark:bg-[#1c1c1e] p-5">
        <DialogHeader className="gap-1 text-left">
          <DialogTitle className="text-[17px] font-semibold text-black dark:text-white">
            {many ? `Etiquetar ${docIds.length} documentos` : "Etiquetas"}
          </DialogTitle>
          <DialogDescription className="text-[13px] leading-snug text-[#8e8e93]">
            {many
              ? "La etiqueta se añade o se quita de todos los seleccionados."
              : "Organiza el documento con etiquetas de color."}
          </DialogDescription>
        </DialogHeader>

        {/* Etiquetas actuales del lote */}
        {present.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {present.map((p) => {
              const c = tagColor(p.tag);
              const checked = p.all;
              return (
                <button
                  key={normalizeTag(p.tag)}
                  type="button"
                  aria-pressed={checked}
                  onClick={() => {
                    if (checked) {
                      for (const d of docs) removeTagFromDocument(d.id, p.tag);
                    } else {
                      for (const d of docs) {
                        if (addTag(docTags(d), p.tag)) addTagToDocument(d.id, p.tag);
                      }
                    }
                  }}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold transition-all active:scale-95",
                    !checked &&
                      "border-[#e5e5ea] bg-[#f2f2f7]/90 text-[#3c3c43] dark:border-[#3a3a3c] dark:bg-[#2c2c2e] dark:text-white"
                  )}
                  style={
                    checked
                      ? {
                          backgroundColor: c.soft,
                          borderColor: c.softBorder,
                          color: c.text,
                        }
                      : undefined
                  }
                >
                  {checked ? (
                    <Check className="size-3.5" strokeWidth={3} style={{ color: c.dot }} />
                  ) : (
                    <Plus className="size-3.5" strokeWidth={2.5} style={{ color: c.dot }} />
                  )}
                  <span className="max-w-[140px] truncate">{p.tag}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-xl bg-[#f2f2f7] dark:bg-[#2c2c2e] px-3 py-2.5 text-[13px] text-[#8e8e93]">
            <TagIcon className="size-4 shrink-0" />
            {many
              ? "Los documentos no tienen etiquetas todavía."
              : "Este documento no tiene etiquetas todavía."}
          </div>
        )}

        {/* Entrada de nueva etiqueta */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex items-center gap-2"
        >
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={MAX_TAG_LEN}
            placeholder="Nueva etiqueta…"
            aria-label="Nueva etiqueta"
            className="h-10 flex-1 rounded-xl border-[#e5e5ea] bg-[#f2f2f7] dark:border-[#3a3a3c] dark:bg-[#2c2c2e] dark:text-white text-[14px]"
          />
          <button
            type="submit"
            disabled={!value.trim() || anyFull}
            aria-label="Añadir etiqueta"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#007aff] text-white shadow-[0_4px_12px_rgba(0,122,255,0.28)] transition-all active:scale-90 disabled:opacity-40"
          >
            <Plus className="size-5" strokeWidth={2.5} />
          </button>
        </form>

        {/* Sugerencias del resto de la biblioteca */}
        {suggestions.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#8e8e93]">
              Sugerencias
            </p>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((t) => {
                const c = tagColor(t);
                return (
                  <button
                    key={normalizeTag(t)}
                    type="button"
                    onClick={() => addEverywhere(t)}
                    className="inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-all active:scale-95"
                    style={{
                      backgroundColor: c.soft,
                      borderColor: c.softBorder,
                      color: c.text,
                    }}
                  >
                    <TagDot tag={t} />
                    <span className="max-w-[120px] truncate">{t}</span>
                    <Plus className="size-3" strokeWidth={2.5} />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="mt-1 h-10 w-full rounded-full bg-[#f2f2f7] text-[15px] font-semibold text-[#3c3c43] transition-colors hover:bg-[#e5e5ea] dark:bg-[#2c2c2e] dark:text-white dark:hover:bg-[#3a3a3c]"
        >
          Listo
        </button>
      </DialogContent>
    </Dialog>
  );
}
