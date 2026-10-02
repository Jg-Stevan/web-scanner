/**
 * Procesamiento de imágenes del escáner.
 *
 * INTEGRACIÓN REAL ✅ (logica-deteccion.zip): detección, rectificado y realce
 * delegados al DetectionWorker del usuario (OpenCV.js 4.5.5 self-hosted):
 *  - detect: contornos → quads → selección por score (área + prior + blancura)
 *  - warp  : refinado sub-píxel por líneas (RANSAC) + shrink 3.5px/lado +
 *            homografía INTER_CUBIC — la FOTO es la fuente de verdad
 *  - enhance: modos reales (text/bw/gray/raw/color) con modelo de sombras
 *            común y constantes exactas del producto
 *
 * Cada función degrada con gracia: si el worker no está disponible (SSR,
 * OpenCV que no carga, navegador sin OffscreenCanvas) cae al pipeline Canvas
 * local anterior — la app NUNCA se rompe.
 */

import type { PageFilter, PagePrecision, PageQuality, Point, Quad } from "./types";
import {
  getScannerWorker,
  type EnhanceMode,
  type ScannerWorkerClient,
} from "./detector-client";

export { warmUpScannerWorker, getScannerWorker } from "./detector-client";

export interface ProcessResult {
  processed: string; // data URL
  thumbnail: string; // data URL pequeña
  /** Estadísticas del pipeline REAL (worker OpenCV) o fallback canvas. */
  precision?: PagePrecision;
}

/** Opciones del pipeline preciso (aditivas, con defaults seguros). */
export interface ProcessOptions {
  /** Quad colocado por el humano → sin refine, sin shrink (F5-MANUAL). */
  manual?: boolean;
  /** Lado mayor máximo del resultado procesado (default 2000 px). */
  maxLongSide?: number;
  /** true = aplica unsharp (0.5/1.5) al filtro Original (que por fidelidad
   *  al sensor F5-RAW se guarda puro). No afecta a los demás filtros:
   *  el enhance real del worker ya aplica unsharp en todo modo ≠ raw. */
  unsharpOriginal?: boolean;
}

/** Lado mayor tope del resultado (protege memoria de data URLs en iOS). */
const PROCESSED_MAX_LONG_SIDE = 2000;

/** Mapea los presets de la app a los modos reales del worker. */
export function filterToEnhanceMode(filter: PageFilter): EnhanceMode {
  switch (filter) {
    case "original":
      return "raw";
    case "auto":
    case "document":
    case "whiteboard":
      return "text"; // "Texto claro" — el default del producto
    case "natural":
      return "natural"; // estirado suave p97→255 + unsharp (JPEG q90)
    case "grayscale":
      return "gray"; // percentil 97 → 255
    case "blackwhite":
      return "bw"; // Bradley-Roth adaptativo + despeckle
    case "color":
      return "color"; // CLAHE sobre canal L (modo legado soportado)
  }
}

/** ¿El pipeline de precisión (worker + OpenCV) está activo? */
export function isPrecisionActive(): boolean {
  return getScannerWorker()?.isReady ?? false;
}

/** Carga una imagen (data URL o URL) en un HTMLImageElement. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo cargar la imagen"));
    img.src = src;
  });
}

// ─── Helpers del pipeline preciso ───────────────────────────────────────────

function floatsToQuad(f: Float32Array): Quad {
  return [
    { x: f[0]!, y: f[1]! },
    { x: f[2]!, y: f[3]! },
    { x: f[4]!, y: f[5]! },
    { x: f[6]!, y: f[7]! },
  ];
}

function isValidQuadFloats(f: Float32Array | null): f is Float32Array {
  if (f === null || f.length !== 8) return false;
  for (let i = 0; i < 8; i++) {
    const v = f[i]!;
    if (!Number.isFinite(v) || v < -0.05 || v > 1.05) return false;
  }
  return true;
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error("blobToDataURL falló"));
    fr.readAsDataURL(blob);
  });
}

/** Dibuja un bitmap en canvas aplicando rotación de 90/180/270. */
function bitmapToRotatedCanvas(
  bitmap: ImageBitmap | HTMLCanvasElement | HTMLImageElement,
  rotation: number
): HTMLCanvasElement {
  const w = bitmap instanceof HTMLImageElement ? bitmap.naturalWidth : bitmap.width;
  const h = bitmap instanceof HTMLImageElement ? bitmap.naturalHeight : bitmap.height;
  const swapped = rotation === 90 || rotation === 270;
  const canvas = document.createElement("canvas");
  canvas.width = swapped ? h : w;
  canvas.height = swapped ? w : h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("sin contexto");
  ctx.imageSmoothingQuality = "high";
  if (rotation !== 0) {
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(bitmap as CanvasImageSource, -w / 2, -h / 2);
    ctx.restore();
  } else {
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0);
  }
  return canvas;
}

