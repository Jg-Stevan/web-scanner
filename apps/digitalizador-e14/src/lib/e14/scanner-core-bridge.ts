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
 * FASE LÓGICA L5 (§7.5): `recortar` — re-ejecuta §5 sobre `fotoOriginal` con
 * el QUAD MANUAL (F5-MANUAL del core: `manual: true` respeta el quad al
 * píxel, sin refine) → fotoProcesada nueva → evaluateQuality + gate OCR →
 * acta ACTUALIZADA. El rescate D20 NO consume intento (fuente/intento/
 * maxIntentos/paginación se preservan por spread del acta de entrada).
 *
 * Lo que sigue simulado (votos/firmas/ubicación) se rellena del seed exacto
 * (§0: no se presenta como extraído).
 *
 * UX-REAL F1 (SPEC-ux-real-bn-editor §F1, D35): SIMULACIÓN también pasa por
 * este pipeline — la fuente carga el acta E-14 REAL incluida (§1) y la trata
 * EXACTAMENTE como un `archivo` de IMPORTAR (mismo File → fileToCaptureDataUrl
 * → F-IMPORT: EXIF/12MP). El mock de la fase gráfica se retiró.
 */
import {
  detectDocumentEdges,
  evaluateQuality,
  fileToCaptureDataUrl,
  processImage,
} from "@jg-stevan/scanner-core/image-processor";
import { ocrTextIsValid, requestOcr } from "@jg-stevan/scanner-core/ocr";
import {
  buildDocPdf,
  downloadBlob,
  sanitizeFileName,
} from "@jg-stevan/scanner-core/pdf-export";
import {
  excellentQuality,
  defaultQuad,
  makeQuality,
} from "@jg-stevan/scanner-core/types";
import type {
  PageFilter,
  PageQuality,
  Quad,
  ScanDocument,
} from "@jg-stevan/scanner-core/types";
import { ACTA_MOCK } from "./seed";
import { statusDeScore } from "./types";
// §1 (SPEC-ux-real-bn-editor): acta E-14 real del dueño (Galaxy A56 5G) —
// import estático: Next resuelve el basePath /web-scanner del deploy estático.
import actaSimUrl from "@/assets/acta-e14-real.jpg";
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

/**
 * SIMULACIÓN = pipeline real sobre el acta E-14 incluida (D35).
 * Mismo camino que IMPORTAR: File → fileToCaptureDataUrl (F-IMPORT: EXIF/12MP).
 * Caché a nivel de módulo para no re-descargar en REINTENTAR/REPETIR FOTO
 * (SPEC §F1.1 — el asset se decodifica al entrar a SIMULACIÓN, lazy).
 */
