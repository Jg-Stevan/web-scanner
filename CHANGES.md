# CHANGES — Mejoras de cámara, rendimiento y filtros

> Delta sobre el upstream `Jg-Stevan/web-scanner` (rama `main`).
> Todos los cambios están verificados con `eslint`, `tsc --noEmit` y pruebas E2E en navegador (flujo completo: onboarding → biblioteca → cámara con detección OpenCV → captura manual y automática → editor con filtros → exportar PDF → persistencia IndexedDB), sin errores de consola.
> Rama de trabajo local: `fix/camera-stabilizer-perf`.

## 0. FIX v3 — Calidad del editor WYSIWYG + presentación iOS + benchmark fuera (rama `fix/scanner-lab-editor-quality`)

**Regla del propietario:** "guardar la captura en lo máximo del lente, sin ajustes por benchmark". Documentación completa del fix (plan, decisiones, evidencia de verificación): `apps/scanner-lab/docs/fix-editor-quality-v3.md`.

**Cambios:**

- **Tope técnico ÚNICO exportado** — `PROCESSED_MAX_LONG_SIDE = 4032` px (`image-processor.ts`, antes module-private). Preview del editor (2 usos) y guardado (4 llamadas de `processImage` en `store.ts`) usan LA MISMA constante → **WYSIWYG estricto por construcción** (verificado: chip == `naturalWidth/Height` del preview).
- **Benchmark F-DEVBENCH ELIMINADO** — `device-capability.ts` borrado, su UI ("Rendimiento del dispositivo") fuera de Ajustes (queda fila estática "Resolución de procesado — 4032 px"), `setWarpCap(4032)` fijo, key `escaner-device-cap-v1` limpiada al arrancar, `rg` de todos los identificadores → 0 resultados. La protección de sensores gigantes (48/108 MP) del `sensor-profiler` se CONSERVA (`overCap`, `buildCappedPhotoSettings`, `clampBlobToSafeCap`); `getSensorSafeCap()` ahora devuelve 4032 fijo y el campo `tier` desaparece de `SensorProfile`.
- **Rotar sin degradar (F-ROT-RAPID + calidad)** — la rotación rápida solo marca `processed/processedKey` si la imagen conserva la resolución objetivo (`min(4032, máx(aristas del quad en px del original))`, tolerancia 0.9 — misma geometría que `warpQuadToCanvas`); si no, el store **reprocesa a tope al guardar**. Defensa extra en la rama `processedValid` del merge (`processedMeetsTarget`): una procesada materialmente inferior al objetivo jamás llega al documento como "final" (red de seguridad contra 3200/2600 heredados).
- **iPhone: stream de auto-captura 1920×1440** — `IDEAL_PREVIEW_*` condicionado a la ausencia de `ImageCapture` (proxy iOS): los originales de la auto-captura pasan de 960 px (0.5 MP) a ≥1920 px. El disparo manual sigue por cámara nativa (12 MP). El ORIGINAL ya no se re-escala a tope de gama (downscale a 4032 fijo). Toast "Cámara lenta" solo si el frame es realmente bajo (<1280 px).
- **Presentación fullscreen (bug iOS)** — wrapper de tamaño DEFINITIVO (`h-full w-full`, antes altura auto: iOS Safari no resolvía el `max-height:100%` y la foto desbordaba recortada), `clampPan`/`clampZoomPan` con la fórmula correcta `(imgW×s − stageW)/2` (fin del sobre-paneo con huecos negros — verificado pixel-perfect: 75.61 px medidos vs 75.6 teóricos), `presentationPages` se construye AL ABRIR con lectura fresca de la caché (antes un `useMemo` que leía un ref mostraba la foto ORIGINAL sin recortar en páginas no visitadas) y `will-change` solo durante el gesto (rasterizado iOS).
- **PDF "standard" a tamaño completo de serie** — `ATTEMPTS_STANDARD[0] = { longSide: 0, quality: 0.9 }` (antes recortaba a 2600 px aunque la página fuera de 4032); la escalera por presupuesto de bytes se mantiene como respaldo.
- **Chip "Se guardará: {calidad} · {WxH} px"** en el editor (transparencia WYSIWYG) con drawer Estándar/Alta/Máxima (mismo patrón que el sheet de Filtros, cambia `settings.exportQuality` sin salir del editor).
- **LRU de previews 12 → 6 entradas** — mitigación de memoria obligatoria al procesar todo a 4032 (entradas de ~el doble; mismo presupuesto total, sin riesgo de jetsam en sesiones largas).

