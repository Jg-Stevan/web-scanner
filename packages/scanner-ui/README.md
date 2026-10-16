# @jg-stevan/scanner-ui

Capa React de la base de digitalización (compañera de `@jg-stevan/scanner-core`).

## Contrato

SOLO componentes React puros (props + callbacks). Prohibido: lógica de motor
(vive en `@jg-stevan/scanner-core`), fetch de red, stores globales y NADA
electoral. Este paquete es la BASE replicable a otros proyectos.

## Instalación

```bash
bun add @jg-stevan/scanner-ui
```

Peers: `react ^19` · `framer-motion ^12`.

## Uso — `ZoomableVisor`

Visor táctil de UNA página (máquina de gestos probada en táctil real:
pinza anclada al punto · pan con clamps contra el stage · doble toque 2.5× ·
rueda no-pasiva en escritorio · comparación por pulsación larga 350 ms).

```tsx
import { ZoomableVisor } from "@jg-stevan/scanner-ui";

// Fullscreen (modal): cierre por tap-fuera inmediato o tap limpio a 1×
// diferido 320 ms (no mata el doble toque); Esc lo gestiona el consumidor.
<ZoomableVisor src={url} alt="documento" compareSrc={original} onClose={cerrar} />

// Inline en tarjeta (card): techo 3×, sin chrome (chip/hint/comparación),
// tap a 1× abre fullscreen (diferido), tap ampliado vuelve a 1×.
<ZoomableVisor mode="card" src={url} alt="documento" onOpenFullscreen={abrir} />

// Opcional — carrusel del consumidor (swipe horizontal a 1× con goma
// elástica en los bordes; la navegación la decide el consumidor):
<ZoomableVisor
  src={url}
  alt="documento"
  carousel={{ canPrev, canNext, onPrev, onNext }}
/>
```

### Props (`ZoomableVisorProps`)

| Prop | Tipo | Default | Descripción |
|---|---|---|---|
| `src` | `string` | — | Imagen visible (procesada). El zoom se reinicia al cambiar. |
| `alt` | `string` | — | Texto alternativo. |
| `compareSrc?` | `string` | — | Original — solo si difiere de `src` (comparación por pulsación larga). Se ignora en modo card. |
| `mode?` | `"modal" \| "card"` | `"modal"` | `modal`: fullscreen (stage `absolute inset-0` dentro del contenedor posicionado del consumidor). `card`: inline en tarjeta (stage `relative h-full w-full` con clip de esquinas). |
| `onOpenFullscreen?` | `() => void` | — | Solo card: tap simple a 1× (diferido 320 ms). |
| `onClose?` | `() => void` | — | Solo modal: cierre (tap-fuera / tap limpio a 1×). |
| `carousel?` | `{ canPrev; canNext; onPrev; onNext }` | — | Swipe horizontal a 1× (distancia mínima 56 px, goma elástica 72 px). |
| `showHint?` | `boolean` | `true` | Hint didáctico (6 s por montaje). El visor lo oculta al ampliar. |

## Notas de integración

- Tailwind v4: las clases del componente se generan en el build del
  consumidor. Si el paquete viene de `node_modules`, añádelo como source:
  `@source "../../node_modules/@jg-stevan/scanner-ui";` en tu CSS de entrada.
- El componente es `"use client"` (compatible Next.js App Router).
