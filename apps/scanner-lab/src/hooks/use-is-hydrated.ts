"use client";

import { useSyncExternalStore } from "react";

/**
 * True solo tras la hidratación en el cliente (false en SSR y durante el
 * primer render de hidratación). Sustituye al patrón clásico
 * «useEffect + setState(mounted)» sin disparar renders en cascada
 * (regla react-hooks/set-state-in-effect) — useSyncExternalStore con una
 * suscripción vacía es la forma recomendada de leer "estamos en cliente".
 */
const emptySubscribe = () => () => {};

export function useIsHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}
