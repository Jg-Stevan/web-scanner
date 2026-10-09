/**
 * RealCoreBridge — el motor REAL de @jg-stevan/scanner-core (SPEC-fase-logica §5).
 * FASE LÓGICA L2: fuente ARCHIVO completa —
 *   fileToCaptureDataUrl → detectDocumentEdges → processImage →
 *   evaluateQuality → requestOcr → mapeo §4 → Acta.
 * FASE LÓGICA L3 (§5 CAMARA): la fuente CÁMARA reusa EL MISMO pipeline con
 *   dos entradas —
 *   · `archivo` (foto ya capturada por ZSL / captureSmart / cámara nativa
 *     iOS — la ruta del spec §7: "la foto entra al mismo pipeline (como
 *     ARCHIVO, L2)");
 *   · `frameActual` (video con stream vivo, último recurso) → grab síncrono
 *     a canvas a RESOLUCIÓN DEL STREAM → dataUrl → pipeline. El grab debe
 *     ocurrir ANTES de que React desmonte el visor (el stream se detiene al
 *     cambiar a ANALIZANDO), por eso se hace en el arranque síncrono de
 *     escanearActa.
 * Mapeo de score §4.1 (techos por level), gate de legibilidad §4.2 (el OCR
 * manda sobre el score: ILEGIBLE calca la rechazada v2) y timeout global de
 * 15 s que RESUELVE un acta RECHAZADA (nunca congela la UI ni revienta el
 * flujo de toasts del store). Etiquetas de etapa idénticas por fuente.
 *
 * Lo que sigue simulado (votos/firmas/ubicación) se rellena del seed exacto
 * como hace el MockBridge (§0: no se presenta como extraído).
 */
import {
  detectDocumentEdges,
  evaluateQuality,
  fileToCaptureDataUrl,
  processImage,
} from "@jg-stevan/scanner-core/image-processor";
import { ocrTextIsValid, requestOcr } from "@jg-stevan/scanner-core/ocr";
import type { PageQuality, Quad } from "@jg-stevan/scanner-core/types";
import { ACTA_MOCK } from "./seed";
import { statusDeScore } from "./types";
import type { Acta, ActaFirma, ActaStatus, ProgresoAnalisis } from "./types";
import type { E14Bridge, OpcionesEscaneo } from "./bridge";

/** Timeout de seguridad global §5 (worker colgado en gama baja). */
const TIMEOUT_MS = 15_000;
/** Techos/labels del mapeo §4 y el gate §4.2. */
const DETALLE_ILEGIBLE = "CÓDIGO DE BARRAS Y CABECERA NO DETECTADOS";
const DETALLE_TIMEOUT = "TIEMPO DE PROCESADO EXCEDIDO";
const DETALLE_GENERICO = "SCORE INSUFICIENTE PARA TRANSMISIÓN";
/** Regla de dominio E-14: la cabecera debe decir E-14 / REGISTRADURÍA. */
const PATRON_CABECERA = /E\s*-\s*14|REGISTRADURIA|REGISTRADURÍA/i;

/**
 * Grab del <video> a RESOLUCIÓN DEL STREAM (§5 CAMARA): canvas de
 * videoWidth×videoHeight → JPEG 0.92. Síncrono (~10 ms) — se llama ANTES de
 * que el visor se desmonte, mientras el stream sigue vivo.
 */
function capturarFrame(video: HTMLVideoElement): string | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx || !canvas.width || !canvas.height) return null;
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.92);
  } catch {
    return null;
  }
}

/** Entrada del pipeline: File (ARCHIVO o foto CÁMARA) o dataUrl ya crudo. */
type EntradaPipeline = { archivo: File } | { dataUrl: string };

function dosDigitos(n: number): string {
  return String(n).padStart(2, "0");
}

