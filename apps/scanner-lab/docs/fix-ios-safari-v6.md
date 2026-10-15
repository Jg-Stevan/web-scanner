# FIX v6 — iPhone real: cámara, pantalla negra y paneo táctil (iOS Safari)

> **APP:** `apps/scanner-lab` (+ `packages/scanner-core` sin cambios de código en
> esta versión). **⛔ NO se tocó `apps/digitalizador-e14`** (0 archivos en el diff).
>
> **Rama:** `fix/ios-safari-v6` · **Base:** `main` en `cef735c` (incluye v4+v5
> fusionados vía PR #12 y #14). Un commit por punto (6.1→6.4).
>
> **Reportado por el propietario en iPhone 17 Pro (iOS 26):**
> 1. Sigue el problema de pantalla negra; ahora aparece el aviso de «alta
>    resolución».
> 2. La navegación del editor es «lenta» (pero funciona); el zoom por doble
>    toque sirve.
> 3. **No se puede desplazar** la imagen ampliada (el paneo no responde al dedo).
>
> Los tres diagnósticos fueron reproducidos/verificados en código por el
> propietario-técnico antes de escribir las instrucciones. Esta ejecución NO
> re-diagnosticó: implementó tal cual.

## Estado

| Punto | Título | Commit |
|-------|--------|--------|
| 6.1 | Detección POSITIVA de Android (`CAN_TAKEPHOTO`) — régimen iOS 1920×1440 de vuelta, takePhoto nunca en Safari | `9d5d684` |
| 6.2 | Watchdog de FRESCURA de frames (latido rVFC + fallback onFrame) — cierra la pantalla negra restante | `6f7036e` |
| 6.3 | Paneo táctil iOS: `touch-action` en el ELEMENTO tocado + touchmove no pasivo | `a21c8be` |
| 6.4 | Presentación: apertura progresiva con displayUrl en background (placeholder iOS + concurrencia 2) | `75208c7` |
| docs | Este documento + CHANGES + worklog | (este commit) |

## 6.1 — ⚠️ CRÍTICO: detección de plataforma rota en Safari moderno

**Causa raíz (confirmada):** el régimen se decidía con
`typeof ImageCapture !== "undefined"` (`CameraView` ~126, ~1458, ~1806). Eso era
válido cuando SOLO Chrome/Android exponía `ImageCapture`, pero **Safari moderno
(iOS 17+/26, el caso del iPhone 17 Pro) TAMBIÉN la expone** — con un
`takePhoto()` que se cuelga. Consecuencias en iPhone:

1. Régimen ANDROID por error: preview ideal 960×540 (antes iOS pedía 1920×1440).
2. El obturador llamaba `captureSmart()` → `takePhotoBlob()` → cuelgue de
   Safari → timeout 5 s → **el toast «La foto de alta resolución no respondió»**
   (copy que SOLO sale con `canTakePhotoRef === true`).
3. La AUTO-captura caía a frames de preview de **960×540 (0.5 MP)** — regresión
   de calidad grave (el bug original renacía).
4. Tras el cuelgue, el track podía quedar congelado → pantalla negra.

**Fix aplicado (detección positiva de Android):**

```ts
const IS_ANDROID =
  typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
const CAN_TAKEPHOTO = IS_ANDROID && typeof ImageCapture !== "undefined";
```

- `IDEAL_PREVIEW_WIDTH/HEIGHT`: 960×540 SOLO con `CAN_TAKEPHOTO`;
  **1920×1440 en todo lo demás** (iOS vuelve al régimen alto de v3).
- `canTakePhotoRef.current = CAN_TAKEPHOTO` en sus DOS sitios (`applyStream`,
  `retryRealCamera`) → en iOS el shutter manual abre la cámara nativa
  (input 12 MP) y la auto-captura usa frames de 1920×1440.
- `takePhotoBlob`: guard `if (!CAN_TAKEPHOTO) return { blob: null, timedOut: false }`
  en la primera línea.
- `profileActiveSensor`: solo corre con `CAN_TAKEPHOTO` (getPhotoCapabilities
  en Safari es inútil).
- `buildCappedPhotoSettings` queda blindado por el guard de `takePhotoBlob`.
- `onShutter` SIN cambios (con `canTakePhotoRef=false` en iOS vuelve solo al
  input capture nativo).
- ⛔ Regla E3 intacta (solo `ideal`); el UA sniffing NO toca constraints.

## 6.2 — Watchdog de FRESCURA de frames

**Hueco que v4 4.3 dejó:** `isStreamDead()` mira `track.muted / readyState /
video.readyState / videoWidth`. Un video **congelado sin estar muted** (lo que
Safari deja tras un takePhoto colgado) PASA esa revisión → checks sanos, cero
frames → watchdog mudo → negro para siempre.

**Fix aplicado:**

1. Nuevo `lastFrameAtRef = useRef(performance.now())`.
2. Latido REAL por `video.requestVideoFrameCallback` (Safari 15.4+ y Chrome):
   bucle que actualiza el ref en cada frame decodificado; arranca en el effect
   de asignación de stream y se cancela en su cleanup.
3. Fallback: `onFrame` del `CameraFrameLoop` actualiza el mismo ref (en modo
   espera el análisis va a 2 fps ≈ 500 ms ≪ umbral 4 s → sin falsos positivos,
   anotado en comentario).
4. Watchdog v4: la condición pasa a ser
   `isStreamDead() || (performance.now() - lastFrameAtRef.current > 4000)`,
   SOLO evaluada con la app en primer plano (`document.visibilityState ===
   "visible"` — en background iOS pausa el video y sin frames es lo esperado).
   El `visibilitychange` al volver resetea el latido (gracia) y relanza
   `video.play()` si quedó pausado → sin recuperaciones espurias.
5. Evaluación post-disparo (v4 4.1): tras un takePhoto por timeout, la MISMA
   comprobación de frescura → `recoverStream()` si el latido está viejo.

## 6.3 — Paneo táctil en iOS: touch-action en el ELEMENTO tocado

**Causa raíz (reproducida):** con Playwright + emulación táctil el paneo a zoom
funciona PERFECTO en Chromium (`translateX(80px)` exacto tras arrastre de 80 px)
— el código de eventos es correcto. **WebKit solo respeta `touch-action` del
elemento donde NACE el toque, no el de los ancestros** (Chrome sí evalúa la
cadena). El toque nacía en el `<img>` (touch-action por defecto) aunque el stage
tuviera `touch-none` → Safari disparaba `pointercancel` al iniciar el arrastre →
gesto muerto → sin paneo. El doble-toque funcionaba por no haber movimiento.

**Fix aplicado:**

1. `PresentationView.tsx`: `touch-none` al **`<img>`** principal y al **wrapper**
   `motion.div` del pan (`imgWrapRef`). El stage ya lo tenía — se dejó.
2. `EditorView.tsx` (stage de zoom del review): mismo patrón — `touch-none` en
   el `<img>` del preview (`zoomImgRef`) y en el wrapper (`zoomWrapRef`). El
   stage ya lo tenía.
3. Overlays de comparación (ambas vistas): `touch-none` — al comparar, ESE img
   cubre al principal y el toque nace en él.
4. Cinturón y tirantes: listener nativo NO pasivo
   `stage.addEventListener("touchmove", e => e.preventDefault(), { passive: false })`
   en el stage de la presentación (mata rubber-band residual de Safari), con
   cleanup.
5. ⛔ Lógica de pointer events INTACTA (verificada correcta en Chromium táctil).
6. Auditoría del modo recorte: los handles ya tenían `touch-none`; el img del
   crop no recibe pan → sin cambios.

## 6.4 — Navegación «lenta» de la presentación: displayUrl perezosa

**Causa raíz:** `openPresentation` usaba `entry?.displayUrl ?? entry?.url`. La
`displayUrl` se genera PEREZOSAMENTE: una página sin ella (nunca previsualizada)
obligaba a la presentación a decodificar el **PNG de 4032 px** (o el JPEG
original de 12 MP) DENTRO de la transición → frames caídos en iPhone → «lenta».

**Fix aplicado:**

1. **Eager (ya existía de v5 5.1, conservado):** el effect de procesado del
   preview genera `makeDisplayUrl(res.processed)` en el MISMO bloque asíncrono,
   antes de `setPreview`. La generación perezosa del cache-hit se mantiene como
   red de seguridad.
2. **Apertura progresiva:** en `openPresentation`, cada página sin `displayUrl`
   lista pinta YA el `thumbnail` como placeholder y dispara
   `makeDisplayUrl(entry.url ?? p.original)` en background; al aterrizar,
   `presentationPages` se actualiza y la imagen hace **swap suave**.
   - Placeholder estilo iOS en `PresentationView`: el thumbnail se escala por
     CSS con `blur(8px)` + `scale(1.03)` y transición de filter 240 ms.
   - **Concurrencia 2** (cola simple) — decodificar N gigantes a la vez en iOS
     son picos de memoria.
   - La copia generada se SIEMBRA en la caché de previews → la próxima apertura
     es instantánea para esa página.
3. Nuevo tipo `PresentationPage = ScanPage & { displayPending?: boolean }`
   (runtime-only, exportado desde `PresentationView.tsx`).
4. ⛔ Pipeline de guardado y `PROCESSED_MAX_LONG_SIDE` intactos.

## Qué NO cambió (acumulado, verificado)

- Regla E3 (solo `ideal`), DUAL PIPELINE (manual iOS = input nativo).
- `PROCESSED_MAX_LONG_SIDE = 4032`, chip «Se guardará…», escalera PDF (v3).
- Watchdog `isStreamDead` + `recoverStream` de v4 (v6 lo EXTIENDE, no sustituye).
- Fixes v5: bornQuad, caché de cámara, modo espera, flash auto, swipe toasts,
  swipe presentación, sin «Proyecto».
- Lógica de pointer events de PresentationView/EditorView (solo touch-action y
  preventDefault añadidos).
- `apps/digitalizador-e14`: ni una línea.

## Verificación ejecutada (evidencia)

Entorno: dev server efímero `bunx next dev -p 3005` + agente de navegador
(Chromium headless). La app renderiza en un marco tipo teléfono — los eventos
deben caer DENTRO de ese marco.

**Técnica del smoke:** como el sandbox no tiene cámara real, se parcheó
`navigator.mediaDevices.getUserMedia` para devolver un canvas.captureStream con
ruido redibujado a ~8 fps (sin documento → sin auto-captura espuria) y
`enumerateDevices` para devolver una cámara falsa — así la app entra en el camino
REAL de apertura (sondas → elección → apertura con constraints → status "live")
y el watchdog v6.2 queda plenamente ejercitable.

1. ✅ `bunx tsc --noEmit` en `packages/scanner-core` y `apps/scanner-lab` → 0
   errores. `bun run lint` (scanner-lab) → 0 errores.
2. ✅ **6.1 régimen NO-Android (UA escritorio):** apertura con
   `width:{ideal:1920}, height:{ideal:1440}` (capturada en el patch de
   getUserMedia) — ANTES de v6 este mismo entorno habría pedido 960×540
   (Chromium expone ImageCapture). `__sensorProfile` **ausente** (profiler
   saltado). Sin toast de alta resolución.
3. ✅ **6.1 régimen Android intacto (emulación Pixel 7 / UA Android 13):**
   apertura con `width:{ideal:960}, height:{ideal:540}` y `__sensorProfile`
   **presente** (profiler corrió). Captura con obturador → takePhoto intentado
   → fallback de frames → editor abierto con la página («Digitalización 7»).
4. ✅ **6.2 congelamiento → recuperación:** parche `window.__freeze()`
   (clearInterval del redibujo → video congelado SIN mutear, readyState 4) →
   toast **«Reiniciando cámara… El sensor dejó de responder.» a los 7760 ms**
   del congelamiento (ventana diseñada: umbral 4 s + 2 strikes × 2 s = ≤8 s;
   la primera comprobación útil cae según alineación) → `getUserMedia`
   re-invocada (3→4 llamadas) → video reproduciéndose de nuevo (readyState 4).
5. ✅ **6.2 sin espurias:** 12 s adicionales con frames fluyendo → 0
   recuperaciones nuevas, `__gumCalls` estable, video OK.
6. ✅ **6.3 DOM:** `getComputedStyle().touchAction === "none"` en el `<img>`
   principal, en el wrapper del pan y en el stage de la presentación.
7. ✅ **6.3 paneo funcional:** doble-toque sobre la imagen → `scale(2)` (chip
   200 %) → arrastre de 60 px sobre la IMAGEN → `translateX(60px) scale(2)`
   exacto.
8. ✅ **6.4 camino listo:** página visitada → img `data:image/jpeg` (displayUrl)
   con `blur(0px)` instantáneo.
9. ✅ **6.4 placeholder + swap:** documento guardado reabierto (caché de
   previews nueva) + `toBlob` parcheado con retardo de 2 s para alargar la
   fase → grabador a 40 ms capturó **49 muestras con `blur(8px)`** en la
   página pendiente (t=4690→6614 ms ≈ 1,9 s) y luego **swap a `blur(0px)`**
   con la copia de display a pantalla completa.
10. ✅ **0 errores de página y 0 errores/warnings de consola** en TODA la
    sesión de smoke (parches, congelamiento/recuperación, 3 capturas, guardado,
    reapertura, presentación con placeholder/swap/paneo/zoom).

## Pendiente de QA físico (no verificable en sandbox headless)

- **6.1 en iPhone real:** stream 1920×1440 visible en telemetría; NUNCA el
  toast de alta resolución; disparo manual → cámara nativa 12 MP; auto-captura
  → frames 1920×1440.
- **6.2 en iPhone real:** 5 capturas seguidas sin negro; si algo se congela,
  «Reiniciando cámara…» solo y vuelta en ≤8 s (por construcción: 4 s de umbral
  + 2 strikes × 2 s — el criterio «≤6 s» de las instrucciones asume alineación
  óptima de los ticks; medido 7,76 s en el sandbox).
- **6.3 en iPhone real:** con zoom ≥2×, arrastrar el dedo SOBRE LA IMAGEN
  desplaza la página (no solo desde el padding del stage); swipe a 1× intacto.
- **6.4 en iPhone real:** presentación de 5 páginas abriendo con algo visible
  en <300 ms en todas y navegación sin frames caídos.

## Cómo continuar si la sesión se corta

1. Rama `fix/ios-safari-v6` en `/home/z/my-project` NO — en `/home/z/web-scanner`;
   los 4 puntos + docs están committeados (ver tabla). `git log --oneline -6`.
2. Verificación rápida: `bunx tsc --noEmit` en `packages/scanner-core` y
   `apps/scanner-lab` → `bun run lint` en `apps/scanner-lab`.
3. Smoke: `bunx next dev -p 3005` en `apps/scanner-lab` + agente de navegador;
   técnica del patch de getUserMedia descrita arriba (§Verificación).
4. QA físico: checklist de §Pendiente de QA físico.
