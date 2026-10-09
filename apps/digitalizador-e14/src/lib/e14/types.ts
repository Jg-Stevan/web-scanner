/**
 * Dominio E-14 (SPEC §6 — ampliado para v2).
 * FASE LÓGICA L1: campos async opcionales (§3.1) — el mock y el seed siguen
 * compatibles (todo es opcional).
 */
import type { PageFilter, Quad } from "@jg-stevan/scanner-core/types";

// ---------- Captura y análisis (SPEC fase lógica §3.1) ----------
export type FuenteCaptura = "SIMULACION" | "CAMARA" | "ARCHIVO";

export type EtapaAnalisis = "DETECTANDO" | "RECORTANDO" | "REALZANDO" | "CALIDAD" | "OCR";

export interface ProgresoAnalisis {
  etapa: EtapaAnalisis;
  progreso: number; // 0..1 dentro de la etapa
}

// ---------- Acta (flujo de revisión) ----------
export type ActaStatus =
  | "OPTIMA" // verde   ≥ 8.0  → envío automático
  | "ADVERTENCIA" // ámbar   6.5–7.9 → confirmar o repetir
  | "RECHAZADA" // rojo    < 6.5  → repetir obligatorio (2 intentos)
  | "ENVIADA" // verde   tras envío (auto o manual)
  | "EN_REVISION_HUMANA"; // ámbar   salida manual desde RECHAZADA (C4)

export interface ActaUbicacion {
  departamento: string;
  municipio: string;
  zona: string;
  puesto: string;
  mesa: string;
}
export interface ActaCandidato {
  codigo: string;
  votos: number;
} // "101": 25 …

/**
 * Estado de una firma sobre el acta.
 * D6: "TENUE" añadido para reproducir el marcado ámbar "TRAZO TENUE"
 * de las pantallas de advertencia del zip v2 (ver docs/DECISIONS.md).
 */
export interface ActaFirma {
  nombre: string;
  jurado: string;
  estado: "OK" | "NO_DETECTADO" | "TENUE";
}

export interface Acta {
  id: string;
  titulo: string; // "ROMA - CONSULADO"
  ubicacion: ActaUbicacion;
  tipo: string; // "SENADO DE LA REPÚBLICA"
  pagina: { index: number; total: number };
  candidatos: ActaCandidato[];
  firmas: ActaFirma[];
  codigoBarras: string; // "*E14-SEN-2026-001*"
  score: number; // 0..10 SIEMPRE /10 (D2)
  status: ActaStatus;
  /** Motivo del rechazo → define la variante visual (§7.5) */
  rechazo: null | { tipo: "ILEGIBLE"; detalle: string } | { tipo: "GENERICO"; detalle: string };
  intento: number;
  maxIntentos: number; // "INTENTO 1 DE 2"
  enviadoAutomaticamente?: string; // "16:42:00"
  hashSha256?: string; // "EN COLA" | hash

  // ----- FASE LÓGICA (§3.1, opcionales — compatibles con seed/mocks) -----
  fuente?: FuenteCaptura;
  /** data URL warp+realce (la evidencia real). */
  fotoProcesada?: string;
  /** data URL cruda del frame/archivo. */
  fotoOriginal?: string;
  /** texto detectado (debug/verificación). */
  ocrTexto?: string;
  /** métricas del core 0-100. */
  metricas?: { sharpness: number; brightness: number; contrast: number };
  motor?: "worker" | "canvas" | "mock";
  /** esquinas de la detección automática (inicio del editor §7.5). */
  quadDetectado?: Quad;
  /** 0|90|180|270 — horneada en fotoProcesada. */
  rotation?: number;
  /** F2 (D36): filtro con el que se procesó (default del producto = "bw"). */
  filtro?: PageFilter;
}

// ---------- Control de mesas (vista ACTAS) ----------
export type MesaEstado = "COMPLETADA" | "EN_PROCESO" | "PENDIENTE";
export type PaginaEstado = "OK" | "RESCANEO" | "EN_PROCESO" | "PENDIENTE";
export type TipoPagina = "DELEGADOS" | "TRANSMISIÓN";

export interface MesaPagina {
  tipo: TipoPagina;
  pagina: 1 | 2;
  estado: PaginaEstado;
}
export interface Mesa {
  id: string; // "MESA 01"
  estado: MesaEstado;
  progresoPct: number; // 100 | 50 | 0
  paginas: MesaPagina[]; // DELEGADOS P1/P2 · TRANSMISIÓN P1/P2
}

// ---------- Resumen de trabajo (vista RESUMEN) ----------
export interface ProgresoPuesto {
  asignadasHoy: number;
  completadas: number;
} // 12 / 9 → 75%
export interface HistorialRow {
  id: string;
  titulo: string; // "MESA 01 — TRANSMISIÓN P2"
  estado: "ENVIADO" | "RESCANEO_REQUERIDO" | "REVISION_HUMANA";
  hora?: string; // "14:32"
}

/** Score → estado canónico (§6). */
export function statusDeScore(score: number): ActaStatus {
  if (score >= 8) return "OPTIMA";
  if (score >= 6.5) return "ADVERTENCIA";
  return "RECHAZADA";
}