/** Mapeo §4.1: PageQuality del core → score 0-10 (1 decimal) con techos por level. */
function scoreDeCalidad(q: PageQuality): number {
  const bruto = (q.sharpness * 0.4 + q.brightness * 0.3 + q.contrast * 0.3) / 10;
  let score10 = Math.round(bruto * 10) / 10;
  if (q.level === "fair") score10 = Math.min(score10, 7.9); // techo ADVERTENCIA
  if (q.level === "poor") score10 = Math.min(score10, 6.4); // techo RECHAZADA
  return score10;
}

/**
 * Emite progreso INTERPOLADO mientras una espera real del core está en vuelo
 * (decode/detect/proceso no exponen avance interno; el OCR sí lo reporta
 * real). La fracción se cap al 95% para que la resolución de la etapa
 * siempre produzca un salto visible en ANALIZANDO.
 */
function conRampa<T>(
  promesa: Promise<T>,
  msEstimados: number,
  evento: (fraccion: number) => ProgresoAnalisis,
  emitir: (p: ProgresoAnalisis) => void,
): Promise<T> {
  const inicio = performance.now();
  const timer = setInterval(() => {
    const f = Math.min(1, (performance.now() - inicio) / msEstimados);
    emitir(evento(f * 0.95));
  }, 140);
  return promesa.then(
    (valor) => {
      clearInterval(timer);
      return valor;
    },
    (error) => {
      clearInterval(timer);
      throw error;
    },
  );
}

export class RealCoreBridge implements E14Bridge {
  private contador = 0;

