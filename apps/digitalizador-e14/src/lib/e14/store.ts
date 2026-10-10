/**
 * Estado global (zustand): vista activa, acta en revisión, mesas, progreso,
 * historial, conexión y notificaciones flotantes. Toda la data nace del
 * bridge (D1) — las vistas nunca tocan el bridge directamente.
 */
import { create } from "zustand";
import { getBridge } from "./get-bridge";
import { rotateProcessedDataUrl } from "./image-utils";
import { FILTER_PRESETS } from "@jg-stevan/scanner-core/types";
import type { PageFilter } from "@jg-stevan/scanner-core/types";
import type { PaginaObjetivo } from "./bridge";
import type { Acta, FuenteCaptura, HistorialRow, Mesa, ProgresoAnalisis, TipoPagina } from "./types";
import type { Quad } from "@jg-stevan/scanner-core/types";
import {
  COLA_OFFLINE_INICIAL,
  SOLICITUDES_RESCANEO_INICIAL,
  historialInicial,
  mesasIniciales,
  progresoInicial,
} from "./seed";

export type Vista = "escanear" | "analizando" | "revision" | "actas" | "resumen";

export interface Notificacion {
  id: number;
  tone: "ok" | "warn" | "crit";
  titulo: string;
  descripcion?: string;
}

interface E14Store {
  vista: Vista;
  online: boolean;
  actaActual: Acta | null;
  /** Página de mesa apuntada por el escaneo en curso (D7). */
  paginaObjetivo: PaginaObjetivo | null;
  /** Fuente de captura del próximo escaneo (D35: SIMULACIÓN = pipeline real). */
  fuente: FuenteCaptura;
  /** Archivo elegido para la fuente ARCHIVO (L2 lo consume). */
  archivoPendiente: File | null;
  /** Video vivo de la fuente CÁMARA (L3: grab del frame si el disparo no trae foto). */
  framePendiente: HTMLVideoElement | null;
  /** Último evento de progreso del pipeline (alimenta ANALIZANDO, §7.2). */
  progresoAnalisis: ProgresoAnalisis | null;
  /** true cuando el pipeline resolvió (piso escénico D16 de ANALIZANDO). */
  analisisResuelto: boolean;
  /** L5 §7.5: true mientras el bridge re-corre el pipeline del RECORTE. */
  recortando: boolean;
  /** F2 §F2.2: true mientras el bridge re-procesa la foto con un filtro. */
  revelando: boolean;
  actasSesion: number;
  mesas: Mesa[];
  completadas: number;
  asignadasHoy: number;
  colaOffline: number;
  solicitudesRescaneo: number;
  historial: HistorialRow[];
  notificaciones: Notificacion[];

  navegar: (vista: Vista) => void;
  setFuente: (fuente: FuenteCaptura) => void;
  setArchivoPendiente: (archivo: File | null) => void;
  /** Registra el <video> vivo de la cámara (null al detener el stream). */
  setFramePendiente: (frame: HTMLVideoElement | null) => void;
  /** Toast flotante genérico (L2: aviso CÁMARA→L3 del chip de fuente; L3 lo reusa para permisos). */
  notificar: (tone: Notificacion["tone"], titulo: string, descripcion?: string) => void;
  alternarConexion: () => void;
  dispararEscaneo: (intento?: number) => Promise<void>;
  analisisCompletado: () => void;
  enviarActa: () => void;
  repetirFoto: () => void;
  enviarRevisionHumana: () => void;
  /** L4 §6: exporta el acta REAL (fotoProcesada) a PDF vía buildDocPdf del core. */
  exportarPdfActa: () => Promise<void>;
  /**
   * L5 §7.5 (rescate D20): aplica el recorte manual del QuadEditor —
   * bridge.recortar re-ejecuta el pipeline con el quad manual (F5-MANUAL) y
   * NO consume intento. F4/D37: `rotacionNueva` hornea la rotación LOCAL
   * del editor (undefined = conserva acta.rotation). Toast según resultado.
   */
  aplicarRecorte: (quad: Quad, rotacionNueva?: number) => Promise<void>;
  /**
   * F2 (§F2.2, D36): cambia el filtro del acta — bridge.revelar re-procesa
   * la foto (SOLO processImage, sin re-OCR/re-calidad — igual que
   * setFilterOnPage del core) y el toast copia el texto del lab (L1214-1218).
   */
  cambiarFiltro: (filtro: PageFilter) => Promise<void>;
  /**
   * L5 §7 ReviewView: gira fotoProcesada 90° (rotateProcessedDataUrl del lab,
   * canvas puro) y hornea rotation para el PDF §6. Gate: foto (D35 — la
   * SIMULACIÓN también rota real).
   */
  rotarFoto: () => Promise<void>;
  descartarNotificacion: (id: number) => void;
}

