# Lote D — decisiones del dueño (nitidez, pinch-zoom, modo dev, OCR local)

**Kit:** `INSTR-ws-loteD-decisiones-v1` · **Agente:** B (calidad/estructura)
**Rama:** `feat/loteD-decisiones-v1` · **Base real:** `main` @ `0e9f924` (el kit
calibró sobre `1e874d4` — main avanzó con la pila de merges L5→L7→L8→L6→L9).
**Fecha:** 2026-10-17 · BUN obligatorio · PR SOLO DRAFT.

---

## 0 · Re-verificación de coordenadas (kit §0 — «re-verifica si main avanzó»)

Main avanzó (`0e9f924`) y el Lote 9 (estructural) movió archivos. Anclas reales:

| Ancla del kit | Posición real (post-L9) | Nota |
|---|---|---|
| `store.ts:115` `ScannerSettings` | `packages/scanner-core/src/types.ts:213-260` | **L9 movió la interfaz + `DEFAULT_SETTINGS` a `types.ts`**; `store.ts` los importa (`store.ts:15-18`). Campo nuevo va en `types.ts` (misma whitelist-función) |
| `store.ts:769-771` `updateSettings`→`saveSettings` | `store.ts:883-888` | intacto (patch merge gratis) |
| `store.ts:778-798` hidratación `loadSettings` | `page-store.ts:523-548` (L9 movió loadSettings a page-store) | merge defensivo `{ ...DEFAULT_SETTINGS, ...parsed }` → **instalaciones viejas toleran campos nuevos sin migración** |
| `EditorView.tsx:94` `PREVIEW_FAST_LONG_SIDE = 2048` | `EditorView.tsx:114` | movió (comentarios Lote 4/8) |
| `EditorView` pasada full `scheduleFullPass` ~L633 | `EditorView.tsx:631` | ✓ |
| `layout.tsx:55-56` `maximumScale/userScalable` | `layout.tsx:52-59` | eliminados (D-2) |
| `page.tsx:231` mount QAOverlay | `page.tsx:256` | gated (D-3) |
| `ocr.ts:28` `TESSERACT_CDN` | `ocr.ts:27-28` → ahora `TESSERACT_SRC` | sustituido (D-4) |
| `sw.js` bloque F2-C ~L92-115 | `sw.js:95-130` | ampliado (D-4) |
| `SettingsView` «Calidad de foto» ~L350 | `SettingsView.tsx:375-397` | patrón reutilizado para la fila Nitidez |

**Verificación clave D-1:** `scheduleFullPass` NO tiene gate por equipo (se
agenda SIEMPRE tras el tier fast) → `exacta` y `auto` **coinciden de momento**
(lo documenta el código en `types.ts` y `EditorView.tsx`); `ligera` es la única
que cambia el display (no agenda la pasada full).

---

## 1 · D-1 — COMP-4: ajuste «Nitidez del visor» (display only)

- `types.ts`: `previewQuality: "auto" | "exacta" | "ligera"` (default `auto`)
  con JSDoc de la semántica. Persistencia gratis (`saveSettings`/`loadSettings`,
  merge parcial verificado arriba).
- `EditorView.tsx`: select fino Zustand (`s.settings.previewQuality ?? "auto"`,
  FORT-6 — cambiar el ajuste NO re-renderiza la biblioteca); `ligera` salta la
  re-agenda de la pasada full en cache-hit fast (§2.3.3) y en el flujo completo
  (§2.3.1). Dep del efecto ampliado con `previewQuality` (re-pintado instantáneo
  desde cache al cambiar).
- `SettingsView.tsx`: fila «Nitidez del visor» en «Procesamiento», patrón Select
  de «Calidad de foto», subtitle íntegro del kit. Captura:
  `docs/lab/evidence/loteD/settings-nitidez-row.png`.
- **Invariante WYSIWYG intacto:** verificado por grep — `previewQuality` SOLO lo
  leen `EditorView` (display) y `SettingsView` (fila). Guardado/export/OCR/share
  siguen en `image-processor` a `PROCESSED_MAX_LONG_SIDE = 4032` (INTOCABLE).
