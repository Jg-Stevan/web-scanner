"use client";

/**
 * Store global del escáner (Zustand).
 * Mantiene: vista activa, documentos guardados, sesión de captura y ajustes.
 */

import { create } from "zustand";
import type {
  CapturePage,
  PageFilter,
  Quad,
  ScanDocument,
  ScanPage,
  ScannerSettings,
  ScannerView,
} from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { initialDocuments } from "./mock-data";
import { processImage } from "./image-processor";
import {
  clearAllDocuments as idbClearAll,
  loadAllDocuments,
  loadSettings,
  persistDocument,
  removeDocument as idbRemove,
  saveManualOrder,
  saveSettings,
} from "./page-store";
import { addTag, removeTag } from "./tags";

let uid = 0;
export function nextId(prefix: string): string {
  uid += 1;
  return `${prefix}-${Date.now().toString(36)}-${uid}`;
}

interface ScannerState {
  view: ScannerView;
  documents: ScanDocument[];
  activeDocumentId: string | null;

  /** Sesión de captura: páginas pendientes de guardar */
  capturePages: CapturePage[];
  /** Índice de página en edición dentro del editor */
  editingIndex: number;

  /** Edición MANUAL de una página YA GUARDADA: mientras esté activo, el editor
   *  trabaja sobre esa página del documento (write-back) en vez de crear un
   *  documento nuevo. E2c: "la edición manual" también existe post-guardado. */
  editSavedPageCtx: { docId: string; pageId: string } | null;
  /** Abre el editor de bordes sobre una página guardada (carga la página como
   *  sesión de edición y recuerda el destino del write-back). */
  beginEditSavedPage: (docId: string, pageId: string) => void;
  /** Cancela la edición de página guardada (vuelve al detalle, sin cambios). */
  clearEditSavedPage: () => void;
  /** Procesa la página editada y la escribe de vuelta en su documento
   *  (respeta quadManual → warp SIN refine y SIN shrink). Devuelve el docId
   *  o null si no hay contexto. */
  saveEditedPageToDocument: () => Promise<string | null>;

  /** Modo lote: nº de documentos guardados en cadena durante la sesión de
   *  cámara actual (sin volver a la biblioteca). 0 = lote inactivo. */
  batchSavedCount: number;

  settings: ScannerSettings;
  hydrated: boolean;

  setView: (view: ScannerView) => void;
  openDocument: (id: string) => void;

  /** Consulta que la biblioteca “presta” al detalle para abrir el buscador
   *  de texto OCR ya relleno y saltar a la primera coincidencia. */
  pendingFindQuery: string | null;
  setPendingFindQuery: (q: string | null) => void;

  /** Etiquetas: añade/quita a un documento (persiste). */
  addTagToDocument: (id: string, tag: string) => void;
  removeTagFromDocument: (id: string, tag: string) => void;
  setDocumentTags: (id: string, tags: string[]) => void;

  addCapturePage: (page: CapturePage) => void;
  removeCapturePage: (id: string) => void;
  updateCapturePage: (id: string, patch: Partial<CapturePage>) => void;
  setEditingIndex: (i: number) => void;
  clearCaptureSession: () => void;

  /** Lote: encadena un nuevo documento tras guardar (contador+1, sesión
   *  limpia, vuelve a la cámara). */
  startBatchDocument: () => void;
  /** Lote: termina la cadena (vuelve a biblioteca, contador a 0). */
  endBatch: () => void;

  reprocessPage: (id: string) => Promise<void>;

  saveSessionAsDocument: (title: string) => Promise<ScanDocument | null>;
  deleteDocument: (id: string) => void;
  renameDocument: (id: string, title: string) => void;
  toggleFavorite: (id: string) => void;
  addPageToDocument: (docId: string, page: CapturePage) => Promise<void>;
  deletePageFromDocument: (docId: string, pageId: string) => void;
  /** Reordena las páginas de un documento por lista completa de ids. */
  reorderPages: (docId: string, order: string[]) => void;
  /** Duplica un documento completo (copia profunda, «Título (copia)»). */
  duplicateDocument: (docId: string) => void;
  /** Aplica el orden MANUAL completo de la biblioteca (lista de ids del
   *  drag & drop) y lo persiste en el meta store. */
  setDocumentsOrder: (order: string[]) => void;
  setFilterOnPage: (docId: string, pageId: string, filter: PageFilter) => Promise<void>;
  setOcrText: (docId: string, pageId: string, text: string) => void;
  wipeLibrary: () => void;

