# 🔧 FIX v4 — Cámara negra tras el aviso «Cámara lenta»: recuperación del stream + disparo a prueba de colgados

> **Documento de ejecución recuperable.** Si el contexto/la sesión se corta,
> este archivo contiene TODO lo necesario para continuar: el plan, las
> decisiones tomadas y el estado de cada punto. Fuente: instrucciones v4 del
> propietario (`INSTRUCCIONES-FIX-camara-negra-v4.md`, entregadas por chat).
>
> **Rama:** `fix/camera-black-recovery-v4` (base: `main` = v3 mergeado +
> registro — ver §Decisiones punto 6) · **Alcance:** solo
> `apps/scanner-lab` + `packages/scanner-core`. `apps/digitalizador-e14`
> COMPLETAMENTE intocado. Todos los cambios en
> `apps/scanner-lab/src/components/scanner/CameraView.tsx`.
>
> **Síntoma reportado por el propietario:** en algunos dispositivos, al
> capturar aparece el toast «Cámara lenta: baja resolución esta vez» y después
> **la captura nunca se muestra (el editor no abre) y la cámara se queda en
> negro para siempre**.

## Los 5 defectos (diagnóstico de las instrucciones, verificado en código)

| # | Defecto | Antes |
|---|---|---|
| 1 | Doble intento de `takePhoto` = **16 s congelado** | `takePhotoBlob`: 8 s + reintento de 8 s |
| 2 | Obturador **habilitado** durante todo el disparo | `onShutter` solo miraba `processingRef` (se activa DESPUÉS del disparo) |
| 3 | Track muerto en silencio → **negro permanente sin recuperación** | solo el evento `ended` re-arrancaba; un track `muted`/sin frames NUNCA lo dispara |
| 4 | Burst 100 % nulo → segundo toast y **el editor jamás abre** | `dispatchBestFrame`: solo `toast.error` |
| 5 | Ring ZSL a resolución completa (1920×1440 en iOS) → **presión de memoria** que mata la capa de video | 8 slots ≈ 88 MB + scratch ~11 MB a 5 Hz |

## Estado de ejecución — ✅ TODO COMPLETADO (orden aplicado: 4.1 → 4.2 → 4.3 → 4.4 → 4.5 → 4.6)

| Fix | Qué | Estado |
|---|---|---|
| 4.1 | `takePhotoBlob`: timeout 8→**5 s**, `attempt` devuelve `{blob, err, timedOut}`, reintento SOLO si falló **rápido** (timeout = sensor colgado, no se reintenta), lista negra `takePhotoBrokenRef` (mientras esté marcada, `captureSmart` salta `takePhotoBlob` directo al fallback) | ✅ |
| 4.2 | `capturingRef` + estado `isCapturing` + `try/finally` SIMÉTRICO en todo el disparo; `onShutter` corta con `capturingRef \|\| processingRef`; botón `disabled={processing \|\| isCapturing}` + `opacity-60` sin `active:scale-90` mientras captura | ✅ |
| 4.3 | **Watchdog de salud**: `isStreamDead()` (track nulo / `readyState ≠ live` / `muted` / video sin datos) evaluado cada 2 s mientras `status === "live"`, **2 strikes consecutivos** → `recoverStream()`; chequeo **post-timeout** en `captureSmart`; gracia de 8 s al arrancar; sin strikes durante disparo o recuperación | ✅ |
| 4.4 | `dispatchBestFrame` con frames 100 % nulos: si `isStreamDead()` → `recoverStream()` (antes: solo toast y el editor jamás abría — el final exacto del síntoma) | ✅ |
| 4.5 | `RING_MAX_LONG_SIDE = 1280`: copias del ring escaladas (pushRingFrame) + scratch a medida escalada (feedRingFromVideo); `snapshotVideo` INTACTO (resolución del track). Presupuesto: ≤ 8 × (1280×960×4) ≈ 37 MB | ✅ |
| 4.6 | Toast honesto: con ImageCapture presente y foto caída → «**La foto de alta resolución no respondió** / Se usó el fotograma de vista previa. Las próximas capturas irán directas.» (veraz por la lista negra). Sin ImageCapture + frame <1280 px conserva «Cámara lenta» | ✅ |
| — | Rehabilitación de la lista negra: stream nuevo (`applyStream`, `retryRealCamera`) o `takePhoto` que vuelve a responder → `takePhotoBrokenRef = false` | ✅ |

