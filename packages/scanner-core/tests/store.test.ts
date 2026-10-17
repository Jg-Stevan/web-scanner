/**
 * LOTE 6 (BLQ-1) — tests del store vanilla (zustand) EN MEMORIA.
 *
 * El store es importable en bun sin IndexedDB: page-store degrada a noop
 * (guards SSR preexistentes, verificados en page-store.test.ts). Aquí se
 * prueba el comportamiento de estado puro: merge de revisión con snapshot
 * B4, papelera, duplicado (C-11), lote y ajustes.
 *
 * SIN CÁMARA/WORKER/CANVAS: en bun `processImage` cae al fallback que
 * lanza (no hay DOM) → los catches del store usan el original. Es el
 * comportamiento determinista esperado en este entorno.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { useScannerStore, nextId } from "../src/store";
import { initialDocuments } from "../src/mock-data";
import { isTrashed, type CapturePage, type ScanDocument } from "../src/types";

const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const QUAD = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 },
];

function makeCapturePage(id: string, over: Partial<CapturePage> = {}): CapturePage {
  return {
    id,
    original: PNG_1PX,
    quad: QUAD,
    filter: "bw",
    rotation: 0,
    quality: { level: "excellent", sharpness: 90, brightness: 85, contrast: 80, label: "Excelente" },
    ...over,
  };
}

/** Reset del store singleton entre tests (misma biblioteca mock de arranque). */
beforeEach(() => {
  useScannerStore.setState({
    view: "library",
    documents: initialDocuments(),
    activeDocumentId: null,
    capturePages: [],
    editingIndex: 0,
    reviewDocId: null,
    batchSavedCount: 0,
    settings: {
      enhance: true,
      ocrEnabled: false,
      exportQuality: "máxima",
      flashMode: "off",
      photoMode: "auto",
    },
    hydrated: false,
    onboardingDone: false,
    pendingFindQuery: null,
  });
});

describe("nextId", () => {
  test("formato prefijo-base36-contador y ÚNICO entre llamadas", () => {
    const a = nextId("doc");
    const b = nextId("page");
    expect(a).toMatch(/^doc-[a-z0-9]+-\d+$/);
    expect(b).toMatch(/^page-[a-z0-9]+-\d+$/);
    expect(a).not.toBe(b);
    const c = nextId("doc");
    expect(c).not.toBe(a);
  });
});

describe("estado inicial y navegación", () => {
  test("arranque: biblioteca con los 6 mocks, sin sesión, sin hidratar", () => {
    const s = useScannerStore.getState();
    expect(s.documents).toHaveLength(6);
    expect(s.view).toBe("library");
    expect(s.capturePages).toHaveLength(0);
    expect(s.hydrated).toBe(false);
    expect(s.reviewDocId).toBeNull();
  });

  test("setView a cámara conserva el lote; a biblioteca/ajustes lo resetea", () => {
    const s = useScannerStore.getState();
    s.setView("camera");
    useScannerStore.setState({ batchSavedCount: 3 });
    expect(useScannerStore.getState().batchSavedCount).toBe(3);
    useScannerStore.getState().setView("camera");
    expect(useScannerStore.getState().batchSavedCount).toBe(3); // cámara: sigue
    useScannerStore.getState().setView("library");
    expect(useScannerStore.getState().batchSavedCount).toBe(0);
    useScannerStore.setState({ batchSavedCount: 2, view: "camera" });
    useScannerStore.getState().setView("settings");
    expect(useScannerStore.getState().batchSavedCount).toBe(0);
  });
});