  updateSettings: (patch: Partial<ScannerSettings>) => void;
  hydrateFromStorage: () => Promise<void>;
}

export const useScannerStore = create<ScannerState>((set, get) => ({
  view: "library",
  documents: initialDocuments(),
  activeDocumentId: null,
  capturePages: [],
  editingIndex: 0,
  editSavedPageCtx: null,
  batchSavedCount: 0,
  settings: DEFAULT_SETTINGS,
  hydrated: false,
  setView: (view) =>
    set((s) => ({
      view,
      // El lote termina al salir del ciclo cámara→editor (biblioteca, detalle o ajustes).
      batchSavedCount:
        view === "library" || view === "document" || view === "settings"
          ? 0
          : s.batchSavedCount,
    })),
  openDocument: (id) =>
    set((s) => ({ activeDocumentId: id, view: "document", batchSavedCount: 0 })),

  pendingFindQuery: null,
  setPendingFindQuery: (q) => set({ pendingFindQuery: q }),

  /** Etiquetas — añade (si cabe y no existe) y persiste. */
  addTagToDocument: (id, tag) => {
    const doc = get().documents.find((d) => d.id === id);
    if (!doc) return;
    const next = addTag(doc.tags ?? [], tag);
    if (!next) return;
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === id ? { ...d, tags: next, updatedAt: Date.now() } : d
      ),
    }));
    const updated = get().documents.find((d) => d.id === id);
    if (updated) void persistDocument(updated);
  },

  /** Etiquetas — quita y persiste. */
  removeTagFromDocument: (id, tag) => {
    const doc = get().documents.find((d) => d.id === id);
    if (!doc) return;
    const next = removeTag(doc.tags ?? [], tag);
    if (!next) return;
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === id ? { ...d, tags: next, updatedAt: Date.now() } : d
      ),
    }));
    const updated = get().documents.find((d) => d.id === id);
    if (updated) void persistDocument(updated);
  },

  /** Etiquetas — reemplaza la lista completa (edición en lote). */
  setDocumentTags: (id, tags) => {
    const clean = [...new Set(tags)].slice(0, 8);
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === id ? { ...d, tags: clean, updatedAt: Date.now() } : d
      ),
    }));
    const updated = get().documents.find((d) => d.id === id);
    if (updated) void persistDocument(updated);
  },

  addCapturePage: (page) =>
    set((s) => ({ capturePages: [...s.capturePages, page], editingIndex: s.capturePages.length })),
  removeCapturePage: (id) =>
    set((s) => {
      const idx = s.capturePages.findIndex((p) => p.id === id);
      const pages = s.capturePages.filter((p) => p.id !== id);
      return {
        capturePages: pages,
        editingIndex: Math.min(idx > 0 ? idx - 1 : 0, Math.max(0, pages.length - 1)),
      };
    }),
  updateCapturePage: (id, patch) =>
    set((s) => ({
      capturePages: s.capturePages.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    })),
  setEditingIndex: (i) => set({ editingIndex: i }),
  clearCaptureSession: () => set({ capturePages: [], editingIndex: 0, editSavedPageCtx: null }),

  startBatchDocument: () =>
    set((s) => ({
      batchSavedCount: s.batchSavedCount + 1,
      capturePages: [],
      editingIndex: 0,
      view: "camera",
    })),
  endBatch: () => set({ batchSavedCount: 0 }),

  reprocessPage: async (id) => {
    const { capturePages, settings } = get();
    const page = capturePages.find((p) => p.id === id);
    if (!page) return;
    try {
      await processImage(page.original, page.quad, page.filter, page.rotation, {
        manual: page.quadManual === true,
        unsharpOriginal: settings.unsharpOriginal,
      });
    } catch {
      /* noop */
    }
  },

  saveSessionAsDocument: async (title) => {
    const { capturePages, settings } = get();
    if (capturePages.length === 0) return null;
    const now = Date.now();
    const pages: ScanPage[] = [];
    for (const p of capturePages) {
      let processed = p.original;
      let thumbnail = p.original;
      let precision: ScanPage["precision"];
      try {
        const res = await processImage(p.original, p.quad, p.filter, p.rotation, {
          manual: p.quadManual === true,
          unsharpOriginal: settings.unsharpOriginal,
        });
        processed = res.processed;
        thumbnail = res.thumbnail;
        precision = res.precision;
      } catch {
        /* usa original */
      }
      pages.push({
        id: p.id,
        original: p.original,
        processed,
        thumbnail,
        filter: p.filter,
        quad: p.quad,
        quadManual: p.quadManual,
        rotation: p.rotation,
        quality: p.quality,
        precision,
        ocrText: undefined,
        ocrDone: false,
        createdAt: now,
      });
    }
    const doc: ScanDocument = {
      id: nextId("doc"),
      title: title.trim() || `Digitalización ${get().documents.length + 1}`,
      pages,
      favorite: false,
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({
      documents: [doc, ...s.documents],
      capturePages: [],
      editingIndex: 0,
    }));
    void persistDocument(doc);
    // El orden manual debe conocer al nuevo documento (si no, en el próximo
    // reload caería al final aunque aquí esté primero).
    void saveManualOrder(get().documents.map((d) => d.id));
    return doc;
  },

  // ── Edición manual de página guardada (E2c) ──────────────────────────
  beginEditSavedPage: (docId, pageId) => {
    const doc = get().documents.find((d) => d.id === docId);
    const page = doc?.pages.find((p) => p.id === pageId);
    if (!doc || !page) return;
    set({
      capturePages: [
        {
          id: page.id,
          original: page.original,
          quad: page.quad,
          quadManual: page.quadManual,
          filter: page.filter,
          rotation: page.rotation,
          quality: page.quality,
        },
      ],
      editingIndex: 0,
      editSavedPageCtx: { docId, pageId },
      view: "editor",
      batchSavedCount: 0,
    });
  },

  clearEditSavedPage: () => {
    const ctx = get().editSavedPageCtx;
    set({ capturePages: [], editingIndex: 0, editSavedPageCtx: null });
    if (ctx) set({ activeDocumentId: ctx.docId, view: "document" });
  },

  saveEditedPageToDocument: async () => {
    const { editSavedPageCtx, capturePages, settings } = get();
    if (!editSavedPageCtx || capturePages.length === 0) return null;
    const p = capturePages[0]!;
    const { docId, pageId } = editSavedPageCtx;
    let processed = p.original;
    let thumbnail = p.original;
    let precision: ScanPage["precision"];
    try {
      const res = await processImage(p.original, p.quad, p.filter, p.rotation, {
        manual: p.quadManual === true,
        unsharpOriginal: settings.unsharpOriginal,
      });
      processed = res.processed;
      thumbnail = res.thumbnail;
      precision = res.precision;
    } catch {
      /* conserva la imagen actual */
    }
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === docId
          ? {
              ...d,
              updatedAt: Date.now(),
              pages: d.pages.map((pg) =>
                pg.id === pageId
                  ? {
                      ...pg,
                      original: p.original,
                      quad: p.quad,
                      quadManual: p.quadManual,
                      filter: p.filter,
                      rotation: p.rotation,
                      processed,
                      thumbnail,
                      precision,
                      // El OCR previo puede quedar desalineado tras re-recortar:
                      // se re-marca como pendiente (no se borra el texto viejo
                      // — el usuario decide si re-reconocer).
                      ocrDone: false,
                    }
                  : pg
              ),
            }
          : d
      ),
      capturePages: [],
      editingIndex: 0,
      editSavedPageCtx: null,
      activeDocumentId: docId,
      view: "document",
    }));
    const after = get().documents.find((d) => d.id === docId);
    if (after) void persistDocument(after);
    return docId;
  },

  deleteDocument: (id) => {
    set((s) => ({
      documents: s.documents.filter((d) => d.id !== id),
      view: s.activeDocumentId === id ? "library" : s.view,
      activeDocumentId: s.activeDocumentId === id ? null : s.activeDocumentId,
    }));
    void idbRemove(id);
  },

  renameDocument: (id, title) => {
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === id ? { ...d, title: title.trim() || d.title, updatedAt: Date.now() } : d
      ),
    }));
    const doc = get().documents.find((d) => d.id === id);
    if (doc) void persistDocument(doc);
  },

  toggleFavorite: (id) => {
    set((s) => ({
      documents: s.documents.map((d) => (d.id === id ? { ...d, favorite: !d.favorite } : d)),
    }));
    const doc = get().documents.find((d) => d.id === id);
    if (doc) void persistDocument(doc);
  },

  addPageToDocument: async (docId, page) => {
    const { settings } = get();
    let processed = page.original;
    let thumbnail = page.original;
    let precision: ScanPage["precision"];
    try {
      const res = await processImage(page.original, page.quad, page.filter, page.rotation, {
        manual: page.quadManual === true,
        unsharpOriginal: settings.unsharpOriginal,
      });
      processed = res.processed;
      thumbnail = res.thumbnail;
      precision = res.precision;
    } catch {
      /* usa original */
    }
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === docId
          ? {
              ...d,
              pages: [
                ...d.pages,
                {
                  id: page.id,
                  original: page.original,
                  processed,
                  thumbnail,
                  filter: page.filter,
                  quad: page.quad,
                  quadManual: page.quadManual,
                  rotation: page.rotation,
                  quality: page.quality,
                  precision,
                  ocrText: undefined,
                  ocrDone: false,
                  createdAt: Date.now(),
                },
              ],
              updatedAt: Date.now(),
            }
          : d
      ),
    }));
    const doc = get().documents.find((d) => d.id === docId);
    if (doc) void persistDocument(doc);
  },

  deletePageFromDocument: (docId, pageId) => {
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === docId
          ? { ...d, pages: d.pages.filter((p) => p.id !== pageId), updatedAt: Date.now() }
          : d
      ),
    }));
    const doc = get().documents.find((d) => d.id === docId);
    if (doc) void persistDocument(doc);
  },

  /** Reordena las páginas por ids (arrastrar y soltar en el carrusel). */
  reorderPages: (docId, order) => {
    const doc = get().documents.find((d) => d.id === docId);
    if (!doc) return;
    const byId = new Map(doc.pages.map((p) => [p.id, p]));
    const pages = order
      .map((id) => byId.get(id))
      .filter((p): p is ScanPage => p !== undefined);
    // Ignora órdenes incompletos o idénticos (evita escrituras vacías).
    if (pages.length !== doc.pages.length) return;
    if (pages.every((p, i) => p.id === doc.pages[i].id)) return;
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === docId ? { ...d, pages, updatedAt: Date.now() } : d
      ),
    }));
    const updated = get().documents.find((d) => d.id === docId);
    if (updated) void persistDocument(updated);
  },

  /** Duplica un documento (menú contextual de la biblioteca). */
  duplicateDocument: (docId) => {
    const doc = get().documents.find((d) => d.id === docId);
    if (!doc) return;
    const now = Date.now();
    const copy: ScanDocument = {
      ...doc,
      id: nextId("doc"),
      title: `${doc.title} (copia)`.slice(0, 60),
      favorite: false,
      createdAt: now,
      updatedAt: now,
      pages: doc.pages.map((p) => ({ ...p })),
    };
    set((s) => ({ documents: [copy, ...s.documents] }));
    void persistDocument(copy);
    // Sincroniza el orden manual con la nueva membresía (misma razón que
    // saveSessionAsDocument).
    void saveManualOrder(get().documents.map((d) => d.id));
  },

  /** Orden manual: aplica la lista completa de ids (drag & drop de la vista
   *  de lista) y la persiste en el meta store (sobrevive al refresh). */
  setDocumentsOrder: (order) => {
    const byId = new Map(get().documents.map((d) => [d.id, d] as const));
    const next: ScanDocument[] = [];
    for (const id of order) {
      const d = byId.get(id);
      if (d) {
        next.push(d);
        byId.delete(id);
      }
    }
    // Los ids ausentes (nuevos mientras se arrastraba) van al final.
    for (const d of byId.values()) next.push(d);
    const same =
      next.length === get().documents.length &&
      next.every((d, i) => d.id === get().documents[i].id);
    if (same) return;
    set({ documents: next });
    void saveManualOrder(next.map((d) => d.id));
  },

  setFilterOnPage: async (docId, pageId, filter) => {
    const { settings } = get();
    const doc = get().documents.find((d) => d.id === docId);
    const page = doc?.pages.find((p) => p.id === pageId);
    if (!doc || !page) return;
    let processed = page.processed;
    let thumbnail = page.thumbnail;
    let precision: ScanPage["precision"] = page.precision;
    try {
      const res = await processImage(page.original, page.quad, filter, page.rotation, {
        manual: page.quadManual === true,
        unsharpOriginal: settings.unsharpOriginal,
      });
      processed = res.processed;
      thumbnail = res.thumbnail;
      precision = res.precision;
    } catch {
      /* conserva */
    }
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === docId
          ? {
              ...d,
              pages: s.documents
                .find((dd) => dd.id === docId)!
                .pages.map((p) =>
                  p.id === pageId ? { ...p, filter, processed, thumbnail, precision } : p
                ),
              updatedAt: Date.now(),
            }
          : d
      ),
    }));
    const updated = get().documents.find((d) => d.id === docId);
    if (updated) void persistDocument(updated);
  },

  setOcrText: (docId, pageId, text) => {
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === docId
          ? {
              ...d,
              pages: d.pages.map((p) =>
                p.id === pageId ? { ...p, ocrText: text, ocrDone: true } : p
              ),
              updatedAt: Date.now(),
            }
          : d
      ),
    }));
    const doc = get().documents.find((d) => d.id === docId);
    if (doc) void persistDocument(doc);
  },

  /** Borra TODOS los documentos (memoria + IndexedDB). Tras el refresh la
   *  biblioteca permanece vacía (la instalación queda marcada). */
  wipeLibrary: () => {
    set({ documents: [], activeDocumentId: null });
    void idbClearAll();
  },

  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    saveSettings(settings);
  },

  /** Hidrata documentos + ajustes desde el almacenamiento local (§8).
 *  En instalación nueva conserva los mocks. Idempotente. */
  hydrateFromStorage: async () => {
    if (get().hydrated) return;
    const settings = loadSettings();
    const docs = await loadAllDocuments();
    set((s) => ({
      hydrated: true,
      settings: { ...s.settings, ...settings },
      documents: docs === null ? s.documents : docs,
    }));
  },
}));

/** Selecciona el documento activo. */
export function useActiveDocument(): ScanDocument | null {
  return useScannerStore((s) => s.documents.find((d) => d.id === s.activeDocumentId) ?? null);
}

/** Sonda de QA (misma idea que __scannerPrecision/__cameraTelemetry):
 *  expone un resumen del store para verificar estado desde la consola. */
if (typeof window !== "undefined") {
  (window as unknown as { __scannerStore?: () => unknown }).__scannerStore = () => {
    const s = useScannerStore.getState();
    return {
      view: s.view,
      hydrated: s.hydrated,
      batchSavedCount: s.batchSavedCount,
      captureSession: {
        pages: s.capturePages.length,
        ids: s.capturePages.map((p) => p.id.slice(-8)),
      },
      documents: s.documents.map((d) => ({
        id: d.id,
        title: d.title,
        tags: d.tags ?? [],
        pages: d.pages.map((p) => ({
          id: p.id.slice(-8),
          ocrDone: p.ocrDone,
          chars: typeof p.ocrText === "string" ? p.ocrText.length : 0,
        })),
        updatedAt: d.updatedAt,
      })),
    };
  };
}
