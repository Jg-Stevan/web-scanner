/**
 * OCR compartido — helpers cliente para el endpoint /api/ocr.
 *
 * Extraídos de DocumentDetailView para reutilizarlos en:
 *  · DocumentDetailView  → OCR de una página / de todo el documento.
 *  · LibraryView         → OCR por lotes sobre la selección múltiple.
 */

/** Respuesta del modelo cuando la imagen no contiene texto legible. */
export const OCR_NO_TEXT = "(sin texto legible)";

/** Payload máximo aceptado por el endpoint (~10 MB de data URL). */
const MAX_OCR_PAYLOAD = 10 * 1024 * 1024;

/**
 * Sentinela anti-rechazos: el vision-model a veces responde con disculpas
 * o meta-comentarios en lugar de admitir que no hay texto. Filtra esas
 * respuestas para no persistir basura en el documento.
 */
export function ocrTextIsValid(text: string): boolean {
  if (text === "" || text === OCR_NO_TEXT) return false;
  const t = text.toLowerCase();
  if (t.startsWith("lo siento") || t.startsWith("i'm sorry") || t.startsWith("i apologize")) {
    return false;
  }
  return true;
}

/**
 * Llama al endpoint de OCR con un data URL (JPEG normalizado vía toJpeg).
 * Lanza si la respuesta no es ok o si el payload es demasiado grande.
 */
export async function requestOcr(image: string): Promise<string> {
  if (image.length > MAX_OCR_PAYLOAD) {
    throw new Error("Imagen demasiado grande");
  }
  const res = await fetch("/api/ocr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image }),
  });
  // GitHub Pages (hosting estático) no tiene endpoints: detectarlo y avisar claro.
  if (res.status === 404) {
    throw new Error("OCR no disponible en el despliegue estático (requiere servidor)");
  }
  const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? "Error de OCR");
  return (data.text ?? "").trim();
}

/* ------------------------------------------------------------------ */
/* Búsqueda en el texto OCR (resaltado de coincidencias)               */
/* ------------------------------------------------------------------ */

/** Coincidencia de búsqueda: rango [start, end) sobre el texto ORIGINAL. */
export interface TextMatch {
  start: number;
  end: number;
}

/** Normaliza un carácter/texto para buscar (minúsculas, sin tildes). */
function foldText(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Busca TODAS las coincidencias (no solapadas) de `query` en `text`,
 * insensibles a mayúsculas y tildes, devolviendo rangos sobre el texto
 * original (no sobre el normalizado).
 */
export function findTextMatches(text: string, query: string): TextMatch[] {
  const q = foldText(query.trim());
  if (!q) return [];
  // Cadena plegada + mapa índice → posición en el original (la descomposición
  // NFD puede expandir un carácter base+diacrítico, el mapa lo resuelve).
  const folded: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    for (const ch of foldText(text[i]!)) {
      folded.push(ch);
      map.push(i);
    }
  }
  const hay = folded.join("");
  const out: TextMatch[] = [];
  let idx = hay.indexOf(q);
  while (idx >= 0) {
    const start = map[idx]!;
    const end = map[idx + q.length - 1]! + 1;
    out.push({ start, end });
    idx = hay.indexOf(q, idx + q.length);
  }
  return out;
}

/** Segmento del texto para renderizar con <mark>: hit = resaltar. */
export interface TextSegment {
  text: string;
  hit: boolean;
}

/** Trocea el texto en segmentos según las coincidencias (para <mark>). */
export function splitByMatches(text: string, matches: TextMatch[]): TextSegment[] {
  if (matches.length === 0) return [{ text, hit: false }];
  const out: TextSegment[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start > cursor) out.push({ text: text.slice(cursor, m.start), hit: false });
    out.push({ text: text.slice(m.start, m.end), hit: true });
    cursor = m.end;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), hit: false });
  return out;
}

