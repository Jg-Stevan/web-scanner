/** Utilidades de formato (español) — deterministas. */

import { BASE_TIME } from "./mock-data";

const MIN = 60000;
const HOUR = 3600000;
const DAY = 86400000;

/** Tiempo relativo en español respecto a un `now` dado. */
export function relativeTime(timestamp: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - timestamp);
  if (diff < MIN) return "hace un momento";
  if (diff < HOUR) return `hace ${Math.floor(diff / MIN)} min`;
  if (diff < DAY) return `hace ${Math.floor(diff / HOUR)} h`;
  if (diff < 7 * DAY) return `hace ${Math.floor(diff / DAY)} d`;
  return new Date(timestamp).toLocaleDateString("es-CO", {
    day: "numeric",
    month: "short",
  });
}

/** Fecha completa en español. */
export function fullDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("es-CO", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Estima el tamaño de un data URL en bytes. */
export function dataUrlBytes(dataUrl: string): number {
  const idx = dataUrl.indexOf(",");
  if (idx < 0) return 0;
  return Math.round(((dataUrl.length - idx - 1) * 3) / 4);
}

export { BASE_TIME };
