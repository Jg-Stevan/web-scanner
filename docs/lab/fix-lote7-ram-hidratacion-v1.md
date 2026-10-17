# Lote 7 — RAM: hidratación perezosa + Blob URLs on-demand (kit `INSTR-ws-lote7-ram-hidratacion-v1`)

**Rama:** `feat/lote7-ram-hidratacion-v1` (apilada sobre `fix/lote5-quickwins-v1`) · **Diseño-first — este doc se escribe ANTES de los commits de código (T0.4).**

## T0.1 — Inventario de consumidores (102 refs, grep completo)

| Campo | Consumidor | Vista/contexto | Síncrono | Riesgo si llega vacío |
|---|---|---|---|---|
| `.thumbnail` | `store.ts` ×6, `pdf-export.ts` ×4 (portada), `LibraryView` ×3 (covers), `EditorView` ×3, `page-store` ×2, `SettingsView` ×1, `PresentationView` ×1 | biblioteca (covers), PDF portada, stats | sync | cover roto — **hidrata SIEMPRE (es el único materializado al boot)** |
| `.processed` | `EditorView` ×18 (pipeline preview/warp), `store.ts` ×12 (merge/reprocess), `pdf-export.ts` ×4, `PresentationView` ×1-2 (`src=`), `LibraryView` ×2 (OCR lote, export), `SettingsView` ×1 (stats) | editor, export, presentación | mixto | render vacío / reproceso roto / **página omitida al persistir** |
| `.original` | `EditorView` ×23, `store.ts` ×18 (reprocesos: `setFilterOnPage`, `duplicateDocument` vía copia, `saveSessionToDocument`), `PresentationView` ×1, `SettingsView` ×1 | editor (reprocesos), stats | mixto | reproceso roto (filtros/duplicado) |

### Consumidores que ESCRIBEN (línea roja de pérdida de datos)

1. **`persistDocument` (page-store.ts L131)** — reescrive el doc completo (`put`) y **OMITE páginas con data URL inválida** (warn). Con campos lazy `""`, cualquier `toggleFavorite`/rename/tag (×9 call-sites) borraría las páginas no materializadas de IndexedDB. → **GUARD obligatorio** (ver T0.2.4).
2. **`duplicateDocument` (store.ts L660)** — copia campos verbatim (`{...p, id: nuevo}`) sin reprocesar → la copia con campos `""` se persistiría VACÍA (sin registro previo que rescatar). → **materializar antes de copiar**.
3. **`setFilterOnPage` (store.ts L708)** — `processImage(page.original…)` con `""` lanza → catch conserva la procesada vieja → **el filtro no se aplica en silencio**. → **materializar antes**.
4. `saveSessionToDocument`/`beginReviewDocument` — la sesión se copia del doc: con campos `""` el merge marcaría `geometrySame` ("" === "") y conservaría prev (seguro por accidente), pero el EDITOR renderizaría vacío y los reprocesos fallarían. → **materializar la sesión al abrir**.

## T0.2 — Diseño de materialización (aprobado para implementación)

### 1. Hidratación perezosa
`loadAllDocumentsLazy()` (page-store.ts): igual que `loadAllDocuments` pero **solo `thumbnail` se convierte a data URL** (C-10 paralelo por página preservado); `original`/`processed` llegan al store como **`""`**. Los Blobs NO se retienen en RAM — se releen de IndexedDB por demanda. `hydrateFromStorage` pasa a usarla. Formato en disco: **intacto** (StoredPage con Blobs).

### 2. API de materialización (page-store.ts)
- `loadPageBlobs(docId, pageId): Promise<{original: Blob, processed: Blob} | null>` — `get(docId)` directo a IndexedDB (una lectura, cero base64).
- `getPageImageData(docId, pageId): Promise<{originalUrl, processedUrl} | null>` — `URL.createObjectURL` (NO data URL: cero base64 en RAM, cero duplicación de bytes) con **caché LRU de 8 entradas** (`docId:pageId`), `revokeObjectURL` al expulsar.
- `releasePageImageData(docId, pageId)` — revoke determinista (cierre de editor/presentación).
- `PageImageCache` — clase pura inyectable (create/dispose) para tests `bun test` (eviction, hit/miss, release, claves duplicadas).