/** Miniatura 160px de ancho desde un blob (resultado real del enhance). */
async function thumbnailFromBlob(blob: Blob): Promise<string> {
  try {
    const bm = await createImageBitmap(blob);
    const tW = 160;
    const tH = Math.max(1, Math.round((bm.height / bm.width) * tW));
    const canvas = document.createElement("canvas");
    canvas.width = tW;
    canvas.height = tH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("sin contexto");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bm, 0, 0, tW, tH);
    bm.close();
    return canvas.toDataURL("image/jpeg", 0.8);
  } catch {
    return "";
  }
}

// ─── Unsharp client-side (constantes EXACTAS del usuario §6) ────────────────

/** UNSHARP_AMOUNT/RADIUS del core del usuario: 0.5 / 1.5 (kernel derivado 7). */
const UNSHARP_AMOUNT = 0.5;
const UNSHARP_RADIUS = 1.5;
const UNSHARP_KERNEL = 7;

/** Núcleo gaussiano 1D normalizado (mismo efecto que cv.GaussianBlur k7 σ1.5). */
function gaussianKernel1D(size: number, sigma: number): Float32Array {
  const half = (size - 1) / 2;
  const k = new Float32Array(size);
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const v = Math.exp(-((i - half) ** 2) / (2 * sigma * sigma));
    k[i] = v;
    sum += v;
  }
  for (let i = 0; i < size; i++) k[i] /= sum;
  return k;
}

/** Desenfoque gaussiano separable sobre RGB (in place sobre una copia). */
function gaussianBlurRGBA(data: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const k = gaussianKernel1D(UNSHARP_KERNEL, UNSHARP_RADIUS);
  const half = (UNSHARP_KERNEL - 1) / 2;
  const tmp = new Uint8ClampedArray(data.length);
  const out = new Uint8ClampedArray(data.length);
  // Pase horizontal
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let t = -half; t <= half; t++) {
        const xx = Math.min(w - 1, Math.max(0, x + t));
        const wgt = k[t + half]!;
        const i = (y * w + xx) * 4;
        r += data[i]! * wgt;
        g += data[i + 1]! * wgt;
        b += data[i + 2]! * wgt;
      }
      const o = (y * w + x) * 4;
      tmp[o] = r;
      tmp[o + 1] = g;
      tmp[o + 2] = b;
      tmp[o + 3] = data[o + 3]!;
    }
  }
  // Pase vertical
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let t = -half; t <= half; t++) {
        const yy = Math.min(h - 1, Math.max(0, y + t));
        const wgt = k[t + half]!;
        const i = (yy * w + x) * 4;
        r += tmp[i]! * wgt;
        g += tmp[i + 1]! * wgt;
        b += tmp[i + 2]! * wgt;
      }
      const o = (y * w + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = tmp[o + 3]!;
    }
  }
  return out;
}

/**
 * Unsharp mask EXACTO del producto, en cliente: addWeighted(src, 1.5, blur, −0.5, 0)
 * sobre un canvas — mismo efecto que el unsharpRgba del worker (GaussianBlur
 * k7 σ1.5 + amount 0.5). Se usa SOLO para el filtro Original con el toggle
 * de nitidez activo: el resto de modos ya reciben el unsharp del enhance real.
 */
