/**
 * PUNTO ÚNICO DE INTERCAMBIO (SPEC §2): conectar el core real mañana
 * significa tocar SOLO este archivo — las vistas no se enteran.
 * FASE LÓGICA L1 (§3.3, D17): CompositeBridge(null) — SIMULACIÓN delega en
 * el mock actual; L2 inyectará aquí el RealCoreBridge para CAMARA/ARCHIVO.
 */
import { CompositeBridge, type E14Bridge } from "./bridge";

let instancia: E14Bridge | null = null;

export function getBridge(): E14Bridge {
  if (!instancia) {
    instancia = new CompositeBridge(null);
  }
  return instancia;
}
