# 🚀 DEPLOY — Escáner en GitHub Pages

Guía verificada de despliegue. Sustituye al antiguo `LEEME-SUBIR-A-GITHUB.md`
(que contenía instrucciones incorrectas — p. ej. decía de borrar
`public/vendor/opencv-*.js`, que **el worker de detección SÍ usa**).

## Cómo funciona

- **Deploy automático**: cada push a `main` dispara
  `.github/workflows/deploy-pages.yml` (pestaña *Actions*). También se puede
  lanzar a mano con *Run workflow*.
- El workflow hace: checkout → `bun install --frozen-lockfile` →
  `BUILD_STATIC=1 bunx next build` (export estático a `./out`) → publica con
  `actions/upload-pages-artifact@v4` y `actions/deploy-pages@v4`.
- Mejora futura opcional: añadir `bunx tsc --noEmit` como gate de tipos (solo
  cuando el repo esté sin archivos heredados, para no romper migraciones).
- **El sitio queda en**: `https://jg-stevan.github.io/web-scanner/`

## Variables del build estático (no tocar a la ligera)

| Variable | Valor | Para qué |
|---|---|---|
| `BUILD_STATIC` | `1` | Activa `output: "export"` + `basePath: /web-scanner` en `next.config.ts` |
| `NEXT_PUBLIC_BASE_PATH` | `/web-scanner` | Prefijo para assets y URLs construidas en cliente (worker, manifest, ZIP de descarga) |
| `NEXT_PUBLIC_STATIC` | `1` | El OCR salta la ruta `/api/ocr` (no existe en Pages) y va directo a Tesseract local |

## Reglas de oro

1. **Todo el código de la app es cliente.** No agregar rutas en `src/app/api`
   ni server actions: el export estático no las soporta (el workflow las
   elimina del build, pero no deben existir en el repo).
2. **NO borrar `public/vendor/opencv-*.js`**: el Web Worker
   `public/scanner/detection-worker.js` los carga por ruta relativa y
   funcionan perfectamente en Pages. Si se borran, la detección cae al CDN de
   docs.opencv.org (~10 MB) o al fallback Sobel (menos precisión).
3. **Las imágenes de las páginas viven en el dispositivo** (IndexedDB). No hay
   backend que sincronice: borrar datos del navegador borra la biblioteca.
4. Si tocas `package.json`, ejecuta `bun install` y sube `bun.lock` también
   (el workflow usa `--frozen-lockfile`).

## Actualizar la app en tu teléfono

GitHub Pages cachea, y además el Service Worker mantiene modo offline:

1. Espera a que el job de Actions termine (verde).
2. Abre el sitio y **recarga 2 veces** (el SW nuevo es network-first: con la
   primera trae el HTML fresco).
3. Si algo sigue viejo: ajustes del navegador → sitio → **Borrar datos** →
   recarga.

## Verificación post-deploy (2 minutos)

- [ ] El sitio abre en incógnito (sin caché ni SW previos)
- [ ] Cámara: preview + detección + captura; linterna si hay torch
- [ ] Importar un JPG **y un HEIC** → ambos entran al editor
- [ ] Editor: rotar (instantáneo), filtros, guardar imagen, guardar PDF
- [ ] OCR de una página (descarga Tesseract la primera vez)
- [ ] Ajustes › «Descargar código fuente» → baja el ZIP (ruta con basePath)
- [ ] PWA: «Instalar app» y abre sin conexión
