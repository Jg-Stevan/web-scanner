# 🔧 FIX v5 — Calidad de importación, recorte doble, cámara y UX

> **Documento de ejecución recuperable.** Si el contexto/la sesión se corta,
> este archivo contiene TODO lo necesario para continuar: el plan, las
> decisiones tomadas y el estado de cada punto. Fuente: instrucciones v5 del
> propietario (`INSTRUCCIONES-FIX-ux-editor-v5.md`, entregadas por chat).
>
> **Rama:** `fix/ux-editor-camera-v5` (base: `fix/camera-black-recovery-v4`,
> commit `99fa46a` — el PR #12 de v4 seguía ABIERTO al ramificar; v5 parte
> de la versión ya corregida de `CameraView.tsx` como exigen las
> instrucciones) · **Alcance:** solo `apps/scanner-lab` +
> `packages/scanner-core`. `apps/digitalizador-e14` COMPLETAMENTE intocado.
>
> **Síntomas reportados por el propietario:** (a) imágenes de galería
> borrosas EN el editor pero bien guardadas; (b) «doble recorte»: el recorte
> del editor no es el que se vio en vivo; (c) arranque de cámara lento;
> (d) gasto de recursos con el visor abierto sin documento; (e) sin flash
> automático; (f) toasts no eliminables deslizando; (g) navegación pobre en
> presentación; (h) apartado «Proyecto» sobrante en Ajustes.

## Estado de ejecución — ✅ TODO COMPLETADO (orden aplicado: 5.8 → 5.6 → 5.1 → 5.2 → 5.7 → 5.3 → 5.5 → 5.4)

| Fix | Qué | Estado |
|---|---|---|
| 5.8 | **Ajustes sin «Proyecto»**: grupo `Proyecto` + `ProjectDownloadRow` + constantes `PROJECT_ZIP_*` + imports huérfanos (Copy/Download/Loader2) eliminados | ✅ `1678e6f` |
| 5.6 | **Toasts deslizables**: `swipeDirections={["left","right","top"]}` en `<Sonner>` (sonner 2.0.8; «up» = `top` en su tipado). `dismissible` default intacto, sin `closeButton` | ✅ `8b47f08` |
| 5.1 | **Importaciones nítidas**: `PreviewEntry.displayUrl` (JPEG ≤2560 q0.92, `makeDisplayUrl` re-encodea SIEMPRE) — los `<img>` del editor (preview + presentación) consumen la copia ligera; el DATO (`res.processed` PNG 4032, regla R-10) intacto como fuente de verdad. WYSIWYG conservado por construcción | ✅ `e2cc1be` |
| 5.2 | **Fin del doble recorte**: si al disparar hay detección viva confiable (corners + score ≥ 0.6), la página NACE con ese quad (normalizado al frame de video, con guarda de aspect ±2 %) y `autoQuadPending: false` — NO se lanza `applyAutoQuad`. Micro-salto evitado: `quadDrift` < 2 % de la diagonal no reemplaza | ✅ `755c296` |
| 5.7 | **Presentación**: `drag="x"` en el contenedor de página (solo a 1× y >1 página, sin momentum) — navega con ≥80 px o fling ≥500 px/s (`onSwipeDragEnd`), si no rebota (`dragSnapToOrigin`). Doble toque 1×↔2× (antes 2.5×). **+ fix del guard F-NAV preexistente** que bloqueaba TODO toque sobre la imagen | ✅ `43a8995` |
| 5.3 | **Arranque rápido de cámara**: `localStorage["escaner-main-camera-v1"]` (deviceId/label/score/at/torch…) tras abrir la ganadora → 2ª apertura DIRECTA con las mismas constraints; fallo → caché borrada + sondeo completo. `probeCamera(timeoutMs)`: sonda colgada caduca a los 2000 ms y la apertura tardía se cierra (sin fugas) | ✅ `a80775a` |
| 5.5 | **Flash por captura**: `ScannerSettings.flashMode` ("off"/"auto"/"on", default "off", persistido con merge defensivo). Ajustes › Procesamiento (Select) + botón rayo en la barra (cicla, estilo del selector de captura, «A» = Auto). `captureSmart`: "on" fuerza torch; "auto" decide con la exposición FRESCA de snapA (misma escala que el loop) o la del último frame; umbral `AUTO_FLASH_EXPOSURE = 0.30`; try/finally retira SOLO lo que encendimos (torch manual se respeta) | ✅ `c1b33be` |
| 5.4 | **Modo espera (nivel 1)**: `CameraFrameLoop.setIdle()` fuerza el throttle a 500 ms (2 fps) sin tocar el stream. Entrada: sin corners 30 s Y sin interacción (`onPointerDownCapture` en la raíz marca `lastInteractionRef`). Pill «Modo espera — toca para reactivar». Salida: toque / corners de nuevo (el análisis a 2 fps reacciona en <1 s) / captura. Watchdog v4 4.3 intacto por construcción (el video sigue vivo) | ✅ `cbba601` |