/** Siguiente página a escanear: EN_PROCESO > PENDIENTE > RESCANEO (por mesa). */
function proximaPagina(mesas: Mesa[]): PaginaObjetivo | null {
  const prioridad: Record<string, number> = { EN_PROCESO: 0, PENDIENTE: 1, RESCANEO: 2, OK: 9 };
  let mejor: { mesaId: string; tipo: TipoPagina; pagina: 1 | 2; prio: number } | null = null;
  for (const mesa of mesas) {
    for (const p of mesa.paginas) {
      const prio = prioridad[p.estado] ?? 9;
      if (prio < 9 && (!mejor || prio < mejor.prio)) {
        mejor = { mesaId: mesa.id, tipo: p.tipo, pagina: p.pagina, prio };
      }
    }
  }
  return mejor ? { mesaId: mejor.mesaId, tipo: mejor.tipo, pagina: mejor.pagina } : null;
}

/** Recalcula progresoPct y estado de una mesa tras un cambio de página. */
function recalcularMesa(mesa: Mesa): Mesa {
  const noPendientes = mesa.paginas.filter((p) => p.estado !== "PENDIENTE").length;
  const enProceso = mesa.paginas.some((p) => p.estado === "EN_PROCESO");
  const pendientes = mesa.paginas.some((p) => p.estado === "PENDIENTE");
  const progresoPct = Math.round((noPendientes / mesa.paginas.length) * 100);
  const estado = pendientes || enProceso ? "EN_PROCESO" : "COMPLETADA";
  return { ...mesa, progresoPct, estado: estado as Mesa["estado"] };
}

function hashMock(): string {
  const hex = Array.from({ length: 12 }, () =>
    "0123456789abcdef"[Math.floor(Math.random() * 16)],
  ).join("");
  return `${hex}…`;
}

let idNotificacion = 0;

/** Guard anti doble-rotación (espejo del rotatingRef del lab L1054 — la
 *  rotación rápida es async y un doble tap giraría 180°). */
let rotandoFotoEnVuelo = false;