export function applyUnsharpToCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const { width: W, height: H } = canvas;
  if (W < 1 || H < 1) return canvas;
  const image = ctx.getImageData(0, 0, W, H);
  const src = image.data;
  const blur = gaussianBlurRGBA(src, W, H);
  // addWeighted(src, 1 + amount, blur, -amount, 0)
  const gain = 1 + UNSHARP_AMOUNT;
  for (let i = 0; i < src.length; i += 4) {
    src[i] = src[i]! * gain - blur[i]! * UNSHARP_AMOUNT;
    src[i + 1] = src[i + 1]! * gain - blur[i + 1]! * UNSHARP_AMOUNT;
    src[i + 2] = src[i + 2]! * gain - blur[i + 2]! * UNSHARP_AMOUNT;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Decodifica un blob a canvas (para post-proceso del encode del worker). */
async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const bm = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bm.width;
  canvas.height = bm.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("sin contexto");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bm, 0, 0);
  bm.close();
  return canvas;
}

// ─── Detección de bordes ────────────────────────────────────────────────────

/**
 * Detección de bordes del documento — PIPELINE REAL del usuario
 * (contornos OpenCV + selección por score). Fallback: Sobel local.
 */
export async function detectDocumentEdges(src: string): Promise<Quad> {
  // 1) Pipeline real: worker + OpenCV.js
  const quad = await detectWithWorker(src);
  if (quad) return quad;
  // 2) Fallback: Sobel simplificado (siempre devuelve algo)
  return detectSobel(src);
}

async function detectWithWorker(src: string): Promise<Quad | null> {
  const client = getScannerWorker();
  if (!client || client.isDead) return null;
  const ok = await client.waitReady();
  if (!ok) return null;
  try {
    const img = await loadImage(src);
    if (!img.naturalWidth || !img.naturalHeight) return null;
    const out = await client.detect(img, img.naturalWidth, img.naturalHeight);
    if (out && isValidQuadFloats(out.corners)) {
      const quad = floatsToQuad(out.corners);
      // Sanity: área razonable (el worker ya valida ≥10% del frame)
      const area = quadArea(quad);
      if (area > 0.01) return quad;
    }
  } catch {
    /* fallback */
  }
  return null;
}

function quadArea(q: Quad): number {
  const [tl, tr, br, bl] = q;
  const tri = (a: Point, b: Point, c: Point) =>
    Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  return tri(tl!, tr!, br!) + tri(tl!, br!, bl!);
}

/** Sobel simplificado sobre downscaled (fallback del pipeline real). */
async function detectSobel(src: string): Promise<Quad> {
  try {
    const img = await loadImage(src);
    const W = 160;
    const H = Math.max(1, Math.round((img.height / img.width) * W));
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("sin contexto");
    ctx.drawImage(img, 0, 0, W, H);
    const data = ctx.getImageData(0, 0, W, H).data;

    // Mapa de energía Sobel
    const energy = new Float32Array(W * H);
    const gray = (i: number) =>
      0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const gx =
          -gray(i - W - 1) - 2 * gray(i - 1) - gray(i + W - 1) +
          gray(i - W + 1) + 2 * gray(i + 1) + gray(i + W + 1);
        const gy =
          -gray(i - W - 1) - 2 * gray(i - W) - gray(i + W - 1) +
          gray(i + W - 1) + 2 * gray(i + W) + gray(i + W + 1);
        energy[i] = Math.sqrt(gx * gx + gy * gy);
      }
    }

    const findEdgeX = (from: number, to: number, y0: number, y1: number) => {
      let bestX = from;
      let bestE = -1;
      for (let x = from; x < to; x++) {
        let e = 0;
        for (let y = y0; y < y1; y++) e += energy[y * W + x];
        if (e > bestE) {
          bestE = e;
          bestX = x;
        }
      }
      return bestX / W;
    };
    const findEdgeY = (from: number, to: number, x0: number, x1: number) => {
      let bestY = from;
      let bestE = -1;
      for (let y = from; y < to; y++) {
        let e = 0;
        for (let x = x0; x < x1; x++) e += energy[y * W + x];
        if (e > bestE) {
          bestE = e;
          bestY = y;
        }
      }
      return bestY / H;
    };

    const m = Math.round(W * 0.06);
    const left = findEdgeX(1, Math.floor(W * 0.45), m, H - m);
    const right = findEdgeX(Math.ceil(W * 0.55), W - 1, m, H - m);
    const top = findEdgeY(1, Math.floor(H * 0.45), m, W - m);
    const bottom = findEdgeY(Math.ceil(H * 0.55), H - 1, m, W - m);

    return [
      { x: clamp01(left), y: clamp01(top) },
      { x: clamp01(right), y: clamp01(top) },
      { x: clamp01(right), y: clamp01(bottom) },
      { x: clamp01(left), y: clamp01(bottom) },
    ];
  } catch {
    return [
      { x: 0.08, y: 0.1 },
      { x: 0.92, y: 0.07 },
      { x: 0.95, y: 0.93 },
      { x: 0.05, y: 0.96 },
    ];
  }
}

