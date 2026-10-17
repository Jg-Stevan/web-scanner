"use client";

/**
 * Persistencia local §8 del usuario (ARQUITECTURA-Y-PRECISION.md):
 *  - Documentos completos en IndexedDB con las imágenes como BLOB (no data
 *    URLs) — mucho más compactos en disco y nativos del navegador.
 *  - Ajustes en localStorage (payload diminuto, sync al boot).
 *
 * Toda la API degrada en silencio: sin IndexedDB (SSR, modo privado, Safari
 * viejo) la app sigue funcionando 100% en memoria. Nunca lanza.
 */

import type { ScanDocument, ScanPage, ScannerSettings } from "./types";
import { DEFAULT_SETTINGS, normalizePageFilter } from "./types";

const DB_NAME = "escaner-ios";
const DB_VERSION = 2;
const STORE_DOCS = "documents";
const STORE_META = "meta";
const META_KEY = "initialized";
const META_KEY_ORDER = "manualOrder";
const SETTINGS_KEY = "escaner-settings-v1";
/** Marca de migración one-time: sube exportQuality a "máxima" para
 *  instalaciones creadas antes del cambio de calidad por defecto (F-OCR).
 *  Si el usuario elige otro valor DESPUÉS de migrar, se respeta siempre. */
const SETTINGS_MIGRATION_KEY = "escaner-settings-v2-maxq";
/** F-OCR-MANUAL v6.1: clave aparte para que la migración del OCR corra una
 *  vez en TODAS las instalaciones (la clave v2-maxq ya está escrita en las
 *  anteriores y no volvería a ejecutarse). */
const SETTINGS_MIGRATION_KEY_OCR_OFF = "escaner-settings-v3-ocr-manual";

/** Registro persistido: igual que ScanPage pero con las imágenes como Blob. */
interface StoredPage extends Omit<ScanPage, "original" | "processed" | "thumbnail"> {
  original: Blob;
  processed: Blob;
  thumbnail: Blob;
}

interface StoredDocument extends Omit<ScanDocument, "pages"> {
  pages: StoredPage[];
}

// ─── utilidades data URL ⇄ Blob ─────────────────────────────────────────────

export function dataUrlToBlob(dataUrl: string): Blob | null {
  // Sin fetch() (más portable en workers/contextos fríos): parse manual.
  // Soporta DOS variantes de data URL:
  //  · base64 (image/png, image/jpeg de los escaneos reales)
  //  · percent-encoded (data:image/svg+xml;charset=utf-8,… de los mocks demo)
  // atob() sobre SVG percent-encoded lanza InvalidCharacterError — antes se
  // tragaba el error en el catch de persistDocument y los cambios sobre
  // documentos demo (renombrar, favorito, etiquetas…) NO persistían.
  const comma = dataUrl.indexOf(",");
  // C-24 (auditoría leaks-recursos): null en vez de Blob vacío — un blob
  // vacío persistible producía, al hidratar, data URLs no-imagen rotas en
  // silencio (la carga ya tolera páginas corruptas; la escritura ahora
  // también, ver persistDocument).
  if (comma < 0) return null;
  const header = dataUrl.slice(0, comma);
  const mime = /data:([^;]+)/.exec(header)?.[1] ?? "application/octet-stream";
  const payload = dataUrl.slice(comma + 1);
  if (/;base64$/i.test(header)) {
    const bin = atob(payload);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  const text = decodeURIComponent(payload);
  return new Blob([text], { type: mime });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error("blobToDataUrl falló"));
    fr.readAsDataURL(blob);
  });
}

// ─── materialización on-demand (BLQ-6, lote7) ──────────────────────────────────

/** Imágenes materializadas de una página como Blob URLs (NO data URLs:
 *  cero base64 en RAM — el bitmap vive en el blob store del navegador y el
 *  string es una referencia de ~60 bytes). Volátil: NUNCA persistir. */
export interface PageImageData {
  originalUrl: string;
  processedUrl: string;
}

/** LRU pura e inyectable (testeable sin DOM): los valores se crean con
 *  `create` (async) y se liberan con `dispose` al expulsar o en `release`.
 *  El acceso refresca la posición (LRU clásica por inserción). */
export class PageImageCache<V> {
  private map = new Map<string, Promise<V>>();
  constructor(
    private max: number,
    private create: (key: string) => Promise<V>,
    private dispose: (value: V) => void,
  ) {}