- Humo (headless, build estático): selector muestra Auto/Exacta/Ligera →
  «Ligera» persiste en `escaner-settings-v1` (`"previewQuality":"ligera"`) y
  sobrevive al reload (value «Ligera» tras rehidratar). La verificación visual
  fast→full por opción en dispositivo físico queda pendiente (no hay cámara en
  sandbox) — la lógica es la misma rama `scheduleFullPass` ya cubierta por los
  tests del Lote 6.

## 2 · D-2 — COMP-1: pinch-zoom permitido

- `layout.tsx`: `maximumScale: 1` y `userScalable: false` eliminados; el resto
  del viewport export intacto (`viewportFit: "cover"` conservado — F-MOBILE).
- Meta renderizada verificada en navegador:
  `width=device-width, initial-scale=1, viewport-fit=cover` ✓ (WCAG 1.4.4).
- **HALLAZGO D-2 (reportado, NO parcheado — kit §1.1/D-2.3):** el claim del kit
  «el stage de cámara/editor ya usa touch-action (FORT 6.3)» NO se confirma con
  grep: el touch-action de FORT 6.3 vive SOLO en `PresentationView.tsx` (zoom/
  pan de foto en presentación). Cámara/editor gestionan sus gestos con pointer
  events (asas del quad con `setPointerCapture`+`preventDefault`), pero el
  pinch de DOS dedos sobre cámara/editor ahora hará zoom de PÁGINA. Si el dueño
  lo quiere bloqueado ahí, el fix es `touch-action: none` en el stage — queda
  propuesto, FUERA de la whitelist de este lote.
- Doble-tap-zoom molesto: no verificable en sandbox headless (no emula pinch/
  double-tap táctil real) — pendiente de iOS físico. Reportado honestamente.

## 3 · D-3 — BP-7: «Modo desarrollador» + gate del QA

- `types.ts`: `devMode: boolean` (default `false`).
- `page.tsx:256`: `{!showOnboarding && devMode && <QAOverlay />}` con select
  fino (`s.settings.devMode ?? false`). Verificado: QAOverlay no tiene otro
  path de montaje (grep: solo `page.tsx:256`) y el componente pinta `null`
  salvo armed/running/finished (`QAOverlay.tsx:117-120`).
- `SettingsView.tsx`: sección plegable nativa `<details>` (colapsada por
  defecto; SIN reintroducir `ui/collapsible` — regla de oro §1.4) al final de
  Ajustes con `<summary>` «Modo desarrollador» + chevron (`group-open`) y
  toggle «Panel de QA». Captura:
  `docs/lab/evidence/loteD/settings-modo-desarrollador.png`.
- Humo verificado en navegador:
  - default → **0 rastros del overlay QA** en DOM (`[data-qa-start]` ausente,
    chunk ni siquiera cargado).
  - activar (2 taps: summary → switch) → `devMode:true` persistido; armado del
    test → «Iniciar test (1 captura)» visible en cámara (overlay funcional).
  - reload → el ajuste persiste (overlay se re-monta; visual igual: pinta null
    en reposo).
- **HALLAZGO D-3 (fuera de whitelist — decisión del dueño):** la tarjeta
  «Test estándar QA» (botón «Preparar test») dentro de Ajustes › Diagnóstico
  (`SettingsView.tsx` `QaTestCard`, línea ~1081) sigue visible SIN devMode. El
  kit solo pedía gatear el MOUNT del QAOverlay (hecho). Si se quiere 0 rastros
  absolutos, el gate de esa tarjeta es una línea condicional — pendiente de
  orden explícita.

## 4 · D-4 — F-OCR-LOCAL: Tesseract self-host

### 4.1 Vendor descargado — origen y versión EXACTOS (kit D-4.2)

Verificación byte-exacto: sha256 local == hash oficial de jsdelivr (API
`data.jsdelivr.com`, base64→hex). **6/6 coinciden.**

