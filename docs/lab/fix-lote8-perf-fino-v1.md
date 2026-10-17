# Lote 8 — perf fino (kit `INSTR-ws-lote8-perf-fino-v1`)

**Rama:** `perf/lote8-fino-v1` (apilada sobre `feat/lote7-ram-hidratacion-v1`) · **6 commits (uno por tarea)** · BUN 1.3.14.
**Gates:** `core:check` + `ui:check` + `app:check` + `lint` = exit 0 · `bun test` **9/9** (6 LRU + 3 paridad) · `build:static` exit 0 · smoke headless 0 errores de consola.
**COMP-4 (recablear tier al warp cap): EXCLUIDO por el kit — no implementado** (requiere decisión del dueño; revierte la decisión WYSIWYG de fix-editor-quality-v3).

## T1 — PERF-4: integrales Float64 → Uint32 (con verificación)

**Análisis obligatorio previo:** la integral SIMPLE de grises 8-bit cabe en Uint32 — máx = 255·w·h: 4032×3024 ≈ 3,11e9 e incluso 4096×4096 ≈ 4,28e9 < 2³² ≈ 4,295e9, y todos los valores son enteros exactos → conversión sin pérdida. La integral de CUADRADOS llega a ≈ 7,93e14 → **NO cabe** (ni en Uint32; Float64 es el tipo mínimo correcto — enteros exactos hasta 2⁵³). **Resultado:** `integralImage` → Uint32Array con guard (`255*w*h < 2³2` — degrada a Float64 para inputs fuera del cap); `integralImageSq` **queda Float64** (límite alcanzado, documentado).

**Paridad (test committeado):** `tests/image-modes-parity.test.ts` — bradleyRoth y sauvola con referencia Float64 inline → **salida byte-idéntica** en 512×384 aleatoria, caso all-255 y constantes reales del módulo (BW_T/BW_WINDOW_RATIO/BW_SAUVOLA_K/R). **3/3 ✓.**

**Medición (bun, 4032×3024, RSS Δ sobre la misma entrada):**

| | ANTES (Float64) | DESPUÉS (Uint32) | Δ |
|---|---|---|---|
| bradleyRoth | **108 MB** | **61 MB** | **−47 MB (−43%)** |

Teoría: integral 4032×3025 = 93 MB Float64 → 47 MB Uint32 ✓ cuadra.

**Desviación D-T1 (espejo del worker):** `detection-worker.js` L452-517 lleva una COPIA MANUAL de las integrales (espejo de image-modes) — fuera de la whitelist §6 del lote (solo T3/T4 en el worker) → queda en Float64. **La SALIDA es byte-idéntica** (enteros exactos), pero el ahorro de memoria PERF-4 solo aplica al fallback canvas del main thread. Espejar = 1 cambio en el worker — pendiente del dueño.

## T2 — PERF-5: overlay del quad por ref directa + React a 2 Hz

- `onFrame`: el throttle de 100 ms se mantiene (liveRef fresco a 10 Hz — FIX v5.2 del disparo **intacto**); **el quad del overlay se pinta por REF DIRECTA a 10 Hz** (`setAttribute("d", …)` en los 2 paths + `style.left/top` en las 4 esquinas — patrón `window.__cameraTelemetry`); **el ESTADO React `setLive` baja a 2 Hz** (solo alimenta textos/labels/standby — la puerta del disparo lee `liveRef`).
- El mapeo object-cover vive en `paintOverlay` (estable, `[]`) vía helper de módulo `mapPointToPct` con inputs frescos por ref (patrón compiler-safe: `react-hooks/immutability` prohíbe guardar valores memoizados en refs y el orden de declaración del React Compiler obligó a declarar antes del frame loop — ambos resueltos).
- Los paths/esquinas del JSX son NO controlados (React solo monta/desmonta el contenedor con gate a 2 Hz) — React nunca pisa el valor fresco de 10 Hz.
- NO tocado: lógica de detección/disparo/backpressure (FORT-2/3/11 intactos), standby, gates.
- **Medición:** main-thread bloqueado por frame durante detección viva requiere device real (long tasks del perf-probe) — **pendiente del dueño**; el win estructural es verificable por diseño: 10 Hz de re-render de CameraView (3.7k L) → 0 re-renders por el quad (solo 2 Hz por labels) y los cálculos `mapPoint/toFixed/join` salen del render de React al ref-update.

## T3 — PERF-6: histograma de exposición en el worker

- `detection-worker.js`: `lumaHistogram` (espejo JS plano de `quality.ts` — misma fórmula 0.299/0.587/0.114, comentario de paridad) calculado sobre el frame de trabajo (~400 px ya transferido) y **viaja en el `ResultReply`** (campo nuevo `hist`).
- `detector-client.ts`: `ResultReply.hist?` + `DetectOutcome.hist?` — **compat bidireccional**: app nueva con worker viejo → campo ausente → main cae al cálculo local (miniatura 96 px, intacto); worker nuevo con app vieja → campo ignorado.
- `frame-loop.ts`: `const hist = out.hist?.length ? out.hist : this.frameHistogram(video)`.
- **Medición ms/frame en detección viva:** requiere device real — **pendiente del dueño** (meta −0,5-1,5 ms/frame; el getImageData de main thread por frame analizado desaparece en el camino feliz).

