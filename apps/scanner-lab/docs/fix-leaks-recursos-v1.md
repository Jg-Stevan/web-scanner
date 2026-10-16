# Evidencia — PR 2 «Leaks y recursos» (`fix/leaks-recursos-v1`)

**Fecha:** 2026 ejecutado por agente (sesión `fix/leaks-recursos-v1`).
**Repo:** `Jg-Stevan/web-scanner` · **Base:** `main` @ `ad4c6fa` · **Rama:** `fix/leaks-recursos-v1`
**Origen:** auditoría externa de 113 hallazgos (0 falsos). Este PR cierra los 15 hallazgos triviales de leaks/liberación de recursos y bugs latentes: A-01, A-04, A-05, A-08, A-13, A-15, B-01, B-05, B-12, B-14, C-11, C-24, D-02, D-04, D-11.
**Instrucciones:** `INSTRUCCIONES-ws-pr2-leaks-recursos-v1.md` (whitelist §1, fixes §2, validación §3, QA §4).

---

## 1. Archivos tocados (vs whitelist §1)

`git diff --stat origin/main` tras aplicar los 15 fixes (salida real):

```text
 .../scanner-lab/public/scanner/detection-worker.js | 32 +++++++++++++--
 .../src/components/scanner/CameraView.tsx          | 39 +++++++++++++++++-
 .../src/components/scanner/EditorView.tsx          | 46 +++++++++++++++++-----
 apps/scanner-lab/src/lib/burst-budget.ts           |  6 ++-
 apps/scanner-lab/src/lib/crash-reporter.ts         | 38 +++++++++++++++++-
 apps/scanner-lab/src/lib/device-profile.ts         | 34 ++++++++++++++--
 packages/scanner-core/src/detector-client.ts       |  4 +-
 packages/scanner-core/src/image-processor.ts       | 34 ++++++++++++----
 packages/scanner-core/src/ocr.ts                   |  7 +++-
 packages/scanner-core/src/page-store.ts            | 37 +++++++++++++----
 packages/scanner-core/src/store.ts                 |  5 ++-
 11 files changed, 243 insertions(+), 39 deletions(-)
```

- Coincide EXACTAMENTE con la whitelist de §1 (los docs de este PR — `CHANGES.md` y este archivo — se suman en el commit de documentación).
- `packages/scanner-core/src/types.ts` NO se tocó: el union de `tier` está definido LOCALMENTE en `EditorView.tsx` (L145 tras el fix), como la propia instrucción anticipaba en 2.6.

## 2. Los 15 fixes — qué se cambió y dónde (referencias post-fix)

