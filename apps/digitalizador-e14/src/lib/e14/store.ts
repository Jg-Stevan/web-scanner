/**
 * Estado global (zustand): vista activa, acta en revisión, mesas, progreso,
 * historial, conexión y notificaciones flotantes. Toda la data nace del
 * bridge (D1) — las vistas nunca tocan el bridge directamente.
 */
import { create } from "zustand";
import { getBridge } from "./get-bridge";
import type { PaginaObjetivo, Forzado } from "./bridge";
import type { Acta, HistorialRow, Mesa, TipoPagina } from "./types";
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
  /** Resultado que forzará el próximo escaneo (panel de simulación §7.1). */
  forzado: Forzado;
  actasSesion: number;
  mesas: Mesa[];
  completadas: number;
  asignadasHoy: number;
  colaOffline: number;
  solicitudesRescaneo: number;
  historial: HistorialRow[];
  notificaciones: Notificacion[];

  navegar: (vista: Vista) => void;
  setForzado: (forzado: Forzado) => void;
  alternarConexion: () => void;
  dispararEscaneo: (intento?: number) => void;
  analisisCompletado: () => void;
  enviarActa: () => void;
  repetirFoto: () => void;
  enviarRevisionHumana: () => void;
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
    forzado: "ALEATORIO",
    actasSesion: 0,
    mesas: mesasIniciales(),
    completadas: progresoInicial().completadas,
    asignadasHoy: progresoInicial().asignadasHoy,
    colaOffline: COLA_OFFLINE_INICIAL,
    solicitudesRescaneo: SOLICITUDES_RESCANEO_INICIAL,
    historial: historialInicial(),
    notificaciones: [],

    navegar: (vista) => set({ vista }),

    setForzado: (forzado) => set({ forzado }),

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

    dispararEscaneo: (intento = 1) => {
      const { forzado, mesas } = get();
      const objetivo = proximaPagina(mesas);
      const acta = bridge.escanearActa({ objetivo, forzado, intento, maxIntentos: 2 });
      set({
        actaActual: acta,
        paginaObjetivo: objetivo,
        actasSesion: get().actasSesion + 1,
        vista: "analizando",
      });
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
      }
      set({ vista: "revision" });
    },

    enviarActa: () => {
      const { actaActual } = get();
      if (!actaActual || actaActual.status !== "ADVERTENCIA") {
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
      get().dispararEscaneo(intento);
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

    descartarNotificacion: (id) =>
      set({ notificaciones: get().notificaciones.filter((n) => n.id !== id) }),
  };
});
