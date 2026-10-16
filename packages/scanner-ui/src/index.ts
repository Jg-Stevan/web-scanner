/* @jg-stevan/scanner-ui — capa React de la base de digitalización.
   REGLA (inversa del core): SOLO componentes React puros (props + callbacks).
   Prohibido: lógica de motor (vive en @jg-stevan/scanner-core), fetch de red,
   stores globales, y NADA electoral (E-14, votos, mesa, DIVIPOL).
   Este paquete es la BASE replicable a otros proyectos. */
export { ZoomableVisor } from "./ZoomableVisor";
export type { ZoomableVisorProps } from "./ZoomableVisor";