| Archivo local | Origen oficial | Bytes | sha256 (primeros 12) |
|---|---|---|---|
| `tesseract.min.js` | `cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js` | 66.695 | `a8e29918d098` |
| `worker.min.js` | `cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js` | 123.724 | `aca1229639fc` |
| `tesseract-core-simd-lstm.wasm.js` | `cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core-simd-lstm.wasm.js` | 3.938.657 | `ce20eda9533c` |
| `tesseract-core-lstm.wasm.js` | `cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core-lstm.wasm.js` | 3.938.277 | `8f04aa0cc81e` |
| `lang/spa.traineddata.gz` | `cdn.jsdelivr.net/npm/@tesseract.js-data/spa@1.0.0/4.0.0_best_int/spa.traineddata.gz` | 2.100.190 | `40be52f97b5d` |
| `lang/eng.traineddata.gz` | `cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz` | 2.952.873 | `45b4cb346724` |

Notas de selección:
- `createWorker("spa+eng", 1)` → oem=1 (LSTM-only) → el worker v5.1.1 solo pide
  variantes `-lstm` del core (verificado en `worker.min.js`: selección
  `simd ? (lstm ? '-simd-lstm' : '-simd') : (lstm ? '-lstm' : '')`); los idiomas
  van a `4.0.0_best_int` (default del worker v5.1.1, confirmado en el binario).
  Por eso NO se vendorizan `tesseract-core[-simd].wasm.js` (oem=0) — si algún
  día se cambia el oem, añadirlos.
- Pesos: `vendor/ocr/` = **13 MB en disco** (lang 4,9 MB) · bundle de la app
  SIN CAMBIOS (assets servidos desde `public/`, no importados).

### 4.2 `ocr.ts` — carga local + opciones worker

- `TESSERACT_CDN` (jsdelivr) → `TESSERACT_SRC` local; `loadTesseract()` inyecta
  `${PUBLIC_BASE}/vendor/ocr/tesseract.min.js` (sin `crossOrigin` — mismo
  origen).
- `createWorker("spa+eng", 1, { workerPath, corePath, langPath })` — corePath
  como DIRECTORIO (el worker v5.1.1 añade la variante según SIMD+OEM — ambos
  cores `-lstm` vendorizados); langPath espera `{langPath}/{lang}.traineddata.gz`.
- **DESVIACIÓN JUSTIFICADA (kit §1.1):** el kit daba rutas absolutas
  `/vendor/ocr/**`, pero el deploy de Pages vive bajo **basePath
  `/web-scanner/lab`** (workflow) — una ruta absoluta daría 404 en producción.
  Se adopta el patrón del repo: `PUBLIC_BASE = process.env.NEXT_PUBLIC_BASE_PATH
  ?? ""` (idéntico a `detector-client.ts:167` `WORKER_URL`). En dev queda
  vacío; en Pages produce `/web-scanner/lab/vendor/ocr/**`.
- **0 dependencias npm nuevas** (global UMD inyectado, como antes).

### 4.3 `sw.js` — bloque F2-C (única zona tocada)

- Match local añadido: `url.pathname.includes("/vendor/ocr/")` + estrategia
  **cache-first en `OCR_CACHE`** (respeta `OCR_CACHE_MAX=20`) — la misma del
  bloque original.
- **Estrategia elegida: cache-on-first-use (runtime), NO precache en install.**
  Justificación: precachear ~13 MB de OCR en `install` retrasaría el arranque
  offline de TODA la app (y el control del SW) para usuarios que nunca abren
  «Texto». Con runtime, el primer OCR online llena el cache y de ahí en adelante
  funciona offline (verificado abajo).
- **DESVIACIÓN JUSTIFICADA (kit §1.1):** el kit proponía
  `startsWith("/vendor/ocr/")`, pero con basePath el pathname real es
  `/web-scanner/lab/vendor/ocr/**` → se usa `includes("/vendor/ocr/")`
  (literal de directorio específico del vendor; sobrevive a cualquier basePath).
  Verificado en vivo: el cache del SW capturó las **5 entradas** bajo
  `/web-scanner/vendor/ocr/**` (tesseract.min.js, worker.min.js,
  tesseract-core-simd-lstm.wasm.js, spa/eng.traineddata.gz).
- El match jsdelivr se conserva como defensa (0 peticiones esperadas).

### 4.4 Humo de red y offline (kit D-4.5 / §3.3)

Entorno: Chromium headless (agent-browser). Tres orígenes probados:
1. **Dev** `localhost:3100` — OCR real con las opciones de `ocr.ts`:
   texto reconocido («ACTA DE ESCANEO LOCAL 12345 / OCR sin CDN funciona») con
   **0 peticiones a jsdelivr** (`performance.getEntriesByType('resource')`).
