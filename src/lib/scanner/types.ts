/**
 * Tipos del escáner de documentos.
 * 📍 PUNTO DE INTEGRACIÓN: cuando llegue la lógica real de precisión del usuario,
 * estas interfaces deben mantenerse estables.
 */

export type ScannerView =
  | "library"
  | "camera"
  | "editor"
  | "document"
  | "settings";

export type PageFilter =
  | "original"
  | "auto"
  | "color"
  | "grayscale"
  | "blackwhite"
  | "whiteboard"
  | "document"
  | "natural";

export interface FilterPreset {
  id: PageFilter;
  label: string;
  description: string;
}

export const FILTER_PRESETS: FilterPreset[] = [
  { id: "original", label: "Original", description: "Sin cambios" },
  { id: "auto", label: "Auto", description: "Ajuste automático" },
  { id: "natural", label: "Natural", description: "Blanco realzado suave" },
  { id: "color", label: "Color", description: "Colores vivos" },
  { id: "grayscale", label: "Escala de grises", description: "Blanco y negro suave" },
  { id: "blackwhite", label: "Blanco y negro", description: "Contraste máximo" },
  { id: "whiteboard", label: "Pizarra", description: "Fondo blanco limpio" },
  { id: "document", label: "Documento", description: "Nítido para texto" },
];

/** Filtros cuyo modo de enhance se codifica como PNG sin pérdida
 *  (mime por modo §8 del usuario: raw|text|bw → PNG; el resto JPEG). */
export const PNG_FILTERS: ReadonlySet<PageFilter> = new Set<PageFilter>([
  "original", // raw
  "auto", // text
  "document", // text
  "whiteboard", // text
  "blackwhite", // bw
]);

/** Punto (normalizado 0-1) del marco de perspectiva. */
export interface Point {
  x: number;
  y: number;
}

/** Cuadrilátero de perspectiva: 0=top-left, 1=top-right, 2=bottom-right, 3=bottom-left */
export type Quad = [Point, Point, Point, Point];

export type QualityLevel = "excellent" | "good" | "fair" | "poor";

export interface PageQuality {
  level: QualityLevel;
  sharpness: number; // 0-100
  brightness: number; // 0-100
  contrast: number; // 0-100
  label: string;
}

/** Estadísticas del pipeline de precisión para una página procesada.
 *  Refleja el WarpOutcome REAL del worker (refined/fellBack del RANSAC)
 *  o el fallback canvas. Solo informativo — nunca altera el pipeline. */
export interface PagePrecision {
  /** "worker" = pipeline OpenCV real · "canvas" = fallback local. */
  engine: "worker" | "canvas";
  /** true = esquinas refinadas sub-píxel por líneas (RANSAC). */
  refined: boolean;
  /** Nº de esquinas firmes (0–4) del ajuste de líneas; null si no aplica. */
  cornersSolid: number | null;
  /** Dimensiones del resultado procesado. */
  width: number;
  height: number;
  /** Ms del enhance real (worker) o del canvas fallback. */
  elapsedMs?: number;
}

export interface ScanPage {
  id: string;
  /** data URL de la imagen cruda capturada */
  original: string;
  /** data URL procesada (recorte + filtro) */
  processed: string;
  /** data URL miniatura */
  thumbnail: string;
  filter: PageFilter;
  quad: Quad;
  /** true = quad ajustado por el humano (respetar al píxel en re-procesos) */
  quadManual?: boolean;
  rotation: number; // 0 | 90 | 180 | 270
  quality: PageQuality;
  /** Estadísticas del pipeline que produjo esta página (si es real). */
  precision?: PagePrecision;
  ocrText?: string;
  ocrDone: boolean;
  createdAt: number;
}

export interface ScanDocument {
  id: string;
  title: string;
  pages: ScanPage[];
  favorite: boolean;
  /** Etiquetas de organización (opcional para compat con registros viejos). */
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

/** Página en sesión de captura (antes de guardar) */
export interface CapturePage {
  id: string;
  original: string;
  quad: Quad;
  /** true = el humano movió las esquinas → warp SIN refine y SIN shrink */
  quadManual?: boolean;
  filter: PageFilter;
  rotation: number;
  quality: PageQuality;
}

/** Perfil de documento para los priores de detección (selectQuad del usuario):\n *  preferencia de aspecto, NUNCA rechazo — un documento fuera de perfil sigue
 *  siendo válido. Se aplica en caliente vía {type:'config'} al worker. */
export type DocProfileId = "auto" | "pagina" | "documento-largo" | "tarjeta";

export interface DocProfileOption {
  id: DocProfileId;
  label: string;
  hint: string;
}

export const DOC_PROFILES: DocProfileOption[] = [
  { id: "auto", label: "Automático", hint: "Sin prior de aspecto" },
  { id: "pagina", label: "Página", hint: "Carta o A4 · 1.2–1.6" },
  { id: "documento-largo", label: "Documento largo", hint: "Actas y tirillas · 1.3–4.5" },
  { id: "tarjeta", label: "Tarjeta", hint: "Credenciales · 0.6–0.8" },
];

export interface ScannerSettings {
  autoCapture: boolean;
  flash: boolean;
  enhance: boolean;
  ocrEnabled: boolean;
  exportQuality: "standard" | "alta" | "máxima";
  /** Prior de aspecto para la detección (R4-B2 del usuario). */
  docProfile: DocProfileId;
  /** true = aplica unsharp (0.5/1.5) al filtro Original. Por fidelidad al
   *  sensor el modo raw se guarda PURO (F5-RAW); este toggle añade el
   *  enfoque del producto solo cuando el usuario lo pide. */
  unsharpOriginal: boolean;
}

export const DEFAULT_SETTINGS: ScannerSettings = {
  autoCapture: true,
  flash: false,
  enhance: true,
  ocrEnabled: true,
  exportQuality: "alta",
  docProfile: "auto",
  unsharpOriginal: false,
};

export function defaultQuad(): Quad {
  return [
    { x: 0.08, y: 0.1 },
    { x: 0.92, y: 0.06 },
    { x: 0.95, y: 0.92 },
    { x: 0.05, y: 0.95 },
  ];
}

export function excellentQuality(): PageQuality {
  return {
    level: "excellent",
    sharpness: 92,
    brightness: 88,
    contrast: 84,
    label: "Excelente",
  };
}

export function makeQuality(
  sharpness: number,
  brightness: number,
  contrast: number
): PageQuality {
  const score = (sharpness + brightness + contrast) / 3;
  const level: QualityLevel =
    score >= 85 ? "excellent" : score >= 70 ? "good" : score >= 50 ? "fair" : "poor";
  const label =
    level === "excellent"
      ? "Excelente"
      : level === "good"
        ? "Buena"
        : level === "fair"
          ? "Aceptable"
          : "Baja";
  return { level, sharpness, brightness, contrast, label };
}
