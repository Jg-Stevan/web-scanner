# Lote 5 — quick wins perf + limpieza-v2 (kit `INSTR-ws-lote5-quickwins-v1`)

**Rama:** `fix/lote5-quickwins-v1` desde `main` @ `1e874d4` · **6 commits** · BUN 1.3.14.
**Gates:** `core:check` + `ui:check` + `app:check` + `lint` = exit 0 · `build:static` exit 0 · smoke navegador 0 errores de consola.

## T1 — PERF-1: OpenCV diferido a la entrada de cámara

**Cambios:**
- `page.tsx`: fuera `warmUpScannerWorker()` del effect de montaje (L104) y fuera `getScannerWorker()?.setWarpCap(4032)` (L112). **Justificación de la 2.ª:** el worker carga OpenCV **eager** en el eval del script (`detection-worker.js` L1673 `loadOpenCv()` top-level), así que CUALQUIER `getScannerWorker()` en montaje spawnea el worker y descarga los ~8.4 MB. El `setWarpCap` era explícito-redundante: el default del worker YA es 4032 (`detection-worker.js` L271 `warpMaxLongSide = 4032` = `PROCESSED_MAX_LONG_SIDE`) — cero cambio de comportamiento (verificado en código, ambos valores literales).
- Fallback deliberado en `page.tsx` (mismo effect, zona whitelist L~100-115): si `view !== "camera"` al montar → `requestIdleCallback` con `{ timeout: 3000 }` → re-check de vista → `warmUpScannerWorker()`. Guard `typeof requestIdleCallback !== "undefined"` (Safari). Cleanup con `cancelIdleCallback`.
- `CameraView.tsx`: `warmUpScannerWorker()` UNA vez al inicio del effect de arranque de cámara (L2310, antes del return temprano de permisos — corre en rutas real/sintética). `waitReady()` es idempotente (cachea `_ready`/`readyPromise` — verificado `detector-client.ts` L197-205).

**Evidencia de arranque (grep):** `warmUpScannerWorker` → solo `page.tsx` (fallback idle) + `CameraView.tsx` (mount) + definiciones en core. Cero llamadas en montaje de página.

## T2 — PERF-2: jsPDF dinámico

**Inventario (todos los call-sites verificados):** EditorView `sanitizeFileName`/`downloadBlob`/`buildDocPdf` en 3 handlers async (`handleSaveImage`, `downloadDocPdf`, `shareDocPdf`); LibraryView `buildLibraryPdf` ×2, `toJpeg` ×1 (`runBatchOcr` — **handler, NO render-path**), `sanitizeFileName`/`buildDocPdf`/`downloadBlob` en 3 handlers. **8 handlers → `await import("@jg-stevan/scanner-core/pdf-export")`** (patrón diag-report/SettingsView). Cero import estático de `pdf-export` en `apps/` (grep = vacío).

**Desviación D-2 (hallazgo fuera de whitelist):** el objetivo «sin jsPDF en el chunk inicial» seguía roto por una cadena INTERNA del package: `packages/scanner-core/src/text-export.ts:12` importa `downloadBlob/sanitizeFileName` de `./pdf-export` (que importa jspdf en su L17), y `packages/scanner-core/src/index.ts:16` re-exporta `pdf-export`. La app importa `text-export` estáticamente en el grafo inicial (LibraryView/EditorView) → jspdf (425 KB) seguía inicial. **Resolución puente (en whitelist, patrón «helper local» de T2.3, copias VERBATIM con comentario de fuente):** `docHasOcrText` (text-export.ts L34-36) como helper local en LibraryView; `ocrTextOfPages` (L18-26) como helper local en EditorView (uso en `useMemo` render-path); `downloadOcrTxt`/`shareOcrText` → import dinámico en los 2 handlers de texto (`exportText` ahora async). **El fix canónico — separar los helpers de descarga de `pdf-export.ts` en el core — queda PENDIENTE del dueño** (fuera de whitelist §6); los helpers puente son byte-idénticos y se borran ese día.

**Métrica First Load JS (chunks del HTML prerenderizado, mismo método antes/después):**

| | main `1e874d4` | lote5 `3cdb72c` |
|---|---|---|
| JS de carga inicial | **1.633.634 B** (12 chunks) | **1.207.897 B** (13 chunks) |
| Δ | — | **−425.737 B (−26%)** |
| chunk jsPDF | inicial (642 KB compartido) | **lazy** (`305wsxt0adiik.js`, 425.837 B, on-demand) |
| Meta auditoría ≤ 1.300 KB | ✗ (1,56 MB) | **✓ (1,15 MB)** |

## T3 — limpieza-v2 (D-1): 31 ui + 20 radix + use-mobile