## Verificación ejecutada (evidencia)

Entorno: dev server puerto 3005 + agente de navegador (Chromium headless).
La app renderiza en un marco tipo teléfono (420×542) centrado en el
viewport — los eventos de puntero DEBEN apuntar dentro de ese marco
(lección aprendida: los primeros drags de prueba caían fuera y parecía
que el swipe no funcionaba).

1. ✅ `bunx tsc --noEmit` en `packages/scanner-core` → 0 errores.
2. ✅ `bunx tsc --noEmit` en `apps/scanner-lab` → 0 errores.
3. ✅ `bun run lint` (scanner-lab, ESLint) → 0 errores.
4. ✅ **5.8**: Ajustes muestra Apariencia, Instalación, Procesamiento,
   Exportación, Almacenamiento, Acerca de — `innerText.includes('Proyecto')
   === false`.
5. ✅ **5.5 UI**: fila «Flash de captura» (Select Apagado/Auto/Encendido) en
   Procesamiento; cambio a Auto → `localStorage.escaner-settings-v1` =
   `{...,flashMode:"auto"}` (persistido con el resto). Botón rayo de la
   barra: «Flash de captura: Auto» → clic → «Encendido» (`flashMode:"on"`
   persistido) → clic → «Apagado». Estado heredado de Ajustes al abrir la
   cámara ✓.
6. ✅ **5.1**: (a) captura simulada → preview del editor =
   `data:image/jpeg` (el DATO procesado es PNG); (b) **importación de
   galería**: PNG de prueba 3024×4032 subido por el input de galería →
   preview del editor = `data:image/jpeg` **1971×2560 (lado mayor
   capado a 2560), ~231 KB** — exactamente la copia de display.
7. ✅ **5.7**: drag con eventos REALES dentro del marco: 640→750 (+110 px)
   navega 2→1; 640→610 (−30 px) REBOTA sin navegar; 640→520 (−120 px)
   navega 1→2. Doble toque sobre la IMAGEN (dos clicks reales encadenados,
   gap medido 35 ms) → indicador «200%»; de nuevo → 1×. Con zoom activo el
   drag PANEA (la página no cambia). Teclado ← navega. Clic en miniatura
   navega SIN alternar el chrome (F-NAV preservado). Cerrar: header con
   `pt-safe` (código verificado).
8. ✅ **5.6**: toast largo (hint de linterna, 8 s) arrastrado a la
   izquierda con pausas → `[data-sonner-toast]` DESAPARECE (swipe-dismiss
   funciona; los primeros intentos fallían solo por la velocidad del
   harness — sonner necesita un re-render entre el move que fija la
   dirección y el que aplica el desplazamiento; un dedo real produce
   decenas de moves y lo cubre de sobra).
9. ✅ Consola y errores de página: **0 errores** durante toda la sesión de
   smoke (import, capturas, editor, presentación, toasts, ajustes).

## Pendiente de QA físico (no verificable en sandbox headless)

- **5.2**: la detección viva confiable necesita cámara real + documento;
  en simulado no hay `live.corners`. La lógica está verificada por
  construcción (liveRef fresco al instante del disparo, guarda de aspect,
  quad nato + `autoQuadPending: false`).
- **5.3**: la caché de cámara se escribe tras abrir una cámara REAL
  (headless cae a modo simulado). Criterio a medir en dispositivo: 2ª
  apertura < 1,5 s (telemetría `window.__cameraChoice` ahora incluye
  `cache: true/false`).
- **5.4**: el modo espera requiere `precisionLive` (worker + stream real).
  Criterio: visor sin documento 40 s → `live.fps` ≈ 2 + pill visible;
  acercar documento → reacciona en <1 s.
- **5.5 auto**: el torch no existe en headless. Criterio: escena oscura +
  Auto → captura iluminada y torch apagado tras el disparo; escena clara
  → sin torch; Encendido → torch siempre; Apagado → nunca. iOS manual
  (input capture nativo) SIN cambios por diseño.

## Decisiones de implementación (desviaciones conscientes de la letra)

1. **5.6 — `"up"` no existe**: el tipo `SwipeDirection` de sonner 2.0.8 es
   `'top' | 'right' | 'bottom' | 'left'`. «Deslizar hacia arriba» = `top`.
   Mismo comportamiento que pedía la instrucción, nombre del enum distinto.
2. **5.1 — displayUrl en presentación vía caché**: `openPresentation`
   prefiere `entry.displayUrl ?? entry?.url` de la caché de previews; para
   páginas nunca previsualizadas cae a `p.processed ?? p.original` (como
   hoy). Generar displayUrls para TODAS las páginas al abrir retrasaría la
   presentación (N × ~300 ms) — fuera de alcance conservador.
