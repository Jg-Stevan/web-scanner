# FIX — PR 3 «PWA Y GAMA BAJA» (E-04 + B-02 + D-05 + C-10) — `fix/pwa-gama-baja-v1`

**Fecha:** 2026-10-15 · **Base:** `main` @ `ad4c6fa` · **Kit:** `INSTRUCCIONES-ws-pr3-pwa-gama-baja-v1.md`
**Origen:** auditoría externa de 113 hallazgos (0 falsos). Este PR arregla 4: el Service Worker que rompe pestañas en cada deploy (E-04), la escalera de export inútil en «máxima» (B-02), las ~1.470 líneas de diagnóstico en el bundle de primera carga (D-05) y la hidratación serial de blobs (C-10).
**Coordinación:** PRs paralelos `fix/gate-calidad-v1` (se mergea primero) y `fix/leaks-recursos-v1`. Este PR comparte `page-store.ts` con leaks-recursos en ZONA DISTINTA (~L241-263 vs ~L53-54) y se mergea AL FINAL. **JAMÁS merge sin el dueño.**

---

## 1. Qué cambia (4 fixes quirúrgicos)

### E-04 — SW: fin del skipWaiting incondicional + banner de actualización
**Problema:** el SW hacía `skipWaiting()` en CADA install → la pestaña abierta quedaba sirviendo HTML viejo con chunks nuevos → chunk-load-errors hasta recargar manual. El listener `SKIP_WAITING` era código muerto. El cache-first de inmutables cacheaba sin comprobar `fresh.ok` (un 404 quedaba cacheado para siempre).

**Cambios (`public/sw.js`):**
1. ELIMINADO `await self.skipWaiting();` del install — el SW nuevo queda `waiting`. La pestaña vieja sigue funcionando con SU versión hasta consentimiento.
2. Listener `SKIP_WAITING` VIVO: ahora acepta el string plano y el formato `{ type: "SKIP_WAITING" }` (el banner usa el objeto).
3. `clients.claim()` se queda (inofensivo sin skipWaiting) + la purga de cachés viejas se queda (corre cuando el SW nuevo por fin activa).
4. Cache-first de inmutables: `if (fresh && fresh.ok)` ANTES del `cache.put` — mismo guard que la navegación (A7).

**Cambios (nuevo `src/lib/pwa.ts` + cableado en `PwaRegister.tsx`):** banner «Nueva versión lista» + botón «Recargar» (DOM directo, self-contained, sin dependencias — decisión del kit §2.1.5 para no acoplar el sistema de notificaciones). Detección: `navigator.serviceWorker.ready` → `reg.waiting` + `updatefound` → `statechange "installed"` con `navigator.serviceWorker.controller` no-null (descarta el primer install). Al pulsar Recargar: listener `controllerchange` registrado UNA vez (guard `armed`) ANTES del `reg.waiting.postMessage({ type: "SKIP_WAITING" })`, con guard anti-doble-recarga (`reloaded`). El listener NO se registra al montar: el `controllerchange` del PRIMER install (clients.claim) no debe recargar la página. Botón ✕ lo descarta hasta la próxima `updatefound`. Accesible (`role="status"`, `aria-live="polite"`), `z-index` máximo, respeta `safe-area-inset-bottom`, no bloquea gestos fuera del banner. Solo producción (https) — mismo guard que el registro.

### B-02 — Cortar la escalera inútil de export en «máxima» (`pdf-export.ts`)
**Problema:** con calidad «máxima» (default, forzada por migración one-time) y páginas PNG, `pageForAttempt` devuelve la MISMA página idéntica en los 4 intentos → `buildDocPdf` reconstruía el PDF completo (decode + jsPDF + serialización) hasta 4 veces para producir el mismo archivo. Su propio comentario (L148-154) lo admitía.

**Cambios:** en `buildDocPdf` y `buildLibraryPdf` (que repite la escalera) — ANTES del bucle:
```ts
const allPagesPng = pages.every((p) => PNG_FILTERS.has(p.filter) && p.processed.startsWith("data:image/png"));
const canShrink = allowJpegFast || !allPagesPng;
```
DENTRO del bucle, tras comprobar presupuesto: `if (!canShrink) break;` — el primer intento que excede presupuesto ES el resultado final (los demás producirían el mismo PDF). `adjusted` sigue la fórmula de siempre y NO se marca (con el corte, `attemptIdx < attempts.length` → `adjusted=false` correcto: no hubo ajuste). **NO se tocó** `ATTEMPTS_STANDARD`, ni `pageForAttempt`, ni la q0.95 de «máxima», ni la regla 4032. Los casos que SÍ pueden encoger (JPEG, o mezcla con PNG) quedan byte-idénticos.