- **31 componentes borrados** (accordion…tooltip) + `hooks/use-mobile.ts` — cada uno con prueba `git grep "ui/<nombre>"` = **0 importers externos** (los cruces entre muertos no cuentan; lista completa verificada en tanda, 4 tandas de ~8 con `core:check`+`ui:check`+`app:check`+`lint` verdes entre tanda y tanda).
- **20 deps `@radix-ui/react-*` fuera** de `apps/scanner-lab/package.json` (42→22 deps) con 0 referencias post-purga; `bun.lock` regenerado.
- **KEEP intacto:** los 7 ui vivos (alert-dialog, button, dialog, dropdown-menu, input, select, switch) + `@radix-ui/react-{alert-dialog,dialog,dropdown-menu,select,slot,switch}` + lucide-react, framer-motion, sonner, vaul, next-themes, class-variance-authority, clsx, tailwind-merge, tw-animate-css, heic2any, jspdf, zustand.
- Humo: `grep "components/ui/"` en `apps/scanner-lab/src` → solo los 7 vivos. Diff: **−3.167 líneas**.

## T4 — BLQ-7a: metadatos npm

- Ambos packages: `repository` (github:Jg-Stevan/web-scanner + directory), `homepage` (Pages), `bugs`, `keywords` (8 core / 6 ui, honestas), `engines: { bun: ">=1.1" }`, `files: ["dist","README.md","LICENSE"]`.
- **`sideEffects`: NO se declara — opción «no lo pongas y repórtalo» del kit.** Razón: 3 módulos del core registran globals al import (`detector-client.ts:543` `__scannerPrecision`, `store.ts:811` `__scannerStore`, `sensor-profiler.ts:169-175` `__sensorTools`) y las rutas con efecto difieren entre layout dev (`src/*.ts`) y publicado (`dist/*.js`) — una lista incompleta rompería las tools de QA en silencio por tree-shake. `frame-loop.ts` sin efectos top-level (verificado).
- `LICENSE` (MIT raíz) copiado a `packages/scanner-core/LICENSE` y `packages/scanner-ui/LICENSE` + añadido a `files`.
- `publish:stage` verificado en AMBOS: `.publish/package.json` con metadata completa y `prepublishOnly` preservado (E-15 de limpieza intacto).
- **Desviación D-1 (fuera de whitelist → pendiente del dueño):** `make-publish-package.mjs` (core L~28 y ui, misma línea `cpSync("README.md", ".publish/README.md")`) NO copia LICENSE al `.publish/` — un publish real saldría sin LICENSE pese a `files`. Fix de 1 línea por script (`cpSync("LICENSE", ".publish/LICENSE");`) — el script no está en la whitelist §6 del lote, no se toca.

## T5 — BLQ-7b: fallback CDN de OpenCV fuera

- `detection-worker.js`: `OPENCV_CDN_URL` (L1491) y su `out.push(...)` (L1499) eliminados — `opencvCandidateUrls()` devuelve SOLO las 2 rutas vendor locales; si ambas fallan, `loadOpenCv()` lanza → estado de error/self-healing existente (re-spawn + Sobel canvas). Cero reintentos nuevos, resto del worker intocado (detección/cascada/RANSAC).
- Humo: `grep "https://" detection-worker.js` = **0 URLs activas** · sintaxis válida (`node --check`).
- **Pendiente del dueño (NO tocado):** `tesseract.js` CDN en `packages/scanner-core/src/ocr.ts:28` — decisión de self-host OCR pendiente (kit T5.5).

## T6 — LEG-1 residual

- `AGENTS.md` L12-14: refs a `apps/digitalizador-e14/docs/` marcadas «(histórico del repo origen…)» + equivalente actual (`docs/` y `docs/DECISIONS.md` de la raíz). No se redefinió ninguna regla.
- `CHANGES.md`: entradas históricas intocadas (append-only) — nota en la entrada del lote.
- `.env.example`: verificado inexistente (eliminado en PR #7) — nada que hacer.

## Smoke navegador (§3.5, build estático servido, headless Chromium)

| Check | Resultado |
|---|---|
| (a) visita solo-biblioteca | **0 spawns de worker en el boot**; a t+3-7 s el fallback idle spawnea 1 y `__scannerPrecision()` = `{ready:true,dead:false}` (diseño T1.3) |
| (b) entrada a cámara | **1 worker total** (dedupe del warm-up ✓), visor sintético vivo, captura OK |
| (c) Exportar PDF desde biblioteca | chunk `305wsxt0adiik.js` (jspdf) **cargado on-demand**, toast «PDF exportado · 1 página · 39.9 KB» |
| (d) biblioteca | portadas visibles, abrir doc → editor → volver, **0 errores de consola en toda la sesión** |

NOTA de medición: la red del worker (importScripts de OpenCV) no es visible en el performance API del document; la verificación se hizo por spawns del worker + `__scannerPrecision` (hook QA del propio repo).

## Métricas finales

- First Load JS: 1.633.634 → **1.207.897 B (−26%)** — meta ≤1.300 KB cumplida.
- Componentes ui eliminados: **31 + 1 hook** · deps app: **42 → 22** (−20 radix).
- `node_modules`: 734M → 734M (`du` — los 20 radix suman ~2 MB; bun poda perezosamente).
- Desviaciones: **D-1** (publish script LICENSE — pendiente dueño), **D-2** (cadena text-export→jspdf — puente en app, fix canónico en core pendiente).
- Pendientes del dueño: tesseract self-host (T5.5), fix de 1 línea en `make-publish-package.mjs` ×2, split de helpers en `pdf-export.ts`.
