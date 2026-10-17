# EXPERIMENTO v11 — Crash-test en gama baja: fuente única, SIN red de seguridad

> **APP:** `apps/scanner-lab` · **Base:** `fix/editor-display-quality-v10` en `4f285f1` (v10-A + v10-B).
> **Rama:** `fix/crash-test-fuente-unica-v11` (apilada sobre v10 — PR con base en esa rama).
> `apps/digitalizador-e14`: **0 archivos tocados.** · **PR ABIERTO, SIN FUSIONAR.**

## Pregunta a responder con datos reales

¿Un dispositivo gama baja **crashea** si TODO (editor, presentación, zoom) consume el
**dato completo** (PNG ≤4032 px) **sin ninguna copia de pantalla, sin degradación por
tier y sin red de seguridad**?

**Decisión del dueño:** mientras dure el experimento, todos los dispositivos ven el
mismo dato de imagen (el de 4032). Si no crashea → se vuelve permanente (más simple,
mejor calidad percibida) y las fases de degradación del plan v8 se archivan. Si
crashea → sabremos el punto exacto y se reactiva protección SOLO ahí.

**Qué era «la red de seguridad» (en la rama v10):** la copia de pantalla `displayUrl`
(JPEG re-encodeado ≤ tope adaptativo v10-A) introducida en v5 5.1 para ahorrar RAM.
Era la única protección de datos activa. Este experimento **la apaga por completo**.

**Beneficio inmediato:** editor y presentación pasan a consumir exactamente la misma
fuente → es *imposible* que se vean distintas. La queja «el editor se ve peor que
pantalla completa» desaparece por construcción.

> ⚠️ Esta spec **SUSTITUYE** a `INSTRUCCIONES-FIX-editor-fidelidad-v10c.md` (v10-C,
> HIFI condicional por tier): fuente única **incondicional para todos los
> dispositivos**, sin `deviceMemory` de por medio.

## Cambios (4 commits)

### Commit 1 — `cbd166e` — 11.1 + 11.2: apagar la generación de `displayUrl`

Mapa del código en `EditorView.tsx` (rama v10):

| # | Sitio | Acción |
|---|---|---|
| G1 | Lazy-fill entrada sembrada/rotada sin `displayUrl` | **Bloque eliminado** — la entrada se pinta YA con su `url` completa |
| G2 | Build inicial tras `processImage` | **Sin re-encode** — la entry se crea solo con `url/w/h/engine` |
| G3 | Cola de apertura de presentación (concurrencia 2) | **Swap directo** al dato (`item.source`) — sin re-encode ni siembra en caché; la concurrencia 2 SE MANTIENE |
| — | `computeDisplayMaxLongSide()` | **`return 4032;` incondicional** → `window.__displayMax === 4032` en todos los dispositivos |
| — | `makeDisplayUrl` + `PreviewEntry.displayUrl` | **NO borrados** — son el *seam* para revertir el experimento con un commit. Quedan sin llamadas activas |

Contador de verificación en la primera línea de `makeDisplayUrl`:
`window.__displayUrlCalls` — en QA debe quedar en **0** (prueba de que la red de
seguridad no corre).

### Commit 2 — `36b5eac` — 11.3 + 11.4: fuente única en editor y presentación