**Verificado:** `tsc` core + app, `eslint`, y E2E en navegador (Ajustes sin benchmark, chip WYSIWYG con dimensiones exactas, rotación que conserva resolución, clamp de paneo pixel-perfect, merge al salir, captura → guardar). Pendiente: QA en iPhone Safari físico (bug 1.1 solo visible ahí).

---

## Resumen de commits

| # | Commit | Título |
|---|--------|--------|
| 1 | `3392064` | fix(cámara): estabilizador de quietud + throttling adaptativo + buffer ZSL anti tap-shock |
| 2 | `2f98475` | feat(cámara): Dual Pipeline — preview ligero + captura full-sensor |
| 3 | `27bb731` | perf(scanner): preview dual-pipeline v2 — 960×540 + fps cap 30, foto intacta vía takePhoto |
| 4 | `b4e1aa2` | feat(sensor): sensor-profiler con tope seguro 4032/3200px por gama |
| 5 | `740f7a2` | fix(scanner): F-TEXT-CLEAN — filtro Texto claro sin ruido amplificado, halos de croma ni unsharp global |

---

## 1. Estabilizador + rendimiento del bucle de frames (gama baja y alta)

**Problema:** el obturador automático se disparaba en ~120–150 ms mientras la mano aún acomodaba el teléfono (falsa detección en gama alta), y el bucle de detección saturaba CPU/GPU en gama baja (stuttering y calentamiento).

**Cambios:**

- **NUEVO `src/lib/scanner/motion-stabilizer.ts`** — clase `MotionStabilizer` sobre `DeviceMotion`:
  - Umbrales: aceleración 1.25 m/s² y rotación 14 °/s.
  - Compuerta de quietud `isDeviceStable(280)`: exige 280 ms de quietud antes de autorizar disparo.
  - Degradación elegante donde no hay sensor (desktop).
- **`src/lib/scanner/quality.ts`** — `shouldTriggerShutter` exige ahora una **ventana sostenida ≥ 260 ms** entre la primera y la última muestra k-de-n; elimina el disparo prematuro.
- **`src/lib/scanner/frame-loop.ts`** — **throttling dinámico adaptativo**: cadencia base 65 ms que se relaja +15 ms al saturar y se recupera −3 ms cuando hay holgura (tope 200 ms); reset en `start()`; el estabilizador se integra y destruye en `stop()`.
- **`src/components/scanner/CameraView.tsx`** — **buffer ZSL (Zero Shutter Lag)** de 8 frames con canvas + laplacian variance + timestamp, alimentado a ~5 Hz con canvas scratch reutilizado (sin stuttering adicional):
  - Captura MANUAL: el ganador por `lapVar` entre 80–450 ms **antes** del tap sustituye a la foto del impacto (anti *tap-shock* — el dedo mueve el teléfono en el instante de disparar).
  - Captura AUTO conserva el flujo foto-first.

**Resultado medido:** captura manual nítida incluso con sacudida de tap; auto-captura estable en gama alta; cadencia adaptativa evita el calentamiento en gama baja.

---

## 2. Dual Pipeline — preview ligero + captura a resolución de sensor

**Problema:** un solo `getUserMedia` servía para todo; subir la resolución del preview para mejorar la foto mataba la fluidéz del visor en gama baja.

**Cambios en `src/components/scanner/CameraView.tsx`:**