describe("sesión de captura", () => {
  test("add/remove/update de páginas de sesión y editingIndex", () => {
    const s = useScannerStore.getState();
    s.addCapturePage(makeCapturePage("c1"));
    s.addCapturePage(makeCapturePage("c2"));
    let st = useScannerStore.getState();
    expect(st.capturePages).toHaveLength(2);
    expect(st.editingIndex).toBe(1); // índice de la última añadida
    st.updateCapturePage("c2", { rotation: 90 });
    expect(useScannerStore.getState().capturePages[1]!.rotation).toBe(90);
    useScannerStore.getState().removeCapturePage("c2");
    st = useScannerStore.getState();
    expect(st.capturePages.map((p) => p.id)).toEqual(["c1"]);
    expect(st.editingIndex).toBe(0);
    st.removeCapturePage("c1");
    expect(useScannerStore.getState().capturePages).toHaveLength(0);
  });

  test("clearCaptureSession limpia sesión y modo revisión", () => {
    const s = useScannerStore.getState();
    s.addCapturePage(makeCapturePage("c1"));
    useScannerStore.setState({ reviewDocId: "d-x" });
    s.clearCaptureSession();
    const st = useScannerStore.getState();
    expect(st.capturePages).toHaveLength(0);
    expect(st.reviewDocId).toBeNull();
    expect(st.editingIndex).toBe(0);
  });

  test("saveSessionAsDocument sin sesión → null", async () => {
    expect(await useScannerStore.getState().saveSessionAsDocument("Vacío")).toBeNull();
  });

  test("saveSessionAsDocument: crea doc, limpia sesión y fallback sin canvas usa el original", async () => {
    const s = useScannerStore.getState();
    s.addCapturePage(makeCapturePage("c1", { rotation: 0 }));
    const doc = await s.saveSessionAsDocument("Sonda lote6");
    expect(doc).not.toBeNull();
    expect(doc!.title).toBe("Sonda lote6");
    expect(doc!.pages).toHaveLength(1);
    // Sin canvas/worker en bun → catch del store → processed = original.
    expect(doc!.pages[0]!.processed).toBe(PNG_1PX);
    expect(doc!.pages[0]!.original).toBe(PNG_1PX);
    expect(doc!.pages[0]!.ocrDone).toBe(false);
    const st = useScannerStore.getState();
    expect(st.capturePages).toHaveLength(0);
    expect(st.documents[0]!.id).toBe(doc!.id); // más reciente primero
  });

  test("saveSessionAsDocument: título vacío → «Digitalización N» por nº de docs", async () => {
    const s = useScannerStore.getState();
    s.addCapturePage(makeCapturePage("c1"));
    const doc = await s.saveSessionAsDocument("   ");
    expect(doc!.title).toBe(`Digitalización ${6 + 1}`);
  });
});

describe("lote (cadena de documentos)", () => {
  test("startBatchDocument incrementa, limpia sesión y vuelve a cámara", () => {
    const s = useScannerStore.getState();
    s.addCapturePage(makeCapturePage("c1"));
    s.startBatchDocument();
    const st = useScannerStore.getState();
    expect(st.batchSavedCount).toBe(1);
    expect(st.capturePages).toHaveLength(0);
    expect(st.view).toBe("camera");
    expect(st.reviewDocId).toBeNull();
    s.startBatchDocument();
    expect(useScannerStore.getState().batchSavedCount).toBe(2);
    useScannerStore.getState().endBatch();
    expect(useScannerStore.getState().batchSavedCount).toBe(0);
  });
});

describe("etiquetas sobre documentos", () => {
  test("add/remove/setDocumentTags con límites y dedup", () => {
    const s = useScannerStore.getState();
    const id = s.documents[0]!.id;
    s.setDocumentTags(id, []); // limpiar las tags del mock para partir de cero
    s.addTagToDocument(id, "Facturas");
    s.addTagToDocument(id, "facturas"); // duplicada normalizada → ignorada
    expect(useScannerStore.getState().documents[0]!.tags).toEqual(["Facturas"]);
    s.addTagToDocument(id, "Casa");
    expect(useScannerStore.getState().documents[0]!.tags).toEqual(["Facturas", "Casa"]);
    s.removeTagFromDocument(id, "FACTURAS");
    expect(useScannerStore.getState().documents[0]!.tags).toEqual(["Casa"]);
    s.setDocumentTags(id, ["a", "a", "b"]);
    expect(useScannerStore.getState().documents[0]!.tags).toEqual(["a", "b"]);
  });

  test("tope de 8 etiquetas respetado por setDocumentTags", () => {
    const s = useScannerStore.getState();
    const id = s.documents[0]!.id;
    s.setDocumentTags(id, Array.from({ length: 12 }, (_, i) => `t${i}`));
    expect(useScannerStore.getState().documents[0]!.tags).toHaveLength(8);
  });

  test("documento inexistente → noop sin lanzar", () => {
    const s = useScannerStore.getState();
    expect(() => s.addTagToDocument("no-existe", "x")).not.toThrow();
    expect(() => s.removeTagFromDocument("no-existe", "x")).not.toThrow();
  });
});

