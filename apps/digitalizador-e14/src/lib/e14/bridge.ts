/**
 * E14Bridge — la ÚNICA fuente de datos de las vistas (SPEC §2, D1).
 * FASE LÓGICA L1 (SPEC-fase-logica §3.2): contrato ASYNC con eventos de
 * progreso. El CompositeBridge enruta por `fuente` (D17: get-bridge.ts
 * sigue siendo el punto único de intercambio — las vistas no se enteran).
 *
 * UX-REAL F1 (SPEC-ux-real-bn-editor §F1, D35): el MockBridge de la fase
 * gráfica se RETIRÓ — SIMULACIÓN también pasa por el bridge real (pipeline
 * real sobre el acta E-14 incluida). Los gates pasan de «fuente ≠ SIM» a
 * PRESENCIA DE FOTO (recortar/exportarPdf ya no miran `acta.fuente`).
 * Fuente: (diseño propio e14, D35 — el mock de la fase gráfica se retiró;
 * SIMULACIÓN = pipeline real sobre el acta incluida).
 */
import type { Acta, ProgresoAnalisis, FuenteCaptura, TipoPagina } from "./types";
import type { Quad } from "@jg-stevan/scanner-core/types";

/** Página de mesa a la que apunta el próximo escaneo (D7: vive en el store). */
export interface PaginaObjetivo {
  mesaId: string; // "MESA 02"
  tipo: TipoPagina; // "DELEGADOS" | "TRANSMISIÓN"
  pagina: 1 | 2;
}

export interface OpcionesEscaneo {
  objetivo: PaginaObjetivo | null;
  intento: number;
  maxIntentos: number;
  fuente: FuenteCaptura;
  archivo?: File; // fuente ARCHIVO (y SIMULACIÓN si el store inyecta el acta incluida)
  frameActual?: HTMLVideoElement | null; // fuente CAMARA
  onProgreso?: (p: ProgresoAnalisis) => void;
}

export interface E14Bridge {
  /** Analiza la imagen y resuelve con el acta resultante (async, §3.2). */
  escanearActa(opciones: OpcionesEscaneo): Promise<Acta>;
  /** Exporta el acta a PDF (§6; L4 lo cablea para actas con foto real). */
  exportarPdf(acta: Acta): Promise<void>;
  /**
   * L5 (§7.5): re-ejecuta el pipeline §5 sobre `fotoOriginal` del acta con el
   * QUAD MANUAL (F5-MANUAL: respeta el quad al píxel, sin refine) → devuelve
   * el acta ACTUALIZADA (fotoProcesada/score/status/rechazo/ocr/metricas;
   * fuente/intento/maxIntentos/paginación IGUALES — el rescate D20 NO consume
   * intento).
   */
  recortar(
    acta: Acta,
    quad: Quad,
    onProgreso?: (p: ProgresoAnalisis) => void,
  ): Promise<Acta>;
  /** HH:MM:SS — hora del envío automático. */
  horaEnvio(): string;
  /** HH:MM — hora de las filas del historial. */
  horaHistorial(): string;
}

function dosDigitos(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Enrutador (SPEC §3.3, D17 — simplificado en D35): TODO pasa al bridge real
 * (SIMULACIÓN incluida: el real carga el acta E-14 incluida). Los gates de
 * recortar/exportarPdf miran la PRESENCIA DE FOTO, no la fuente.
 * get-bridge.ts sigue siendo el punto único de intercambio.
 */
export class CompositeBridge implements E14Bridge {
  constructor(private real: E14Bridge | null = null) {}

  escanearActa(opciones: OpcionesEscaneo): Promise<Acta> {
    if (!this.real) {
      return Promise.reject(new Error("FUENTE REAL NO IMPLEMENTADA (L2)"));
    }
    return this.real.escanearActa(opciones);
  }

  exportarPdf(acta: Acta): Promise<void> {
    if (!this.real) {
      return Promise.reject(new Error("FUENTE REAL NO IMPLEMENTADA (L2)"));
    }
    // D35: el gate es la foto — el real ya rechaza sin fotoProcesada
    // ("SIN FOTO REAL PARA EXPORTAR"), da igual la fuente.
    return this.real.exportarPdf(acta);
  }

  recortar(
    acta: Acta,
    quad: Quad,
    onProgreso?: (p: ProgresoAnalisis) => void,
  ): Promise<Acta> {
    if (!this.real) {
      return Promise.reject(new Error("FUENTE REAL NO IMPLEMENTADA (L2)"));
    }
    // D35: el gate es la foto, no la fuente (SIMULACIÓN tiene foto real).
    if (!acta.fotoOriginal) {
      return Promise.reject(new Error("RECORTAR NO APLICA SIN FOTO REAL"));
    }
    return this.real.recortar(acta, quad, onProgreso);
  }

  horaEnvio(): string {
    // Las horas son de dominio de sesión, no del motor (D35: antes delegaba
    // al mock; ahora viven aquí — mismo formato HH:MM:SS).
    const d = new Date();
    return `${dosDigitos(d.getHours())}:${dosDigitos(d.getMinutes())}:${dosDigitos(d.getSeconds())}`;
  }

  horaHistorial(): string {
    const d = new Date();
    return `${dosDigitos(d.getHours())}:${dosDigitos(d.getMinutes())}`;
  }
}
