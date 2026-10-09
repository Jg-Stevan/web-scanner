/**
 * Dominio E-14 (SPEC §6 — ampliado para v2).
 * FASE GRÁFICA: los datos salen del bridge mock; el core se conecta luego.
 */

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
