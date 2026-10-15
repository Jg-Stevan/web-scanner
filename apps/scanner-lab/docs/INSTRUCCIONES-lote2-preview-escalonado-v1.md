# INSTRUCCIONES — LOTE 2: Preview escalonado del editor (v1)

> **Archivo canónico de esta spec:** `apps/scanner-lab/docs/INSTRUCCIONES-lote2-preview-escalonado-v1.md`
> — lo commitea el DUEÑO en `main` ANTES de lanzar al agente (GitHub web → Add file → esa ruta). **La raíz del repo NUNCA recibe specs.**
> Política de ubicación: cada lote vive en `apps/<app>/docs/` (lab → `apps/scanner-lab/docs/`, donde ya viven los `fix-*.md`; e14 → `apps/digitalizador-e14/docs/`). La raíz solo aloja `AGENTS.md`/`README`/`CHANGES`/`DEPLOY`.
>
> **Rama:** `perf/lote2-preview` — créala DESDE `perf/post-capture-f2` (tip `1c508b0`).
> Si `perf/post-capture-f2` ya fue mergeada a `main`, créala desde `main`.
> **Prerequisito bloqueante:** merge de `perf/post-capture-f2` (#43) ANTES de empezar (las anclas de esta spec viven en ese código). `feat/e14-zoom-inline` (#45) ya está en `main`.

---

## 0. Whitelist (SOLO estos archivos pueden cambiar)

1. `packages/scanner-core/src/image-processor.ts`
2. `apps/scanner-lab/src/components/scanner/EditorView.tsx`
3. `apps/scanner-lab/src/lib/diag-report.ts`
4. `CHANGES.md`

(El archivo de esta spec ya vive en `main` en `apps/scanner-lab/docs/` — NO forma parte del diff del agente: `git diff --stat` debe mostrar SOLO los 4 archivos de arriba.)

**INMUTABLES — CERO toques:** `apps/digitalizador-e14/` completo, `packages/scanner-core/src/ocr.ts`, `packages/scanner-core/src/pdf-export.ts`, `packages/scanner-core/src/detector-client.ts`, `apps/scanner-lab/public/sw.js`, `package.json`, `bun.lock`, cualquier otro archivo de `packages/`. Sin dependencias nuevas.

**Validación estática obligatoria:** `bun run core:check` (tsc) = 0 · `bun run lint` (eslint) = 0 · `bun run app:check` = 0 · `git diff --stat` contra la base = SOLO los 4 archivos de la whitelist.

---

## 1. Contexto (datos, no supuestos)

Diag `scannerlab-diag-SM-A135M-20261013-1241` (SM-A135M, build `perf/post-capture-f2 @ 879ff20 f2-lote1`):

- Tras el disparo, la página nace en el store SOLO con `original` (foto ≤4032) + `quad` (`CameraView.tsx`, bloque `const page: CapturePage = {...}` → `addCapturePage(page)` → `setView("editor")` inmediato).
- El editor monta → cache miss → `processImage(page.original, page.quad, page.filter, page.rotation, { manual, maxLongSide: PROCESSED_MAX_LONG_SIDE })` (`EditorView.tsx` L639): decodifica el original y hace **warp de 12 MP con INTER_CUBIC en el DetectionWorker** (`image-processor.ts` L865 `client.warp(img, quad, ...)`) + filtro + encode PNG.
- Costo medido: `editor_first_render` = **38 398 ms** en esta sesión (12 072 ms en diag 0951 sin congestión). El usuario lo vive como "el editor tarda en abrirse y mientras la cámara sigue ahí".
- El photo grace (~17.5 s, piso del navegador, saga cerrada) es IRREDUCIBLE: la foto no existe antes. Lo único optimizable es el render DENTRO del editor.

**Principio de diseño:** el usuario debe VER el acta rápido; la resolución completa (WYSIWYG del guardado) no se toca.

## 2. F2-E — Preview escalonado (fast-first-preview)

### 2.1 Constante nueva

En `apps/scanner-lab/src/components/scanner/EditorView.tsx`, junto a donde se importa/usar `PROCESSED_MAX_LONG_SIDE`:

```ts
/** LOTE 2 (F2-E) — lado mayor del PRIMER pintado del editor (tier fast).
 *  2048: el warp del worker escala ~cuadrático con el output
 *  ((2048/4032)² ≈ 0.26×) y el downscale 4032→2048 cuesta ~1 ms en A13.
 *  El tier full (4032) llega después en background y reemplaza este entry. */
const PREVIEW_FAST_LONG_SIDE = 2048;
```

### 2.2 Cambio en `image-processor.ts` (additivo)

En `processImagePrecise` (`packages/scanner-core/src/image-processor.ts`, el warp está en L865):

- HOY: `const img = await loadImage(src); ... const warp = await client.warp(img, quad, opts?.manual === true);`
- CAMBIO: cuando `opts?.maxLongSide` esté definido y sea **menor** que el lado mayor del img, reducir la ENTRADA del warp a ese tope antes de enviarla al worker (p. ej. `createImageBitmap(img, { resizeWidth, resizeHeight, resizeQuality: "high" })` — corre fuera del hilo principal — o el capador canvas existente). El output del warp queda ≤ maxLongSide por construcción.
- La ruta de fallback (`processImageCanvas`) ya escala por output: NO tocarla.
- ⚠️ INVARIANTE WYSIWYG: cuando `maxLongSide` sea `PROCESSED_MAX_LONG_SIDE` (4032) o no venga, el comportamiento debe ser **byte a byte el de hoy**. El guardado (`store.ts` L303/462/587/713, todas con 4032) queda intocable. El tier fast es SOLO display del editor.

### 2.3 Cambio en `EditorView.tsx` (el corazón)

En el efecto del preview (anclas: L567 `cacheKey`, L604 cache-hit check, L633 `beginBackgroundJob()`, L639 `processImage`, L655 `cachePreviewEntry`, L670 mark `editor_first_render`, L681 cleanup):

1. **Cache miss (hoy L639):** ejecutar DOS pasadas secuenciales:
   - **Pasada FAST:** `processImage(page.original, page.quad, page.filter, page.rotation, { manual: page.quadManual === true, maxLongSide: PREVIEW_FAST_LONG_SIDE })` → `cachePreviewEntry` + `setPreview` con un entry marcado `tier: "fast"` → mark `editor_first_render` **igual que hoy** (mismo orden de campos) **+ `previewTier: "fast"`**.
   - **Pasada FULL (background, no bloquea):** inmediatamente después, misma llamada con `maxLongSide: PROCESSED_MAX_LONG_SIDE`; al resolver: reemplazar el entry en el cache con `tier: "full"`, `setPreview` del nuevo entry SOLO si la página/filtro/rotación siguen siendo los mismos (el cacheKey no cambió) → mark aditivo `editor_preview_upgraded` con `{ ms, filterId }`.
2. **Cancelación:** el job FULL se cancela si (a) el componente se desmonta (el `return () => { cancelled = true }` de L681 ya existe — extiéndelo a la pasada FULL), (b) el cacheKey cambia (página/filtro/rotación — hoy el effect ya se re-ejecuta), (c) la vista vuelve a cámara (el desmontaje cubre este caso).
3. **Cache-hit con tier fast (L604-617):** si el entry cacheado tiene `tier: "fast"`, pintar instantáneo (como hoy) y **re-agendar la pasada FULL** en background (mismo mecanismo del punto 1). Si es `tier: "full"`, comportamiento actual.
4. **Cortesía con la cámara:** la pasada FULL NO debe seguir viva cuando el usuario dispare la siguiente foto. La cancelación por desmontaje lo garantiza en el flujo normal (editor → cámara desmonta el editor). El mark `capture_shot` ya estampa `bgJobsAtShot` — debe quedarse en **0**.
5. **PreviewEntry:** agregar el campo `tier: "fast" | "full"` (y donde se construyen entries: fast L655-rama, full en la pasada 2, y el cache-hit existente conserva su tier). Los entries creados por OTROS caminos que llamen `cachePreviewEntry` con processImage a 4032 (si los hay — verificar L1283 `capturePageKey(p)`) quedan `tier: "full"`.

### 2.4 Qué NO cambia

- El guardado (`handleSave`/`saveSessionToDocument`), el export (PDF/PNG), el OCR y los filtros manuales del usuario (cualquier cambio de filtro/rotación re-procesa a 4032 como hoy — WYSIWYG estricto).
- El detector de cámara, el worker client, `setWarpCap` global (`page.tsx` L104 queda en 4032).
- La captura: NADA nuevo corre entre `capture_fired` y `page_saved`.

## 3. F2-F — Escalera PDF: fast path SOLO en el primer intento

`packages/scanner-core/src/pdf-export.ts` (OJO: tocamos este archivo EXCEPCIONALMENTE para este fix de ~4 líneas — está en la whitelist de esta spec aunque era inmutable en F2):

- HOY (bug latente): con `allowJpegFast=true`, TODOS los intentos devuelven el MISMO JPEG full-size q0.95 (`toJpegAt(src, 0, 0.95)` ignora `attempt.longSide/quality`) → si un documento excediera `budgetBytes`, los reintentos regenerarían bytes idénticos inútiles.
- CAMBIO: el fast path aplica SOLO al primer intento. Pasa `attemptIdx === 0` a `pageForAttempt` (nuevo parámetro o combínalo con `allowJpegFast` en el call-site de `buildDocPdf` y `buildLibraryPdf`) y en los intentos ≥2 cae a la escalera normal (`toJpegAt(src, attempt.longSide, attempt.quality)`), que sí reduce.
- En calidad «máxima» NO cambia nada (PNG puro se conserva igual que hoy, con o sin reintentos).

## 4. F2-G — Diag: tier del primer render (aditivo)

`apps/scanner-lab/src/lib/diag-report.ts` (anclas: L190-194 `firstRenderMs`/`firstRenders`, L328-340 la agregación de `editor_first_render`):

- Agregar al section `editor`: `firstRenderTier: string | null` (de `m.meta?.previewTier`) y `previewUpgrades: number` (count de marks `editor_preview_upgraded`).
- TXT: una línea extra SOLO si hay datos: `Preview escalonado        : fast→full · upgrade N`.
- Todo lo demás del informe: byte a byte igual.

**Descarte documentado:** el `cachedCount` por filtro de F2-D queda oficialmente descontinuado (nadie escribe `meta.cached` en `filter_applied` y los cache-hits no emiten ese mark; el dato útil ya vive en `editor_first_render.cached`). No reintentar esa telemetría.

## 5. NO-objetivos de este lote

- **OCR downscale (piso de 38-44 s):** es la única palanca real contra ese piso, pero cambia la CALIDAD del reconocimiento (el score-ocr de e14 depende del mismo `scanner-core`) y no tenemos corpus de actas para gates de precisión. Iteración propia, futura, con harness de accuracy. NO tocar `ocr.ts` aquí.
- **Muro 2000 ms / photo grace:** cerrados por la saga burst (piso del navegador en A13, heapProbe plana).
- Cualquier refactor, renombre o "mejora de paso".

## 6. Gates físicos (A13, corrida única con el test estándar)

| # | Gate | Meta |
|---|---|---|
| L2-G1 | Primer render del editor (tier fast) | `< 4000 ms` (ideal ≤2500) · mark `editor_first_render` con `previewTier:"fast"` |
| L2-G2 | Captura SIN regresión | mediana `captureToSavedMs` en `17994±2000` · heapProbe plana (sierra ~0) · `bgJobsAtShot = 0` |
| L2-G3 | Upgrade a full | mark `editor_preview_upgraded` presente · `pxLong` del export sigue 3031± y bytes PDF ~261 KB ±30 % (WYSIWYG 4032 intacto) |
| L2-G4 | Test estándar | 11/11 pasos ok · paso QA `editor-1` `< 8000 ms` (baseline 30230) |
| L2-G5 | Estática | tsc 0 · eslint 0 · whitelist exacta · inmutables CERO · sin deps nuevas |

**Criterio de parada:** 1 iteración por blanco. Si L2-G2 muestra regresión de captura, el fix es BAJAR la agresividad (cancelar la pasada FULL más temprano o subirla a `requestIdleCallback`), no una saga.

## 7. Reporte que debe entregar el agente

1. `git diff --stat` contra la base (deben ser SOLO los 4 archivos).
2. tsc/eslint pegados tal cual.
3. Lista de marks nuevos/modificados con sus campos exactos.
4. Confirmación explícita de que `store.ts`, `detector-client.ts`, `ocr.ts`, `pdf-export.ts` (salvo el fix F2-F puntual), e14 y `sw.js` quedaron byte a byte intactos.
5. Cualquier desviación de esta spec, dicha tal cual.

---

## 8. PROMPT LISTO PARA PEGAR (Jules o Codespace)

```text
Lee apps/scanner-lab/docs/INSTRUCCIONES-lote2-preview-escalonado-v1.md (en main) y ejecútalo COMPLETO y AL PIE DE LA LETRA.

Reglas duras:
- Rama nueva: perf/lote2-preview, basada en perf/post-capture-f2 (o main si ya fue mergeado).
- SOLO los 4 archivos de la whitelist (§0). CERO cambios en inmutables. Sin dependencias nuevas.
- La pasada FULL del preview (§2.3) SIEMPRE cancelable y NUNCA viva cuando la cámara dispara (bgJobsAtShot = 0).
- WYSIWYG intocable: guardado/export a 4032 byte a byte como hoy.
- Al terminar: bun run core:check, bun run app:check, bun run lint — pega los resultados reales.
- git diff --stat contra la base pegado tal cual (deben ser solo los 4 archivos).
- Haz commit (mensaje: perf(editor): LOTE 2 — preview escalonado fast-first + upgrade full en background) pero NO hagas push ni PR: yo reviso el diff primero.
```