describe("papelera (F-TRASH)", () => {
  test("delete → restore: borrado suave recuperable", () => {
    const s = useScannerStore.getState();
    const id = s.documents[0]!.id;
    s.deleteDocument(id);
    let doc = useScannerStore.getState().documents.find((d) => d.id === id)!;
    expect(isTrashed(doc)).toBe(true);
    expect(typeof doc.deletedAt).toBe("number");
    s.restoreDocument(id);
    doc = useScannerStore.getState().documents.find((d) => d.id === id)!;
    expect(isTrashed(doc)).toBe(false);
  });

  test("purgeDocument: borrado definitivo (solo si ya estaba en papelera)", () => {
    const s = useScannerStore.getState();
    const id = s.documents[0]!.id;
    s.deleteDocument(id);
    s.purgeDocument(id);
    expect(useScannerStore.getState().documents.find((d) => d.id === id)).toBeUndefined();
    expect(useScannerStore.getState().documents).toHaveLength(5);
  });

  test("openDocument: nunca abre un documento de la papelera (guard anti-carrera)", () => {
    const s = useScannerStore.getState();
    const id = s.documents[0]!.id;
    s.deleteDocument(id);
    s.openDocument(id);
    expect(useScannerStore.getState().activeDocumentId).toBeNull();
    expect(useScannerStore.getState().reviewDocId).toBeNull();
  });

  test("emptyTrash: vacía SOLO los eliminados", () => {
    const s = useScannerStore.getState();
    const alive = s.documents[0]!.id;
    const dead1 = s.documents[1]!.id;
    const dead2 = s.documents[2]!.id;
    s.deleteDocument(dead1);
    s.deleteDocument(dead2);
    s.emptyTrash();
    const st = useScannerStore.getState();
    expect(st.documents).toHaveLength(4);
    expect(st.documents.map((d) => d.id)).toContain(alive);
    expect(st.documents.find((d) => d.id === dead1)).toBeUndefined();
    expect(st.documents.find((d) => d.id === dead2)).toBeUndefined();
  });
});

describe("edición de documentos guardados", () => {
  test("renameDocument + toggleFavorite (flip del estado actual)", () => {
    const s = useScannerStore.getState();
    // documents[1] del mock: favorite=false (documents[0] nace favorito).
    const id = s.documents[1]!.id;
    const before = useScannerStore.getState().documents.find((d) => d.id === id)!.favorite;
    s.renameDocument(id, "Nuevo título");
    let doc = useScannerStore.getState().documents.find((d) => d.id === id)!;
    expect(doc.title).toBe("Nuevo título");
    s.toggleFavorite(id);
    doc = useScannerStore.getState().documents.find((d) => d.id === id)!;
    expect(doc.favorite).toBe(!before);
    s.toggleFavorite(id);
    expect(useScannerStore.getState().documents.find((d) => d.id === id)!.favorite).toBe(before);
  });

  test("duplicateDocument: copia profunda con título «(copia)» e ids NUEVOS de página (C-11)", async () => {
    const s = useScannerStore.getState();
    const orig: ScanDocument = s.documents[0]!;
    // Lote 7: duplicateDocument es async (persistencia fire-and-forget dentro).
    await s.duplicateDocument(orig.id);
    const st = useScannerStore.getState();
    expect(st.documents).toHaveLength(7);
    const copy = st.documents[0]!;
    expect(copy.id).not.toBe(orig.id);
    expect(copy.title).toBe(`${orig.title} (copia)`);
    expect(copy.favorite).toBe(false);
    expect(copy.pages).toHaveLength(orig.pages.length);
    const origIds = new Set(orig.pages.map((p) => p.id));
    for (const p of copy.pages) expect(origIds.has(p.id)).toBe(false); // ids nuevos
  });

  test("deletePageFromDocument quita solo la página pedida y actualiza updatedAt", () => {
    const s = useScannerStore.getState();
    const doc = s.documents[0]!;
    expect(doc.pages.length).toBeGreaterThan(0);
    const pageId = doc.pages[0]!.id;
    const before = doc.updatedAt;
    s.deletePageFromDocument(doc.id, pageId);
    const after = useScannerStore.getState().documents.find((d) => d.id === doc.id)!;
    expect(after.pages.find((p) => p.id === pageId)).toBeUndefined();
    expect(after.pages).toHaveLength(doc.pages.length - 1);
    expect(after.updatedAt).toBeGreaterThanOrEqual(before);
  });

  test("reorderPages aplica el orden completo de ids", () => {
    const s = useScannerStore.getState();
    const doc = s.documents[0]!;
    const ids = doc.pages.map((p) => p.id);
    const reversed = [...ids].reverse();
    s.reorderPages(doc.id, reversed);
    expect(
      useScannerStore.getState().documents.find((d) => d.id === doc.id)!.pages.map((p) => p.id)
    ).toEqual(reversed);
  });

  test("setDocumentsOrder: orden manual de la biblioteca (ids completos)", () => {
    const s = useScannerStore.getState();
    const ids = s.documents.map((d) => d.id);
    const rotated = [...ids.slice(1), ids[0]!];
    s.setDocumentsOrder(rotated);
    expect(useScannerStore.getState().documents.map((d) => d.id)).toEqual(rotated);
  });

  test("setOcrText marca ocrDone y persiste el texto en la página", () => {
    const s = useScannerStore.getState();
    const doc = s.documents[0]!;
    const pageId = doc.pages[0]!.id;
    s.setOcrText(doc.id, pageId, "FACTURA Nº 123");
    const page = useScannerStore
      .getState()
      .documents.find((d) => d.id === doc.id)!
      .pages.find((p) => p.id === pageId)!;
    expect(page.ocrText).toBe("FACTURA Nº 123");
    expect(page.ocrDone).toBe(true);
  });
});