  escanearActa(opciones: OpcionesEscaneo): Promise<Acta> {
    // Resolución de la entrada (L3 §5 CAMARA):
    //  · CAMARA + archivo (ZSL/captureSmart/iOS) → MISMO pipeline que ARCHIVO.
    //  · CAMARA sin archivo + frameActual (video vivo) → grab síncrono.
    //  · Sin entrada → error explícito (el guard del store ya avisó).
    let entrada: EntradaPipeline | null = null;
    if (opciones.archivo) {
      entrada = { archivo: opciones.archivo };
    } else if (opciones.fuente === "CAMARA") {
      const video = opciones.frameActual;
      const dataUrl = video && video.readyState >= 2 && video.videoWidth
        ? capturarFrame(video)
        : null;
      if (!dataUrl) {
        return Promise.reject(new Error("SIN CAPTURA PARA ANALIZAR (fuente CÁMARA)"));
      }
      entrada = { dataUrl };
    } else {
      return Promise.reject(new Error("SIN IMAGEN PARA ANALIZAR (fuente ARCHIVO)"));
    }

    // Acumulador de lo que ya se tiene (el acta de timeout rellena lo que
    // alcance a conocer — p. ej. fotoOriginal si el decode alcanzó a correr).
    const parcial: { fotoOriginal?: string } = {};
    let vencido = false; // tras el timeout no se emite más progreso (§5)
    const emitir = (p: ProgresoAnalisis) => {
      if (!vencido) opciones.onProgreso?.(p);
    };

    return new Promise<Acta>((resolve, reject) => {
      const timer = setTimeout(() => {
        vencido = true;
        // §5: el timeout NO rechaza la Promise — resuelve un acta RECHAZADA
        // controlada (el toast crit sale del flujo normal del store).
        resolve(
          this.construirActa(opciones, parcial, {
            score: 0,
            status: "RECHAZADA",
            rechazo: { tipo: "ILEGIBLE", detalle: DETALLE_TIMEOUT },
          }),
        );
      }, TIMEOUT_MS);

      this.pipeline(opciones, entrada, parcial, emitir).then(
        (acta) => {
          if (vencido) return; // ya resolvió el timeout: el resultado se descarta
          clearTimeout(timer);
          resolve(acta);
        },
        (error) => {
          if (vencido) return;
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error("ERROR DE PIPELINE"));
        },
      );
    });
  }

  /** Pipeline §5 (ARCHIVO y CAMARA comparten etapas y mapeo; ms por etapa en consola). */
  private async pipeline(
    opciones: OpcionesEscaneo,
    entrada: EntradaPipeline,
    parcial: { fotoOriginal?: string },
    emitir: (p: ProgresoAnalisis) => void,
  ): Promise<Acta> {
    const ms = { decode: 0, detect: 0, proceso: 0, calidad: 0, ocr: 0, total: 0 };
    const inicio = performance.now();

    // 1) Entrada → data URL crudo (F-IMPORT del core: HEIC/EXIF/12MP seguros;
    //    en CAMARA sin archivo el dataUrl ya vino del grab del <video>).
    emitir({ etapa: "DETECTANDO", progreso: 0 });
    const fotoOriginal =
      "archivo" in entrada
        ? await conRampa(
            fileToCaptureDataUrl(entrada.archivo),
            700,
            (f) => ({ etapa: "DETECTANDO", progreso: f * 0.5 }),
            emitir,
          )
        : entrada.dataUrl;
    ms.decode = performance.now() - inicio;
    parcial.fotoOriginal = fotoOriginal;

    // 2) Detección de bordes (worker OpenCV → fallback Sobel del core).
    let quad: Quad;
    const tDetect = performance.now();
    try {
      quad = await conRampa(
        detectDocumentEdges(fotoOriginal),
        900,
        (f) => ({ etapa: "DETECTANDO", progreso: 0.5 + f * 0.4 }),
        emitir,
      );
    } catch {
      // El core SIEMPRE devuelve Quad; una EXCEPCIÓN aquí = imagen no
      // detectable → RECHAZADA ILEGIBLE inmediata (§5 paso 1, spec §7.5).
      // El piso escénico D16 de ANALIZANDO completa la animación solo.
      return this.construirActa(opciones, parcial, {
        score: 0,
        status: "RECHAZADA",
        rechazo: { tipo: "ILEGIBLE", detalle: DETALLE_ILEGIBLE },
      });
    }
    ms.detect = performance.now() - tDetect;
    emitir({ etapa: "DETECTANDO", progreso: 1 });

    // 3) Recorte + realce (warp real INTER_CUBIC + "original").
    emitir({ etapa: "RECORTANDO", progreso: 0.2 });
    const tProceso = performance.now();
    const resultado = await conRampa(
      processImage(fotoOriginal, quad, "original"),
      1400,
      // RECORTANDO .2→.6 (warp) → REALZANDO .4→1 (enhance), interpolado.
      (f) =>
        f < 0.55
          ? { etapa: "RECORTANDO", progreso: 0.2 + (f / 0.55) * 0.4 }
          : { etapa: "REALZANDO", progreso: 0.4 + ((f - 0.55) / 0.45) * 0.6 },
      emitir,
    );
    ms.proceso = performance.now() - tProceso;
    emitir({ etapa: "REALZANDO", progreso: 1 });
    const fotoProcesada = resultado.processed;

    // 4) Calidad de la página (Laplaciano + contraste + brillo sobre el crudo).
    emitir({ etapa: "CALIDAD", progreso: 0 });
    const tCalidad = performance.now();
    const calidad = await evaluateQuality(fotoOriginal);
    ms.calidad = performance.now() - tCalidad;
    emitir({ etapa: "CALIDAD", progreso: 1 });

    // 5) OCR sobre la PROCESADA (spa+eng local; progreso real 0→1).
    const tOcr = performance.now();
    const texto = await requestOcr(fotoProcesada, (p) => {
      emitir({ etapa: "OCR", progreso: Math.min(1, Math.max(0, p)) });
    });
    ms.ocr = performance.now() - tOcr;
    emitir({ etapa: "OCR", progreso: 1 });
    ms.total = performance.now() - inicio;

    const motor = resultado.precision?.engine ?? "canvas";

    // 6) Mapeo §4 → status/score/rechazo.
    const score = scoreDeCalidad(calidad);
    const legible = ocrTextIsValid(texto) && PATRON_CABECERA.test(texto);
    const status: ActaStatus = legible ? statusDeScore(score) : "RECHAZADA";

    console.info(
      `[e14] pipeline ${opciones.fuente}/${"archivo" in entrada ? "file" : "video-grab"} ` +
        `total=${Math.round(ms.total)}ms ` +
        `(decode=${Math.round(ms.decode)} detect=${Math.round(ms.detect)} ` +
        `proceso=${Math.round(ms.proceso)} calidad=${Math.round(ms.calidad)} ` +
        `ocr=${Math.round(ms.ocr)} motor=${motor} legible=${legible} score=${score} ` +
        `metricas={sharpness:${calidad.sharpness} brightness:${calidad.brightness} ` +
        `contrast:${calidad.contrast} level:${calidad.level}})`,
    );

    return this.construirActa(opciones, parcial, {
      fotoProcesada,
      quadDetectado: quad,
      calidad,
      ocrTexto: texto,
      motor,
      score,
      status,
      rechazo:
        !legible
          ? { tipo: "ILEGIBLE", detalle: DETALLE_ILEGIBLE }
          : status === "RECHAZADA"
            ? { tipo: "GENERICO", detalle: DETALLE_GENERICO }
            : null,
    });
  }

  /** Acta final: relleno simulado (seed, igual que el mock) + campos reales §3.1. */
  private construirActa(
    opciones: OpcionesEscaneo,
    parcial: { fotoOriginal?: string },
    campos: {
      fotoProcesada?: string;
      quadDetectado?: Quad;
      calidad?: PageQuality;
      ocrTexto?: string;
      motor?: "worker" | "canvas";
      score: number;
      status: ActaStatus;
      rechazo: Acta["rechazo"];
    },
  ): Acta {
    const numeroMesa = opciones.objetivo
      ? opciones.objetivo.mesaId.replace(/\D/g, "").padStart(3, "0")
      : "001";
    this.contador += 1;

    // Firmas coherentes con el estado (misma regla del mock §7.5):
    // ADVERTENCIA → firma 2 TENUE · RECHAZADA → NO_DETECTADO · resto OK.
    const estadoFirma2: ActaFirma["estado"] =
      campos.status === "ADVERTENCIA" ? "TENUE" : campos.status === "RECHAZADA" ? "NO_DETECTADO" : "OK";

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
      pagina: { index: opciones.objetivo?.pagina ?? 1, total: 2 },
      candidatos: ACTA_MOCK.candidatos.map((c) => ({ ...c })),
      firmas: [
        { nombre: ACTA_MOCK.firmas[0].nombre, jurado: ACTA_MOCK.firmas[0].jurado, estado: "OK" },
        { nombre: ACTA_MOCK.firmas[1].nombre, jurado: ACTA_MOCK.firmas[1].jurado, estado: estadoFirma2 },
        { nombre: ACTA_MOCK.firmas[2].nombre, jurado: ACTA_MOCK.firmas[2].jurado, estado: "OK" },
      ],
      codigoBarras: ACTA_MOCK.codigoBarras,
      score: campos.score,
      status: campos.status,
      rechazo: campos.rechazo,
      intento: opciones.intento,
      maxIntentos: opciones.maxIntentos,

      // ----- Campos reales (§3.1) -----
      fuente: opciones.fuente,
      fotoOriginal: parcial.fotoOriginal,
      fotoProcesada: campos.fotoProcesada,
      ocrTexto: campos.ocrTexto,
      metricas: campos.calidad
        ? {
            sharpness: campos.calidad.sharpness,
            brightness: campos.calidad.brightness,
            contrast: campos.calidad.contrast,
          }
        : undefined,
      motor: campos.motor ?? "canvas",
      quadDetectado: campos.quadDetectado,
      rotation: 0,
    };
  }

  async exportarPdf(): Promise<void> {
    // §6: el adaptador buildDocPdf + el CTA llegan en L4.
    throw new Error("EXPORTACIÓN PDF LLEGA EN LA FASE L4");
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