### 3. Materialización de un doc abierto (editor)
- `beginReviewDocument` → **async**: materializa TODAS las páginas del doc a data URLs (`loadPageBlobs` + `blobToDataUrl`) ANTES de montar la sesión → el editor recibe datos 100% materializados (cero cambios en EditorView y su pipeline de previews). Coste RAM = el que hoy paga el boot por TODA la biblioteca, pero solo para UN doc y solo mientras el editor está abierto. `openDocument` lo espera (editores sin flash ni carreras).
- Al guardar (`saveSessionToDocument`): páginas sin cambios → `geometrySame` conserva la página previa LAZY del store ("" === "" ✓); páginas editadas → quedan materializadas (data URL nueva del reproceso — igual que hoy).

### 4. Guard anti-pérdida en `persistDocument` (firewall)
Antes del `put`: leer el registro EXISTENTE del doc (`get(docId)`) y construir `prevByPage`. Por página y campo: `dataUrlToBlob(x)`; si es `null` (campo `""` o `blob:` no convertible) → **usar el Blob previo de esa `page.id` byte-idéntico**; solo si tampoco existe → omitir página (comportamiento actual). **Hace imposible la pérdida por páginas no materializadas, incluso con mutaciones no cubiertas.**

### 5. Exports desde biblioteca (LibraryView)
- Nueva acción de store `materializeDocument(docId): Promise<ScanDocument | null>` (materializa todas las páginas en el store y devuelve el doc) + `reLazyDocument(docId)` (devuelve a `""` las páginas que estaban lazy — solo se puede llamar tras materialize).
- `exportPdf`/`sharePdf`/`runExportSelected`/`runExportAll`/`runBatchOcr`: `await materializeDocument(...)` antes de `buildDocPdf`/`buildLibraryPdf`/`toJpeg` (pdf-export.ts queda INTOCADO — prohibido por el kit) y `reLazyDocument` en el `finally`. **Pico de RAM durante export de biblioteca ≈ al de hoy** (pdf-export materializa todo internamente) — documentado; el win del lote es la RESIDENCIA en reposo.
- `dataUrlBytes("")` = 0 verificado (format.ts L40) → stats de SettingsView (fuera de whitelist §6 — no se toca) subcuentan el storage de páginas lazy: desviación documentada, no rompe.

### 6. Riesgos cubiertos
| Riesgo (kit T0.3) | Cobertura |
|---|---|
| `<img>` con URL aún no materializada | editor: materialización previa al mount (sin flash); biblioteca: thumbnail hidratado |
| export PDF mientras materializa | handlers `await materializeDocument` explícito antes de build |
| QA/diag que lee `processed` | diag-report usa metadatos (verificado — `perf-probe`/diag no leen imágenes); SettingsView subcuenta (d-sv) |
| share desde biblioteca | `sharePdf` pasa por materialize/re-lazy igual que export |
| use-after-revoke | blob URLs SOLO en memoria volátil; **nunca se persisten** (guard: `blob:` no convertible → prev blob); revoke solo al expulsar del LRU/cerrar |
| escritura de página nunca materializada | guard de `persistDocument` (T0.2.4) — firewall total |
| worker/OCR de sesión | páginas de sesión (cámara) SIEMPRE materializadas por el pipeline vivo — intocadas |

## T0.3 — Alcance de código

| Archivo | Cambio |
|---|---|
| `packages/scanner-core/src/page-store.ts` | `loadPageBlobs`, `PageImageCache`+`getPageImageData`+`releasePageImageData`, `loadAllDocumentsLazy`, guard en `persistDocument` |
| `packages/scanner-core/src/store.ts` | hydrate lazy; `beginReviewDocument` async + materialización; guards `setFilterOnPage`/`duplicateDocument`; acciones `materializeDocument`/`reLazyDocument` |
| `apps/scanner-lab/src/components/scanner/LibraryView.tsx` | 5 handlers: materialize antes de export/OCR + re-lazy en finally |
| `packages/scanner-core/tests/page-image-cache.test.ts` | tests de la LRU (bun test) |
| `EditorView`/`PresentationView`/`pdf-export.ts`/`CameraView` (T3) | **SIN cambios** — el diseño los hace innecesarios (T3 COMP-3 queda pendiente: toca el pipeline de captura) |

Commits: `perf(store): hidratación perezosa — solo thumbnails al boot (BLQ-6)` · `feat(store): materialización on-demand con LRU/revoke + guard anti-pérdida (BLQ-6)` · `perf(views): exports de biblioteca materializan on-demand y liberan`.

## T0.4 — QA pendiente de dispositivo (registrado para el dueño)
La medición de heap en dispositivo físico (15 docs × 3-4 págs, open/close ×10, iOS jetsam) requiere dispositivo real — en sandbox se ejecuta smoke headless completo (biblioteca → abrir doc → editar → guardar → **reload y verificar integridad de datos** → export → OCR lote) + `bun test` de la LRU.