| # | Sitio | Antes | Después |
|---|---|---|---|
| C1 | `<img>` grande del editor (zoom/pan PR #21) | `src={preview.displayUrl ?? preview.url}` | `src={preview.url}` |
| C2 | Presentación (`openPresentation`) | `const ready = entry?.displayUrl ?? null;` | `const ready = entry?.url ?? null;` |

Si la entry existe en caché, la presentación arranca YA con el dato completo; si no,
se conserva el placeholder `p.thumbnail` + swap en background (comportamiento v6.4
intacto, ahora sin re-encode). Telemetría `window.__editorSource = "preview-url"`
(seteada cuando el preview está resuelto en modo review).

### Commit 3 — 11.5: crash reporter (SOLO observación — NO es una red de seguridad)

Nuevo `apps/scanner-lab/src/lib/crash-reporter.ts` — `installCrashReporter()` idempotente:

- Escucha `window` `error` + `unhandledrejection`.
- **PROHIBIDO (y ausente):** `preventDefault`, `stopPropagation`, reintentos, resets
  de estado, fetch a servidores, interceptar `console`. Solo observar, registrar y
  mostrar — el error sigue apareciendo en consola normalmente.
- Registro por evento: `{ ts, type, message ≤300, source/line/col, stack ≤2000,
  view (window.__scannerView), ua, deviceMemory, hardwareConcurrency, heapMB }`.
- Anillo `localStorage["scannerlab_crash_ring"]` (máx 10; si localStorage falla →
  solo `console.error`) + `window.__crashLog` (array en memoria).
- **Banner visible:** overlay fijo arriba (equivale a `fixed top-0 inset-x-0
  z-[9999] bg-red-900`, estilos INLINE a propósito para pintar incluso sin CSS
  cargado), título «⛔ ERROR CAPTURADO — toma captura de pantalla», cuerpo
  `type · message · view · ts`, botón «Cerrar» que solo oculta. Un banner a la vez
  (reemplaza contenido). Sin animaciones complejas.
- **Instalación:** `page.tsx` a nivel de módulo (`typeof window !== "undefined"`) —
  antes del primer render. `__scannerView` se sincroniza con un `useEffect([view])`.

### Commit 4 — 11.6: esta documentación + `CHANGES.md`

## Qué NO se tocó (checklist de intangibles)

- **v10-B tal cual:** chip «Se guardará…» eliminado + migración one-time
  `exportQuality ≠ máxima → máxima` (page-store).
- **`PROCESSED_MAX_LONG_SIDE = 4032`** y exportación **SIEMPRE máxima** — intocables.
- **Pan del editor (PR #21):** gestos, `touch-none`, doble-tap — el `<img>` solo
  cambió el `src`.
- **Reglas de cámara E3** (`getUserMedia` solo `ideal`), cooldown 1500 ms, toggles auto.
- **Recuperación de stream (v4/v6/v7):** watchdog, `recoverStream`, latido rVFC —
  recuperar la cámara no es la red de seguridad de datos.
- **LRU de `previewCache` en 6 entradas:** NO reducida (sería otra red de seguridad —
  el punto ES medir la presión real).
- **Miniaturas (`p.thumbnail`)** de la rejilla/pies (~160 px) — quedan igual.
- **Fallback simulado** de `frame-loop.ts`: solo bajo `__scene` QA explícito.
- **⛔ APARCADO — NO implementado:** plan v8 Fase 0 (device-profile tiers), Fase 1
  (adaptación estática), Fase 3 (auto-degradación dinámica), Fase 4 (OpenCV CDN
  múltiple). La Fase 2 (= v9) vive en su propio PR `fix/auto-shutter-fps-v9` (#23).

## Criterios de aceptación verificados (estático)

- Diff **solo** `apps/scanner-lab`: `EditorView.tsx`, `app/page.tsx`,
  `lib/crash-reporter.ts` (nuevo), `CHANGES.md`, este doc — **0 archivos en
  `apps/digitalizador-e14`**.
- `grep displayUrl` → solo definición del tipo, `makeDisplayUrl` (sin llamadas
  activas) y comentarios «EXPERIMENTO v11». **Cero** lecturas
  `preview.displayUrl ??` / `entry?.displayUrl ??`.
- `tsc --noEmit` = 0 · `eslint` = 0 · sin `next build`.

## Protocolo de crash-test (dueño, dispositivo gama baja)

> Usar la **URL de PREVIEW** del PR v11 (no producción, no main).
> En gama baja la auto-captura puede no disparar (bug que corrige v9, PR aparte) —
> para ESTE experimento disparar MANUAL con el obturador.

| Escenario | Pasos | Qué se pone a prueba |
|---|---|---|
| **A — base** | 1 página (obturador manual) → editor → zoom máximo → pan → export PDF | Decodificación del dato completo + zoom 2.5× |
| **B — sesión** | 3 páginas → editor en cada una → presentación → export | Varias entradas de 4032 en caché |
| **C — estrés** | 6–8 páginas → editor con pan/zoom en varias → presentación completa → export | Presión de memoria sostenida (LRU llena) |
| **D — export doble** | Con 6–8 páginas, exportar PDF 2 veces seguidas | Pico de memoria del export (dataURL→blob) |

**Señales de crash a vigilar:**

1. **Banner rojo ⛔** = error JS capturado → **foto del banner** (dice dónde: `view`
   y mensaje).
2. **Pantalla en blanco / la pestaña se recarga sola / Safari dice «Se produjo un
   problema»** = crash nativo (OOM — el proceso muere antes de poder pintar el
   banner). Anotar en qué paso y con cuántas páginas.
3. **Congelación >30 s** sin respuesta = crash blando. Anotar el paso.

**Qué reportar:** modelo del dispositivo, RAM aproximada, navegador y versión,
escenario y paso exacto, nº de páginas acumuladas, foto del banner (o «no salió
banner, se recargó sola»), y si la app se recuperó o hubo que reabrir.

**Prueba rápida del crash reporter (consola):**

```js
window.dispatchEvent(new ErrorEvent("error", { message: "TEST-CRASH" }))
```

→ banner rojo visible, `__crashLog.length === 1`, `localStorage.scannerlab_crash_ring`
con 1 entrada, y la app sigue funcionando tras cerrar el banner.

**Telemetrías QA (consola):** `__displayMax` (debe ser 4032) · `__displayUrlCalls`
(debe ser 0 tras escanear + editar + presentar) · `__editorSource` (debe ser
`"preview-url"` en el editor).

---

*El experimento es reversible con un commit: los seams `makeDisplayUrl` /
`computeDisplayMaxLongSide` / `displayUrl` quedan en el código, sin uso.*
