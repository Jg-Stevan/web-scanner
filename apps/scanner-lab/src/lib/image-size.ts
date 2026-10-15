"use client";

/**
 * DIAG v1.1 — Lee el lado largo (px) de un data URL de imagen SIN
 * decodificarla: parsea solo la CABECERA (PNG IHDR / JPEG SOF).
 *
 * Motivo (spec sub-marks §2/§3): `filter_applied.inputPx` y
 * `export_end.pxLong` necesitan el tamaño de ENTRADA, pero decodificar un
 * original de 12 MP solo para medirlo duplicaría el costo del filtro en
 * gama baja (A13: +17 s). La cabecera son ~24 bytes (PNG) o un escaneo
 * ligero de marcadores (JPEG).
 *
 * Best-effort puro: cualquier formato/dato no reconocido → null (la marca
 * se emite igual sin el campo). Cache FIFO acotada (las claves son cortas
 * — ids de página/estado — para no retener los data URL de MB en memoria).
 */

const cache = new Map<string, number>();
const CACHE_MAX = 64;

/** Decodifica los primeros `wantBytes` bytes del data URL (base64). */
function decodePrefix(dataUrl: string, wantBytes: number): Uint8Array | null {
  try {
    const comma = dataUrl.indexOf(",");
    if (comma < 0) return null;
    if (!dataUrl.slice(0, comma).includes("base64")) return null; // nuestros data URL siempre son base64
    // Corta en múltiplo de 4 chars (grupos base64 completos) con margen.
    const b64 = dataUrl.slice(comma + 1, comma + 1 + Math.ceil(wantBytes / 3) * 4 + 8);
    const safe = b64.slice(0, Math.floor(b64.length / 4) * 4);
    let bin: string;
    try {
      bin = atob(safe);
    } catch {
      return null; // padding/carácter inválido en el corte
    }
    const n = Math.min(bin.length, wantBytes);
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** PNG: IHDR lleva width/height en los bytes 16..23 (big-endian). */
function pngLongSide(b: Uint8Array): number | null {
  if (b.length < 24) return null;
  if (b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return null;
  const w = (b[16]! << 24) | (b[17]! << 16) | (b[18]! << 8) | b[19]!;
  const h = (b[20]! << 24) | (b[21]! << 16) | (b[22]! << 8) | b[23]!;
  if (w <= 0 || h <= 0) return null;
  return Math.max(w, h);
}

/** JPEG: escanea marcadores hasta el primer SOF (C0-CF menos C4/C8/CC);
 *  height/width van tras length+precision. */
function jpegLongSide(b: Uint8Array): number | null {
  if (b.length < 4) return null;
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = b[i + 1]!;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const h = (b[i + 5]! << 8) | b[i + 6]!;
      const w = (b[i + 7]! << 8) | b[i + 8]!;
      if (w <= 0 || h <= 0) return null;
      return Math.max(w, h);
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

/** Lado largo (px) de la imagen del data URL, sin decodificar. `key` es una
 *  clave corta y estable para la cache (id de página, cacheKey, doc+page…). */
export function readImageLongSide(key: string, dataUrl: string): number | null {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const isPng = dataUrl.startsWith("data:image/png");
  // PNG: cabecera de 24 bytes basta. JPEG: escaneo hasta el SOF (cap 192 KB).
  const b = decodePrefix(dataUrl, isPng ? 24 : 196_608);
  const side = b === null ? null : isPng ? pngLongSide(b) : jpegLongSide(b);
  const value = side !== null && side > 0 && side <= 100_000 ? side : null;
  if (value !== null) {
    cache.set(key, value);
    if (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }
  return value;
}

/** PERF/burst-budget — Lado largo (px) de un Blob PNG/JPEG sin decodificar:
 *  lee solo el prefijo de bytes (PNG 24 B · JPEG hasta 192 KB de marcadores,
 *  igual que arriba). Uso: saltar el `createImageBitmap` de 12 MP que
 *  `clampBlobToSafeCap` ejecutaba SOLO para leer el tamaño cuando el blob
 *  ya está dentro del tope (en gama baja ese decode son segundos enteros
 *  dentro del tramo captura→guardada). Best-effort: formato/dato no
 *  reconocido → null (el llamador cae al clamp íntegro, sensores gigantes
 *  siguen protegidos). */
export async function readBlobLongSide(blob: Blob): Promise<number | null> {
  try {
    const head = await blob.slice(0, 196_608).arrayBuffer();
    const b = new Uint8Array(head);
    const isPng = b.length > 4 && b[0] === 0x89 && b[1] === 0x50;
    const side = isPng ? pngLongSide(b) : jpegLongSide(b);
    return side !== null && side > 0 && side <= 100_000 ? side : null;
  } catch {
    return null;
  }
}