let actaSimCache: File | null = null;
async function fetchActaSimulada(): Promise<File> {
  if (actaSimCache) return actaSimCache;
  // actaSimUrl es StaticImageData — .src ya resuelve el basePath /web-scanner
  // del deploy estático (en dev: /_next/static/media/...).
  const res = await fetch(actaSimUrl.src);
  if (!res.ok) throw new Error("SIMULACIÓN: no se pudo cargar la imagen incluida");
  actaSimCache = new File([await res.blob()], "acta-e14-real.jpg", { type: "image/jpeg" });
  return actaSimCache;
}

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

  async escanearActa(opciones: OpcionesEscaneo): Promise<Acta> {
    // Resolución de la entrada (L3 §5 CAMARA + F1 SIMULACIÓN):
    //  · CAMARA + archivo (ZSL/captureSmart/iOS) → MISMO pipeline que ARCHIVO.
    //  · CAMARA sin archivo + frameActual (video vivo) → grab síncrono.
    //  · SIMULACIÓN sin archivo (D35) → el acta E-14 incluida, EXACTAMENTE
    //    como un archivo de IMPORTAR (la foto real del dueño, EXIF incluido).
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
        throw new Error("SIN CAPTURA PARA ANALIZAR (fuente CÁMARA)");
      }
      entrada = { dataUrl };
    } else if (opciones.fuente === "SIMULACION") {
      // SIMULACIÓN = pipeline real sobre el acta E-14 incluida (D35).
      // Mismo camino que IMPORTAR: File → fileToCaptureDataUrl (F-IMPORT: EXIF/12MP).
      entrada = { archivo: await fetchActaSimulada() };
    } else {
      throw new Error("SIN IMAGEN PARA ANALIZAR (fuente ARCHIVO)");
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

    // 3) Recorte + realce (warp real INTER_CUBIC + filtro default "bw").
    emitir({ etapa: "RECORTANDO", progreso: 0.2 });
    const tProceso = performance.now();
    const resultado = await conRampa(
      // Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L602-604
      // (captura arranca en B/N adaptativo) + types.ts L50 (default del
      // producto) — D36: e14 no tiene ajustes → el default fijo es "bw".
      processImage(fotoOriginal, quad, "bw"),
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
        `filtro=${"bw"} ` +
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

  /**
   * L5 (§7.5) — RECORTE MANUAL (rescate D20): re-ejecuta el pipeline §5 sobre
   * `fotoOriginal` con el quad del editor (F5-MANUAL: `manual: true` respeta
   * el quad al píxel, sin refine) y devuelve el acta ACTUALIZADA. El acta
   * conserva IDENTIDAD (fuente/intento/maxIntentos/paginación/título…) — el
   * rescate NO es una captura nueva, no consume intento. Timeout 15 s igual
   * que escanearActa: resuelve un acta RECHAZADA ILEGIBLE controlada.
   * F4/D37: `rotacionOverride` (4º parámetro) hornea la rotación LOCAL del
   * editor — el retorno de pipelineRecorte fija `rotation: rotacionUsada`.
   */
  recortar(
    acta: Acta,
    quad: Quad,
    onProgreso?: (p: ProgresoAnalisis) => void,
    rotacionOverride?: number,
  ): Promise<Acta> {
    const fotoOriginal = acta.fotoOriginal;
    if (!fotoOriginal) {
      return Promise.reject(new Error("SIN FOTO ORIGINAL PARA RECORTAR"));
    }
    const rotacion = rotacionOverride ?? acta.rotation ?? 0;
    let vencido = false; // tras el timeout no se emite más progreso (§5)
    const emitir = (p: ProgresoAnalisis) => {
      if (!vencido) onProgreso?.(p);
    };

    return new Promise<Acta>((resolve, reject) => {
      const timer = setTimeout(() => {
        vencido = true;
        // §5: el timeout NO rechaza la Promise — resuelve el acta RECHAZADA
        // controlada (el toast sale del flujo normal del store).
        resolve({
          ...acta,
          score: 0,
          status: "RECHAZADA",
          rechazo: { tipo: "ILEGIBLE", detalle: DETALLE_TIMEOUT },
          firmas: this.firmasPorStatus(acta.firmas, "RECHAZADA"),
        });
      }, TIMEOUT_MS);

      void this.pipelineRecorte(acta, fotoOriginal, quad, rotacion, emitir).then(
        (actaNueva) => {
          if (vencido) return; // ya resolvió el timeout: el resultado se descarta
          clearTimeout(timer);
          resolve(actaNueva);
        },
        (error) => {
          if (vencido) return;
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error("ERROR DE PIPELINE"));
        },
      );
    });
  }

  /** Pipeline §5 del RECORTE (sin decode/detección: la foto y el quad ya son
   *  conocidos). Reusa los helpers del pipeline L2 (conRampa, scoreDeCalidad,
   *  PATRON_CABECERA) y el mapeo §4.1 + gate §4.2 idénticos. */
  private async pipelineRecorte(
    acta: Acta,
    fotoOriginal: string,
    quad: Quad,
    rotacion: number,
    emitir: (p: ProgresoAnalisis) => void,
  ): Promise<Acta> {
    const ms = { proceso: 0, calidad: 0, ocr: 0, total: 0 };
    const inicio = performance.now();
    // F2/D36: el recorte conserva el filtro del acta (default del producto "bw").
    const filtro: PageFilter = acta.filtro ?? "bw";

    // 1) Recorte + realce (warp real INTER_CUBIC + filtro del acta, F5-MANUAL).
    emitir({ etapa: "RECORTANDO", progreso: 0.2 });
    const tProceso = performance.now();
    const resultado = await conRampa(
      processImage(fotoOriginal, quad, filtro, rotacion, { manual: true }),
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

    // 2) Calidad de la página (sobre el crudo — misma regla §5 paso 4).
    emitir({ etapa: "CALIDAD", progreso: 0 });
    const tCalidad = performance.now();
    const calidad = await evaluateQuality(fotoOriginal);
    ms.calidad = performance.now() - tCalidad;
    emitir({ etapa: "CALIDAD", progreso: 1 });

    // 3) OCR sobre la PROCESADA + gate §4.2 (progreso real 0→1).
    const tOcr = performance.now();
    const texto = await requestOcr(fotoProcesada, (p) => {
      emitir({ etapa: "OCR", progreso: Math.min(1, Math.max(0, p)) });
    });
    ms.ocr = performance.now() - tOcr;
    emitir({ etapa: "OCR", progreso: 1 });
    ms.total = performance.now() - inicio;

    const motor = resultado.precision?.engine ?? "canvas";

    // 4) Mapeo §4 → status/score/rechazo (idéntico al escaneo).
    const score = scoreDeCalidad(calidad);
    const legible = ocrTextIsValid(texto) && PATRON_CABECERA.test(texto);
    const status: ActaStatus = legible ? statusDeScore(score) : "RECHAZADA";

    console.info(
      `[e14] recorte ${acta.fuente} total=${Math.round(ms.total)}ms ` +
        `(proceso=${Math.round(ms.proceso)} calidad=${Math.round(ms.calidad)} ` +
        `ocr=${Math.round(ms.ocr)} motor=${motor} legible=${legible} score=${score} ` +
        `filtro=${filtro} ` +
        `metricas={sharpness:${calidad.sharpness} brightness:${calidad.brightness} ` +
        `contrast:${calidad.contrast} level:${calidad.level}})`,
    );

    // Acta ACTUALIZADA: identidad intacta (spread), campos reales nuevos y
    // rechazo LIMPIO si el rescate mejora el estado (D20). F4/D37: la
    // rotación usada queda HORNEADA (rotation) — la respeta el PDF §6 y un
    // eventual re-recorte/filtrado.
    return {
      ...acta,
      fotoProcesada,
      quadDetectado: quad,
      rotation: rotacion,
      ocrTexto: texto,
      metricas: {
        sharpness: calidad.sharpness,
        brightness: calidad.brightness,
        contrast: calidad.contrast,
      },
      motor,
      score,
      status,
      rechazo: !legible
        ? { tipo: "ILEGIBLE", detalle: DETALLE_ILEGIBLE }
        : status === "RECHAZADA"
          ? { tipo: "GENERICO", detalle: DETALLE_GENERICO }
          : null,
      firmas: this.firmasPorStatus(acta.firmas, status),
    };
  }

  /**
   * F2 (§F2.2, D36) — FILTRO: re-procesa la foto con el filtro elegido,
   * IGUAL que setFilterOnPage del core (apps/scanner-lab/src/components/
   * scanner/…/store.ts L644-669): SOLO processImage — sin re-OCR, sin
   * re-calidad (el gate ya resolvió). Devuelve el acta con fotoProcesada y
   * filtro actualizados. Sin timeout: es un ÚNICO processImage con fallback
   * canvas (misma exposición al cuelgue que tiene el lab aquí — documentado
   * en worklog como ADAPTACIÓN de la opción «timeout 15 s» del spec).
   */
  async revelar(acta: Acta, filtro: PageFilter): Promise<Acta> {
    const fotoOriginal = acta.fotoOriginal;
    if (!fotoOriginal) {
      throw new Error("SIN FOTO ORIGINAL PARA FILTRAR");
    }
    // Fuente: apps/scanner-lab/…/store.ts L644-669 (setFilterOnPage) —
    // processImage(original, quad, filter, rotation, { manual }).
    const resultado = await processImage(
      fotoOriginal,
      acta.quadDetectado ?? defaultQuad(),
      filtro,
      acta.rotation ?? 0,
      { manual: true },
    );
    return { ...acta, fotoProcesada: resultado.processed, filtro };
  }

  /**
   * F-OCR del lab (EditorView.tsx L1360-1395): corre requestOcr sobre la
   * imagen PROCESADA del acta y devuelve el texto crudo.
   * ADAPTACIÓN documentada: el lab elige imagen con prioridad
   * `preview ?? procesada-fresca ?? original` (L1373-1376) porque tiene
   * previewCache; en e14 la procesada SIEMPRE está fresca (todo cambio pasa
   * por el pipeline) → se usa fotoProcesada directa. El guard `previewLoading`
   * (L1364-1370) NO aplica (no hay preview en e14) → omitido. Sin timeout
   * extra (igual que el lab L1379 — requestOcr se gobierna solo).
   */
  async reconocerTexto(acta: Acta): Promise<string> {
    const fotoProcesada = acta.fotoProcesada;
    if (!fotoProcesada) {
      throw new Error("SIN FOTO PROCESADA PARA RECONOCER TEXTO");
    }
    return requestOcr(fotoProcesada);
  }

  /** Firmas coherentes con el estado (misma regla del mock/§7.5):
   *  ADVERTENCIA → firma 2 TENUE · RECHAZADA → NO_DETECTADO · resto OK. */
  private firmasPorStatus(firmas: ActaFirma[], status: ActaStatus): ActaFirma[] {
    if (firmas.length < 2) return firmas;
    const estadoFirma2: ActaFirma["estado"] =
      status === "ADVERTENCIA" ? "TENUE" : status === "RECHAZADA" ? "NO_DETECTADO" : "OK";
    return firmas.map((f, i) => (i === 1 ? { ...f, estado: estadoFirma2 } : { ...f }));
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
      // F2/D36: default del producto (types.ts L50 del core) — toda captura
      // nace en B/N adaptativo (Fuente: CameraView.tsx L602-604 del lab).
      filtro: "bw" as PageFilter,
    };
  }

  async exportarPdf(acta: Acta): Promise<void> {
    // §6 — export real con el core tal cual: adaptador Acta→ScanDocument +
    // buildDocPdf (solo lee pages[i].processed y filter; el resto es relleno
    // compatible con la interfaz congelada) + downloadBlob.
    const foto = acta.fotoProcesada;
    if (!foto) {
      throw new Error("SIN FOTO REAL PARA EXPORTAR");
    }
    const t = Date.now();
    const calidad: PageQuality = acta.metricas
      ? makeQuality(acta.metricas.sharpness, acta.metricas.brightness, acta.metricas.contrast)
      : excellentQuality();
    const doc: ScanDocument = {
      id: acta.id,
      title: `${acta.titulo} — MESA ${acta.ubicacion.mesa}`,
      favorite: false,
      createdAt: t,
      updatedAt: t,
      pages: [
        {
          id: `${acta.id}-p1`,
          original: acta.fotoOriginal ?? foto,
          processed: foto,
          thumbnail: foto,
          // F2/D36: el PDF se genera con el filtro del acta (default "bw").
          filter: (acta.filtro ?? "bw") as PageFilter,
          quad: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
          ],
          rotation: ((acta.rotation ?? 0) % 360) as 0 | 90 | 180 | 270,
          quality: calidad,
          ocrDone: Boolean(acta.ocrTexto),
          createdAt: t,
        },
      ],
    };
    const { pdf } = await buildDocPdf(doc, "standard");
    const blob = pdf.output("blob");
    downloadBlob(blob, `${sanitizeFileName(doc.title)}.pdf`);
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