## Verificación ejecutada (evidencia)

Entorno: dev server puerto 3005 + Chromium headless (CDP) con cámara falsa
(`--use-fake-device-for-media-stream`). Mediciones page-precise (timestamp
dentro de la página, sin latencia del harness).

1. ✅ `bunx tsc --noEmit` en `packages/scanner-core` → 0 errores.
2. ✅ `bunx tsc --noEmit` en `apps/scanner-lab` → 0 errores.
3. ✅ `bun run lint` (scanner-lab, ESLint) → 0 errores.
4. ✅ **Criterio 1 — takePhoto colgado** (parche
   `ImageCapture.prototype.takePhoto = () => new Promise(()=>{})`):
   el fallback (dispatch del fotograma, medido con hook en `toBlob`) cae a
   **5014-5197 ms** (criterio ≤5500; ANTES ~16000 por el doble intento de 8 s),
   **un solo toast** honesto y el editor abre con el fotograma.
5. ✅ **Criterio 1b — lista negra**: 2º disparo en la misma sesión de cámara
   (encode parchado a fallo para no salir de la vista): tap1 = 5014 ms (hang),
   tap2 = **21 ms** (directo al fallback; habría sido ~5300 sin la lista
   negra). El flujo se queda en cámara y ambos intentos informan con toast.
6. ✅ **Criterio 2 — track muerto en silencio** (`track.stop()` por consola:
   NO dispara `ended` — exactamente la muerte silenciosa): toast
   «Reiniciando cámara…» a **3636 ms** (criterio ≤6000) y el stream se
   reabre solo (video `960×540 track=live` verificado tras la recuperación).
   **No existe el negro permanente.**
7. ✅ **Criterio 3 — toques repetidos**: 5 taps al obturador durante el hang
   (0/150/300/450/600 ms) → **UN solo flujo de captura** (1 toast honesto,
   el editor abre una vez). El resto se corta en `onShutter`/`capturingRef`
   y el botón queda `disabled` con feedback visual.
8. ✅ **Criterio 5 — funcionamiento normal**: 12 s de visor live sin NINGÚN
   reinicio del watchdog (0 falsos positivos; video `readyState=4`
   estable); captura manual sin parches → editor abre (500 ms) con hilo
   vivo y consola limpia.
9. ⏳ **Criterio 5 (parte iPhone) — PENDIENTE EN DISPOSITIVO REAL** (no
   simulable en sandbox): memoria del ring a 1920×1440 con LRU 6, jetsam en
   5 capturas seguidas, disparo manual nativo (`input capture`).

### Hallazgo adversativo honesto: hang FLAKY del editor (PRE-EXISTENTE, no regresión v4)

En el sandbox headless+cámara-falsa, el flujo captura→editor a veces deja
el hilo principal ocupado (los `eval` dejan de responder) DESPUÉS de abrir
el editor. Test A/B con 6 iteraciones por versión:

| Versión | hang | OK real | sin cámara |
|---|---|---|---|
| `main` (sin v4) | 3/6 | 1/6 | 2/6 |
| `fix/camera-black-recovery-v4` | 3/6 | 2/6 | 1/6 |

**Estadísticamente idéntico → el defecto PRE-EXISTE en main y NO es una
regresión de este fix.** Solo se observó en el entorno de prueba
(headless sin GPU + frames del dispositivo fake); los criterios del fix se
verificaron con mediciones page-precise que no dependen de ese estado.
**Recomendación:** investigar por separado (candidato: pipeline de preview
del editor con frames sintéticos / animaciones framer-motion en headless;
en el log de consola aparece un warning «script tag while rendering React
component» ×5 que conviene rastrear también).

## Decisiones de implementación (desviaciones conscientes de la letra)

1. **`runCaptureFlow` separado + wrapper `captureSmart`** (4.2): en vez de
   re-indentar todo el cuerpo dentro de `try/finally`, el flujo completo
   vive en `runCaptureFlow` y `captureSmart` es un wrapper fino con el
   guard (`capturingRef`) y el `finally` que SIEMPRE libera. Mismo
   comportamiento, diff legible, cero riesgo de romper la indentación del
   cuerpo.
