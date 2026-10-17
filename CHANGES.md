# CHANGES — Mejoras de cámara, rendimiento y filtros

> Delta sobre el upstream `Jg-Stevan/web-scanner` (rama `main`).
> Todos los cambios están verificados con `eslint`, `tsc --noEmit` y pruebas E2E en navegador (flujo completo: onboarding → biblioteca → cámara con detección OpenCV → captura manual y automática → editor con filtros → exportar PDF → persistencia IndexedDB), sin errores de consola.
> Rama de trabajo local: `fix/camera-stabilizer-perf`.

## PILA DE MERGES — lotes 5→7→8 y luego 6→9 a main (orden explícito del dueño)

**Fecha:** 2026-10-17 · Orden ejecutado EXACTO del dueño: L5 → L7 → L8 (pila; GitHub muestra solo el delta de cada uno) y después L6 → L9 (pila entre sí). CI 2/2 (checks + Vercel Preview Comments) verde en cada head ANTES de cada merge; un-draft vía GraphQL (`markPullRequestReadyForReview`); método = merge commit (convención del repo).

| # | PR | Lote | Rama | Merge commit | Notas |
|---|----|------|------|--------------|-------|
| 1 | #8 | L5 quick wins | `fix/lote5-quickwins-v1` | `ed4b0db` | pila 1/3 |
| 2 | #10 | L7 RAM/hidratación | `feat/lote7-ram-hidratacion-v1` | `cb13342` | pila 2/3 — delta real 6 archivos (+543/−29) ✓ solo lote7 |
| 3 | #12 | L8 perf fino | `perf/lote8-fino-v1` | `232e885` | pila 3/3 — delta real 15 archivos (+486/−38) ✓ solo lote8 |
| 4 | #9 | L6 red de seguridad | `test/red-seguridad-v1` | `095d7ae` | **rebase (agente B)** sobre main post-pila: conflicto `page-store.ts` resuelto combinando docs BLQ-6 (lote7) + BP-3 (lote6); `CHANGES.md` reordenado (L6 arriba); + commit `8c34233` adaptando la batería a las APIs async de L7 |
| 5 | #11 | L9 estructural | `refactor/lote9-estructural-v1` | `f38efe4` | **rebase (agente B)** `--onto main` saltando el L6 viejo: `AGENTS.md` con LEG-1 (lote5) + LEG-6 (lote9) combinados; `CameraView.tsx` conservando la implementación T2 de L8 con la justificación BP-10 de L9 como comentario |

**Gates post-rebase L6:** tsc ×3 exit 0 · lint 0 errores · `bun test` **201 pass / 0 fail / 1 skip** (6 fallos iniciales corregidos: `duplicateDocument`/`beginReviewDocument` son async desde Lote 7) · `build:static` exit 0.
**Gates post-rebase L9:** tsc ×3 exit 0 · lint 0 errores (143 warnings) · `bun test` **206 pass / 0 fail / 2 skip** · `build:static` exit 0.
**Post-merge en main:** Quality Gate #28/#30/#32 success (uno por push) · Deploy to GitHub Pages #14/#15/#16 **success** (incl. head final `f38efe4`). Rama `fix/deploy-concurrency-v1` ignorada por orden del dueño — confirmado con `merge-base` que ya está contenida en main.
**Pendiente del plan:** Lote D (decisiones del dueño: nitidez, pinch-zoom, modo dev, OCR local) → PR draft; runbook historia-resumida solo al FINAL (requiere cero PRs abiertos).

---

## LOTE 6 — red de seguridad: tests + higiene (rama `test/red-seguridad-v1`)

