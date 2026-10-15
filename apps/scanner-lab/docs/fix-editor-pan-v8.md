# FIX v8 — Pan con zoom en el EDITOR: el iPhone no puede desplazarse

> **APP:** `apps/scanner-lab` · **Base:** `main` en `6a99ddf` (PR #19 v7-b fusionado y verificado).
> **Rama:** `fix/editor-pan-v8` · **2 commits de código (8.1, 8.2) + 1 docs.**
> `apps/digitalizador-e14`: **0 archivos tocados.**

## Reporte del usuario (iPhone físico)

En el EDITOR, el doble-toque amplía bien, pero desplazarse (pan) con la imagen
ampliada es «muy difícil». El botón de la esquina superior derecha
(Maximize2 → `openPresentation` → **PresentationView**) funciona correctamente.

## Diagnóstico

La LÓGICA de pointer events del editor es correcta — verificada empíricamente en
Chromium táctil (CDP): doble-toque → `scale(2.5)`, pan 1:1 con el dedo
(40px→−40px, 150px verticales→+150px), clamp correcto contra stage+imagen.
Lo que falla en iOS es la CAPA DE GESTOS DE WEBKIT. El mismo patrón que ya se
resolvió en v6 6.3 para la presentación:

| Aspecto | PresentationView (✓ iPhone) | EditorView (✗ iPhone) |
|---|---|---|
| `touch-none` en img + wrapper + stage | ✓ (6.3) | ✓ (6.3) |
| Listener `touchmove` NO pasivo con `preventDefault` | ✓ (6.3) | ✗ NO LO TENÍA |
| `onPointerLeave` que termina el gesto | no existe | ✓ `onPointerLeave={onStagePointerUp}` (mataba el pan) |

### Causa 1 — Falta el `touchmove` no pasivo

En v6 se diagnosticó que WebKit se queda con el gesto (rubber-band residual del
body, heurística de doble-toque) y dispara `pointercancel` a mitad del arrastre
AUNQUE toda la cadena tenga `touch-action:none`. Eso se arregló en la
presentación con un listener `touchmove` no pasivo — y el usuario confirma que
la presentación funciona en su iPhone. El editor nunca recibió esa mitad del fix.

### Causa 2 — `onPointerLeave` corta el gesto

El stage de zoom del editor tenía `onPointerLeave={onStagePointerUp}`.
iOS WebKit dispara `pointerleave`/`pointerout` espurios a mitad de un toque
cuando recomposa capas — y el editor recomposa justo al ampliar: monta el chip
de zoom (`AnimatePresence`), promociona la capa `willChange`, puede montar/
desmontar el overlay de comparación. Cada leave espurio ejecutaba
`onStagePointerUp` → limpiaba `zoomPointers`/`zoomGesture` → el pan moría con el
dedo aún apoyado. La presentación NO tiene ese handler y por eso sobrevive.

### Nota secundaria (NO corregida, por diseño)

Si la página recortada es más angosta que el stage (aspect raro), `clampZoomPan`
acota el pan horizontal a `(imgW×s − stageW)/2` — matemática correcta (evita
huecos negros) pero da poco recorrido. **No es un bug; `clampZoomPan` intacto.**

## Cambios (ambos en `EditorView.tsx`)

### 8.1 — Listener `touchmove` no pasivo en el stage de zoom

Efecto nuevo inmediatamente después del efecto de reset de zoom:

- `addEventListener("touchmove", onTouchMove, { passive: false })` con
  `preventDefault()` — dentro del stage no hay nada scrollable → seguro.
- **Depende de `[mode]`**: el stage es CONDICIONAL (`{mode === "review" ? …}`) —
  se desmonta al entrar en «Ajustar bordes» y remonta al volver. Un
  `useEffect([])` solo funcionaría la primera vez; con `[mode]` el cleanup
  desadjunta al desmontar y el efecto re-adjunta al volver a review.
- Misma forma que el 6.3 de la presentación (patrón «cinturón y tirantes»).

### 8.2 — `onPointerLeave` solo para mouse

```tsx
onPointerLeave={(e) => {
  if (e.pointerType === "mouse") onStagePointerUp(e);
}}
```

- Los `pointerleave` espurios de iOS (pointerType `"touch"`) ya NO terminan el
  gesto.
- El comportamiento de escritorio se conserva (el mouse que sale del stage
  mientras arrastra sigue soltando el pan).
- `onPointerCancel={onStagePointerUp}` queda INTACTO — es el que recupera los
  gestos que WebKit sí cancela; su cleanup ya limpia todo el estado.

## NO cambiado (lista dura respetada)

- `clampZoomPan` (límites contra stage+imagen, incluido el tope cuando la
  página es más angosta que el stage).
- La lógica pointer del stage (`onStagePointerDown/Move/Up`), el swipe F-SWIPE
  con goma elástica, el hold-comparar (350 ms), el doble-toque 1×↔2,5×, la pinza.
- `onPointerCancel={onStagePointerUp}`.
- La PresentationView COMPLETA (6.2/6.3 intactos).
- Todo lo de v7 (7.1/7.2/7.3/7-b), v6, v5, v4, v3; `PROCESSED_MAX_LONG_SIDE=4032`;
  reglas E3; watchdog.

## Verificación (sandbox)

Con dev server efímero en `:3005` + Chromium headless con emulación táctil
(iPhone 14) vía CDP `Input.dispatchTouchEvent`, importando la imagen demo →
editor (ver detalle en el worklog de ejecución):

1. Doble-toque → transform con `scale(2.5)`. ✓
2. Pan horizontal 40px → `translateX(−40px)` exacto (1:1); pan vertical 150px →
   `translateY(150px)` exacto (1:1). ✓
3. Pan hasta el tope del clamp se detiene en el límite sin saltos. ✓
4. El swipe a 1× sigue navegando páginas y el vertical a 1× no hace nada (sin
   regresión F-SWIPE). ✓
5. Entrar a «Ajustar bordes» y volver: el listener 8.1 vuelve a estar adjunto
   (el efecto depende de `mode`). ✓
6. `bunx tsc --noEmit` en scanner-lab = 0 · `bun run lint` = 0 ·
   `git diff main...HEAD --name-only | grep -c digitalizador-e14` = 0. ✓
7. Sin errores de consola nuevas (el 404 de `qa/test-doc.jpg` es pre-existente
   de v5, ignorado). ✓

## QA físico pendiente (iPhone — Safari Y Chrome)

1. Doble-toque → 2,5× → arrastrar: la imagen SIGUE al dedo de forma continua
   (sin morir a mitad del gesto, sin volver sola a su sitio).
2. Pinza 2 dedos → pan con 1 dedo: fluido.
3. Swipe horizontal a 1× sigue cambiando de página; el hold-comparar (mantener
   pulsado a 1×) sigue mostrando el original.
4. La pantalla completa (botón esquina superior derecha) sigue funcionando igual
   que ahora (sin regresión).
5. Repetir 5 veces alternando zoom/pan/páginas: sin bloqueos ni gestos muertos.

> Recordar hard-reload en iPhone (Safari Y Chrome) para saltar la caché del
> service worker tras el despliegue.

## Commits

| # | Commit | Título |
|---|--------|--------|
| 1 | `c8b2583` | fix(scanner-lab): 8.1 — touchmove no pasivo en el stage de zoom del editor |
| 2 | `718f145` | fix(scanner-lab): 8.2 — onPointerLeave solo para mouse (leave espurio de iOS mataba el pan) |
| 3 | — | docs(lab): fix v8 — documento de ejecución + registro en CHANGES |