describe("modo revisión (F-NOVIEW) y merge B4", () => {
  test("beginReviewDocument carga el doc como sesión con ids originales", async () => {
    const s = useScannerStore.getState();
    const doc = s.documents[0]!;
    // Lote 7: async — materializa el doc (IndexedDB → data URLs) antes de montar.
    await s.beginReviewDocument(doc.id);
    const st = useScannerStore.getState();
    expect(st.reviewDocId).toBe(doc.id);
    expect(st.view).toBe("editor");
    expect(st.capturePages.map((p) => p.id)).toEqual(doc.pages.map((p) => p.id));
    expect(st.capturePages[0]!.processedKey).toBeTruthy();
  });

  test("beginReviewDocument con doc inexistente/vacío → noop", async () => {
    const s = useScannerStore.getState();
    await s.beginReviewDocument("no-existe");
    expect(useScannerStore.getState().reviewDocId).toBeNull();
  });

  test("saveSessionToDocument sin revisión activa → null", async () => {
    expect(await useScannerStore.getState().saveSessionToDocument()).toBeNull();
  });

  test("merge B4: página sin cambios conserva la procesada; página nueva se añade; sesión se vacía", async () => {
    const s = useScannerStore.getState();
    const doc = s.documents[0]!;
    const origProcessed = doc.pages[0]!.processed;
    await s.beginReviewDocument(doc.id);
    // La página existente NO cambia → merge conserva procesada persistida.
    // Añadimos una página NUEVA durante la revisión.
    useScannerStore.getState().addCapturePage(makeCapturePage("c-nueva"));
    const mergedId = await useScannerStore.getState().saveSessionToDocument();
    expect(mergedId).toBe(doc.id);
    const st = useScannerStore.getState();
    expect(st.reviewDocId).toBeNull();
    expect(st.capturePages).toHaveLength(0); // todo lo del snapshot se fusionó
    const after = st.documents.find((d) => d.id === doc.id)!;
    expect(after.pages).toHaveLength(doc.pages.length + 1);
    expect(after.pages.at(-1)!.id).toBe("c-nueva");
    // Sin canvas la nueva página cae al original (fallback determinista).
    expect(after.pages.at(-1)!.processed).toBe(PNG_1PX);
    // La página intacta conserva su procesada persistida (cero reprocesos).
    expect(after.pages[0]!.processed).toBe(origProcessed);
  });

  test("merge B4: snapshot ANTES del await — captura durante el merge no se borra", async () => {
    // Simulación del caso B4: la sesión arranca con la página del doc; mientras
    // saveSessionToDocument corre (processImage async), el snapshot ya fijó los
    // ids a fusionar. Aquí probamos el contrato observable: tras el merge,
    // capturePages queda vacío SOLO con las páginas fusionadas.
    const s = useScannerStore.getState();
    const doc = s.documents[0]!;
    await s.beginReviewDocument(doc.id);
    const mergedId = await useScannerStore.getState().saveSessionToDocument();
    expect(mergedId).toBe(doc.id);
    expect(useScannerStore.getState().capturePages).toHaveLength(0);
  });

  test("sesión de revisión vaciada = usuario eliminó la última página → doc a papelera", async () => {
    const s = useScannerStore.getState();
    const doc = s.documents[0]!;
    await s.beginReviewDocument(doc.id);
    for (const p of doc.pages) useScannerStore.getState().removeCapturePage(p.id);
    expect(useScannerStore.getState().capturePages).toHaveLength(0);
    const result = await useScannerStore.getState().saveSessionToDocument();
    expect(result).toBeNull();
    const st = useScannerStore.getState();
    expect(isTrashed(st.documents.find((d) => d.id === doc.id)!)).toBe(true);
    expect(st.activeDocumentId).toBeNull();
  });
});

describe("ajustes y onboarding", () => {
  test("updateSettings hace merge parcial", () => {
    const s = useScannerStore.getState();
    s.updateSettings({ flashMode: "on" });
    const st = useScannerStore.getState();
    expect(st.settings.flashMode).toBe("on");
    expect(st.settings.exportQuality).toBe("máxima"); // resto intacto
  });

  test("completeOnboarding sin localStorage → marca solo en memoria (no lanza)", () => {
    const s = useScannerStore.getState();
    expect(() => s.completeOnboarding()).not.toThrow();
    expect(useScannerStore.getState().onboardingDone).toBe(true);
  });

  test("setPendingFindQuery ida y vuelta", () => {
    const s = useScannerStore.getState();
    s.setPendingFindQuery("factura");
    expect(useScannerStore.getState().pendingFindQuery).toBe("factura");
    s.setPendingFindQuery(null);
    expect(useScannerStore.getState().pendingFindQuery).toBeNull();
  });
});
