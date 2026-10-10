# 🔧 FIX v3 — Calidad del editor + presentación iOS + eliminación del benchmark

> **Documento de ejecución recuperable.** Si el contexto/la sesión se corta,
> este archivo contiene TODO lo necesario para continuar: el plan, las
> decisiones tomadas y el estado de cada punto. Fuente: instrucciones v3 del
> propietario (`INSTRUCCIONES-FIX-scanner-lab.md`, entregadas por chat).
>
> **Rama:** `fix/scanner-lab-editor-quality` · **Alcance:** solo
> `apps/scanner-lab` + `packages/scanner-core` · **`apps/digitalizador-e14`
> COMPLETAMENTE intocado** (v3.1 — corrección de alcance por orden expresa del
> propietario tras el push inicial).
>
> **ESTADO: ✅ COMPLETADO Y VERIFICADO** (tsc core/app/lint/browser smoke test).

## Regla del propietario (innegociable)

**"Guardar la captura en lo máximo del lente, sin ajustes por benchmark."**

- Único tope técnico: `PROCESSED_MAX_LONG_SIDE = 4032` px de lado mayor
  (máximo seguro del canvas de iOS, ~16.7 MP). Para lentes ≤12 MP **es la
  resolución nativa del sensor**.
- Preview del editor y guardado usan LA MISMA constante → WYSIWYG estricto.
- Se ELIMINA el benchmark de dispositivo (F-DEVBENCH) y su UI.
- Se CONSERVA la protección de sensores gigantes (48/108/200 MP) del
  sensor-profiler (`overCap`, `buildCappedPhotoSettings`, `clampBlobToSafeCap`).
- Mitigación de memoria al subir todo a 4032: caché LRU de previews 12 → 6.

## Orden de aplicación (de las instrucciones)

`2.1 → 2.2 → 4 (4.1-4.5) → 3.A → 3.B → 1.x → 2.3/2.4`

## Estado de ejecución — ✅ TODO COMPLETADO

| Paso | Qué | Archivos | Estado |
|---|---|---|---|
| 2.1 | Exportar `PROCESSED_MAX_LONG_SIDE`; unificar preview (2 usos) y guardado (4 calls en store) | `image-processor.ts`, `store.ts`, `EditorView.tsx` | ✅ |
| 2.2 | Rotar sin degradar: solo marcar `processed/processedKey` si la rotada está a resolución objetivo + defensa en rama `processedValid` del store (`processedMeetsTarget`) | `EditorView.tsx`, `store.ts` | ✅ |
| 4.1 | `getSensorSafeCap()` → 4032 fijo; sin import de device-capability; campo `tier` fuera de `SensorProfile` | `sensor-profiler.ts` | ✅ |
| 4.2 | `setWarpCap(PROCESSED_MAX_LONG_SIDE)` fijo; sin medición en idle; `localStorage.removeItem("escaner-device-cap-v1")` | `page.tsx` | ✅ |
| 4.3 | `DeviceSection` fuera + fila estática "Resolución de procesado — 4032 px" en Procesamiento | `SettingsView.tsx` | ✅ |
| 4.4 | `device-capability.ts` BORRADO + re-export fuera de `index.ts`; `rg` → **0 resultados** | core | ✅ |
| 4.5 | LRU previews 12 → 6 + comentario de presupuesto de memoria | `EditorView.tsx` | ✅ |
| 3.A | Stream iOS 1920×1440 (`IDEAL_PREVIEW_*` condicionado a `!HAS_IMAGE_CAPTURE`) + toast "Cámara lenta" solo si `videoWidth < 1280` | `CameraView.tsx` | ✅ |
| 3.B | `downscaleImage(decoded, PROCESSED_MAX_LONG_SIDE)` — nunca tope de gama sobre la fuente | `CameraView.tsx` | ✅ |
| 1.1 | Wrapper presentación `h-full w-full` + `imgRef` nuevo | `PresentationView.tsx` | ✅ |
| 1.2 | `clampPan`: `(imgW×s − stageW)/2` midiendo `<img>` vs stage | `PresentationView.tsx` | ✅ |
| 1.3 | `clampZoomPan` del editor: misma fórmula contra el stage | `EditorView.tsx` | ✅ |
| 1.4 | `presentationPages`: estado + `openPresentation()` con lectura FRESCA de la caché (no `useMemo` con ref) | `EditorView.tsx` | ✅ |
| 1.5 | `willChange: transform` solo ampliado (zoom > 1×) en ambos views | `PresentationView.tsx`, `EditorView.tsx` | ✅ |
| 2.3 | `ATTEMPTS_STANDARD[0] = { longSide: 0, quality: 0.9 }` (tamaño completo de serie) | `pdf-export.ts` | ✅ |
| 2.4 | Chip "Se guardará: {calidad} · {WxH} px" + drawer Estándar/Alta/Máxima (vaul, patrón Filtros) | `EditorView.tsx` | ✅ |