export const useE14Store = create<E14Store>((set, get) => {
  const bridge = getBridge();

  const notificar = (tone: Notificacion["tone"], titulo: string, descripcion?: string) => {
    idNotificacion += 1;
    const noti: Notificacion = { id: idNotificacion, tone, titulo, descripcion };
    set({ notificaciones: [...get().notificaciones.slice(-2), noti] });
  };

  const registrarEnvio = (tituloPagina: string) => {
    const { online, historial, completadas, mesas, paginaObjetivo, actaActual } = get();
    const hora = bridge.horaHistorial();
    const fila: HistorialRow = {
      id: `h-${Date.now()}`,
      titulo: tituloPagina,
      estado: "ENVIADO",
      hora,
    };
    let colaOffline = get().colaOffline;
    let hash: string;
    if (online) {
      hash = hashMock();
    } else {
      colaOffline += 1;
      hash = "EN COLA";
    }
    const mesasActualizadas = paginaObjetivo
      ? mesas.map((m) =>
          m.id === paginaObjetivo.mesaId
            ? recalcularMesa({
                ...m,
                paginas: m.paginas.map((p) =>
                  p.tipo === paginaObjetivo.tipo && p.pagina === paginaObjetivo.pagina
                    ? { ...p, estado: "OK" }
                    : p,
                ),
              })
            : m,
        )
      : mesas;
    set({
      historial: [fila, ...historial],
      completadas: Math.min(completadas + 1, get().asignadasHoy),
      colaOffline,
      mesas: mesasActualizadas,
      actaActual: actaActual ? { ...actaActual, hashSha256: hash } : actaActual,
    });
    return { online, hora };
  };

  const tituloPaginaActual = (): string => {
    const { paginaObjetivo } = get();
    if (!paginaObjetivo) return "MESA 01 — TRANSMISIÓN P1";
    const p = paginaObjetivo.pagina === 1 ? "P1" : "P2";
    return `${paginaObjetivo.mesaId} — ${paginaObjetivo.tipo} ${p}`;
  };

  return {
    vista: "escanear",
    online: true,
    actaActual: null,
    paginaObjetivo: null,
    fuente: "SIMULACION",
    archivoPendiente: null,
    framePendiente: null,
    progresoAnalisis: null,
    analisisResuelto: false,
    recortando: false,
    revelando: false,
    actasSesion: 0,
    mesas: mesasIniciales(),
    completadas: progresoInicial().completadas,
    asignadasHoy: progresoInicial().asignadasHoy,
    colaOffline: COLA_OFFLINE_INICIAL,
    solicitudesRescaneo: SOLICITUDES_RESCANEO_INICIAL,
    historial: historialInicial(),
    notificaciones: [],

    navegar: (vista) => set({ vista }),

    setFuente: (fuente) => set({ fuente }),

    setArchivoPendiente: (archivo) => set({ archivoPendiente: archivo }),

    setFramePendiente: (frame) => set({ framePendiente: frame }),

    notificar,

    alternarConexion: () => {
      const { online, colaOffline, actaActual } = get();
      if (online) {
        set({ online: false });
        notificar("warn", "MODO OFFLINE", "Los envíos se acumularán en cola local.");
      } else {
        set({ online: true });
        if (colaOffline > 0) {
          set({
            colaOffline: 0,
            actaActual:
              actaActual && actaActual.hashSha256 === "EN COLA"
                ? { ...actaActual, hashSha256: hashMock() }
                : actaActual,
          });
          notificar("ok", "COLA SINCRONIZADA", `${colaOffline} envíos transmitidos al servidor.`);
        } else {
          notificar("ok", "CONEXIÓN RESTABLECIDA");
        }
      }
    },

    dispararEscaneo: async (intento = 1) => {
      const { mesas, fuente, archivoPendiente, framePendiente } = get();
      // L2: en fuente ARCHIVO el disparo necesita imagen (REPETIR FOTO vuelve
      // al picker en vez de reventar el pipeline sin archivo).
      if (fuente === "ARCHIVO" && !archivoPendiente) {
        notificar("warn", "ELIGE UNA IMAGEN", "La fuente IMPORTAR analiza la imagen que elijas.");
        set({ vista: "escanear" });
        return;
      }
      // L3: la fuente CÁMARA necesita una captura (foto ZSL/nativa ya en el
      // store) o el video vivo para el grab del frame. REPETIR FOTO vuelve al
      // visor (la cámara se reinicia al reactivar la vista) — espejo de D23.
      if (fuente === "CAMARA" && !archivoPendiente && !framePendiente) {
        notificar("warn", "CAPTURA UNA FOTO", "La fuente CÁMARA analiza la foto que toma el obturador.");
        set({ vista: "escanear" });
        return;
      }
      const objetivo = proximaPagina(mesas);
      set({
        vista: "analizando",
        actaActual: null,
        progresoAnalisis: null,
        analisisResuelto: false,
      });
      try {
        const acta = await bridge.escanearActa({
          objetivo,
          intento,
          maxIntentos: 2,
          fuente,
          archivo: archivoPendiente ?? undefined,
          frameActual: fuente === "CAMARA" ? framePendiente : undefined,
          onProgreso: (p) => set({ progresoAnalisis: p }),
        });
        set({
          actaActual: acta,
          paginaObjetivo: objetivo,
          actasSesion: get().actasSesion + 1,
          analisisResuelto: true,
          archivoPendiente: null,
        });
      } catch {
        // Manejo de error del pipeline (§7 store): nunca quedar en analizando.
        notificar("crit", "ERROR DE PROCESADO", "No se pudo analizar la imagen.");
        set({ vista: "escanear", progresoAnalisis: null, analisisResuelto: false });
      }
    },

    analisisCompletado: () => {
      const { actaActual } = get();
      if (!actaActual) return;
      // D4: ÓPTIMA (≥8) se envía automáticamente al capturar.
      if (actaActual.status === "OPTIMA") {
        const hora = bridge.horaEnvio();
        const { online } = registrarEnvio(tituloPaginaActual());
        set({
          actaActual: {
            ...get().actaActual!,
            status: "ENVIADA",
            enviadoAutomaticamente: hora,
          },
          vista: "revision",
        });
        if (!online) {
          notificar("warn", "EN COLA (OFFLINE)", "El envío se transmitirá al reconectar.");
        }
        return;
      }
      if (actaActual.status === "RECHAZADA") {
        const fila: HistorialRow = {
          id: `h-${Date.now()}`,
          titulo: tituloPaginaActual(),
          estado: "RESCANEO_REQUERIDO",
          hora: bridge.horaHistorial(),
        };
        set({
          solicitudesRescaneo: get().solicitudesRescaneo + 1,
          historial: [fila, ...get().historial],
        });
        notificar(
          "crit",
          "ACTA NO RECONOCIDA",
          `Score ${actaActual.score.toFixed(1)}/10 — obligatorio repetir foto.`,
        );
      }
      set({ vista: "revision" });
    },

    enviarActa: () => {
      const { actaActual } = get();
      // D20 (L5): envío MANUAL para ADVERTENCIA y también para ÓPTIMA tras un
      // rescate por recorte (el auto-envío D4 solo dispara al capturar — el
      // rescate nunca se auto-envía, evita la doble transmisión).
      if (
        !actaActual ||
        (actaActual.status !== "ADVERTENCIA" && actaActual.status !== "OPTIMA")
      ) {
        return;
      }
      registrarEnvio(tituloPaginaActual());
      set({
        actaActual: { ...get().actaActual!, status: "ENVIADA" },
        vista: "revision",
      });
      const { online } = get();
      if (online) {
        notificar("ok", "ENVIADO CORRECTAMENTE", "Acta transmitida y verificada.");
      } else {
        notificar("warn", "EN COLA (OFFLINE)", "El envío se transmitirá al reconectar.");
      }
    },

    repetirFoto: () => {
      const { actaActual } = get();
      const intento = (actaActual?.intento ?? 0) + 1;
      void get().dispararEscaneo(intento);
    },

    enviarRevisionHumana: () => {
      const { actaActual } = get();
      if (!actaActual) return;
      const fila: HistorialRow = {
        id: `h-${Date.now()}`,
        titulo: tituloPaginaActual(),
        estado: "REVISION_HUMANA",
        hora: bridge.horaHistorial(),
      };
      set({
        actaActual: { ...actaActual, status: "EN_REVISION_HUMANA" },
        historial: [fila, ...get().historial],
      });
      notificar("warn", "ENVIADA A REVISIÓN HUMANA", "Un auditor validará esta acta.");
    },

    exportarPdfActa: async () => {
      const { actaActual } = get();
      if (!actaActual?.fotoProcesada) {
        notificar("warn", "SIN FOTO REAL", "Solo las actas escaneadas se exportan.");
        return;
      }
      try {
        await bridge.exportarPdf(actaActual);
        notificar("ok", "PDF GENERADO", "Acta exportada y descargada.");
      } catch {
        notificar("crit", "ERROR DE EXPORTACIÓN", "No se pudo generar el PDF del acta.");
      }
    },

    aplicarRecorte: async (quad, rotacionNueva) => {
      const { actaActual } = get();
      if (!actaActual?.fotoOriginal) {
        notificar("warn", "SIN FOTO ORIGINAL", "Solo las actas escaneadas se pueden recortar.");
        return;
      }
      if (get().recortando) return;
      set({ recortando: true, progresoAnalisis: null });
      try {
        // RecorTE manual → pipeline §5 re-ejecutado con F5-MANUAL; el acta
        // conserva identidad (intento/fuente/paginación) — rescate sin intento.
        // F4/D37: la rotación LOCAL del editor se hornea en fotoProcesada.
        const acta = await bridge.recortar(
          actaActual,
          quad,
          (p) => set({ progresoAnalisis: p }),
          rotacionNueva,
        );
        set({ actaActual: acta, progresoAnalisis: null });
        if (acta.status === "OPTIMA" || acta.status === "ADVERTENCIA") {
          notificar("ok", "ACTA RECUPERADA", "LISTA PARA ENVÍO MANUAL");
        } else {
          notificar("warn", "SIGUE RECHAZADA", `SCORE ${acta.score.toFixed(1)}/10 — prueba otro recorte o repite la foto.`);
        }
      } catch {
        notificar("crit", "ERROR DE RECORTADO", "No se pudo re-procesar el acta.");
      } finally {
        set({ recortando: false });
      }
    },

    rotarFoto: async () => {
      const { actaActual } = get();
      // Actas con foto procesada (D35: SIMULACIÓN también — el gate es la foto;
      // F-ROT-RAPID gira la PROCESADA sin re-ejecutar el pipeline).
      if (!actaActual?.fotoProcesada) return;
      if (rotandoFotoEnVuelo) return;
      rotandoFotoEnVuelo = true;
      try {
        // F-ROT-RAPID del lab (L1080): gira la PROCESADA sin re-ejecutar el
        // pipeline; la rotación queda HORNEADA (rotation += 90) para que el
        // PDF §6 y un eventual re-recorte la respeten.
        const { url } = await rotateProcessedDataUrl(actaActual.fotoProcesada, 90);
        set({
          actaActual: {
            ...actaActual,
            fotoProcesada: url,
            rotation: ((actaActual.rotation ?? 0) + 90) % 360,
          },
        });
      } catch {
        notificar("crit", "ERROR DE ROTACIÓN", "No se pudo girar la foto.");
      } finally {
        rotandoFotoEnVuelo = false;
      }
    },

    cambiarFiltro: async (filtro) => {
      const { actaActual } = get();
      if (!actaActual?.fotoOriginal) {
        notificar("warn", "SIN FOTO ORIGINAL", "Solo las actas escaneadas se pueden filtrar.");
        return;
      }
      if (get().revelando) return;
      set({ revelando: true });
      try {
        // F2/D36: revelar = SOLO processImage (sin re-OCR/re-calidad — igual
        // que setFilterOnPage del core); el acta conserva identidad por spread.
        const acta = await bridge.revelar(actaActual, filtro);
        set({ actaActual: acta });
        // Fuente: apps/scanner-lab/src/components/scanner/EditorView.tsx L1214-1218
        // (handleFilter — toast de éxito + cierre del sheet; el sheet lo cierra ReviewView).
        const label = FILTER_PRESETS.find((f) => f.id === filtro)?.label ?? filtro;
        notificar("ok", "FILTRO APLICADO", `Filtro aplicado: ${label}`);
      } catch {
        notificar("crit", "ERROR DE FILTRADO", "No se pudo re-procesar el acta.");
      } finally {
        set({ revelando: false });
      }
    },

    descartarNotificacion: (id) =>
      set({ notificaciones: get().notificaciones.filter((n) => n.id !== id) }),
  };
});