function clamp01(v: number) {
  return Math.min(0.98, Math.max(0.02, v));
}

// ─── Filtros canvas (fallback del enhance real) ─────────────────────────────

/** Recorta la imagen por el cuadrilátero (aprox rectificado) y rota. */
async function cropQuad(
  img: HTMLImageElement,
  quad: Quad,
  rotation: number,
  maxSize = 1400
): Promise<HTMLCanvasElement> {
  const xs = quad.map((p) => p.x * img.width);
  const ys = quad.map((p) => p.y * img.height);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  const w = Math.max(16, right - left);
  const h = Math.max(16, bottom - top);
  const scale = Math.min(1, maxSize / Math.max(w, h));

  const swapped = rotation === 90 || rotation === 270;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(swapped ? h * scale : w * scale);
  canvas.height = Math.round(swapped ? w * scale : h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("sin contexto");
  ctx.imageSmoothingQuality = "high";
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  // La rotación ya intercambia los ejes para 90/270 — el scale debe ser
  // uniforme (el `-scale` anterior ESPEJABA la imagen en rotaciones 90/270,
  // bug E6 del fallback canvas).
  ctx.scale(scale, scale);
  ctx.drawImage(img, -left, -top, w, h, -w / 2, -h / 2, w, h);
  ctx.restore();
  return canvas;
}

/**
 * Aplica el filtro a una imagen ya recortada (implementación canvas local —
 * fallback cuando el worker real no está disponible).
 */
export function applyFilterToCanvas(
  canvas: HTMLCanvasElement,
  filter: PageFilter
): HTMLCanvasElement {
  if (filter === "original") return canvas;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const { width: W, height: H } = canvas;
  const image = ctx.getImageData(0, 0, W, H);
  const d = image.data;

  switch (filter) {
    case "auto":
    case "document": {
      let min = 255;
      let max = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        if (l < min) min = l;
        if (l > max) max = l;
      }
      const range = Math.max(1, max - min);
      for (let i = 0; i < d.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const v = ((d[i + c] - min) / range) * 255;
          const n = v / 255;
          const s = n < 0.5 ? 2 * n * n : 1 - 2 * (1 - n) * (1 - n);
          d[i + c] = Math.round(filter === "document" ? s * 255 : v);
        }
      }
      break;
    }
    case "color": {
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        for (let c = 0; c < 3; c++) {
          const v = l + (d[i + c] - l) * 1.35;
          d[i + c] = Math.min(255, Math.max(0, Math.round(v * 1.03)));
        }
      }
      break;
    }
    case "grayscale": {
      for (let i = 0; i < d.length; i += 4) {
        const l = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
        d[i] = d[i + 1] = d[i + 2] = l;
      }
      break;
    }
    case "blackwhite": {
      const hist = new Array(256).fill(0);
      const grayArr = new Uint8Array(d.length / 4);
      for (let i = 0, j = 0; i < d.length; i += 4, j++) {
        const l = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
        grayArr[j] = l;
        hist[l]++;
      }
      const total = grayArr.length;
      let sum = 0;
      for (let t = 0; t < 256; t++) sum += t * hist[t];
      let sumB = 0;
      let wB = 0;
      let best = 0;
      let thr = 128;
      for (let t = 0; t < 256; t++) {
        wB += hist[t];
        if (wB === 0) continue;
        const wF = total - wB;
        if (wF === 0) break;
        sumB += t * hist[t];
        const mB = sumB / wB;
        const mF = (sum - sumB) / wF;
        const between = wB * wF * (mB - mF) * (mB - mF);
        if (between > best) {
          best = between;
          thr = t;
        }
      }
      for (let i = 0, j = 0; i < d.length; i += 4, j++) {
        const v = grayArr[j] > thr ? 255 : 0;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      break;
    }
    case "whiteboard": {
      let maxL = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        if (l > maxL) maxL = l;
      }
      const norm = Math.max(1, maxL);
      for (let i = 0; i < d.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const v = (d[i + c] / norm) * 255;
          d[i + c] = Math.min(255, Math.round(v));
        }
      }
      break;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

