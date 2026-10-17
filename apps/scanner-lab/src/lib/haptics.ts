/**
 * DRY-6 (Lote 9) — feedback háptico de confirmación ÚNICO.
 * Patrón [28, 60, 28] (kit DRY-6): vibración corta-pausa-corta usada al
 * confirmar acciones (guardar documento, completar onboarding).
 * Guard: navigator.vibrate puede no existir (iOS Safari lo ignora sin
 * error en algunos contexts; el optional-chaining cubre el resto).
 */
// `as const` en vez del tipo DOM `VibratePattern`: eslint no-undef no conoce
// los tipos ambientales de DOM en archivos .ts (mismo fenómeno que
// PerformanceObserverInit en perf-probe) — así el helper sale con CERO warnings.
const CONFIRM_PATTERN = [28, 60, 28] as const;

/** Vibración de confirmación (no-op silencioso si el dispositivo no vibra). */
export function hapticConfirm(): void {
  try {
    navigator.vibrate?.(CONFIRM_PATTERN);
  } catch {
    /* el haptic NUNCA rompe la app */
  }
}
