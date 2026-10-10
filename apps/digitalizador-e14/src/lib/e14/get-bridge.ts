/**
 * PUNTO ÚNICO DE INTERCAMBIO (SPEC §2): conectar el core real mañana
 * significa tocar SOLO este archivo — las vistas no se enteran.
 * FASE LÓGICA L2 (§3.3, D17): se inyecta el RealCoreBridge (pipeline §5).
 * UX-REAL F1 (D35): SIMULACIÓN ahora también pasa por el real — el
 * MockBridge se retiró (la fuente carga el acta E-14 incluida).
 */
import { CompositeBridge, type E14Bridge } from "./bridge";
import { RealCoreBridge } from "./scanner-core-bridge";

let instancia: E14Bridge | null = null;

export function getBridge(): E14Bridge {
  if (!instancia) {
    instancia = new CompositeBridge(new RealCoreBridge());
  }
  return instancia;
}