2. **Dev + SW controlando** (registro manual — `pwa.ts` se salta localhost):
   OCR ok → `escaner-v7-ocr` llena entradas `/vendor/ocr/**`.
3. **Build estático con basePath de Pages** (`BUILD_STATIC=1
   NEXT_PUBLIC_BASE_PATH=/web-scanner`, servido con `Cache-Control: max-age=600`
   tipo Pages): OCR online ok («DOCUMENTO PRODUCCION 42» / «BASEPATH OCR LOCAL
   55») → **offline** (network cut) ok («OFFLINE BASEPATH OK») → **offline +
   reload** ok (app shell desde precache del SW + OCR «RECARGA SIN RED 33»).
   Captura del arranque: `docs/lab/evidence/loteD/static-build-home.png`.

Matriz offline explicada: main-thread (tesseract.min.js) y `new Worker()`
(worker.min.js) + core + traineddata **todos pasan por el SW** (el worker
dedicado de tesseract se crea con `workerPath` en scope → sus fetch internos
también atraviesan el SW — verificado con las 5 entradas del cache). Además
tesseract v5 cachea traineddata en IndexedDB (defensa extra).

### 4.5 Delta de peso del repo (kit D-4.6)

- `du -sh apps/scanner-lab/public/vendor/ocr/` = **13 MB** (4,9 MB lang).
- `git count-objects -vH` antes (main `0e9f924`): `size-pack 6,25 MiB` →
  después del commit del vendor: ver sección «Gates» del CHANGES (medido tras
  commitear).
- Primera carga del usuario SIN CAMBIOS: los assets OCR son lazy (solo cuando
  el usuario abre «Texto» o activa OCR automático).

---

## 5 · Verificación obligatoria (kit §3) — resultados

1. `bun install --frozen-lockfile` ✓ · `core:check && ui:check && app:check` ✓
   exit 0 (×2 rondas: tras implementar y tras el fix basePath).
2. `bun run lint` → **0 errores** (143 warnings = baseline L9) · `bun test` →
   **206 pass / 0 fail / 2 skip** · `bun run build:static` ✓ exit 0 (×2).
3. Smoke completo: verificado en lo automatizable del sandbox (biblioteca →
   ajustes → selector nitidez → persistencia; QA oculto por defecto y
   activable; OCR online/offline sin CDN). La cámara (captura real → editor en
   3 nitideces, PDF idéntico entre modos, pinch físico) NO es automatizable
   aquí → **pendiente de dispositivo**, igual que en lotes anteriores.
4. Instalación vieja simulada ✓: `escaner-settings-v1` SIN
   `previewQuality`/`devMode` → la app arranca con defaults («Auto», QA
   oculto) sin error (merge defensivo de `loadSettings`).
5. Métricas: §4.5 + capturas en `docs/lab/evidence/loteD/`.

## 6 · Desviaciones del kit (§1.1) — resumen para el dueño

| # | Desviación | Motivo |
|---|---|---|
| 1 | Rutas OCR con prefijo `PUBLIC_BASE` (no absolutas `/vendor/ocr/**`) | basePath de Pages (`/web-scanner/lab`) — patrón `detector-client.ts` |
| 2 | SW: `includes("/vendor/ocr/")` en vez de `startsWith` | ídem |
| 3 | Campos settings en `types.ts` (no `store.ts:115`) | L9 movió la interfaz — el kit calibró sobre main viejo |
| 4 | QaTestCard de Diagnóstico sigue visible sin devMode | fuera de whitelist gatearla; se reporta (hallazgo D-3) |
| 5 | Sin parche touch-action en stages de cámara/editor | fuera de whitelist; hallazgo D-2 reportado |

## 7 · Pendientes (no bloqueantes)

- Verificación física (iOS/Android): pinch real, doble-tap, nitidez fast→full
  por opción, PDF idéntico entre modos.
- Si el dueño quiere OCR precacheado en install (offline garantizado sin
  primer uso online): una línea en `sw.js` install `cache.addAll` — decisión
  explícita (hoy: cache-on-first-use, justificado arriba).
- Gate de QaTestCard + touch-action de stages: esperando orden.