// ─── Pipeline principal ─────────────────────────────────────────────────────

/**
 * Pipeline completo: rectifica (warp real) → rota → realza (modo real) →
 * devuelve processed + thumbnail. Fallback: recorte canvas + filtro local.
 */
export async function processImage(
  src: string,
  quad: Quad,
  filter: PageFilter,
  rotation = 0,
  opts?: ProcessOptions
): Promise<ProcessResult> {
  const precise = await processImagePrecise(src, quad, filter, rotation, opts);
  if (precise) return precise;
  return processImageCanvas(src, quad, filter, rotation, opts);
}

/** Nº de esquinas firmes del refinado (fellBack[i]=true ⇒ esquina i cayó al
 *  estimado grueso). null cuando el worker no informa (quad manual). */
function solidCorners(fellBack: readonly boolean[] | null): number | null {
  if (!fellBack) return null;
  return fellBack.filter((f) => !f).length;
}

/** Pipeline REAL vía DetectionWorker. null → el llamador usa su fallback. */
async function processImagePrecise(
  src: string,
  quad: Quad,
  filter: PageFilter,
  rotation: number,
  opts?: ProcessOptions
): Promise<ProcessResult | null> {
  const client: ScannerWorkerClient | null = getScannerWorker();
  if (!client || client.isDead) return null;
  const ok = await client.waitReady();
  if (!ok) return null;
  try {
    const img = await loadImage(src);
    if (!img.naturalWidth || !img.naturalHeight) return null;

    // 1) Warp: refinado sub-píxel (RANSAC) + shrink 3.5px + homografía
    //    INTER_CUBIC sobre la FOTO completa (la foto es la fuente de verdad).
    //    El worker cierra el bitmap de entrada y devuelve uno nuevo (puro,
    //    sin unsharp horneado — F5-RAW-2).
    const warp = await client.warp(img, quad, opts?.manual === true);
    if (!warp || !warp.bitmap) return null;

    // 2) Rotación post-warp (90/180/270) en canvas de alta calidad.
    const rotated = bitmapToRotatedCanvas(warp.bitmap, rotation);
    warp.bitmap.close();

    // 3) Enhance: modo real del producto (modelo de sombras + constantes
    //    exactas). maxLongSide protege la memoria de data URLs en iOS.
    const mode = filterToEnhanceMode(filter);
    const maxLongSide = opts?.maxLongSide ?? PROCESSED_MAX_LONG_SIDE;
    const enh = await client.enhance(rotated, mode, { maxLongSide });

    if (enh && enh.blob.size > 0) {
      let blob = enh.blob;
      // Toggle de nitidez para el Original: el modo raw sale PURO del worker
      // (F5-RAW) — el unsharp se aplica aquí, en cliente, con las mismas
      // constantes del producto (0.5/1.5, kernel 7).
      if (filter === "original" && opts?.unsharpOriginal === true) {
        try {
          const canvas = applyUnsharpToCanvas(await blobToCanvas(blob));
          const reencoded = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob((b) => resolve(b), "image/png")
          );
          if (reencoded && reencoded.size > 0) blob = reencoded;
        } catch {
          /* conserva el blob puro */
        }
      }
      const processed = await blobToDataURL(blob);
      const thumbnail = await thumbnailFromBlob(blob);
      const precision: PagePrecision = {
        engine: "worker",
        refined: warp.refined,
        cornersSolid: solidCorners(warp.fellBack),
        width: enh.w,
        height: enh.h,
        elapsedMs: enh.elapsedMs,
      };
      if (thumbnail) return { processed, thumbnail, precision };
      // Sin thumbnail desde el blob → lo genero del canvas rotado
      return {
        processed,
        thumbnail: thumbnailFromCanvas(rotated),
        precision,
      };
    }

    // 4) Enhance no disponible → warp real + filtro canvas local.
    const filtered = applyFilterToCanvas(rotated, filter);
    if (filter === "original" && opts?.unsharpOriginal === true) {
      applyUnsharpToCanvas(filtered);
    }
    return {
      processed: filtered.toDataURL("image/jpeg", 0.92),
      thumbnail: thumbnailFromCanvas(filtered),
      precision: {
        engine: "worker",
        refined: warp.refined,
        cornersSolid: solidCorners(warp.fellBack),
        width: filtered.width,
        height: filtered.height,
      },
    };
  } catch {
    return null;
  }
}