- **Pilar 1 — Preview:** constantes `IDEAL_PREVIEW_WIDTH/HEIGHT` (1280×720 en v1, **960×540 + `frameRate: { ideal: 30 }` en v2**) aplicadas en las 3 rutas `getUserMedia` (cascada `facingMode`, apertura por `deviceId`, CTA de reintento). El tope es **suave** (`ideal`): no rechaza cámaras solo-60fps.
- **Pilar 2 — Foto:** `takePhotoBlob` documentado e intacto como vía al sensor físico vía `ImageCapture.takePhoto()` (12–48 MP), con la carrera anti-cuelgue de 8 s ya existente.
- `captureSmart` reestructurado: el ganador ZSL pre-tap pasa a ser el **fallback premium** cuando `takePhoto` no existe o cuelga — compite por `lapVar` en `dispatchBestFrame` con los snapshots del canvas.
- **Bug crítico corregido:** `takeZslFallback` liberaba TODOS los canvases del ring incluido el ganador antes de devolverlo → encode 0×0 fallaba y la captura se perdía. Ahora se libera el ring **excepto** el ganador.

**Por qué bajar el preview no afecta la calidad:** el loop de detección remuestrea siempre a 400 px (análisis OpenCV intacto), y la foto final sale del sensor vía `takePhoto`. El fallback ZSL/snapshot opera a 960 px, suficiente para su rol.

**Resultado:** ~44 % menos píxeles por frame de decodificado (frente a 720p) y hasta la mitad de cadencia en equipos que negociaban 60 fps — más fluidéz y menos calor, con la foto a resolución completa del sensor.

---

## 3. Sensor Profiler — tope de captura por gama (PASO 2 del plan de adaptación)

**Problema:** `takePhoto()` disparaba **sin tope** — en sensores de 48/108 MP devolvía ~12000×9000 y el flujo decodificaba el blob ENTERO (~432 MB RGBA) antes del downscale. Riesgo real de crash de pestaña en gama media/baja.

**Cambios:**

- **NUEVO `src/lib/scanner/sensor-profiler.ts`**:
  - `profileSensor(track)`: lee `ImageCapture.getPhotoCapabilities()` (carrera 2 s, degradación elegante en Safari) → perfil `{nativeW/H, ranges, overCap, safeCapPx}`.
  - Tope por **gama** desde el benchmark real de `device-capability` (4032 px alta / 3200 px media-baja, cache 7 días).
  - `buildCappedPhotoSettings()`: genera `{imageWidth, imageHeight}` preservando aspecto, clamped a min/max/step de la spec; `undefined` si el sensor ya está bajo el tope (captura nativa directa, sin re-escalar).
  - `clampBlobToSafeCap()`: red de seguridad post-decode — solo recarta si el blob excede el tope (JPEG 0.92, `bitmap.close()` disciplinado).
- **Integración en `CameraView.tsx`**: `profileActiveSensor()` en `applyStream` y en el reintento; `takePhotoBlob` intenta `takePhoto(photoSettings)` → reintento sin settings si el hardware los rechaza → `clampBlobToSafeCap`. El blob gigante **jamás se decodifica** (capa 1 en el ISP) o se recarta una sola vez (capa 2). El downscale de `handleCaptureDataUrl` usa el tope por gama (tercera red).

**Resultado en dispositivos reales:** sensor ≤4032 px → foto nativa directa; 48/108 MP → el ISP escala en la captura a 4032 (alta) o 3200 (media/baja); si el hardware ignora el ajuste, el clamp post-decode recorta una vez.

---

## 4. Filtro «Texto claro» (default del producto) — F-TEXT-CLEAN

**Problemas en el pipeline anterior:**
1. División `gainW = ink/grayS` con tope 4 × `APPLY_FACTOR_MAX` 8 amplificaba ruido en sombras.
2. `applyModelAndGainToRgba` clampeaba cada canal RGB por separado → virajes amarillo/magenta.
3. Unsharp global previo (worker OpenCV y fallback) ensuciaba el papel antes del filtro.
4. Parámetros agresivos (0.85 / 1.8 / 0.72 / 0.2).

**Cambios:**