## T4 — PERF-1b: wasm de OpenCV separado

**Hallazgo crítico (documentado para el futuro):** el vendor es un **build UMD de opencv-js** — `var cv` local en la factory SIEMPRE ensombrece el global (hoisting) → `Module` es hermético y **NO inyectable** (`Module.wasmBinary`/`instantiateWasm` imposibles desde fuera), y `locateFile` resuelve el `.wasm` contra `self.location` **DEL WORKER** (`/scanner/`), no contra el glue (`/vendor/`). El bootstrap original SINGLE_FILE no necesitaba nada de esto.

**Implementación final:**
- `opencv-4.5.5-core.wasm` (5,99 MB, magic `\0asm` verificado + `WebAssembly.validate=true`) **en `public/scanner/`** (donde el glue lo busca) — `git mv` desde vendor, sin history rewrite.
- `opencv-4.5.5-core.js`: 8,20 → **0,21 MB** (una asignación semántica: el data-URI base64 → `"opencv-4.5.5-core.wasm"`; el glue mantiene su propio `fetch`+`instantiateStreaming` con fallback interno).
- `detection-worker.js`: **bootstrap sin cambios** (el sync `importScripts` del glue funciona cuando el wasm está en su sitio — probado en vivo: `__scannerPrecision()` = `{ready:true,dead:false}`).
- `sw.js`: precache del motor offline (2 líneas de lista — glue + wasm; /vendor/ cae en SWR runtime, no cache-first inmutable → opción (a) del kit). **Cero cambios de lógica.**

**Transferencia OpenCV:** 8,20 MB (glue con b64) → **6,20 MB** (glue 0,21 + wasm 5,99) = **−2,00 MB raw** ✓ meta del kit (−1,5-2 MB); el parseo del base64 (8 MB de string JS) desaparece del boot. Tiempo de parse con performance marks = pendiente de device.
**Páginas sirve `.wasm` con MIME correcto:** verificación con curl al deploy tras merge (pendiente — en el smoke local sirvió 200).

**Desviación D-T4:** el «fallback a la ruta embebida» del kit es incompatible con el objetivo de −2 MB (el b64 embebido ES el peso a eliminar). Fallback final: si el fetch del wasm falla, el glue reintenta su ruta y el fallo total cae al estado de error/self-healing existente (re-spawn del worker). El precache del SW cubre offline.

## T5 — COMP-2: devicemotion con permiso iOS

- `motion-stabilizer.ts`: nueva `requestMotionPermission()` — guard `typeof DeviceMotionEvent.requestPermission === "function"`, **un solo intento por sesión** (flag de módulo), fallo → modo actual (no-op permisible, igual que desktop).
- `CameraView.tsx` (punto de gesto, whitelist): `onShutter` (tap del obturador — gesto DIRECTO, requisito iOS) llama `void requestMotionPermission()` fire-and-forget — cero latencia añadida al disparo.
- Smoke en simulador: sin DeviceMotion (desktop/headless) → `requestPermission` no existe → false → sin cambios ✓. **Verificación en iOS físico = pendiente del dueño.**

## T6 — COMP-5: hitboxes ≥44px

- Helper `.hit-slop` en `globals.css`: `::before` absoluto 44×44 centrado — **cero cambios visuales ni de layout** (patrón hit-slop; no existía uno previo).
- **12 sitios** aplicados: CameraView ×4 (`h-9 w-9`), EditorView ×4 (`h-9 w-9` ×2 + `h-8 w-8` ×2), LibraryView ×4 (incl. el `compact ? h-7 w-7 : h-8 w-8`). **PresentationView: 0 sitios — el citado por el kit (L666) ya no existe** (desviación menor documentada).
- Inspección: los 12 botones quedan con hitbox ≥44 px sin reflow (los visuales siguen 36/32/28 px).

## Verificación final del lote

| Gate | Resultado |
|---|---|
| `core:check`/`ui:check`/`app:check`/`lint` | exit 0 (161 warnings pre-existentes, 0 errores) |
| `bun test` | **9/9** (LRU 6 + paridad integrales 3) |
| `build:static` | exit 0 |
| Smoke: cámara con **wasm separado** | `ready:true` ✓ detección viva ✓ captura sintética ✓ |
| Smoke: export PDF | «PDF exportado · 1 página · 40.5 KB» ✓ |
| Errores de consola | **0** ✓ |

**Pendientes del dueño:** COMP-4 (excluido por kit) · medición T2/T3 en device real · espejar integrales Uint32 al worker (D-T1) · MIME del .wasm en Pages tras merge · iOS físico T5.