| # | Hallazgo | Sitio (post-fix) | Cambio |
|---|---|---|---|
| 2.1 | A-01 | `CameraView.tsx` ~L775 (ref+efecto), ~L2758-2766 (guard) | `isMountedRef` (true en montaje, false en cleanup, deps `[]`); tras `await getUserMedia` en `retryRealCamera`: si `!isMountedRef.current` → `stream.getTracks().forEach(t => t.stop()); return;`. Mismo patrón que el `let cancelled` del efecto de apertura. |
| 2.2 | A-04 | `detection-worker.js` L1703-1709 / L1740-1745 / L1830-1835 | `try { msg.bitmap.close(); } catch {}` antes de `post({type:"busy", ts: msg.ts})` en los 3 handlers (detect/warp/enhance). Estilo del archivo respetado. |
| 2.3 | A-05 | `detection-worker.js` L1695-1702 / L1733-1739 / L1823-1829 | `cvApi === null` → `post({ type: "error", message: "worker no inicializado" })` (+close del bitmap ya transferido, ver nota de la instrucción) en los 3 handlers. El cliente ya correlaciona `error` sin `ts` con el pending más antiguo (`detector-client.ts` L305-318). |
| 2.4 | A-08 | `CameraView.tsx` L2162-2167 (finally) | `releaseFrame(snapA)` al final del `finally` de `runCaptureFlow` (tras la retirada de torch). Idempotente. `snapB` NO se toca (se declara en L2088, DESPUÉS de los returns de L2035/2052/2066 → TDZ). Cubre los caminos de gracia exitosa y stream muerto que salían sin liberar el snapshot full-res. |
| 2.5 | A-13 | `CameraView.tsx` L2743-2748 | `const dead = inForeground && isStreamDead(); strikes = dead || stale ? strikes + 1 : 0;` — sin strikes ni `recoverStream()` espurio en background. |
| 2.6 | B-05 | `EditorView.tsx` L145 (union), L746-754 (preview de error), L1474-1517 (`runOcrCurrent`), L1691-1700 (auto-OCR) | (1) `tier: "fast" \| "full" \| "raw-fallback"` (union LOCAL, `types.ts` intacto). (2) El catch del preview marca `tier: "raw-fallback"` — el visor SÍ lo pinta. (3) `runOcrCurrent`: solo `preview.tier === "full"` sirve de entrada (antes `!== "fast"` disfrazaba al fallback); el bloque de reproceso cubre `fast \|\| raw-fallback` (reprocesar la página); si el reproceso falla y el preview es raw-fallback → ABORTA con el aviso existente `toast.error("No se pudo reconocer el texto", …)` y `setOcrRunning(false)`. La línea `if (!image) image = page.original` (~L1518) NO se tocó. (4) Auto-OCR: `if (preview?.tier === "fast" \|\| preview?.tier === "raw-fallback") return;` (sin marcar `autoOcrTried` → reintenta cuando aterrice un full). |
| 2.7 | B-01 | `image-processor.ts` L230-262 | `attempts: Array<Promise<ImageBitmap>>` → `attemptFactories: Array<() => Promise<ImageBitmap>>` (perezosas). El return temprano no deja decodes en vuelo ni bitmaps huérfanos; el `finally` con `bm?.close()` se conserva byte a byte. |
| 2.8 | B-12 | `ocr.ts` L68-76 | Rama `onload` sin global: `tesseractPromise = null;` antes del `reject(...)` — el rechazo ya no queda cacheado (paridad con el `onerror` de L78). |
| 2.9 | B-14 | `image-processor.ts` L396-423 | `thumbnailFromBlob`: `bm` hoisteado a `let bm: ImageBitmap \| null = null`, close movido a `finally` (patrón idéntico al de `nativeDecodeToCappedDataUrl`). |
| 2.10 | C-11 | `store.ts` L672-675 | `duplicateDocument`: `pages: doc.pages.map((p) => ({ ...p, id: nextId("page") }))` — el generador ya existente en el archivo (L40) y el MISMO prefijo que usa `CameraView.tsx:1180` para páginas nuevas. |
| 2.11 | C-24 | `page-store.ts` L45-58 (`dataUrlToBlob`), L138-163 (`persistDocument`) | (1) `dataUrlToBlob(...): Blob \| null` — `if (comma < 0) return null;`. (2) `persistDocument`: encode POR PÁGINA con `flatMap` + try/catch — data URL inválida (null) o `atob` fallido → se omite ESA página con `console.warn` con el id de página; el doc ya no salta entero. Replica la tolerancia de lectura (catch por página en `loadAllDocuments`). |
| 2.12 | D-02 | `CameraView.tsx` L2024-2029 (parte 1), `burst-budget.ts` L234-243 (parte 2) | (1) Error-path de `dispatchAfterCut`: `recordBurst("error", 0, …, burstExtra)` SIN `cutPipe: true` — alineado con los otros dos error-paths. (2) Sonda heap: `if (heapSamples.length < 600) heapSamples.push(currentMB);`. El bloque `DEFAULTS` (~L92-113) NO se tocó (zona del PR gate-calidad) y el soporte `cutPipe` de burst-budget queda intacto. |
| 2.13 | D-04 | `crash-reporter.ts` L45-67 (constantes + gate), L167-170 (banner gate), L251-269 (record) | (1) Cap FIFO 50: `log.push(rec); if (log.length > 50) log.splice(0, log.length - 50);`. (2) Banner SOLO en modo diagnóstico: no existía mecanismo diag en el repo (verificado con grep) → gate por query param `?diag=1` O `localStorage.getItem("escaner-diag-banner-v1") === "1"` (ambas vías de la instrucción). (3) Dedup: mismo `message` y <10 s → push al log en memoria se mantiene, sin re-persistir anillo ni repetir banner. |
| 2.14 | D-11 | `device-profile.ts` L774-779 (estado módulo), L792-813 (scheduleDiagIdle), L846-856 (stopDiagSampler) | Id del `setInterval` del sampler heap (5 s) guardado en variable de módulo (`diagSamplerIntervalId`); guard de idempotencia al inicio de `scheduleDiagIdle` (segunda llamada = no-op); `stopDiagSampler()` exportado (`clearInterval(id)` + limpia el flag para permitir re-agendado). |
| 2.15 | A-15 | `detector-client.ts` L162-164 | `?v=7` → `?v=8` + comentario obligatorio («Bump obligatorio cada vez que cambie public/scanner/detection-worker.js / el SW lo cachea stale-while-revalidate — auditoría A-15»). |