  /** Resuelve el valor de la clave (creándolo si hace falta) y lo marca
   *  como más-recientemente-usado. Llamadas concurrentes comparten promesa.
   *  Una creación fallida NO se cachea (la entrada se limpia → retry). */
  get(key: string): Promise<V> {
    const pending = this.map.get(key);
    if (pending) {
      this.map.delete(key);
      this.map.set(key, pending);
      return pending;
    }
    const p = this.create(key);
    void p.catch(() => {
      if (this.map.get(key) === p) this.map.delete(key);
    });
    this.map.set(key, p);
    this.evict();
    return p;
  }

  peek(key: string): Promise<V> | undefined {
    return this.map.get(key);
  }

  /** Libera explícitamente (cierre de vista): expulsa y dispone. */
  release(key: string): void {
    const p = this.map.get(key);
    if (!p) return;
    this.map.delete(key);
    void p.then(this.dispose).catch(() => {
      /* dispose best-effort */
    });
  }

  private evict(): void {
    while (this.map.size > this.max) {
      const oldestKey = this.map.keys().next().value as string;
      const oldest = this.map.get(oldestKey);
      this.map.delete(oldestKey);
      if (oldest) void oldest.then(this.dispose).catch(() => {
        /* dispose best-effort */
      });
    }
  }
}

/** Lee los Blobs original/processed de UNA página directamente de IndexedDB
 *  (una lectura; los blobs nunca se retienen en RAM más allá del uso). */
export async function loadPageBlobs(
  docId: string,
  pageId: string,
): Promise<{ original: Blob; processed: Blob } | null> {
  try {
    const db = await openDb();
    if (!db) return null;
    const rec = await new Promise<StoredDocument | undefined>((resolve) => {
      const tx = db.transaction(STORE_DOCS, "readonly");
      const req = tx.objectStore(STORE_DOCS).get(docId);
      req.onsuccess = () => resolve(req.result as StoredDocument | undefined);
      req.onerror = () => resolve(undefined);
    });
    db.close();
    const sp = rec?.pages.find((p) => p.id === pageId);
    if (!sp || !(sp.original instanceof Blob) || !(sp.processed instanceof Blob)) return null;
    return { original: sp.original, processed: sp.processed };
  } catch {
    return null;
  }
}

const PAGE_IMAGE_CACHE_MAX = 8;
const imageCache = new PageImageCache<PageImageData>(
  PAGE_IMAGE_CACHE_MAX,
  async (key) => {
    const sep = key.indexOf("|");
    const blobs = await loadPageBlobs(key.slice(0, sep), key.slice(sep + 1));
    if (!blobs) throw new Error(`page-store: página no encontrada en IndexedDB: ${key}`);
    return {
      originalUrl: URL.createObjectURL(blobs.original),
      processedUrl: URL.createObjectURL(blobs.processed),
    };
  },
  (v) => {
    try {
      URL.revokeObjectURL(v.originalUrl);
    } catch {
      /* ya revocada */
    }
    try {
      URL.revokeObjectURL(v.processedUrl);
    } catch {
      /* ya revocada */
    }
  },
);

/** Materializa original+processed de una página como Blob URLs on-demand
 *  (LRU de 8 entradas + revoke determinista). null = sin datos en disco o
 *  sin API de object URLs (SSR). */
export async function getPageImageData(docId: string, pageId: string): Promise<PageImageData | null> {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
  try {
    return await imageCache.get(`${docId}|${pageId}`);
  } catch {
    return null;
  }
}

/** Libera (revoke) las Blob URLs de una página — cierre determinista. */
export function releasePageImageData(docId: string, pageId: string): void {
  imageCache.release(`${docId}|${pageId}`);
}

// ─── IndexedDB (documentos) ─────────────────────────────────────────────────

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_DOCS)) {
          db.createObjectStore(STORE_DOCS, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Marca la instalación como inicializada (la biblioteca real ya existe). */
async function markInitialized(db: IDBDatabase): Promise<void> {
  const tx = db.transaction(STORE_META, "readwrite");
  tx.objectStore(STORE_META).put(true, META_KEY);
  await txDone(tx);
}

async function readInitialized(db: IDBDatabase): Promise<boolean> {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_META, "readonly");
    const req = tx.objectStore(STORE_META).get(META_KEY);
    req.onsuccess = () => resolve(req.result === true);
    req.onerror = () => resolve(false);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("tx error"));
    tx.onabort = () => reject(tx.error ?? new Error("tx abort"));
  });
}

/** Guarda (o reemplaza) un documento completo con imágenes como Blob.
 *  BLQ-6 (lote7) — GUARD anti-pérdida: con hidratación perezosa, las páginas
 *  NO materializadas llegan con original/processed = "" (o blob: no
 *  convertible). Los Blobs ya están en IndexedDB: se reutilizan por page.id
 *  del registro previo, byte-idénticos. Solo si tampoco existe registro previo
 *  se omite la página (comportamiento histórico). Hace imposible perder datos
 *  de páginas nunca materializadas (rename/favorito/tag/trash con lazy). */