## Verificación ejecutada (evidencia)

1. ✅ `bunx tsc --noEmit` en `packages/scanner-core` → 0 errores.
2. ✅ `bunx tsc --noEmit` en `apps/scanner-lab` → 0 errores.
3. ✅ `bun run lint` (scanner-lab, ESLint) → 0 errores.
4. ✅ `e14:check` → mismo error PREEXISTENTE de siempre
   (`@/assets/acta-e14-real.jpg` sin declaración de tipos — verificado con
   `git stash` que existe en el commit base; NO lo causó este fix).
5. ✅ `rg -n "device-capability|DeviceCapability|getMaxProcessedLongSide|ensureDeviceCapability|measureDeviceCapability|getCachedDeviceCapability" apps/scanner-lab packages` → **0 resultados**.
   (Nota v3.1: en `apps/digitalizador-e14/docs/SPEC-fase-logica.md` queda 1
   mención doc obsoleta a `getMaxProcessedLongSide()` — e14 está fuera de
   alcance por orden del propietario y NO se toca.)
6. ✅ Smoke test navegador (dev server puerto 3005, headless):
   - App arranca; onboarding → biblioteca sin errores de consola.
   - **Ajustes**: "Rendimiento del dispositivo" DESAPARECIDO; fila estática
     "Resolución de procesado — 4032" presente.
   - **Modo documento** (Recibo de servicios): editor abre; chip
     "Se guardará: Máxima · hasta 4032 px"; drawer cambia calidad
     (Estándar/Alta/Máxima + toast + chip actualizado al instante).
   - **Presentación** (fix 1.1/1.2/1.5): imagen contenida SIN overflow;
     zoom teclado/ratón OK; **clamp pixel-perfect**: imagen 200px a escala
     2.8561 → límite teórico (571.2−420)/2 = 75.6 px → transform medido
     `translateX(75.61px)` EXACTO; eje menor (457 < 542) → paneo vertical
     0; imagen menor que el stage → paneo 0 (antes: sobre-paneo de 69px con
     huecos). Escape cierra.
   - **Rotar** (fix 2.2): 1753×2357 → 2357×1753 (ejes intercambiados,
     resolución conservada); chip sincronizado al instante.
   - **WYSIWYG** (fix 2.1): chip "Máxima · 1753×2357 px" ==
     `img.naturalWidth/Height` EXACTOS del preview.
   - **Merge al salir** (fix 2.2 store): atrás = auto-guardado sin errores.
   - **Captura nueva** (sintética) → editor → Guardar PDF → biblioteca
     "7 documentos · 9 páginas" (+1 doc). Cero errores en dev.log.
7. ⏳ **PENDIENTE EN DISPOSITIVO REAL (no verificable en sandbox):**
   - iPhone Safari real: Tarea 1.1 (bug de maquetación WebKit), auto-captura
     con originales ≥1920 px (3.A), 5 capturas seguidas sin jetsam (LRU 6).
   - La sonda `__sensorProfile().safeCapPx === 4032` en cualquier dispositivo.

## Decisiones de implementación (desviaciones conscientes de la letra de las instrucciones)

1. **Chequeo de calidad geométrico (2.2).** La instrucción da la fórmula literal
   `rotatedLong >= 4032 * 0.98`, pero un recorte normal (documento que llena
   ~85-95% del encuadre) produce procesadas de ~3400-3700 px A MÁXIMA calidad —
   la fórmula literal las marcaría "degradadas" y forzaría reprocesos inútiles
   al guardar. **Decisión:** el objetivo se calcula como
   `min(4032, max(aristas del quad en px del original))` — la MISMA fórmula que
   `warpQuadToCanvas` usa para el tamaño de salida (`w0=max(|TL→TR|,|BL→BR|)`,
   `h0=max(|TR→BR|,|TL→BL|)`, tope sin upscalar) — con tolerancia 0.9 (shrink
   3.5px del worker + redondeos). Una fuente menor (auto-captura iOS 1920 px)
   no puede dar 4032 y NO cuenta como degradada. Casos que sí detecta:
   3200-vs-3600 (benchmark viejo), 2600 (PDF viejo), cachés heredadas.
   Implementado en `EditorView.handleRotate` (con `natural` del original) y en
   `store.processedMeetsTarget` (defensa del merge).