## 3. Validación (§3 — salidas REALES)

```text
$ bun install --frozen-lockfile
bun install v1.3.14 (0d9b296a)
1732 packages installed [7.26s]

$ bun run core:check    → exit 0   (tsc --noEmit packages/scanner-core)
$ bun run ui:check      → exit 0   (tsc --noEmit packages/scanner-ui)
$ bun run app:check     → exit 0   (tsc --noEmit apps/scanner-lab)

$ bun run lint          → exit 0   (eslint . — 0 errores, 0 warnings)

$ bun run build:static  → exit 0
▲ Next.js 16.4.2 (Turbopack)
✓ Compiled successfully in 11.0s
✓ Generating static pages using 1 worker (3/3)

$ grep -n "cutPipe" apps/scanner-lab/src/components/scanner/CameraView.tsx
1933:        // está abierto por recordBurst({cutPipe}); en el resto son no-ops.
2004:            cutPipe: true,                      ← photo_grace (ruta con corte, legítimo)
2022:        { ...burstExtra, graceWaitedMs, dispatchSource: "frames", cutPipe: true }  ← frames (legítimo)
2024:        // D-02 (parte 1) — sin cutPipe: …        ← comentario del fix
2027:        // los otros dos error-paths …            ← comentario del fix
→ el error-path (~L2029) queda SIN cutPipe ✓

$ grep -n "v=8" packages/scanner-core/src/detector-client.ts
164:const WORKER_URL = `${PUBLIC_BASE}/scanner/detection-worker.js?v=8`;   ✓

$ git diff --stat origin/main   → EXACTAMENTE la whitelist (ver §1 arriba)   ✓

$ grep -n "tier" EditorView.tsx types.ts → ningún consumidor roto: todos los
  comparadores restantes (L600/634/668/765 cache; L1059/1109/1171 export/rotate;
  L1577 batch-OCR) operan sobre previewCache, que JAMÁS contiene raw-fallback
  (el catch del preview solo hace setPreview, nunca cachePreviewEntry).  ✓
```

## 4. QA física (§4) — checklist honesta

Entorno disponible: sandbox headless (sin cámara física, sin navegador móvil real). Ejecutado: build estático + typechecks + lint + greps + revisión línea a línea de cada camino. Lo que requiere hardware/cámara real queda N/A — se indica cómo probarlo.

| # | Prueba | Resultado |
|---|---|---|
| 1 | Captura manual ×1 → editor abre, guardar OK | **N/A en sandbox** (requiere cámara). Análisis estático: el camino manual no cambia (A-08 solo añade release idempotente en finally; D-02 solo retira cutPipe del error-path). |
| 2 | Captura automática ×1 sin errores de consola | **N/A en sandbox**. Ídem: los dispatch paths con corte conservan su cutPipe legítimo (L2004/L2022). |
| 3 | Idle foreground 15 s → jamás «Reiniciando cámara…» | **N/A en sandbox** (requiere stream vivo). A-13 verificado por lectura: `dead` ahora exige `inForeground` — el comportamiento en foreground es IDÉNTICO al previo (`isStreamDead()` se evalúa igual), solo cambia background. |
| 4 | Background→foreground → cámara viva; si recupera, UNA vez | **N/A en sandbox**. Mismo análisis que #3: en background ya no se acumulan strikes → menos recuperaciones espurias; en foreground sin cambio. |
| 5 | Importar foto de galería ×1 → preview correcto | **N/A en sandbox** (sin input de archivo). B-01/B-14 verificados por lectura: misma cascada, mismos intentos, mismos umbrales; solo cambia CUÁNDO se crean las promesas (perezosas) y DÓNDE se cierra el bitmap (finally). |
| 6 | Exportar PDF ×1 | **N/A en sandbox**. El export usa `currentPreviewEntry` (cache/persistida — jamás raw-fallback) y el guard `entry.tier === "fast"` queda intacto: con raw-fallback el comportamiento es idéntico al previo (disparaba la rama no-fast antes con tier "full" falso; hoy idéntico). |
| 7 | OCR sobre página procesada / raw-fallback | **Verificado por lectura y tipos**: (a) OCR manual solo acepta preview `tier === "full"`; (b) raw-fallback → reproceso a 4032 o aborto con aviso; (c) auto-OCR con raw-fallback → return temprano sin marcar tried; (d) `tsc` en verde garantiza que ningún comparador de `tier` quedó sin cubrir el nuevo valor. |
| 8 | `?diag` → banner solo en modo diag; `__crashLog` ≤ 50 | **Verificado por lectura**: `showBanner` gated por `isDiagBannerEnabled()` (`?diag=1` / localStorage opt-in); cap FIFO en `record()`; dedup <10 s. La verificación dinámica del banner requiere browser real → N/A. |

