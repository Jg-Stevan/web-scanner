/**
 * Helpers de imagen (canvas puro, sin dependencias) — COPIA LITERAL del lab
 * (apps/scanner-lab/src/components/scanner/EditorView.tsx L163–L224, SPEC
 * §7.5 mapa de copia: `rotateProcessedDataUrl` para "ROTAR 90°" de REVISIÓN).
 *
 * F-ROT-RAPID — rota una data URL en múltiplos de 90° SIN reprocesar el
 * pipeline (warp+enhance). Matemáticamente equivalente: el warp ya ocurrió y
 * el realce es conmutativo con rotaciones de 90°. e14 usa la rotación
 * horneada en `Acta.rotation` para el PDF (§6: el adaptador ya la pasa al
 * ScanDocument).
 */

/** Encode PNG de un canvas vía toBlob (memoria-seguro en iOS) → data URL. */
function encodePngDataUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => {
        if (!b || b.size === 0) {
          reject(new Error("toBlob vacío"));
          return;
        }
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result ?? ""));
        fr.onerror = () => reject(new Error("FileReader falló"));
        fr.readAsDataURL(b);
      }, "image/png");
    } catch (e) {
      reject(e instanceof Error ? e : new Error("toBlob falló"));
    }
  });
}

import { loadImage } from "@jg-stevan/scanner-core/image-processor";

/**
 * Rota una data URL `deg` grados (múltiplos de 90) con canvas puro.
 * El lab devuelve también miniatura/w/h para su carrusel; e14 solo consume
 * `url` (los demás campos se conservan por fidelidad de la copia).
 */
export async function rotateProcessedDataUrl(
  url: string,
  deg: number
): Promise<{ url: string; thumb: string; w: number; h: number }> {
  const img = await loadImage(url);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) throw new Error("imagen sin dimensiones");
  const swapped = deg % 180 !== 0;
  const cw = swapped ? h : w;
  const ch = swapped ? w : h;
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("sin contexto 2d");
  ctx.imageSmoothingQuality = "high";
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2);
  const tW = 160;
  const tH = Math.max(1, Math.round((ch / cw) * tW));
  const tCanvas = document.createElement("canvas");
  tCanvas.width = tW;
  tCanvas.height = tH;
  const tCtx = tCanvas.getContext("2d");
  if (tCtx) {
    tCtx.imageSmoothingQuality = "high";
    tCtx.drawImage(canvas, 0, 0, tW, tH);
  }
  const [urlOut, thumb] = await Promise.all([
    encodePngDataUrl(canvas),
    Promise.resolve(tCanvas.toDataURL("image/jpeg", 0.8)),
  ]);
  return { url: urlOut, thumb, w: cw, h: ch };
}