3. **5.1 — el sheet OCR no tiene `<img>`** (es texto puro); «OCR display»
   de la instrucción no requería cambio. La ENTRADA del OCR sigue siendo
   la procesada completa (dato, no pantalla).
4. **5.2 — umbral 0,6**: `SHUTTER_SCORE` (0,8) es el umbral del disparo
   automático; para NACER con el quad vivo basta un overlay estable y
   visible. Bajo 0,6 la detección puede ser basura → re-detección en
   background (comportamiento anterior).
5. **5.2 — corners ya normalizados**: la telemetría del frame-loop entrega
   corners 0–1 del frame COMPLETO de video (no px de análisis); el mapeo
   `fullW/analysisW` de la instrucción está implícito. La guarda real es
   el aspect (±2 %) entre video y captura — si difiere, el mapeo directo
   mentiría → background.
6. **5.7 — doble tap 2× (antes 2,5×)**: criterio de aceptación v5
   explícito («doble tap hace zoom 2× y vuelve a 1×»).
7. **5.7 — fix del guard F-NAV (además de lo pedido)**: el criterio
   «doble tap» era IMPOSIBLE sobre el documento: el guard preexistente
   (`e.target !== e.currentTarget`, en main desde F-NAV) contaba la
   IMAGEN como «botón hijo» y bloqueaba todo toque sobre la foto (ni
   chrome ni doble-toque). Corregido para contar solo CONTROLES
   (`button/a/[role=tab]`). Bug preexistente descubierto por el criterio
   de v5 — documentado en el commit.
8. **5.3 — caché escrita SOLO si abrió con la deviceId de la ganadora**
   (intentos 0-1 del sondeo; el «último recurso» `{video:true}` puede
   abrir otra cámara). La instrucción decía «tras elegir la ganadora»;
   escribir tras la apertura exitosa evita cachear una deviceId que falla.
9. **5.4 — nivel 2 (parar el stream a los 3 min) NO implementado**: la
   propia instrucción lo marca opcional («apagar por defecto si complica
   la UX; el nivel 1 ya ahorra lo esencial — el gasto real es el
   análisis»). Un track parado es indistinguible de un stream MUERTO para
   el watchdog del v4 → complejidad de recuperación > beneficio.
10. **5.5 — auto decide con snapA (no con la telemetría)**: frame A es la
    medición FRESCA en el instante del disparo (misma escala que el loop:
    `1 − (under+over)/total`) — cubre el caso «duda >1 s» de la
    instrucción por construcción; la telemetría queda de fallback si no
    hubo frame.

## Qué NO se cambió (verificado)

- Regla E3 (solo `ideal`), DUAL PIPELINE (manual iOS = input nativo).
- Stream iOS 1920×1440 y tope único `PROCESSED_MAX_LONG_SIDE = 4032`.
- Watchdog/recuperación de cámara del fix v4 (5.4 convive: la espera no
  toca el video; `isStreamDead` vigila el track, que sigue vivo).
- Escalera de respaldo de PDF, chip «Se guardará…», benchmark fuera.
- Regla R-10: los filtros del producto siguen saliendo PNG en el DATO
  guardado — `displayUrl` es SOLO la copia de pantalla del editor.
- `apps/digitalizador-e14`: ni una línea (0 archivos en el diff).

## Mapa de cambios

| Archivo | Puntos |
|---|---|
| `apps/scanner-lab/src/components/scanner/SettingsView.tsx` | 5.8, 5.5 |
| `apps/scanner-lab/src/components/scanner/SonnerToaster.tsx` | 5.6 |
| `apps/scanner-lab/src/components/scanner/EditorView.tsx` | 5.1 |
| `apps/scanner-lab/src/components/scanner/PresentationView.tsx` | 5.7 |
| `apps/scanner-lab/src/components/scanner/CameraView.tsx` | 5.2, 5.3, 5.5, 5.4 |
| `packages/scanner-core/src/types.ts` | 5.5 (`flashMode`) |
| `packages/scanner-core/src/frame-loop.ts` | 5.4 (`setIdle`) |

## Cómo continuar si la sesión se corta

1. Rama `fix/ux-editor-camera-v5` en `/home/z/web-scanner` — los 8 puntos
   están committeados (ver tabla de estado). `git log --oneline` para el
   orden exacto.
2. Verificación rápida: `bun install` (si falta) → `bunx tsc --noEmit` en
   `packages/scanner-core` y `apps/scanner-lab` → `bun run lint` en
   `apps/scanner-lab`.
3. Smoke de navegador: `bunx next dev -p 3005` en `apps/scanner-lab` —
   recordar que los eventos de prueba deben caer DENTRO del marco del
   teléfono (ver §Verificación, nota inicial).
4. QA físico pendiente: §Pendiente de QA físico (5.2/5.3/5.4/5.5-auto).
