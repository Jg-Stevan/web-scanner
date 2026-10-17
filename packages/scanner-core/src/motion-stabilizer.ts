/**
 * src/lib/scanner/motion-stabilizer.ts
 * Estabilizador de inercia y compuerta de quietud para web-scanner.
 */
/** Registro de pestaña (export * desde index.ts): los consumers importan
 *  { MotionStabilizer, requestMotionPermission }. */
let motionPermissionAsked = false;

/** COMP-2 (lote8) — permiso iOS 13+ para DeviceMotionEvent: sin
 *  requestPermission() concedido desde UN GESTO del usuario, los eventos
 *  nunca llegan y el gate de quietud queda en no-op (lastAcc=0 siempre).
 *  Un SOLO intento por sesión; el fallo conserva el modo actual (no-op
 *  permisible, igual que desktop). Llamar desde el handler directo del
 *  gesto (tap del obturador / CTA) — NUNCA en load sin gesto. */
export async function requestMotionPermission(): Promise<boolean> {
  if (motionPermissionAsked) return false;
  motionPermissionAsked = true;
  try {
    const dme =
      typeof window !== "undefined"
        ? (window.DeviceMotionEvent as unknown as {
            requestPermission?: () => Promise<string>;
          } | undefined)
        : undefined;
    if (dme && typeof dme.requestPermission === "function") {
      const state = await dme.requestPermission();
      return state === "granted";
    }
    return false;
  } catch {
    /* permiso denegado / sin gesto: modo actual (no-op permisible) */
    return false;
  }
}

export class MotionStabilizer {
  private lastAcc = 0;
  private lastRot = 0;
  private isListening = false;
  private stableSince = performance.now();
  private maxAllowedAcc = 1.25; // m/s² (umbral de temblor)
  private maxAllowedRot = 14.0; // deg/s (rotación angular de muñeca)

  constructor() {
    this.init();
  }

  public init(): void {
    if (typeof window === "undefined" || this.isListening) return;
    try {
      window.addEventListener("devicemotion", this.handleMotion, { passive: true });
      this.isListening = true;
    } catch {
      /* DeviceMotion no soportado (desktop / permiso denegado): sin escucha */
    }
  }

  public destroy(): void {
    if (typeof window === "undefined" || !this.isListening) return;
    window.removeEventListener("devicemotion", this.handleMotion);
    this.isListening = false;
  }

  private handleMotion = (e: DeviceMotionEvent): void => {
    const acc = e.acceleration;
    if (acc) {
      const x = acc.x ?? 0;
      const y = acc.y ?? 0;
      const z = acc.z ?? 0;
      this.lastAcc = Math.hypot(x, y, z);
    }
    const rot = e.rotationRate;
    if (rot) {
      const a = rot.alpha ?? 0;
      const b = rot.beta ?? 0;
      const g = rot.gamma ?? 0;
      this.lastRot = Math.hypot(a, b, g);
    }

    if (this.lastAcc > this.maxAllowedAcc || this.lastRot > this.maxAllowedRot) {
      this.stableSince = performance.now(); // Reinicia la ventana si hubo movimiento
    }
  };

  /**
   * Verifica si el dispositivo ha permanecido quieto durante al menos `minQuiescenceMs`
   */
  public isDeviceStable(minQuiescenceMs = 280): { stable: boolean; acc: number; rot: number; calmMs: number } {
    const calmMs = performance.now() - this.stableSince;
    const stable = calmMs >= minQuiescenceMs && this.lastAcc <= this.maxAllowedAcc;
    return { stable, acc: this.lastAcc, rot: this.lastRot, calmMs };
  }
}
