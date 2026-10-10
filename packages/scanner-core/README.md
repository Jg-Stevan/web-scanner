# @jg-stevan/scanner-core

Motor **headless** de escaneo de documentos: cámara, detección de bordes, procesado
de imágenes, OCR, calidad de captura y exportación. **Sin UI** — vive para ser
consumido por apps (hoy `apps/scanner-lab`, mañana `apps/digitalizador-e14` y otras skins).

## Reglas del core (inquebrantables)

1. **Nada de React, Next.js ni imports de UI.** Solo TypeScript + `zustand` (peer) + `jspdf`.
2. **Los assets (worker, OpenCV, SW) viven en el `public/` de cada app**; este core los
   localiza vía `process.env.NEXT_PUBLIC_BASE_PATH` (Next.js inlinea las vars `NEXT_PUBLIC_*`
   también en los paquetes del workspace al compilar).
3. **Agregar exports es seguro; renombrar o quitar ROMPE apps consumidoras.**
   El contrato garantizado son los subpaths (`@jg-stevan/scanner-core/xxx`).

## Módulos

| Módulo | Responsabilidad |
|---|---|
| `store` | Estado global Zustand (documentos, páginas, ajustes, papelera) |
| `types` | Tipos + helpers runtime (`isTrashed`, `trashDaysLeft`, …) |
| `image-processor` | Pipeline de imágenes: warp de perspectiva, filtros, escalado |
| `image-modes` | Modos de imagen (B/N adaptativo, escala de grises, …) |
| `frame-loop` | Bucle de cámara con throttling adaptativo |
| `detector-client` | Puente TS ⇄ Web Worker de detección de bordes (OpenCV) |
| `quality` | Score de calidad de captura (`SHUTTER_SCORE`, 0-10) |
| `ocr` | OCR bajo demanda (local Tesseract / remoto según entorno) |
| `pdf-export` | Exportación PDF adaptativa (jspdf, presupuesto de bytes §8) |
| `text-export` | Exportación TXT / compartir texto OCR |
| `format` | Formateo (bytes, tiempo relativo, …) |
| `tags` | Etiquetas de documentos |
| `page-store` | Persistencia IndexedDB de páginas |
| `sensor-profiler` | Tope de resolución del sensor (F-SENSOR · 4032 px fijo) |
| `motion-stabilizer` | Compuerta de quietud (F-STAB) |
| `pwa` | Registro de Service Worker |
| `mock-data` | Datos de hidratación inicial (interno) |

## Uso

```bash
bun add @jg-stevan/scanner-core@workspace:*
```

```ts
import { useScannerStore } from "@jg-stevan/scanner-core/store";
import { SHUTTER_SCORE } from "@jg-stevan/scanner-core/quality";
```

La app consumidora debe proveer los assets en su `public/`:
`scanner/detection-worker.js`, `vendor/opencv-4.5.5.js`, `vendor/opencv-4.5.5-core.js`,
`sw.js` y `manifest.webmanifest`.

## Futuro

- Publicación a npm: `"private": false`, build con `tsup` (o `tsc` emit) a `dist/`,
  `exports` apuntando a `dist/`, y `bun publish`.
- Versionado: `workspace:*` durante desarrollo; semver + Changesets con consumidores externos.
