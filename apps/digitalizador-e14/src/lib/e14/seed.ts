/**
 * Seed EXACTO de los diseños (SPEC §6.4) — el primer render de ACTAS y
 * RESUMEN debe calcar los mocks del zip v2.
 */
import type { HistorialRow, Mesa, ProgresoPuesto } from "./types";

/** MESA 01 COMPLETADA · MESA 02 EN PROCESO · MESA 03 PENDIENTE (§6.4). */
export function mesasIniciales(): Mesa[] {
  return [
    {
      id: "MESA 01",
      estado: "COMPLETADA",
      progresoPct: 100,
      paginas: [
        { tipo: "DELEGADOS", pagina: 1, estado: "OK" },
        { tipo: "DELEGADOS", pagina: 2, estado: "OK" },
        { tipo: "TRANSMISIÓN", pagina: 1, estado: "OK" },
        { tipo: "TRANSMISIÓN", pagina: 2, estado: "RESCANEO" },
      ],
    },
    {
      id: "MESA 02",
      estado: "EN_PROCESO",
      progresoPct: 50,
      paginas: [
        { tipo: "DELEGADOS", pagina: 1, estado: "OK" },
        { tipo: "DELEGADOS", pagina: 2, estado: "EN_PROCESO" },
        { tipo: "TRANSMISIÓN", pagina: 1, estado: "PENDIENTE" },
        { tipo: "TRANSMISIÓN", pagina: 2, estado: "PENDIENTE" },
      ],
    },
    {
      id: "MESA 03",
      estado: "PENDIENTE",
      progresoPct: 0,
      paginas: [
        { tipo: "DELEGADOS", pagina: 1, estado: "PENDIENTE" },
        { tipo: "DELEGADOS", pagina: 2, estado: "PENDIENTE" },
        { tipo: "TRANSMISIÓN", pagina: 1, estado: "PENDIENTE" },
        { tipo: "TRANSMISIÓN", pagina: 2, estado: "PENDIENTE" },
      ],
    },
  ];
}

/** 12 asignadas / 9 completadas → "PROGRESO DEL PUESTO: 75%" (§6.4). */
export function progresoInicial(): ProgresoPuesto {
  return { asignadasHoy: 12, completadas: 9 };
}

export const COLA_OFFLINE_INICIAL = 3; // "03 PENDIENTES EN COLA (OFFLINE)"
export const SOLICITUDES_RESCANEO_INICIAL = 1; // "01 SOLICITUD DE RESCANEO"

/** Historial del mock (§6.4) — "ÚLT. ACT.: 14:32". */
export function historialInicial(): HistorialRow[] {
  return [
    {
      id: "h-1",
      titulo: "MESA 01 — TRANSMISIÓN P2",
      estado: "RESCANEO_REQUERIDO",
      hora: "14:32",
    },
    {
      id: "h-2",
      titulo: "MESA 02 — DELEGADOS P2",
      estado: "ENVIADO",
      hora: "14:28",
    },
    {
      id: "h-3",
      titulo: "MESA 01 — DELEGADOS P1",
      estado: "ENVIADO",
      hora: "14:21",
    },
  ];
}

/** Datos fijos del acta mock (los diseños siempre muestran el mismo acta). */
export const ACTA_MOCK = {
  titulo: "ROMA - CONSULADO",
  departamento: "CONSULADOS",
  municipio: "ROMA",
  zona: "10",
  puesto: "02",
  tipo: "SENADO DE LA REPÚBLICA",
  codigoBarras: "*E14-SEN-2026-001*",
  candidatos: [
    { codigo: "101", votos: 25 },
    { codigo: "102", votos: 42 },
    { codigo: "103", votos: 18 },
    { codigo: "104", votos: 30 },
  ],
  firmas: [
    { nombre: "C. Gomez", jurado: "JURADO 1" },
    { nombre: "L. Rossi", jurado: "JURADO 2" },
    { nombre: "M. Torres", jurado: "JURADO 3" },
  ],
} as const;