**Base:** `main` @ `1e874d4` · **Kit:** `INSTR-ws-lote6-red-seguridad-v1` · **Agente:** B (calidad/estructura) · MERGEADO a main (PR #9 → `095d7ae`, rebased sobre la pila 5/7/8). Evidencia completa: `docs/lab/fix-lote6-red-seguridad-v1.md`.

| Tarea | Resultado |
|-------|-----------|
| **T1 · BLQ-1** | Batería `bun test` nativa (cero deps de testing): **193 tests** (192 pass · 1 skip documentado) en `packages/scanner-core/tests/` — types, tags, format, pdf-export (exports puros), page-store, store (ciclo completo en memoria: merge B4, papelera, duplicado C-11), quality (máquina de disparo FIX v9), text-export, persistSafely |
| **T6 · DRY-2** | Test de paridad worker↔core: extracción por nombre + recursión transitiva del código espejado del worker → sandbox `new Function`. **CERO DRIFT** (comparación exacta, tolerancia 0) en constantes, 4 funciones puras y `enhanceToRgba` end-to-end (modos raw/text/bw/gray). `unsharpRgba` excluido documentado (worker=OpenCV vs core=JS) |
| **T2 · BLQ-1** | Step `bun test` en `quality.yml` (tras lint, antes del build; diff = solo el step) |
| **T5 · BP-4** | `noImplicitAny: true` en los 3 tsconfigs. 1 error real (exacto al estimado): `perf-probe.ts:113` — fijado con anotación explícita (bivarianza de métodos; cero `any`, FORT-1 intacta) |
| **T4 · BP-3** | `persistSafely`/`notePersistFailure` en el core + puente de toast en la app (evento global, frontera core↔app sin invertir dependencias). 5 catches de escritura instrumentados (persistDocument, removeDocument, clearAllDocuments, saveManualOrder, saveSettings). 3.er fallo → **UN solo aviso por sesión**. ⚠ wiring de 1 línea en `page.tsx` pendiente (fuera de whitelist — zona del Agente A) |
| **T3 · BP-2** | exhaustive-deps **12 → 2** (ambos justificados): CameraView 3/3 fijados (deps estables, neutro al timing), EditorView 6/8 fijados (incl. `useCallback` de `handleSaveImage`/`handleFilter` para el efecto QA) + **hallazgo**: auto-OCR podía esperar indefinidamente en páginas <2048 px (tier cambia con url idéntica) — fix de dep alinea con la intención documentada. PresentationView:443 fuera de whitelist → pendiente |

**Verificado:** `core:check`/`ui:check`/`app:check`/`lint` exit 0 · `bun test` 192/193 ✅ · `build:static` exit 0 · warnings lint 169→159 (0 errores) · smoke navegador ×2 (biblioteca→editor→filtros→guardado→PDF→presentación, 0 errores de consola; cámara N/A sandbox). Diff = whitelist exacta (11 archivos código+config + 2 docs + 9 tests).

---

## LOTE 8 — perf fino: motor, worker, wasm, gestos (rama `perf/lote8-fino-v1`)

**Base:** `feat/lote7-ram-hidratacion-v1` @ `42fddbe` (apilado) · **Kit:** `INSTR-ws-lote8-perf-fino-v1` · **6 commits (uno por tarea)** · gates exit 0 · `bun test` 9/9 · smoke headless 0 errores. **COMP-4 EXCLUIDO por el kit** (decisión del dueño pendiente — no implementado).

| Tarea | Resultado (medido) |
|------|-----------|
| T1 PERF-4 | integral simple → Uint32 (max 3,11e9 < 2³², enteros exactos; guard para inputs >4096²); **sumSq queda Float64** (7,93e14 no cabe — límite alcanzado). Paridad byte-idéntica probada en test (3/3). Pico bradleyRoth 4032×3024: **108 → 61 MB (−43%)**. D-T1: espejo del worker fuera de whitelist (pendiente) |
| T2 PERF-5 | quad del overlay por REF DIRECTA a 10 Hz (patrón `__cameraTelemetry`); estado React a **2 Hz**; liveRef/disparo intactos (FIX v5.2). Re-render de CameraView por el quad: 10 Hz → 0. Mapeo object-cover fuera del render (helper módulo, compiler-safe) |
| T3 PERF-6 | histograma de exposición en el worker sobre el frame de trabajo; `ResultReply.hist?` con **compat bidireccional** (fallback local 96 px para workers viejos) |
| T4 PERF-1b | glue 8,20 → **0,21 MB** + wasm separado 5,99 MB (`\0asm` valid) en `/scanner/` (donde el glue UMD-hermético lo resuelve) = **−2,00 MB raw** ✓ meta. Precache SW del motor (opción a). Boot probado en vivo: `ready:true` |
| T5 COMP-2 | `requestMotionPermission()` (1 intento/sesión, guard iOS) desde el tap del obturador (gesto directo) — fallo → modo actual |
| T6 COMP-5 | helper `.hit-slop` (::before 44×44, cero cambios visuales) — **12 sitios** cámara/editor/biblioteca; PresentationView sin sitios (el citado ya no existe) |

**Hallazgo T4 (para el futuro):** el vendor es opencv-js UMD — `var cv` local ensombrece el global → `Module` hermético NO inyectable y `locateFile` resuelve contra el WORKER (`/scanner/`), no el glue. El wasm vive en `/scanner/`; bootstrap del worker SIN cambios.
**Smoke:** wasm separado `ready:true` ✓ · export PDF ✓ · **0 errores de consola** ✓. Pendientes device: medición T2/T3, iOS físico T5, MIME del wasm en Pages, espejo Uint32 (D-T1), COMP-4.

---

## LOTE 7 — RAM: hidratación perezosa + Blob URLs on-demand (rama `feat/lote7-ram-hidratacion-v1`)

**Base:** `fix/lote5-quickwins-v1` @ `ab39e51` (apilado) · **Kit:** `INSTR-ws-lote7-ram-hidratacion-v1` · **Diseño-first:** `docs/lab/fix-lote7-ram-hidratacion-v1.md` (T0 commiteado ANTES del código) · **4 commits** · gates exit 0 · `bun test` 6/6 · smoke headless con **prueba de integridad de datos en vivo**.

**Diseño (T0):** hidratación SOLO thumbnail al boot (`loadAllDocumentsLazy`); `original`/`processed` llegan `""` y se materializan on-demand — `getPageImageData` con **LRU de 8 Blob URLs** (cero base64 en RAM, revoke determinista) + `loadPageBlobs` (lectura directa IndexedDB). **GUARD anti-pérdida en `persistDocument`** (reutiliza los Blobs previos por page.id para campos no convertibles — firewall contra la omisión histórica de páginas). Editor: `beginReviewDocument` async materializa el doc abierto ANTES de montar la sesión (EditorView/PresentationView/pdf-export **cero cambios**). Exports de biblioteca: `materializeDocument` → build → `reLazyDocument` en finally.

| Verificación | Resultado |
|---|---|
| Reload lazy → abrir doc | 2/2 imágenes materializadas en editor ✓ |
| **Rename con campos lazy → reload** | **imagen intacta (sin el guard: pérdida total)** ✓ |
| Export PDF desde biblioteca | «PDF exportado · 1 página · 40.8 KB» (materialize→re-lazy) ✓ |
| `bun test` LRU | 6/6 ✓ |
| Errores de consola | 0 ✓ |

**Desviaciones:** T3 COMP-3 pendiente (pipeline de captura blindado); stats de SettingsView subcuentan (fuera de whitelist); QA de heap en dispositivo = pendiente del dueño (meta <80 MB residente).

---

## LOTE 5 — quick wins perf + limpieza-v2 (rama `fix/lote5-quickwins-v1`)

**Base:** `main` @ `1e874d4` · **Kit:** `INSTR-ws-lote5-quickwins-v1` · **6 commits** · gates `core:check`/`ui:check`/`app:check`/`lint`/`build:static` exit 0 · smoke headless 0 errores de consola. NOTA: las referencias históricas de este fichero a `apps/digitalizador-e14/` apuntan al repo origen (pre-split) — ver AGENTS.md L12-17.

| Tarea | Hallazgos | Resultado |
|------|-----------|-----------|
| T1 PERF-1 | el worker carga OpenCV EAGER al spawn; `getScannerWorker()` en montaje de `page.tsx` (warm-up L104 + `setWarpCap` L112) obligaba a la sesión solo-biblioteca a bajar ~8,4 MB | warm-up SOLO al montar CameraView + fallback `requestIdleCallback` (timeout 3 s, guard Safari) si la sesión no arranca en cámara; `setWarpCap` fuera — redundante por default del worker `warpMaxLongSide = 4032` (sin cambio de comportamiento). Smoke: 0 spawns en boot de biblioteca, 1 total con fallback, dedupe al entrar a cámara |
| T2 PERF-2 | `pdf-export` estático en EditorView/LibraryView arrastraba jspdf (342 KB min); cadena interna extra: `text-export.ts:12 → pdf-export → jspdf` mantenía jspdf en el chunk inicial vía `docHasOcrText`/`ocrTextOfPages` (render-path) | 8 handlers → import dinámico + helpers locales VERBATIM puente (fuente anotada); **First Load JS 1.633.634 → 1.207.897 B (−26%, meta ≤1.300 KB cumplida)**; chunk jsPDF lazy on-demand (verificado en smoke: se pide al exportar) |
| T3 D-1 | 31 ui muertos + `use-mobile` + 20 radix (verificados 2× antes) | borrados con prueba de 0 importers por componente (4 tandas con gates verdes); deps 42→22; KEEP de 7 ui + 6 radix intacto; −3.167 líneas |
| T4 BLQ-7a | metadata npm incompleta | `repository`/`homepage`/`bugs`/`keywords`/`engines` + `files`+LICENSE ×2; **`sideEffects` NO declarado** (3 módulos con globals al import: detector-client/store/sensor-profiler — opción «repórtalo» del kit); `publish:stage` verificado ×2. **D-1:** `make-publish-package.mjs` ×2 no copia LICENSE al `.publish/` (1 línea por script — fuera de whitelist, pendiente dueño) |
| T5 BLQ-7b | `OPENCV_CDN_URL` (docs.opencv.org) como fallback remoto en el arranque del worker | rama remota eliminada (2 líneas) — fallo local → error/self-healing existente; `grep https://` = 0 en el worker. Pendiente dueño: tesseract CDN (ocr.ts:28) |
| T6 LEG-1 | refs rotas a `apps/digitalizador-e14/` en AGENTS.md | nota «(histórico del repo origen)» + equivalente raíz; CHANGES histórico intocado |

**Desviaciones:** D-1 (LICENSE en publish script — pendiente) · D-2 (cadena text-export→jspdf: puente en app con helpers verbatim, fix canónico = separar helpers de `pdf-export.ts` en el core — pendiente dueño).
**Smoke headless (build estático):** biblioteca sin OpenCV en boot ✓ · cámara 1 worker (dedupe) ✓ · export PDF = chunk lazy + «PDF exportado · 1 página · 39.9 KB» ✓ · abrir doc/volver ✓ · **0 errores de consola** ✓. Evidencia completa: `docs/lab/fix-lote5-quickwins-v1.md`.

---

## HOTFIX — step huérfano sin `run` invalidaba `deploy-pages.yml` en el próximo push a main (commit `e7ad9b7`)

**Base:** rama `fix/limpieza-v1` @ `30a9c83` · **Disparo:** al retirar la línea muerta E-09 (`run: rm -rf apps/scanner-lab/src/app/api`) quedó el step `- name: Remove server-only API routes` sin `run` ni `uses` — GitHub Actions rechaza el workflow completo en el próximo push a main («every step must have a run or uses») y mata el deploy. El CI del PR no lo detecta porque este workflow no corre en PRs — mismo modo de fallo que el hotfix de concurrency de abajo. **Fix:** commit `e7ad9b7` — 1 archivo, −4 líneas (2 comentarios del step + la línea `- name:` + línea en blanco). **Verificado:** pyyaml (YAML válido, trigger `[main]` intacto, todos los steps con `run`/`uses`); `apps/scanner-lab/src/app/api` inexistente en `bc38bf8` y `30a9c83` (el step sobraba); CI del head 2/2 (Vercel Preview Comments + checks). **Merge:** PR #7 (`limpieza-v1`, 8 commits, 59 archivos +412/−3046) mergeado → main `6af48d1`; el push disparó `Deploy to GitHub Pages` #10 y `Quality Gate` #19 — **ambos success**.

---

## PR-LIMPIEZA — deps muertas, configs, mock fuera del pipeline (rama `fix/limpieza-v1`)

**Base:** `main` @ `bc38bf8` · **Kit:** `INSTR-ws-pr4-limpieza-v1` · PR de limpieza: **solo eliminación, movimiento e higiene de tipos/config — CERO cambios de comportamiento** en los paths de runtime del scanner (cámara, detección, burst, editor, persistencia, SW). MERGEADO a main (PR #7 → `6af48d1`, con hotfix de deploy `e7ad9b7` incluido); evidencia completa fase a fase en `docs/lab/fix-limpieza-v1.md`.

| Fase | Hallazgos | Qué se eliminó/movió |
|------|-----------|----------------------|
| A | E-14, D-14, C-16 | **26 deps muertas** de `apps/scanner-lab` (17 Clase-1 + 7 pares dep+ui + `bun-types` + 2 prisma) y **8 componentes ui muertos** (7 pares whitelisted + `sonner.tsx`); 7 ui con prueba individual de cero importers. Radix: cierre transitivo → 7 vivos KEEP, 20 muertos **NO tocados** (fuera de whitelist §6 — desviación D-1 reportada) |
| B | C-04, E-06 | Capa Prisma heredada: `prisma/`, `src/lib/db.ts`, 5 scripts `db:*` (lab+root), deps `prisma`+`@prisma/client` |
| C | D-06 | Doble sistema de toasts: `ui/toaster.tsx`, `ui/toast.tsx`, `hooks/use-toast.ts`, `ui/sonner.tsx`, import+JSX en `layout.tsx`, dep `@radix-ui/react-toast`. `SonnerToaster` (sonner) **intacto** |
| D | B-20 | `generateDemoPage` (103 líneas) **movida** de `image-processor.ts` a `packages/scanner-core/src/demo-page.ts` (mismo contenido/semilla); importers (`frame-loop`, `CameraView` solo línea de import) y `index.ts` ajustados; API pública del paquete preservada |
| E | A-16, C-26 | `buildCappedPhotoSettings` fuera de `sensor-profiler.ts` (+`__sensorTools`) con **bump 0.1.0→0.2.0** (export eliminado del paquete publicado); `imgWrapRef` muerto fuera de `PresentationView` |
| F | E-12, E-13, E-15, E-09, E-05, E-18 | `tailwind.config.ts` fuera (tokens verificados 1:1 contra `@theme` v4) + `tailwindcss-animate`; `.gitignore` dedup+anclaje (`/test`, `/prompt`, `dev.log`, `tool-results`); `make-publish-package.mjs` ×2 preserva `prepublishOnly`; línea muerta `rm -rf …/api` fuera de `deploy-pages.yml` (L56); dep fantasma de core en scanner-ui fuera (solo comentarios); exports `"./*.tsx"` añadidos |
| G | E-11, E-10 | `apps/scanner-lab/docs` → `docs/lab` (14 ficheros, 2.7 MB fuera del producto) + 4 archivos con rutas actualizadas; `GEMINI.md`/`QWEN.md` → punteros (copia canónica única `REGLAS-AGENTE.md`, md5 verificado) |
| H | D-13, D-15, D-16, D-09 | `DIAG_REPORT_VERSION=6` única (TXT decía v5, JSON 6); `avgMs`→`emaMs` (es EMA, cero consumidores externos); guard quad vacío (`bboxW/H: null` en vez de `-Infinity`); augmentation de `perf-probe` con el tipo correcto `Record<string, primitivos \| BurstHeapProbe>` (antes colaba cualquier objeto) |

**Verificado:** `core:check`/`ui:check`/`app:check`/`lint` = exit 0 · `build:static` exit 0 · humo de las 28 deps = vacío · smoke navegador (dev :3111, 0 errores de consola): cámara simulated genera la página demo end-to-end, toasts sonner vivos, diag TXT «v6» + JSON `version: 6` coherentes, biblioteca→editor→guardado OK · `node_modules` 1330→1260 MB · deps lab 70→42.

**Excluidos deliberadamente:** 20 deps Radix muertas + 31 `ui/*.tsx` muertos (fuera de la whitelist §6 — desviación D-1 con lista completa en el doc); E-21, B-09 y E-16 (OPCIONALES del kit, «ante duda NO»); todos los hallazgos COMPLEJO/RIESGOSO y bug fixes conductuales del §1.5; `public/sw.js`, workflows (salvo la línea E-09), DEFAULTS y vendor/opencv — intocados.

---

## HOTFIX — deploy de main saltaba: la concurrency del Quality Gate cancelaba la corrida llamada (rama `fix/deploy-concurrency-v1`)

**Base:** `main` @ `5874d5b` · **Disparo:** primer push a main con la cadena del gate (merge de PR #5, `874182c`): `Deploy to GitHub Pages` quedó **cancelled** (run `38974978246` — su job `quality / checks` llamado murió en el segundo del arranque, `build`/`deploy` skipped) y la demo siguió sirviendo `ad4c6fa7`. La standalone `Quality Gate` del mismo push sí corrió (success).

**Causa raíz:** `quality.yml` tenía `concurrency` a nivel workflow (`quality-<ref>`, cancel-in-progress) — ese bloque **también aplica en `workflow_call`** con el contexto del caller → en push a main, la corrida llamada compartió grupo `quality-refs/heads/main` con la standalone (ambas arrancaron 22:18:45Z) y la segunda canceló a la primera. El group propio del caller (`quality-deploy-<ref>`, PR gate-calidad-v1) protegía contra otras llamadas, no contra la standalone: blindaje necesario pero insuficiente.

**Fix:** eliminar el bloque `concurrency` workflow-level de `quality.yml` (única pieza; triggers y jobs intactos). La llamada queda protegida por el group del job caller; la standalone corre sin grupo; **no existe grupo compartido** → la carrera desaparece por construcción. Efecto secundario aceptado: en PR se pierde cancel-in-progress (runs duplicados, ruido no-código). Detalle y evidencia: `docs/lab/fix-deploy-concurrency-v1.md`.

**Verificado:** YAML parseado OK (js-yaml) · CI del PR (`pull_request`) verde sin concurrency · demostración final pendiente del push a main de este hotfix: `Deploy to GitHub Pages` debe completar `quality → build → deploy` sin cancelaciones, en paralelo con la standalone.

---

## LOTE 9 — salud estructural: DRY + deuda (rama `refactor/lote9-estructural-v1`, MERGEADO)

**Base técnica:** `test/red-seguridad-v1` (Lote 6 — la red de tests; PR #9 ya mergeado) · **Kit:** `INSTR-ws-lote9-estructural-v1` · MERGEADO a main (PR #11 → `f38efe4`, rebased tras el rebase de L6). Evidencia: `docs/lab/fix-lote9-estructural-v1.md`.

**Ejecución PARCIAL** (precondiciones del kit): ✅ Fase B completa (LEG-2, LEG-6, BP-11) · ✅ Fase A parcial (DRY-4, DRY-6) · ✅ Fase E parcial (BP-9, BP-10) · ❌ DRY-3 (requiere L5 mergeado, PR #8) · ❌ Fases C/D (requieren Lote 8, inexistente) · ❌ BP-5/BP-6 (smoke sin cámara / warnings 159>60). El kit contempla A+B en PR propio antes que C+D.

| Tarea | Resultado |
|-------|-----------|
| **LEG-2** | `CHANGES.md` 221 KB/58 entradas → raíz con 4 recientes + puntero; **54 entradas verbatim** a `docs/history/CHANGES-2026.md` |
| **LEG-6** | Regla de oro #0 redefinida (AGENTS.md): «EXTRAE, NO COPIES» — lo compartido va al paquete (bump minor); la copia puente pasa a excepción temporal documentada. Redacción propuesta en el doc ANTES de editar |
| **BP-11** | `Date.now()` fuera de render: secciones de biblioteca y `headerDate` del editor → estado + refresco por cambio de día (intervalo 60 s); `buildListSections` vuelve a ser PURA (now por parámetro) |
| **DRY-4** | `codec.ts` ÚNICO blob⇄dataURL (bump **0.3.0**); adopción ×6 (image-processor, pdf-export FileReader→codec, EditorView fetch-version fuera, CameraView downscale). Re-export de page-store preserva la API (test de identidad de binding). `CameraView:1265` con deadline NO migrada (superset del hot path) |
| **DRY-6** | `ScanEngine` único en types.ts; `hapticConfirm()` en lib (EditorView ×2 + Onboarding ×2); `pwa.ts`→`update-banner.ts`; 3 AlertDialog → **ConfirmDialog** local (mismos textos/estilos, tone danger/primary) |
| **BP-9** | 8 reescrituras triviales con guard (Editor ×7, Library ×1); las 63 restantes documentadas (lib no-whitelisted + CameraView hot path) |
| **BP-10** | 2 comentarios justificativos de `key={i}` (split estático de texto; tupla fija de 4 esquinas) |

**Verificado:** checks ×3 + lint exit 0 (warnings 159→151) · `bun test` 197 pass/2 skip (+6 codec) · `build:static` exit 0 · smoke navegador completo (biblioteca→editor→filtros→guardado→PDF→presentación→ajustes→diag) con 0 errores de consola.

---

## Histórico (pre-PR3) — `docs/history/CHANGES-2026.md`

Las entradas anteriores (PR3 PWA/gama baja, PR2 leaks-recursos, gate-calidad, FIX v3-v10, auditoría 113 hallazgos y todo lo previo) viven en **[`docs/history/CHANGES-2026.md`](docs/history/CHANGES-2026.md)** — movidas íntegras por LEG-2 (Lote 9) para mantener la raíz legible. Regla vigente: la raíz conserva las entradas recientes (3-4) + este puntero; el histórico es append-only hacia abajo.