### D-05 — Sacar la instrumentación del bundle de primera carga (`page.tsx` + `SettingsView.tsx`)
**Problema:** `page.tsx` importaba estáticamente las 5 vistas + `QAOverlay` (montado SIEMPRE), y `SettingsView` importaba estáticamente `diag-report` (~1.470 líneas) → todo en el First Load JS de una PWA de gama baja.

**Cambios:**
- `page.tsx`: `SettingsView` y `QAOverlay` → `next/dynamic` con `ssr: false`. CameraView/EditorView/LibraryView siguen ESTÁTICOS (cold-open de un escáner no puede esperar un chunk).
- `SettingsView.tsx`: `diag-report` fuera del import estático → `await import("@/lib/diag-report")` DENTRO de los 4 handlers que lo usan (share/download/copy/bench) — **mismo patrón que ya usa `qa-standard-test.ts` L651/L663** (regla de oro #0: copiar patrones existentes). El módulo se cachea tras la primera carga.
- **Decisiones medidas:** `qa-standard-test` queda estático en SettingsView (es hook de render de `QaTestCard` — no se puede deferir sin partir archivos, fuera de whitelist) y además YA está en first load vía `EditorView` (intocable). `device-profile` queda estático (ya vive en first load vía `page.tsx` → `scheduleDiagIdle`; dynamic no ahorraría nada). Neto real fuera del first load: SettingsView (1.157 líneas) + QAOverlay (313) + diag-report (1.470) ≈ **2.940 líneas** de las ~4.460 estimadas por el kit; las restantes (qa-standard-test 743 + device-profile 829) son inalcanzables dentro de esta whitelist y se documentan como límite.

### C-10 — Hidratación de blobs en paralelo (`page-store.ts` ~L241-263)
**Problema:** 3 `await` EN SERIE por página (original → processed → thumbnail) + bucle serie por doc → arranque lento, ventana de carrera de hidratación agrandada.

**Cambios:** las 3 conversiones → `Promise.all([...])` por página. El `catch` por página existente se conserva tal cual (Promise.all rechaza → página omitida, igual que antes). NO se cambió el modelo de data URLs (la parte compleja NO es este PR) ni la migración one-time (~L313) ni `persistDocument` (PR leaks-recursos).

---

## 2. Evidencia — validación §3 del kit (salidas reales)

```
bun install --frozen-lockfile           → 1732 packages installed [6.95s]
bun run core:check                      → exit 0 (CORE:OK)
bun run ui:check                        → exit 0 (UI:OK)
bun run app:check                       → exit 0 (APP:OK)
bun run lint                            → exit 0 (LINT:OK — eslint .)
bun run build:static                    → ✓ Compiled successfully (Next 16.4.2 Turbopack, 3/3 páginas estáticas)

grep -n "skipWaiting" public/sw.js      → L13/L47: SOLO comentarios + L75: el listener SKIP_WAITING (ya no hay llamada incondicional)
grep -n "fresh.ok" public/sw.js         → L104 (OCR, existente), L131 (navegación A7, existente), L161 (NUEVO guard inmutables)

git diff --stat origin/main             → EXACTAMENTE la whitelist §1 (6 modificados + pwa.ts nuevo):
  apps/scanner-lab/public/sw.js                    | 32 +++++++++++++++++-----
  apps/scanner-lab/src/app/page.tsx                | 12 ++++++--
  apps/scanner-lab/src/components/scanner/PwaRegister.tsx |  5 ++++
  apps/scanner-lab/src/components/scanner/SettingsView.tsx | 15 +++++++++-
  packages/scanner-core/src/page-store.ts          | 14 ++++++++--
  packages/scanner-core/src/pdf-export.ts          | 26 ++++++++++++++++++
```

### Métrica First Load JS (criterio de éxito de D-05)
Next 16 + Turbopack ya no imprime la tabla «First Load JS»: se midió el EQUIVALENTE real — la suma de los bytes de los `<script async>` del HTML exportado de la ruta `/` (lo que el navegador baja para el primer paint):

```
ANTES  (main @ ad4c6fa): chunks=10  bytes=1.597.029  ≈ 1.559 KB
DESPUÉS (rama):          chunks=12  bytes=1.536.635  ≈ 1.500 KB   → −60.394 bytes (−3,8 %)
```

Verificación de CHunks (marcadores de texto en `out/_next/static/chunks/`):
- «Preparar test» / «Re-medir benchmarks» / «Informe del dispositivo» (SettingsView/DiagSection) → **0 chunks iniciales**; viven en el chunk dinámico `0szfwvhwb9yiv.js`.
- «Iniciar test» (QAOverlay) → **0 chunks iniciales**; vive en `42hqfw-n00q11.js`.
- Marker de build de `diag-report` (`DIAG_BUILD = "perf/lote5-foton lote5.7.1"`) → **0 chunks iniciales**; vive en `3kcsypvw7gde3.js` — las ~1.470 líneas de diagnóstico SALIERON del first load.

## 3. QA §4 del kit (checklist honesto)

| # | Prueba | Resultado |
|---|---|---|
| 1 | `build:static` + servir `out/` | ✅ build OK (servido en dev para QA navegable) |
| 2 | SW activo (Application → Service Workers) | ⛔ NOK en sandbox — el SW solo se registra en **https** (guard de `pwa.ts`/registro); localhost/http no aplica. Probar en preview (Vercel) o Pages |
| 3 | Simular deploy (cambiar VERSION) → SW `waiting` + pestaña vieja sin errores | ⛔ NOK en sandbox (mismo motivo — requiere https + 2 deploys). La lógica está cubierta por el guard: sin SKIP_WAITING manual no hay activación forzada |
| 4 | Banner «Nueva versión lista» → Recargar → SW nuevo activo | ⛔ NOK en sandbox (ídem). El flujo postMessage→skipWaiting→controllerchange→reload (con guards) está implementado según kit §2.1 |
| 5 | Export PDF en «máxima» con páginas PNG: PDF válido | ✅ OK (dev): export de TODA la biblioteca (buildLibraryPdf con el corte B-02) ejecutado en navegador — 0 errores de consola. Pendiente: comparación byte-a-byte contra rama sin fix y prueba con PNG reales grandes en dispositivo |
| 6 | Ajustes: sección de diagnóstico carga on-demand sin errores | ✅ OK (dev): Ajustes abre (chunk dinámico), DiagSection renderiza, «Descargar informe JSON» dispara el `await import("@/lib/diag-report")` — 0 errores de consola en toda la sesión |
| — | QA navegable completa (onboarding → biblioteca → ajustes → diag → export) | ✅ 0 errores de página (agent-browser), 0 en consola |

## 4. Desviaciones registradas (transparentes, ninguna rompe el alcance)

1. **`apps/scanner-lab/src/lib/pwa.ts` NO existía** — tras el PR #2 (scanner-ui/core) la lógica PWA vive en `packages/scanner-core/src/pwa.ts` (fuera de whitelist). El kit lista la ruta del lab en su whitelist → se CREÓ como módulo nuevo self-contained (`setupUpdateBanner`), cableado desde `PwaRegister.tsx` (whitelist). El core quedó **intocado**; el banner obtiene el registro vía `navigator.serviceWorker.ready` (sin polling ni toques al registro del core).
2. **Listener `SKIP_WAITING` ampliado a 1 línea** (`event.data === "SKIP_WAITING" || event.data?.type === "SKIP_WAITING"`) — el snippet del kit postea `{ type: "SKIP_WAITING" }` pero el listener existente solo aceptaba el string plano: tal cual, el botón habría sido código muerto otra vez. Se aceptan AMBOS formatos (E-04 es exactamente «darle uso al listener»).
3. **Ruta de import en el snippet D-05** — el kit escribe `import("./components/scanner/SettingsView")`; el repo usa el alias `@/components/scanner/...` → se conservó el alias (patrón del repo, misma semántica).
4. **Reducción real ≈ 2.940 líneas** (no 4.460): `qa-standard-test` (743) y `device-profile` (829) permanecen en first load vía `EditorView` (estático, intocable) y `page.tsx` (scheduleDiagIdle, fuera de los imports autorizados). Se documenta como límite duro de la whitelist.
5. **Métrica First Load JS** medida como suma de `<script async>` del HTML exportado (Next 16/Turbopack ya no imprime la tabla) — equivalente real, misma metodología antes/después.

## 5. Archivos tocados (whitelist cerrada §1)

| Archivo | ± | Fix |
|---|---|---|
| `apps/scanner-lab/public/sw.js` | +21/−11 | E-04 |
| `apps/scanner-lab/src/lib/pwa.ts` | +120 (NUEVO) | E-04 |
| `apps/scanner-lab/src/components/scanner/PwaRegister.tsx` | +5 | E-04 (cableado banner) |
| `packages/scanner-core/src/pdf-export.ts` | +26 | B-02 |
| `apps/scanner-lab/src/app/page.tsx` | +10/−2 | D-05 |
| `apps/scanner-lab/src/components/scanner/SettingsView.tsx` | +13/−2 | D-05 |
| `CHANGES.md` | +sección al inicio | registro |
| `docs/lab/fix-pwa-gama-baja-v1.md` | NUEVO | evidencia |

Cero toques: `burst-budget.ts`, `CameraView.tsx`, `detection-worker.js`, `detector-client.ts`, `package.json`, `bun.lock`, `next.config.ts`, `persistDocument`, migración one-time, ramas de otros PRs.
