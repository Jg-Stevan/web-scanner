/**
 * E14Bridge — la ÚNICA fuente de datos de las vistas (SPEC §2, D1).
 * FASE LÓGICA L1 (SPEC-fase-logica §3.2): contrato ASYNC con eventos de
 * progreso. El CompositeBridge enruta por `fuente` (D17: get-bridge.ts
 * sigue siendo el punto único de intercambio — las vistas no se enteran).
 */
import type { Acta, ActaFirma, EtapaAnalisis, FuenteCaptura, ProgresoAnalisis, TipoPagina } from "./types";
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
  forzado: Forzado; // solo aplica en SIMULACION
  intento: number;
  maxIntentos: number;
  fuente: FuenteCaptura;
  archivo?: File; // fuente ARCHIVO
  frameActual?: HTMLVideoElement | null; // fuente CAMARA
  onProgreso?: (p: ProgresoAnalisis) => void;
}

export interface E14Bridge {
  /** Analiza la imagen y resuelve con el acta resultante (async, §3.2). */
  escanearActa(opciones: OpcionesEscaneo): Promise<Acta>;
  /** Exporta el acta a PDF (§6; L4 lo cablea solo para actas reales). */
  exportarPdf(acta: Acta): Promise<void>;
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

function dormir(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

/** Implementación MOCK — MODO SIMULACIÓN (regla de oro §1.2: intacto). */
export class MockBridge implements E14Bridge {
  private contador = 0;

  /**
   * Async con progreso SINTÉTICO: recorre las 5 etapas canónicas (~350–600 ms
   * por etapa, ~2.3 s total) para calcar el feel del timer de la fase gráfica,
   * emitiendo onProgreso en 2–3 saltos por etapa. Sin onProgreso la
   * temporización es la MISMA (mantener feel). La lógica del acta (regla 2º
   * intento ≥8, scores, firma2, rechazo 80/20) se conserva intacta en
   * generarActa().
   */
  async escanearActa(opciones: OpcionesEscaneo): Promise<Acta> {
    const etapas: EtapaAnalisis[] = ["DETECTANDO", "RECORTANDO", "REALZANDO", "CALIDAD", "OCR"];
    for (const etapa of etapas) {
      const duracion = 350 + Math.floor(Math.random() * 251); // 350–600 ms
      const saltos = 2 + Math.floor(Math.random() * 2); // 2–3 eventos
      for (let i = 1; i <= saltos; i++) {
        await dormir(duracion / saltos);
        opciones.onProgreso?.({ etapa, progreso: Math.min(1, i / saltos) });
      }
    }
    return { ...this.generarActa(opciones), fuente: "SIMULACION", motor: "mock" };
  }

  /** Lógica mock original (FASE GRÁFICA) — intacta. */
  private generarActa({ objetivo, forzado, intento, maxIntentos }: OpcionesEscaneo): Acta {
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

  async exportarPdf(): Promise<void> {
    // La UI no la llama en SIM; L4 la cablea solo para actas reales (§6).
    throw new Error("EXPORTACIÓN NO DISPONIBLE EN SIMULACIÓN");
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

/**
 * Enrutador por fuente (SPEC §3.3, D17): SIMULACIÓN → MockBridge interno;
 * CAMARA/ARCHIVO → bridge real (L2/L3 lo inyecta en get-bridge.ts).
 * get-bridge.ts sigue siendo el punto único de intercambio.
 */
export class CompositeBridge implements E14Bridge {
  private mock = new MockBridge();

  constructor(private real: E14Bridge | null = null) {}

  escanearActa(opciones: OpcionesEscaneo): Promise<Acta> {
    if (opciones.fuente === "SIMULACION") {
      return this.mock.escanearActa(opciones);
    }
    if (this.real) {
      return this.real.escanearActa(opciones);
    }
    return Promise.reject(new Error("FUENTE REAL NO IMPLEMENTADA (L2)"));
  }

  exportarPdf(acta: Acta): Promise<void> {
    if (acta.fuente !== "SIMULACION" && this.real) {
      return this.real.exportarPdf(acta);
    }
    // El mock no exporta (SIM): siempre rechaza con su error canónico.
    return this.mock.exportarPdf();
  }

  horaEnvio(): string {
    // Delega al mock: las horas son de dominio de sesión, no del motor.
    return this.mock.horaEnvio();
  }

  horaHistorial(): string {
    return this.mock.horaHistorial();
  }
}