function thumbnailFromCanvas(canvas: HTMLCanvasElement): string {
  const tW = 160;
  const tH = Math.max(1, Math.round((canvas.height / canvas.width) * tW));
  const tCanvas = document.createElement("canvas");
  tCanvas.width = tW;
  tCanvas.height = tH;
  const tCtx = tCanvas.getContext("2d");
  if (tCtx) {
    tCtx.imageSmoothingQuality = "high";
    tCtx.drawImage(canvas, 0, 0, tW, tH);
  }
  return tCanvas.toDataURL("image/jpeg", 0.8);
}

/** Pipeline canvas local (fallback). */
async function processImageCanvas(
  src: string,
  quad: Quad,
  filter: PageFilter,
  rotation: number,
  opts?: ProcessOptions
): Promise<ProcessResult> {
  const img = await loadImage(src);
  const cropped = await cropQuad(img, quad, rotation);
  const filtered = applyFilterToCanvas(cropped, filter);
  if (filter === "original" && opts?.unsharpOriginal === true) {
    applyUnsharpToCanvas(filtered);
  }
  const processed = filtered.toDataURL("image/jpeg", 0.92);
  return {
    processed,
    thumbnail: thumbnailFromCanvas(filtered),
    precision: {
      engine: "canvas",
      refined: false,
      cornersSolid: null,
      width: filtered.width,
      height: filtered.height,
    },
  };
}

/** Evaluación de calidad de la página (Laplaciano + contraste + brillo). */
export async function evaluateQuality(src: string): Promise<PageQuality> {
  try {
    const img = await loadImage(src);
    const W = 120;
    const H = Math.max(1, Math.round((img.height / img.width) * W));
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("sin contexto");
    ctx.drawImage(img, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;

    const gray = new Float32Array(W * H);
    let sum = 0;
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      gray[j] = l;
      sum += l;
    }
    const mean = sum / gray.length;

    let lapSum = 0;
    let lapSq = 0;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - W] - gray[i + W];
        lapSum += lap;
        lapSq += lap * lap;
      }
    }
    const n = (W - 2) * (H - 2);
    const variance = lapSq / n - (lapSum / n) * (lapSum / n);
    const sharpness = Math.min(100, Math.round(Math.sqrt(variance) * 2.2));

    let sqDiff = 0;
    for (let j = 0; j < gray.length; j++) sqDiff += (gray[j] - mean) * (gray[j] - mean);
    const contrast = Math.min(100, Math.round(Math.sqrt(sqDiff / gray.length) * 1.4));

    const brightness = Math.min(100, Math.round((mean / 255) * 100));

    const score = sharpness * 0.45 + brightness * 0.25 + contrast * 0.3;
    const level = score >= 80 ? "excellent" : score >= 62 ? "good" : score >= 45 ? "fair" : "poor";
    const label =
      level === "excellent" ? "Excelente" : level === "good" ? "Buena" : level === "fair" ? "Aceptable" : "Baja";
    return { level, sharpness, brightness, contrast, label };
  } catch {
    return {
      level: "good",
      sharpness: 70,
      brightness: 70,
      contrast: 70,
      label: "Buena",
    };
  }
}