export async function persistDocument(doc: ScanDocument): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    const prev = await new Promise<StoredDocument | undefined>((resolve) => {
      const tx = db.transaction(STORE_DOCS, "readonly");
      const req = tx.objectStore(STORE_DOCS).get(doc.id);
      req.onsuccess = () => resolve(req.result as StoredDocument | undefined);
      req.onerror = () => resolve(undefined);
    });
    const prevByPage = new Map((prev?.pages ?? []).map((p) => [p.id, p] as const));
    const record: StoredDocument = {
      ...doc,
      // C-24 (auditoría leaks-recursos) — tolerancia por PÁGINA (replica la
      // tolerancia de lectura de loadAllDocuments): una página con data URL
      // inválida (null) o un atob fallido se OMITE — con warn con su id —
      // en vez de saltar el doc COMPLETO en el catch de abajo.
      pages: doc.pages.flatMap((p): StoredPage[] => {
        try {
          const pb = prevByPage.get(p.id);
          const original = dataUrlToBlob(p.original) ?? pb?.original ?? null;
          const processed = dataUrlToBlob(p.processed) ?? pb?.processed ?? null;
          const thumbnail = dataUrlToBlob(p.thumbnail) ?? pb?.thumbnail ?? null;
          if (original === null || processed === null || thumbnail === null) {
            console.warn(
              `[page-store] persistDocument: página ${p.id} con data URL inválida — se omite`
            );
            return [];
          }
          return [{ ...p, original, processed, thumbnail }];
        } catch {
          console.warn(
            `[page-store] persistDocument: página ${p.id} no codificable (atob falló) — se omite`
          );
          return [];
        }
      }),
    };
    const tx = db.transaction(STORE_DOCS, "readwrite");
    tx.objectStore(STORE_DOCS).put(record);
    await txDone(tx);
    await markInitialized(db);
    db.close();
  } catch {
    /* persistencia best-effort: la app sigue en memoria */
  }
}

/** Elimina un documento por id. */
export async function removeDocument(id: string): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    const tx = db.transaction(STORE_DOCS, "readwrite");
    tx.objectStore(STORE_DOCS).delete(id);
    await txDone(tx);
    db.close();
  } catch {
    /* noop */
  }
}

/** Vacía todos los documentos persistedos y deja la instalación marcada
 *  (tras “Borrar todos” el refresh muestra biblioteca vacía, no los mocks). */
export async function clearAllDocuments(): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    const tx = db.transaction(STORE_DOCS, "readwrite");
    tx.objectStore(STORE_DOCS).clear();
    await txDone(tx);
    const mtx = db.transaction(STORE_META, "readwrite");
    mtx.objectStore(STORE_META).delete(META_KEY_ORDER);
    await txDone(mtx);
    await markInitialized(db);
    db.close();
  } catch {
    /* noop */
  }
}

/** Guarda el orden manual de la biblioteca (lista completa de ids). */
export async function saveManualOrder(ids: string[]): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    const tx = db.transaction(STORE_META, "readwrite");
    tx.objectStore(STORE_META).put(ids, META_KEY_ORDER);
    await txDone(tx);
    db.close();
  } catch {
    /* noop */
  }
}

/** Lee el orden manual guardado ([] si nunca se reordenó). */
export async function loadManualOrder(): Promise<string[]> {
  try {
    const db = await openDb();
    if (!db) return [];
    const ids = await new Promise<string[]>((resolve) => {
      const tx = db.transaction(STORE_META, "readonly");
      const req = tx.objectStore(STORE_META).get(META_KEY_ORDER);
      req.onsuccess = () =>
        resolve(Array.isArray(req.result) ? (req.result as string[]) : []);
      req.onerror = () => resolve([]);
    });
    db.close();
    return ids;
  } catch {
    return [];
  }
}

/** Lectura común de loadAllDocuments/loadAllDocumentsLazy: open+initialized+
 *  getAll + conversión por página + orden (manual gana, luego fecha).
 *  `lazy: false` convierte los 3 Blobs (comportamiento histórico);
 *  `lazy: true` SOLO thumbnail — original/processed llegan como "" y se
 *  materializan on-demand (BLQ-6, lote7). */
