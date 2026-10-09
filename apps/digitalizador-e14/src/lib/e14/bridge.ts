/**
 * E14Bridge — la ÚNICA fuente de datos de las vistas (SPEC §2, D1).
 * Hoy: MockBridge. Mañana: scanner-core-bridge (FASE LÓGICA §11) — se
 * reemplaza tocando 1 archivo: get-bridge.ts.
 */
import type { Acta, ActaFirma, TipoPagina } from "./types";
import { statusDeScore } from "./types";
import { ACTA_MOCK } from "./seed";

/** Página de mesa a la que apunta el próximo escaneo (D7: vive en el store). */
export interface PaginaObjetivo {
  mesaId: string; // "MESA 02"
  tipo: TipoPagina; // "DELEGADOS" | "TRANSMISIÓN"
  pagina: 1 | 2;
}

export type Forzado = "ALEATORIO" | "OPTIMA" | "ADVERTENCIA" | "RECHAZADA";

export interface OpcionesEscaneo {
  objetivo: PaginaObjetivo | null;
  forzado: Forzado;
  intento: number;
  maxIntentos: number;
}

export interface E14Bridge {
  /** Genera el acta resultante de un escaneo (mock: aleatorio o forzado). */
  escanearActa(opciones: OpcionesEscaneo): Acta;
  /** HH:MM:SS — hora del envío automático. */
  horaEnvio(): string;
  /** HH:MM — hora de las filas del historial. */
  horaHistorial(): string;
}

const OPTIMA_SCORES = [8.2, 8.6, 9.1, 9.4, 9.8];
const ADVERTENCIA_SCORES = [6.8, 7.0, 7.2, 7.5, 7.8];
const RECHAZADA_SCORES = [3.8, 4.2, 4.9, 5.6, 6.1];

function pick<T>(lista: readonly T[]): T {
  return lista[Math.floor(Math.random() * lista.length)];
}

function dosDigitos(n: number): string {
  return String(n).padStart(2, "0");
}

/** Implementación MOCK (FASE GRÁFICA). */
export class MockBridge implements E14Bridge {
  private contador = 0;

  escanearActa({ objetivo, forzado, intento, maxIntentos }: OpcionesEscaneo): Acta {
    // §7.5: en el 2º intento el mock SIEMPRE fuerza ≥ 8 para desbloquear el
    // demo (regla absoluta: nunca hay rechazo consecutivo que bloquee).
    let resultado: Forzado = forzado;
    if (intento >= 2) {
      resultado = "OPTIMA";
    } else if (forzado === "ALEATORIO") {
      const dado = Math.random();
      resultado = dado < 0.45 ? "OPTIMA" : dado < 0.75 ? "ADVERTENCIA" : "RECHAZADA";
    }

    const score =
      resultado === "OPTIMA"
        ? pick(OPTIMA_SCORES)
        : resultado === "ADVERTENCIA"
          ? pick(ADVERTENCIA_SCORES)
          : pick(RECHAZADA_SCORES);

    const status = statusDeScore(score);

    // Firma 2 según el resultado (calca los mocks de revisión):
    //  · ADVERTENCIA → trazo tenue (ámbar)
    //  · RECHAZADA   → no detectado (rojo)
    const firma2: ActaFirma = {
      nombre: ACTA_MOCK.firmas[1].nombre,
      jurado: ACTA_MOCK.firmas[1].jurado,
      estado:
        status === "ADVERTENCIA" ? "TENUE" : status === "RECHAZADA" ? "NO_DETECTADO" : "OK",
    };

    const firmas: ActaFirma[] = [
      { nombre: ACTA_MOCK.firmas[0].nombre, jurado: ACTA_MOCK.firmas[0].jurado, estado: "OK" },
      firma2,
      { nombre: ACTA_MOCK.firmas[2].nombre, jurado: ACTA_MOCK.firmas[2].jurado, estado: "OK" },
    ];

    const rechazo =
      status === "RECHAZADA"
        ? Math.random() < 0.8
          ? { tipo: "ILEGIBLE" as const, detalle: "CÓDIGO DE BARRAS Y CABECERA NO DETECTADOS" }
          : { tipo: "GENERICO" as const, detalle: "SCORE INSUFICIENTE PARA TRANSMISIÓN" }
        : null;

    const numeroMesa = objetivo ? objetivo.mesaId.replace(/\D/g, "").padStart(3, "0") : "001";

    this.contador += 1;

    return {
      id: `acta-${Date.now()}-${this.contador}`,
      titulo: ACTA_MOCK.titulo,
      ubicacion: {
        departamento: ACTA_MOCK.departamento,
        municipio: ACTA_MOCK.municipio,
        zona: ACTA_MOCK.zona,
        puesto: ACTA_MOCK.puesto,
        mesa: numeroMesa,
      },
      tipo: ACTA_MOCK.tipo,
      pagina: { index: objetivo?.pagina ?? 1, total: 2 },
      candidatos: ACTA_MOCK.candidatos.map((c) => ({ ...c })),
      firmas,
      codigoBarras: ACTA_MOCK.codigoBarras,
      score,
      status,
      rechazo,
      intento,
      maxIntentos,
    };
  }

  horaEnvio(): string {
    const d = new Date();
    return `${dosDigitos(d.getHours())}:${dosDigitos(d.getMinutes())}:${dosDigitos(d.getSeconds())}`;
  }

  horaHistorial(): string {
    const d = new Date();
    return `${dosDigitos(d.getHours())}:${dosDigitos(d.getMinutes())}`;
  }
}
