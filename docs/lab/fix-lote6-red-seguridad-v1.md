# Lote 6 — Red de seguridad: tests + higiene (rama `test/red-seguridad-v1`)

**Kit:** `INSTR-ws-lote6-red-seguridad-v1` · **Agente:** B (track calidad/estructura) · **Base:** `main` @ `1e874d4` · **PR:** DRAFT a main (sin merge).
**Entorno:** bun 1.3.14 obligatorio, `bun test` nativo — cero dependencias de testing nuevas.
**Paralelismo:** ejecutado junto al Lote 5 del Agente A (`fix/lote5-quickwins-v1`, PR #8). Rebase sobre `origin/main` verificado antes del BP-2 de EditorView (§0.3 del kit).

---

## 1 · T1 — BLQ-1: batería `bun test` (193 tests)

Creado `packages/scanner-core/tests/` con 10 archivos. Bun resuelve TS e imports del workspace nativamente — verificado antes de escribir con sondas de importabilidad y runtime (`nextId`, store zustand completo, `dataUrlToBlob`, `attemptsFor` OK sin navegador).

| Archivo | Tests | Qué cubre |
|---|---|---|
| `types.test.ts` | 22 | `normalizePageFilter` (migración legacy §8.4 completa), presets (exactamente 3), `isTrashed`/`trashDaysLeft` (F-TRASH con `now` inyectado: bordes 0/29.5/45 días), `capturePageKey` (formato + participación de cada campo + redondeo 4 dec), `makeQuality` (umbrales exactos 85/70/50), `defaultQuad`, `DEFAULT_SETTINGS`, `excellentQuality` |
| `tags.test.ts` | 19 | CRUD (`addTag`/`removeTag`/`cleanTagInput`), `normalizeTag` (tildes NFD), `tagColor` (determinismo + OBSERVACIÓN de tildes, §5), `countTagUsage` (orden uso↓ + alfabético), topes `MAX_TAGS`/`MAX_TAG_LEN`, no-mutación |
| `format.test.ts` | 15 | `relativeTime` (5 tramos con `now` fijo + futuro clampeado), `fullDate` (ICU es-CO), `formatBytes` (3 rangos + bordes), `dataUrlBytes` (base64 ×3/4, percent-encoded UTF-8, malformado → fallback) |
| `pdf-export.test.ts` | 9 | `attemptsFor` ×3 calidades (escalera §8: máxima 4 intentos 0.95→0.78; standard parte full-size FIX v3), degradación de cada intento, `sanitizeFileName` (prohibidos/trim/«documento»/UTF-8), `PDF_LONG_SIDE_MM` |
| `page-store.test.ts` | 14 | `dataUrlToBlob` (base64+padding, mime con params, octet-stream, percent-encoded SVG pre-C-24, inválidos → null C-24, atob lanza), guards SSR (`loadSettings`→DEFAULTS, `saveSettings` noop, `loadManualOrder`→[], `loadAllDocuments`→null, `storageAvailable`→false en bun) |
| `store.test.ts` | 26 | `nextId` (unicidad/formato), navegación+lote, sesión de captura (add/update/remove), `saveSessionAsDocument` (título fallback «Digitalización N», fallback sin canvas = original), tags (tope 8, dedup), papelera completa (delete/restore/purge/emptyTrash/guard openDocument), duplicado C-11 (ids de página NUEVOS), reorder/setDocumentsOrder, setOcrText, modo revisión F-NOVIEW + **merge B4** (página intacta conserva procesada; nueva se añade; sesión vaciada = doc a papelera), settings/onboarding |
| `quality.test.ts` | 25 | constantes del contrato empírico, `computeSharpnessScore` (saturación + no finitos→0), `computeExposureScore` (fórmula exacta + especular 3 %), `computeStabilityScore` (ventana POR TIMESTAMP 600 ms, fórmula exacta meanVar/8→/20), `computeEccentricityScore` (peor esquina), `computeTotalScore` (ponderación ×excentricidad, isBlur umbral 100), **máquina de disparo FIX v9** (few-samples/last-bad/sustain U5/not-enough-good/ok + hueco fps bajo tolerado + fpsEff clamp), `detectionTimedOut` (8000 estricto), `lumaHistogram` (BT.601) |
| `text-export.test.ts` | 8 | `ocrTextOfPages` (separadores con índice REAL, página única pelada), `documentOcrText`, `docHasOcrText`, `countWords` |
| `persist-safely.test.ts` | 6 | **viaje secuencial de fallos** (ver §4): op OK, 1.er/2.º fallo sin aviso, 3.er → EXACTAMENTE 1 evento `{site,count:3}`, one-shot de sesión (fallos 4-8 no repiten), op síncrona capturada |
| `parity-worker-filters.test.ts` | 32 | **T6/DRY-2** — ver §3 |

**Total: 192 pass · 1 skip · 0 fail · 438 expect()** (`Ran 193 tests across 10 files`). Meta del kit (40-60) superada.

**Decisión de alcance T1 (documentada):**
- `blobToDataUrl` → `test.skip` con motivo: usa `FileReader`, que bun no implementa (browser-only). En CI/navegador quedaría cubierto por E2E. Pendiente del dueño.
- `toJpegAt`/`toJpeg`/`buildDocPdf`/`downloadPdf` → NO testeados: canvas 2D + FileReader + jsPDF runtime (browser-only). Probarlos exigiría polyfill de canvas = dep de testing nueva (prohibida). Documentado en el propio test (`pdf-export.test.ts` header).
- `store.ts`: el store vanilla ES importable sin IndexedDB (guards SSR preexistentes verificados) → se probó el ciclo completo EN MEMORIA, incluido el fallback determinista de `processImage` (sin canvas el catch usa el original).
- Las fechas largas dependen del ICU del runtime (verificado idéntico en bun local; CI usa la misma imagen bun).

## 2 · T2 — CI: step `bun test` en quality.yml

Añadido step «Tests — packages/scanner-core (bun test nativo)» al job `checks`. **Orden elegido y documentado:** tras typechecks + guard + `ui:build` + lint (fallan rápido) y ANTES de `build:static` (el paso caro va al final). Diff del workflow: **solo el step nuevo + comentario** (7 líneas). Concurrency/triggers/otros steps INTOCATOS. Humo: `python3 -c "import yaml;yaml.safe_load(...)"` → YAML válido. Los tests viven SOLO en `packages/scanner-core/tests/` — verificado que no se cuelan en `src/` (build:static OK tras añadirlos).

## 3 · T6 — DRY-2: test de paridad worker ↔ core

`tests/parity-worker-filters.test.ts` (32 tests). El worker declara (L625) «Espejo EXACTO de las funciones puras de image-modes.ts» — este test VERIFICA el contrato:

- **Extracción robusta (no por marcadores de comentario):** las funciones espejadas están DISPERSAS en el IIFE del worker (whitePointStretchPct L585, textClaroContrast L613, textTargetLumaLut L632, edgeAwareSharpenGray L657, enhanceToRgba L1062, unsharpRgba L1392) → extractor por NOMBRE con lexer mínimo (omite strings/comentarios/escapes), extracción de parámetros con default objeto (`opts = {}` rompía el brace-matching ingenuo — corregido) y **recursión transitiva de dependencias** (funciones + `var` UPPER_CASE, incluidas LUTs IIFE como `LAB_L8` que ejecutan código a nivel de módulo). El código extraído se evalúa en sandbox `new Function` = el JS REAL que corre el navegador.
- **Cobertura lograda:** constantes (TEXT_CLARO_* ×4, TEXT_EDGE_* ×2), `whitePointStretchPct` (5 fixtures × 4 pcts), `textClaroContrast` (3 fixtures × 2 firmas), `textTargetLumaLut` (4 juegos de parámetros), `edgeAwareSharpenGray` (3 fixtures + márgenes), y **`enhanceToRgba` END-TO-END** en los modos `raw`/`text`/`text`-custom/`bw`-bradley/`bw`-sauvola+despeckle/`gray` + entrada vacía — con todo el grafo de helpers (rgbaToGray, shadow model, sauvola, bradley, despeckle, rebuildRgbaWithChroma…) extraído por recursión.
- **Fixtures deterministas:** rampa con «ruido» fijo, bajo contraste (96-160), imagen plana (0/128/255) y RGBA sintético tipo documento (papel + trazos + 1 px de croma). 16×16.
- **Comparación EXACTA (tolerancia 0)** — kit T6.2. **RESULTADO: CERO DRIFT.** El «espejo EXACTO» se cumple byte a byte.
- **EXCLUIDO — `unsharpRgba`:** el worker lo implementa vía **OpenCV** (`cv.GaussianBlur` + `cv.addWeighted` sobre Mats; firma `(cv, foto)`) y el core por convolución JS pura. NO son comparables sin cargar cv.js (~8 MB) en el sandbox. Documentado con un test que verifica ambas firmas (kit T6.3 «documenta el alcance real»).
- El test LEE el worker (`Bun.file`/readFileSync); **jamás lo escribe** (diff del lote: 0 toques en `public/**`).

## 4 · T4 — BP-3: `persistSafely()` con aviso único

**Diseño (decisión + justificación — el kit daba latitud: «dónde: apps/scanner-lab/src/lib/ — decide y justifica»):**
- **Motor en el CORE** (`packages/scanner-core/src/page-store.ts`, donde viven los catches de persistencia): `persistSafely(site, op)` envuelve operaciones de escritura; `notePersistFailure(site)` lleva el contador en memoria y al **3.er fallo** dispara **UNA sola vez por sesión** el evento global `PERSIST_FAILURE_EVENT` («escaner-persist-fallo», constante exportada) + `console.warn` observacional (FORT-8: sin red, sin reintentos, sin telemetría; crash-reporter NO se toca — solo escucha `error`/`unhandledrejection`, integrarlo aquí lo convertiría en telemetría).
- **Puente del toast en la APP** (`apps/scanner-lab/src/lib/persist-safely.ts`, nuevo): escucha el evento y muestra el ÚNICO `toast.error` de sonner con el texto EXACTO del kit: «No se pudo guardar; tus cambios están en memoria — evita cerrar la app». Nunca alert/confirm; jamás >1 toast/sesión.
- **Justificación de la partición:** el core no puede importar UI (regla del paquete: «nada de React/Next/imports de UI») y la app no puede envolver los catches del core → el evento global es la frontera limpia sin invertir dependencias. Sonner no puede vivir en el core (`packages/*/package.json` intocable en este lote).
- **⚠ WIRING PENDIENTE (desviación reportada):** instalar el puente requiere 1 línea en `apps/scanner-lab/src/app/page.tsx` (`import "@/lib/persist-safely";`) — `page.tsx` es zona del Agente A (kit §0.1) y está FUERA de mi whitelist. La instalación es idempotente y auto-arranca al importar (guard SSR), así que la línea basta. Queda para el dueño/Agente A. Hasta entonces: los fallos se cuentan y se registran en consola (observación activa), el toast queda en espera del wiring.

**Inventario de catches instrumentados (5):**

| Sitio | Archivo | Antes | Ahora |
|---|---|---|---|
| `persistDocument` | page-store.ts | catch silencioso («best-effort») | `await persistSafely("persistDocument", …)` |
| `removeDocument` | page-store.ts | `/* noop */` | `await persistSafely(\`removeDocument(id)\`, …)` |
| `clearAllDocuments` | page-store.ts | `/* noop */` | `await persistSafely("clearAllDocuments", …)` |
| `saveManualOrder` | page-store.ts | `/* noop */` | `await persistSafely("saveManualOrder", …)` |
| `saveSettings` | page-store.ts | `/* noop */` | catch mantiene contrato sync + `notePersistFailure("saveSettings")` |

**Deliberadamente NO instrumentados:** `loadAllDocuments` (prohibido — Lote 7 del Agente A), `loadSettings`/`loadManualOrder` (LECTURAS: su fallo no pierde datos del usuario — vuelven a DEFAULTS/[]), catches de `store.ts` (los 6 son de `processImage`/onboarding, NO de persistencia: las llamadas de persistencia del store son fire-and-forget `void persistDocument(...)` cuyos fallos ahora reporta el propio page-store; el catch de onboarding-localStorage no es persistencia crítica — perderlo solo re-muestra el onboarding). Los ~83 catch silenciados del resto del repo: para lotes futuros (kit T4.2).

**Verificación del aviso único:** viaje secuencial en `persist-safely.test.ts` (§1) — 3.er fallo → 1 evento exacto; fallos 4-8 → 0 eventos nuevos. La simulación con devtools (bloquear IndexedDB) no es reproducible en sandbox sin navegador interactivo; el camino de producción usa el MISMO código (mismo catch → notePersistFailure).

## 5 · T5 — BP-4: `noImplicitAny` reactivado

`"noImplicitAny": true` en los 3 tsconfigs (app/core/ui). Resultados:

- `core:check` ✅ 0 errores · `ui:check` ✅ 0 errores
- `app:check`: **1 error real** (la auditoría estimaba 1 — exacto): `perf-probe.ts:113` TS2322.
- **Causa raíz (no era implicit-any literal):** `burst-budget.ts` hace *module augmentation* de `PerfProbeApi` con un overload de `mark()` más ANCHO (meta admite `BurstHeapProbe` — D-09 del lote de limpieza). Con interfaz fusionada, la contextualización de la implementación toma el ÚLTIMO overload (el ancho) → el spread de `meta` dejaba de caber en `PerfProbeMark.meta` (estrecho).
- **Fix (en perf-probe.ts, whitelisted):** anotación EXPLÍCITA de los parámetros de la implementación con el tipo estrecho de `PerfProbeApi`. Los métodos son bivariantes en TS → la implementación anotada estrecha sigue asignable a los DOS overloads; los llamadores que pasan `BurstHeapProbe` siguen usando el overload ancho. **Cero cambio de runtime, cero `any`** (FORT-1 preservada: `any: 0` intacto).
- Tras el fix: los 3 typechecks ✅ con `noImplicitAny: true`.

## 6 · T3 — BP-2: exhaustive-deps caso a caso

**Inventario real (`bun run lint`):** 12 vivos al arrancar el lote (la auditoría citaba 10 en 2 archivos; el estado real: CameraView ×3, EditorView ×8, PresentationView ×1 — números movidos como anticipaba el kit). **Después: 2** (ambos justificados abajo). Warnings totales: **169 → 159** (−12 +2 restantes).

### CameraView.tsx (3/3 resueltos — commit propio, zona exclusiva)

| Línea | Dep faltante/extra | Análisis | Decisión |
|---|---|---|---|
| 2169 | +`applyAutoQuad`, −`status` | `applyAutoQuad` es `useCallback([])` → identidad estable para siempre: añadirla NUNCA re-crea el callback. Al añadirla, el lint destapó que `status` era innecesario (no se referencia en el cuerpo de `runCaptureFlow`, verificado). El consumidor es `captureSmartRef.current` (ref re-asignada en cada render) y el efecto del disparador ya tiene `status` en SUS PROPIAS deps → quitarlo no reduce ninguna re-ejecución real | **FIX aplicado** (ambos) |
| 2624 | +`profileActiveSensor` | `useCallback([])` → estable; el efecto de stream no puede re-dispararse por su identidad | **FIX aplicado** |
| 2813 | +`profileActiveSensor` | Ídem (callback de reintento de permisos) | **FIX aplicado** |

### EditorView.tsx (6/8 con fix, 2 justificados — hecho AL FINAL tras rebase, según kit §0.3)

| Línea | Dep | Análisis | Decisión |
|---|---|---|---|
| 781 | +`page` | El efecto es el RE-PROCESO de imagen del editor (crítico). Añadir `page` completo re-dispararía el proceso por campos irrelevantes (`ocrText`, `quality`, identidad del objeto en cada set). El único campo leído no cubierto es `quadManual`, pero se verifica que SIEMPRE viaja con un cambio de `quad` (L1040 `{quad, quadManual:true}` / L1268 `{quad, quadManual:false}`) → `cacheKey` (que incluye quad) ya lo cubre: **no hay staleness real** | **NO aplica — justificado** (cambiaría timing del re-proceso; kit T3.2) |
| 1151 | wrap `handleSaveImage` en `useCallback` | Se re-creaba cada render → el efecto QA (guard `execKey` idempotente) re-corrbía vacío en cada render. Con deps correctas (`page, exportingImg, currentPreviewEntry, cachePreviewEntry, headerTitle, activeIdx, cacheKey`) ejecuta EXACTAMENTE los mismos pasos con menos pasadas vacías. Los consumos (botón + efecto QA) no dependen de la frecuencia de identidad | **FIX aplicado** |
| 1277 | wrap `handleFilter` en `useCallback` | Misma mecánica (deps `page, updateCapturePage`) | **FIX aplicado** |
| 1427 | +`setView` en `handleSave` | Acción zustand → identidad estable → cero cambio de timing | **FIX aplicado** |
| 1443 | +`setView` en `downloadFromOverlay` | Ídem | **FIX aplicado** |
| 1553 | +`cachePreviewEntry`, +`preview` (en vez de `preview?.url`) en `runOcrCurrent` | `cachePreviewEntry` es `useCallback([])` (estable). El callback lee `preview.tier` (L1482/1488/1511) — la dep honesta es el objeto. Transición fast→full siempre cambia url (ya cubierta); añadir `preview` solo agrega re-creaciones con metadatos distintos y misma url (no existe en la práctica) | **FIX aplicado** |
| 1619 | +`cachePreviewEntry` en `runOcrAll` | Estable → seguro | **FIX aplicado** |
| 1734 | +`preview?.tier` (efecto auto-OCR) | El efecto espera al tier FULL y el comentario documentaba la intención («cuando el full aterrice, re-ejecuta»). **HALLAZGO:** con dep solo `preview?.url`, si el tier cambia con url idéntica (posible en páginas <2048 px, donde fast y full escalan ×1 y producen el mismo data URL) el efecto NO re-corre → el auto-OCR quedaría esperando siempre. Añadir `preview?.tier` implementa la intención documentada; en el camino normal no agrega re-corridas (cada tier lleva url propia) | **FIX aplicado** + hallazgo reportado |

### PresentationView.tsx (0/1 — FUERA DE WHITELIST, kit §6)

| Línea | Dep | Análisis | Decisión |
|---|---|---|---|
| 443 | +`relToCenter` | `relToCenter` es `useCallback([])` (L121) → estable; añadirlo al efecto de rueda sería seguro (nunca re-corre). PERO `PresentationView.tsx` NO está en la whitelist §6 del Lote 6 (solo CameraView/EditorView para BP-2) | **Pendiente documentado** (§1.1 stop-and-report; 1 línea para el dueño o un lote futuro) |

**Meta del kit alcanzada:** los 2 restantes están justificados (1 por análisis de timing crítico, 1 por whitelist).

## 7 · Verificación obligatoria (§3 del kit, en orden)

1. **`bun install` + checks:** `core:check` ✅ exit 0 · `ui:check` ✅ exit 0 · `app:check` ✅ exit 0 · `lint` ✅ exit 0 (0 errores, 159 warnings — antes 169; delta −12 exhaustive-deps, +2 restantes justificados; el resto sin cambio).
2. **`bun test`:** ✅ **192 pass · 1 skip · 0 fail · 438 expect()** — `Ran 193 tests across 10 files [166ms]` (meta 40-60 superada).
3. **`bun run build:static`:** ✅ exit 0 (`○ / … prerendered as static content`) — ningún test se cuele en `src/` verificado.
4. **Lint:** exhaustive-deps 12 → 2 (ambos justificados en §6).
5. **Smoke manual (agent-browser sobre dev :3100, dos rondas — antes y después del BP-2 de EditorView):**
   - Arranque + onboarding completo → biblioteca con los 6 mocks, chips de tags, orden Recientes/Favoritos/A-Z/Manual.
   - Editor (modo revisión): acciones Rotar/Filtros funcionan; panel de filtros Original/Texto claro/B-N aplica sin errores.
   - Guardar cambios → vuelve a biblioteca ✅. «Guardar PDF» (jsPDF) ✅. Presentación a pantalla completa ✅ (Escape cierra limpio).
   - **0 errores de página y 0 errores de consola** en ambas rondas.
   - Cámara/burst: **N/A en sandbox sin cámara física** (limitación honesta; QA física del dueño). Los cambios BP-2/3 no tocan pipelines de captura (deps estables verificado §6).
   - Simulación de fallo de persistencia en devtools: no reproducible en sandbox (§4) — cubierto por el viaje de tests de `persistSafely`.
6. **Métricas:** nº tests 0 → 193 (192 pass + 1 skip documentado) · exhaustive-deps 12 → 2 · implicit-any corregidos 1 (`perf-probe.ts:113`, vía anotación explícita sin `any`) · catches instrumentados 5 (+1 motor de aviso único + 1 puente de toast) · `bun test` añadido al Quality Gate.

## 8 · Commits (convención §4)

- `test(core): batería bun test de lógica pura + paridad worker↔core (BLQ-1, DRY-2)`
- `ci: step bun test en quality (BLQ-1)`
- `chore(ts): noImplicitAny reactivado (BP-4)`
- `feat(persist): persistSafely con aviso único tras N fallos (BP-3)`
- `fix(hooks): exhaustive-deps caso a caso documentado (BP-2) — CameraView`
- `fix(hooks): exhaustive-deps caso a caso documentado (BP-2) — EditorView`
- `docs: evidencia Lote 6 — red de seguridad (tests + higiene)`

## 9 · Desviaciones y pendientes (resumen ejecutivo)

1. **Wiring del toast** (§4): 1 línea en `page.tsx` — fuera de whitelist, zona del Agente A. Sin ella el aviso queda instrumentado (contador + consola) pero sin toast.
2. **`blobToDataUrl` sin test** (§1): `FileReader` no existe en bun → `test.skip` documentado.
3. **Funciones browser-only de pdf-export sin test** (§1): canvas/jsPDF runtime — exigiría dep de testing (prohibida).
4. **`unsharpRgba` fuera de la paridad** (§3): worker=OpenCV vs core=JS puro — no comparables sin cv.js.
5. **PresentationView:443** (§6): fuera de whitelist — fix identificado (seguro), pendiente del dueño.
6. **HALLAZGO del auto-OCR** (§6, L1734): con la dep antigua, el auto-OCR podía quedarse esperando para siempre en páginas <2048 px (fast y full producen el mismo data URL). El fix de dep implementado alinea el comportamiento con la intención documentada. Revisión del dueño recomendada en el PR.
7. **Nuevos exports del core** (§4): `persistSafely`, `notePersistFailure`, `PERSIST_FAILURE_EVENT` (aditivos; `index.ts` ya re-exporta `page-store`). El kit del Lote 6 no pide bump y PROHIBE tocar `packages/*/package.json` → sin bump; decisión de versión para el dueño.