2. **Defensa del store SOLO en la rama `processedValid`** (como pide la
   instrucción). La rama `geometrySame` (página intacta) conserva la procesada
   persistida — "cero reprocesos innecesarios al salir" es comportamiento
   documentado del merge. Consecuencia conocida: un documento viejo degradado
   cuyas páginas NO se tocan conserva 3200 hasta que se editen. Documentado
   aquí a propósito.
3. **Toast "Cámara lenta" condicional (3.A).** En iOS la auto-captura siempre
   caía al fallback de frames y el toast de baja resolución disparaba SIEMPRE
   (falso). Ahora solo avisa si el frame del video es realmente bajo
   (`videoWidth < 1280`). Con el stream 1920×1440 el frame ES un original
   decente.
4. **`SensorProfile.tier` se ELIMINA del tipo** (las instrucciones lo
   permiten). Verificado con grep: e14 usa `SensorProfile` pero jamás lee
   `.tier` → su tsc no se rompe. e14 NO importa `device-capability` (solo
   docs). **v3.1 — alcance restringido por el propietario:** e14 queda
   COMPLETAMENTE intocado; la mención doc obsoleta a
   `getMaxProcessedLongSide()` en su SPEC (L445) se dejó tal cual — el rg del
   criterio de la Tarea 4 se verifica en lab+core (ver §Verificación punto 5).
5. **e14 NO se toca en NADA (v3.1):** ni código ni docs. Su compilación se
   verificó después de los cambios del core (solo el error preexistente de
   siempre, ver §Verificación).
6. **`setWarpCap` mantiene la llamada** con `PROCESSED_MAX_LONG_SIDE` fijo
   (4032). El default del worker YA es 4032 (`warpMaxLongSide = 4032` en
   detection-worker.js), así que la carrera arranque-worker es inocua. El
   comentario del worker se actualizó (mencionaba F-DEVBENCH).

## Mapa de archivos (identificadores fiables)

```
apps/scanner-lab/src/components/scanner/
├── EditorView.tsx          ← clampZoomPan (stage), presentationPages (estado+
│                              openPresentation), handleRotate (chequeo calidad),
│                              previewCache LRU 6, maxLongSide ×2, chip
│                              "Se guardará" + drawer calidad, willChange zoom
├── PresentationView.tsx    ← imgWrapRef h-full w-full + imgRef, clampPan
│                              (img vs stage), willChange dinámico
├── CameraView.tsx          ← IDEAL_PREVIEW_* por plataforma, downscale 4032,
│                              toast "Cámara lenta" condicional
└── SettingsView.tsx        ← DeviceSection fuera + fila "Resolución de procesado"

apps/scanner-lab/src/app/page.tsx   ← setWarpCap(4032) + removeItem localStorage

packages/scanner-core/src/
├── image-processor.ts      ← export PROCESSED_MAX_LONG_SIDE
├── store.ts                ← 4 processImage con constante + processedMeetsTarget
│                              (defensa processedValid)
├── sensor-profiler.ts      ← getSensorSafeCap() = 4032; sin device-capability;
│                              sin campo tier
├── device-capability.ts    ← BORRADO
├── index.ts                ← sin re-export de device-capability
└── pdf-export.ts           ← ATTEMPTS_STANDARD[0] = {0, 0.9}
```

## Qué NO cambiar (riesgo de regresión — de las instrucciones)

- No subir el tope por encima de 4032 (límite canvas iOS ~16.7 MP).
- NO eliminar `overCap`/`buildCappedPhotoSettings`/`clampBlobToSafeCap`.
- No eliminar el LRU de previews ni el patrón toBlob (error #22).
- No tocar el disparo manual nativo de iOS (`<input capture>` — HQ-iOS) ni la
  regla E3 de getUserMedia (solo `ideal`, sin `exact/min` para resolución).
- No convertir los data URLs de filtros a JPEG (PNG por R-10).
- La escalera de degradación del PDF por presupuesto de bytes SE MANTIENE
  (solo cambia el primer intento de standard).
- El upgrade de resolución (3.A) se condiciona a la AUSENCIA de ImageCapture
  (proxy iOS) → Android gama baja (que SÍ tiene ImageCapture) queda en 960×540.

## Cómo continuar si la sesión se corta

1. `cd /home/z/web-scanner && git status` — la rama `fix/scanner-lab-editor-quality`
   contiene TODOS los cambios (ver `git log`/`git diff main`).
2. Este documento es la fuente de verdad del estado. Lo único pendiente es el
   QA en dispositivo físico (iPhone real, ver §Verificación punto 7).
3. Para revisar el diff completo: `git diff main...fix/scanner-lab-editor-quality`.