- **`src/lib/scanner/image-modes.ts`**:
  - Constantes estabilizadas `TEXT_CLARO_*`: 0.95 / 1.45 / 0.82 / 0.15.
  - Nueva rama `mode === "text"`: **LUT sigmoidal de 256 entradas** (`textTargetLumaLut` — papel ≥0.82 → smoothstep a blanco; tinta `(v/0.82)^1.45` con rodilla en black point 0.15), **afilado edge-aware** (`edgeAwareSharpenGray`: solo bordes con grad>25 y c<240 — el papel nunca se toca) y **reconstrucción cromática uniforme** (`rebuildRgbaWithChroma`: escala `tgt/luma`, sin clamp por canal).
  - LUT idéntica matemáticamente al `Math.pow` por píxel pero **más rápida** (≈90 ms vs 114 ms en 480k px) y con `opts.textPivot` respetado.
  - **Guardas anti-fosforitos** (`F-TEXT-CLEAN`): fade de croma a neutro para tgt>`TEXT_CHROMA_FADE_START`(200) y tope de amplificación de croma `TEXT_CHROMA_MAX_GAIN`(1.5). La tinta de color queda intacta.
- **`src/lib/scanner/image-processor.ts` + `public/scanner/detection-worker.js`**: el unsharp global se omite en `mode === "text"` en AMBOS motores; la rama `text` del worker está espejada byte a byte con el fallback (verificado con evaluación sandbox del bloque + comparación de 27.648 bytes, 0 diffs).

**Resultado medido (baterías sobre docs sintéticos con ground-truth):**

| Métrica | Pipeline viejo | Pipeline nuevo |
|---|---|---|
| Píxeles fosforitos (croma>20) | 5.421 px | **0 px** |
| Halos de croma (frontera blanco) | 21,03 % | **1,18 %** |
| Bolígrafo azul | aplastado a negro | `rgb(53,67,154)` preservado |
| Sello rojo | aplastado a negro | `rgb(144,34,37)` preservado |
| Fondo (captura real 1800×2420) | — | 97,2 % blanco puro, tinta 0,65 % |

---

## 5. Infra / config

> **Nota de integración (revisión pre-push):** `next.config.ts`, `eslint.config.mjs`
> y `package.json` NO cambiaron en este lote — `output: "standalone"`,
> `images.unoptimized`, `allowedDevOrigins`, los ignores de `public/vendor/` y
> `public/scanner/`, y las dependencias `heic2any`/`jspdf` ya estaban en `main`
> (commit v6 `a000ad9`). No hay delta de infraestructura más allá de lo listado abajo.

- **`.gitignore`**: artefactos de sesión/distribución (`public/**/*.zip`, `/tool-results`, `dev.log`).
- **Eliminado** `public/downloads/web-scanner-repo.zip` (6.5 MB committeado por error; ahora cubierto por el ignore).

## Archivos tocados

```
NUEVOS      src/lib/scanner/motion-stabilizer.ts
NUEVOS      src/lib/scanner/sensor-profiler.ts
NUEVOS      CHANGES.md
MODIFICADOS src/components/scanner/CameraView.tsx
MODIFICADOS src/lib/scanner/quality.ts
MODIFICADOS src/lib/scanner/frame-loop.ts
MODIFICADOS src/lib/scanner/image-modes.ts
MODIFICADOS src/lib/scanner/image-processor.ts
MODIFICADOS public/scanner/detection-worker.js
MODIFICADOS .gitignore
ELIMINADO   public/downloads/web-scanner-repo.zip (artefacto de 6.5 MB)
```

## Cómo validar en local

```bash
bun install
bun run dev        # abrir en móvil (HTTPS requerido para cámara/DeviceMotion)
# Flujo: onboarding → cámara → captura manual (ZSL) / auto (compuertas) → editor (filtros) → PDF
```

## Notas conocidas (preexistentes, fuera de alcance)

- El aplanado de regiones oscuras GRANDES (sello grande lavado a blanco) es comportamiento del modelo de sombras del worker OpenCV, común a ambos pipelines y anterior a estos cambios.