2. **Toast honesto (4.6) se muestra siempre que `canTakePhotoRef` es true y
   la foto cayó al frame** (incluido el caso lista-negra-salteada): es la
   lectura literal de la instrucción y la frecuencia es la misma que la del
   texto viejo en Android (el stream 540p <1280 disparaba el toast en cada
   fallback). En iOS (sin ImageCapture) se conserva el condicional por
   resolución.
3. **Rehabilitación de la lista negra**: la instrucción dice «si algún
   takePhoto futuro vuelve a funcionar, resetear». Como `captureSmart`
   salta `takePhotoBlob` mientras está marcada, los puntos de
   rehabilitación son: (a) blob válido (defensivo), (b) stream nuevo —
   `applyStream`/`retryRealCamera`. NOTA de producto: hoy cada captura
   exitosa abre el editor y la vuelta re-monta CameraView (nuevo stream →
   blacklist reseteada de todos modos); la protección opera en los
   reintentos DENTRO de una misma sesión de cámara (dispatch fallido que
   no abre el editor — exactamente el caso probado en la verificación 5).
4. **Watchdog con gracia de 8 s + no cuenta strikes durante `capturingRef`**:
   el video tarda en reproducir tras abrir el stream (falsos positivos al
   arranque) y algunos sensores pausan el preview durante `takePhoto`.
   La instrucción pedía 2 comprobaciones consecutivas; la gracia es una
   adición defensiva documentada.
5. **`recoverStream` re-dispara el efecto de apertura existente**
   (`setCamRestartNonce`) en vez de reescribirlo: el efecto ya maneja
   cascada completa + sintética. `recoveringRef` (4 s) evita bucles.
6. **Rama base `main` en vez de `fix/scanner-lab-editor-quality`**: la
   instrucción decía «desde ella», pero v3 YA está mergeada en main y main
   añade el commit de registro de docs (`153e303`); ramificar desde la rama
   v3 haría que el PR revirtiera esos docs. `main` ⊇ v3 → misma base
   técnica sin el problema.

## Qué NO se cambió (verificado)

- Regla E3: `getUserMedia` solo `ideal` (el `facingMode exact` del 1er
  intento ya existía y se conserva).
- DUAL PIPELINE: disparo manual iOS vía `input capture` nativo intacto.
- Stream alto iOS 1920×1440 y `PROCESSED_MAX_LONG_SIDE = 4032` (v3) intactos.
- `apps/digitalizador-e14`: ni una línea (diff del PR: 0 archivos).
- Escalera de respaldo del PDF y el resto del fix v3.
- `snapshotVideo` a resolución del track (la captura iOS no se degrada).

## Mapa de cambios en `CameraView.tsx`

```
constantes     ← RING_MAX_LONG_SIDE = 1280 (módulo)
refs/estado    ← capturingRef, isCapturing, recoveringRef, takePhotoBrokenRef
isStreamDead() ← salud del stream (track/video) — la condición del watchdog
recoverStream()← para tracks + setStatus idle + nonce → re-apertura
takePhotoBlob  ← 5 s, {blob, timedOut}, reintento solo si falla rápido,
                 marca/desmarca lista negra
runCaptureFlow ← (antes captureSmart) — con chequeo post-timeout (4.3),
                 toast honesto (4.6), dispatchBestFrame con recuperación (4.4)
captureSmart   ← wrapper: guard capturingRef + try/finally + setIsCapturing
onShutter      ← corta con capturingRef || processingRef
pushRingFrame  ← copia escalada ≤1280 (4.5)
feedRingFromVideo ← scratch a medida escalada ≤1280 (4.5)
watchdog effect← cada 2 s, 2 strikes, gracia 8 s, sin strikes al disparar
applyStream /  ← takePhotoBrokenRef = false (stream nuevo)
retryRealCamera
shutter (JSX)  ← disabled={processing || isCapturing} + opacity-60
```

## Cómo continuar si la sesión se corta

1. `cd /home/z/web-scanner && git status` — la rama
   `fix/camera-black-recovery-v4` contiene el fix completo (ver
   `git diff main`).
2. Este documento es la fuente de verdad del estado. Los 6 fixes están
   implementados y verificados (tsc, lint, E2E con mediciones page-precise).
3. Pendiente externo: QA en dispositivo real (iPhone: memoria/jetsam del
   ring a 1920×1440, disparo nativo) y la investigación del hang flaky
   pre-existente del editor en sandbox (ver §Hallazgo adversativo).
