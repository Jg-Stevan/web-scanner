/**
 * PUNTO ÚNICO DE INTERCAMBIO (SPEC §2): conectar el core real mañana
 * significa tocar SOLO este archivo — las vistas no se enteran.
 */
import { MockBridge, type E14Bridge } from "./bridge";

let instancia: E14Bridge | null = null;

export function getBridge(): E14Bridge {
  if (!instancia) {
    instancia = new MockBridge();
  }
  return instancia;
}