/** Genera una imagen de página de demo (factura) como data URL. */
export function generateDemoPage(seed = 1): string {
  const W = 640;
  const H = 860;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  // Fondo papel
  ctx.fillStyle = "#f7f4ec";
  ctx.fillRect(0, 0, W, H);
  // Sombra leve
  ctx.fillStyle = "rgba(0,0,0,0.05)";
  ctx.fillRect(12, 12, W - 24, H - 24);

  // Encabezado
  ctx.fillStyle = "#1c1c1e";
  ctx.font = "bold 26px -apple-system, sans-serif";
  ctx.fillText("GLOBAL SYNERGY LTD.", 40, 70);
  ctx.fillStyle = "#8e8e93";
  ctx.font = "14px -apple-system, sans-serif";
  ctx.fillText(`FACTURA #GSS-2026-04${seed}1`, 40, 96);
  ctx.fillText("26 October, 2026", 40, 118);

  // Tabla
  let y = 190;
  ctx.fillStyle = "#8e8e93";
  ctx.font = "600 12px -apple-system, sans-serif";
  ctx.fillText("CONCEPTO", 40, y);
  ctx.fillText("CANT.", 400, y);
  ctx.fillText("SUBTOTAL", 500, y);
  ctx.strokeStyle = "#e5e5ea";
  ctx.beginPath();
  ctx.moveTo(40, y + 10);
  ctx.lineTo(W - 40, y + 10);
  ctx.stroke();

  const rows = [
    ["Consultoría Estratégica", "1", "€3,500.00"],
    ["Licencias Software Anual", "1", "€3,600.00"],
    ["Dirección de Proyecto GSS", "1", "€3,600.00"],
  ];
  ctx.font = "15px -apple-system, sans-serif";
  rows.forEach((r, i) => {
    const ry = y + 44 + i * 40;
    ctx.fillStyle = "#1c1c1e";
    ctx.fillText(r[0], 40, ry);
    ctx.fillText(r[1], 405, ry);
    ctx.fillText(r[2], 500, ry);
    ctx.strokeStyle = "#ececf0";
    ctx.beginPath();
    ctx.moveTo(40, ry + 14);
    ctx.lineTo(W - 40, ry + 14);
    ctx.stroke();
  });

  // Total
  ctx.fillStyle = "#3c3c43";
  ctx.font = "600 13px -apple-system, sans-serif";
  ctx.fillText("TOTAL A PAGAR", 40, y + 200);
  ctx.fillStyle = "#007aff";
  ctx.font = "bold 30px -apple-system, sans-serif";
  ctx.fillText("€16,800.00", W - 240, y + 205);

  // Sello
  ctx.save();
  ctx.translate(120, H - 140);
  ctx.rotate(-0.22);
  ctx.strokeStyle = "rgba(255,59,48,0.75)";
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, 190, 54);
  ctx.fillStyle = "rgba(255,59,48,0.8)";
  ctx.font = "bold 16px -apple-system, sans-serif";
  ctx.fillText("PAID · OCT 26", 22, 34);
  ctx.restore();

  ctx.save();
  ctx.translate(W - 320, H - 190);
  ctx.rotate(0.12);
  ctx.strokeStyle = "rgba(0,122,255,0.6)";
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, 210, 54);
  ctx.fillStyle = "rgba(0,122,255,0.7)";
  ctx.font = "bold 15px -apple-system, sans-serif";
  ctx.fillText("RECEIVED", 55, 34);
  ctx.restore();

  // Firma
  ctx.fillStyle = "#3c3c43";
  ctx.font = "italic 20px Georgia, serif";
  ctx.fillText("Sarah Jenkins", W - 260, H - 80);
  ctx.fillStyle = "#8e8e93";
  ctx.font = "11px -apple-system, sans-serif";
  ctx.fillText("Director · 26/10/2026", W - 260, H - 60);

  return canvas.toDataURL("image/jpeg", 0.9);
}