**Conclusión honesta:** ninguna prueba de cámara/OCR física pudo ejecutarse en este entorno (no hay cámara ni dispositivo móvil). Todo lo verificable estáticamente y por compilación está en verde y documentado. El QA físico de §4 queda PENDIENTE para el propietario (pasos exactos en las instrucciones §4).

## 5. Desviaciones y decisiones (transparencia)

1. **`image-processor.ts` ~L970-974 — guard `if (blob === null) throw`** en el consumidor de `dataUrlToBlob` (bloque hermético F3-A): consecuencia TYPE-LEVEL inevitable del cambio de API de C-24 (`Blob` → `Blob | null`). Sin él, `core:check` no compila. El `throw` cae al catch hermético existente → fallback al camino estándar (comportamiento idéntico al de un header corrupto). El scope de esa zona no estaba en B-01/B-14, pero el archivo SÍ está en la whitelist y §3 exige exit 0 — se declara aquí y en el PR.
2. **B-01 sin la línea de encadenamiento** prescrita (`for (const attempt of restantes) void attempt().then(b => b.close())…`): con fábricas perezosas NO existen intentos restantes en vuelo en el return temprano (nunca se lanzaron) — encadenarlos significaría LANZAR decodes solo para cerrarlos (exactamente el doble-decode que el hallazgo quiere eliminar). El objetivo del hallazgo (cero bitmap huérfano, cero decode paralelo) se cumple por construcción.
3. **D-04 dedup — interpretación de «(el push al ring se mantiene)»**: el push SIEMPRE se mantiene al log en memoria (`window.__crashLog`, capped 50); lo que se omite en un dup es la re-persistencia del anillo localStorage y el banner. Es la lectura coherente con «no repetir banner ni persistencia extra».
4. **D-11 guard doble** (`diagIdleScheduled || diagSamplerIntervalId !== null`): el id solo existe DESPUÉS de que `start()` corre (idle-callback/visibility, asíncrono) — un guard SOLO por id dejaría pasar dos llamadas rápidas. La instrucción pide «si ya hay id, return»; el flag añade la cobertura real. `stopDiagSampler()` limpia ambos.
5. **B-05 aviso de aborto**: se reutiliza el toast existente `toast.error("No se pudo reconocer el texto")` (el aviso de fallo de OCR del mismo callback) con description explicativa — sin strings nuevos de error.
6. **`types.ts` sin tocar**: el union de `tier` vive en `EditorView.tsx` (L145) — la instrucción ya lo contemplaba («si es local a EditorView, ahí»).

## 6. Coordinación con PRs paralelos (§0-bis)

- `burst-budget.ts`: este PR toca SOLO el intervalo de la sonda (~L234-243). El bloque `DEFAULTS` (~L92-113) está byte a byte igual que en `main` (verificable con `git diff origin/main -- apps/scanner-lab/src/lib/burst-budget.ts`).
- `page-store.ts`: este PR toca ~L45-58 y ~L138-163. La zona de hidratación (~L239-278, `loadAllDocuments`) está intocada.
- Si un rebase/merge con `fix/gate-calidad-v1` o `fix/pwa-gama-baja-v1` mostrara conflicto en esos 2 archivos: conservar AMBOS lados (hunks disjuntos por diseño).