async function readAllDocuments(lazy: boolean): Promise<ScanDocument[] | null> {
  try {
    const db = await openDb();
    if (!db) return null;
    const initialized = await readInitialized(db);
    if (!initialized) {
      db.close();
      return null;
    }
    const docs = await new Promise<StoredDocument[]>((resolve, reject) => {
      const tx = db.transaction(STORE_DOCS, "readonly");
      const req = tx.objectStore(STORE_DOCS).getAll();
      req.onsuccess = () => resolve(req.result as StoredDocument[]);
      req.onerror = () => reject(req.error ?? new Error("getAll error"));
    });
    db.close();
    const out: ScanDocument[] = [];
    for (const d of docs) {
      const pages: ScanPage[] = [];
      for (const sp of d.pages) {
        try {
          // C-10 — las conversiones por página van EN PARALELO (antes: 3
          // `await` en serie → ~3× la latencia por página y una ventana de
          // carrera de hidratación más grande en documentos de varias páginas).
          // BLQ-6 (lote7) — en lazy SOLO se convierte el thumbnail (~10 KB);
          // original/processed quedan "" y se materializan on-demand vía
          // getPageImageData/loadPageBlobs (el bitmap vive en IndexedDB).
          const [original, processed, thumbnail] = await Promise.all([
            lazy ? Promise.resolve("") : blobToDataUrl(sp.original),
            lazy ? Promise.resolve("") : blobToDataUrl(sp.processed),
            blobToDataUrl(sp.thumbnail),
          ]);
          pages.push({
            ...sp,
            // §8.4 — migración legacy: los usuarios viejos tienen los 8
            // presets persistidos; al hidratar se normaliza al de hoy.
            filter: normalizePageFilter(sp.filter),
            original,
            processed,
            thumbnail,
          });
        } catch {
          /* página corrupta → se omite */
        }
      }
      if (pages.length > 0) out.push({ ...d, pages });
    }
    // Más recientes primero por defecto; si hay orden manual guardado, ese
    // gana (los ids desconocidos/nuevos van al final por fecha).
    const order = await loadManualOrder();
    if (order.length > 0) {
      const pos = new Map(order.map((id, i) => [id, i] as const));
      out.sort((a, b) => {
        const pa = pos.get(a.id);
        const pb = pos.get(b.id);
        if (pa !== undefined && pb !== undefined) return pa - pb;
        if (pa !== undefined) return -1;
        if (pb !== undefined) return 1;
        return b.updatedAt - a.updatedAt;
      });
    } else {
      out.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return out;
  } catch {
    return null;
  }
}

/** Carga todos los documentos (Blobs → data URLs para la UI).
 *  null = instalación nueva (sin persistir) → la app conserva los mocks.
 *  []   = biblioteca real vacía (p. ej. tras borrar todo). */
export async function loadAllDocuments(): Promise<ScanDocument[] | null> {
  return readAllDocuments(false);
}

/** BLQ-6 (lote7) — hidratación perezosa: SOLO thumbnail+metadatos (la
 *  biblioteca renderiza covers con ~10 KB/página); original/processed
 *  llegan "" y se materializan on-demand (getPageImageData/loadPageBlobs,
 *  guard de persistDocument). Meta: RAM residente −80/90%. */
export async function loadAllDocumentsLazy(): Promise<ScanDocument[] | null> {
  return readAllDocuments(true);
}

// ─── localStorage (ajustes) ──────────────────────────────────────────────────

export function saveSettings(settings: ScannerSettings): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* noop */
  }
}

export function loadSettings(): ScannerSettings {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_SETTINGS;
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ScannerSettings>;
    // Merge defensivo: defaults para claves nuevas/ausentes.
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    // Migración one-time (FIX v10-B): la app ya no ofrece selector de
    // calidad en el EDITOR (chip «Se guardará…» y su drawer eliminados) —
    // todo PDF del flujo principal se exporta SIEMPRE a máxima. La marca
    // cubre TODO valor no-máximo persistido: "alta" (default antiguo) y
    // "standard" (elegido en el drawer del editor, ya inexistente). Tras
    // esta única pasada el valor persistido vuelve a ser sagrado (Ajustes
    // › Exportación sigue ofreciendo el selector).
    if (!localStorage.getItem(SETTINGS_MIGRATION_KEY)) {
      if (parsed.exportQuality !== "máxima") merged.exportQuality = "máxima";
      localStorage.setItem(SETTINGS_MIGRATION_KEY, "1");
    }
    // Migración one-time v6.1: OCR automático → OFF (bajo demanda, botón
    // «Texto» del editor). Tras esta única pasada el valor persistido
    // vuelve a ser sagrado: si el usuario lo re-activa, se respeta.
    if (!localStorage.getItem(SETTINGS_MIGRATION_KEY_OCR_OFF)) {
      merged.ocrEnabled = false;
      localStorage.setItem(SETTINGS_MIGRATION_KEY_OCR_OFF, "1");
    }
    return merged;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** ¿Hay persistencia disponible? (para la fila informativa de Ajustes) */
export function storageAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}
