/**
 * DRY-4 (Lote 9) — conversiones blob ⇄ data URL ÚNICAS del paquete.
 *
 * Antes había TRES implementaciones duplicadas: la síncrona del core
 * (page-store, atob manual con contrato C-24), una async fetch-based en la
 * app (EditorView) y FileReaders inline (pdf-export, CameraView). Este
 * módulo es la ÚNICA fuente; page-store re-exporta para no romper la API
 * pública existente (regla del core: agregar es seguro, quitar ROMPE).
 *
 * Contratos (intactos, verbatim de page-store):
 *  · dataUrlToBlob: SINCRONA (parse manual, portable a workers/contextos
 *    fríos — sin fetch). Soporta base64 y percent-encoded (SVG de mocks).
 *    Devuelve null si no hay coma separadora (C-24: nunca un Blob vacío
 *    persistible); lanza si el base64 es inválido (el llamador decide).
 *  · blobToDataUrl: async vía FileReader; rechaza si el reader falla.
 *
 * API nueva del paquete → bump minor 0.2.0 → 0.3.0.
 */

/**
 * data URL → Blob (síncrono).
 * C-24 (auditoría leaks-recursos): null en vez de Blob vacío cuando el data
 * URL no tiene coma separadora — un blob vacío persistible producía, al
 * hidratar, data URLs no-imagen rotas en silencio.
 */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  // Sin fetch() (más portable en workers/contextos fríos): parse manual.
  // Soporta DOS variantes de data URL:
  //  · base64 (image/png, image/jpeg de los escaneos reales)
  //  · percent-encoded (data:image/svg+xml;charset=utf-8,… de los mocks demo)
  // atob() sobre SVG percent-encoded lanza InvalidCharacterError — antes se
  // tragaba el error en el catch de persistDocument y los cambios sobre
  // documentos demo (renombrar, favorito, etiquetas…) NO persistían.
  const comma = dataUrl.indexOf(",");
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

/** Blob → data URL (async vía FileReader; rechaza si el reader falla). */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error("blobToDataUrl falló"));
    fr.readAsDataURL(blob);
  });
}
