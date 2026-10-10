# 📱 Escáner de Documentos — Clon iOS

> ⚠️ **Regla de oro:** lee [`AGENTS.md`](./AGENTS.md) antes de escribir código — lo que existe en el lab se copia, no se re-inventa.

Aplicación web de digitalización de documentos con estética **pixel-perfect de iOS**, construida como reproducción fiel de 4 diseños originales (Cámara, Editor de perspectiva, Digitalización y Biblioteca). Toda la interfaz está en **español**.

![Versión](https://img.shields.io/badge/versión-6.3.0-007AFF)
![Framework](https://img.shields.io/badge/Next.js-16-black)
![Licencia](https://img.shields.io/badge/licencia-MIT-34C759)

---

## 🆕 Novedades v5.0.0

- **PWA instalable**: «Instalar app» desde Ajustes (Android/Chrome: prompt nativo · iOS: guía de «Añadir a pantalla de inicio»), Service Worker network-first (sin caché vieja al actualizar) y funcionar **sin conexión**
- **Benchmark del dispositivo**: Ajustes › Rendimiento del dispositivo mide CPU/canvas y ajusta la resolución de procesado (4032/3200/2560 px) para que ningún teléfono se cuelgue
- **Perspectiva mejorada**: cascada de detección multi-umbral (papeles con poco contraste y bordes rotos ya se detectan) y warp a resolución completa del sensor (4032)
- **Rotación instantánea** (~0,2 s): rotar ya NO reprocesa el documento completo
- **Guardar como imagen**: botón «Imagen» en el editor descarga la página actual en PNG
- **Importación robusta**: las fotos de galería/cámara nativa (12–48 MP, EXIF, HEIC) ya no fallan con «No se pudo procesar la imagen»
- **Soporte HEIC completo**: las fotos HEIC/HEIF de iPhone se convierten solas en el navegador (libheif embebido, descarga bajo demanda) — también en Android/Chrome y en los «.jpg» que en realidad traen contenido HEIC
- **Filtro por defecto «B/N adaptativo»** en cada captura nueva
- **Ajustes simplificados**: sin perfiles de documento (detección siempre automática) y sin la página de demo en el editor
- **Dimensiones móviles**: viewport-fit=cover + dvh (sin huecos con las barras del navegador ni recortes en la PWA instalada)

## 🆕 Novedades v6.1

- **Prioridad de resolución en la captura (gama baja)**: la foto a resolución del sensor SIEMPRE gana — un fotograma de vista previa de 720p/1080p ya no puede sustituirla (antes, en teléfonos de entrada, la imagen guardada quedaba ilegible). Si la foto del sensor tarda demasiado (>8 s) se avisa y el fotograma se usa solo como último recurso
- **OCR bajo demanda**: el reconocimiento automático al capturar se apaga por defecto (Ajustes › OCR automático) para ahorrar memoria y batería; el texto se extrae cuando quieras con el botón «Texto» del editor
- **Procesado mínimo de 3200 px también en gama baja**: más lento en dispositivos de entrada, pero el texto nunca deja de ser legible

## 🆕 Novedades v6.2

- **Captura fluida (F-DEFER-CROP)**: el editor abre AL INSTANTE tras capturar — la detección de bordes ya no bloquea la revisión. Un pill «Ajustando recorte…» indica que el recorte automático aterriza en segundo plano y el preview se actualiza solo; si ajustas el recorte a mano, tu decisión manda. En gama baja esto elimina los segundos de espera frente a la cámara sin sacrificar el recorte automático ni la calidad

## 🆕 Novedades v6.3

- **Dual Pipeline de cámara**: el preview pide 960×540 @ 30 FPS (tope suave) para un visor fluido y sin calentamiento en gama baja, mientras la FOTO sale a resolución completa del sensor vía `ImageCapture.takePhoto()` (12–48 MP) — el análisis de bordes sigue viendo lo mismo (remuestreo a 400 px)
- **Sensor Profiler (F-SENSOR-PROFILER)**: mide la resolución nativa del sensor y, en cámaras de 48/108 MP, pide al ISP la foto dentro de un tope seguro por gama (4032 px alta · 3200 px media/baja) — el blob gigante jamás se decodifica y la pestaña ya no crashea; red de seguridad adicional post-decode
- **Estabilizador de quietud (F-STAB)**: la auto-captura exige 280 ms de quietud medida con el sensor inercial (`DeviceMotion`: aceleración ≤ 1.25 m/s², rotación ≤ 14 °/s) más una ventana sostenida del disparo k-de-n — adiós a los disparos mientras acomodas el teléfono (en desktop, y en iOS sin permiso de motion, degrada con elegancia: la auto-captura sigue funcionando)
- **Captura anti tap-shock (F-ZSL)**: buffer Best-Shot de los últimos 8 fotogramas — si la foto de alta resolución no responde, el frame más nítido capturado 80–450 ms ANTES de tu toque sustituye a la foto sacudida por el impacto del dedo (patrón Zero Shutter Lag de las cámaras nativas)
- **Throttling adaptativo (F-PERF)**: el bucle de detección empieza a ~15 FPS y se relaja hasta ~5 FPS si el hilo principal satura (y se recupera solo) — menos stuttering y menos calor en gama baja
- **Filtro «Texto claro» reconstruido (F-TEXT-CLEAN)**: nuevo pipeline con LUT sigmoidal, afilado solo en bordes de tinta (el papel nunca se toca) y reconstrucción cromática que PRESERVA el color de la tinta (bolígrafos azules y sellos rojos ya no se aplastan a negro) — cero píxeles fosforitos y sin halos de croma en la frontera del papel; worker y fallback comparten la misma matemática exacta
- **Limpieza**: eliminado artefacto ZIP de 6.5 MB committeado por error (`public/downloads/`)

---

## ✨ Funcionalidades

### 📷 Captura (Pantalla 1)
- Cámara **en vivo** con `getUserMedia` — **Dual Pipeline**: preview ligero 960×540 @ 30 FPS + foto a resolución del sensor vía `ImageCapture.takePhoto()` con tope seguro por gama (Sensor Profiler)
- Selección automática de la lente trasera con enfoque real y **linterna (torch)** con reintento y verificación (sondas secuenciales compatibles con Android)
- **Detección de bordes en tiempo real** en un Web Worker (`public/scanner/detection-worker.js`, motor propio Sobel/DFS con motor OpenCV opcional) con **throttling adaptativo** contra la saturación de gama baja
- Marco azul de detección con handles en las esquinas, indicador de estabilidad y **auto-captura** (k-de-n frames estables + **compuerta de quietud** por sensor inercial)
- **Captura manual con buffer ZSL**: si la foto del sensor no responde, el frame pre-toque más nítido (anti tap-shock) entra como fallback premium
- Sesión **multi-página** con contador, importación desde galería y página de demo

### ✂️ Editor de perspectiva (Pantalla 2)
- Marco de 4 esquinas + 4 puntos medios = **8 handles arrastrables** (pointer events, táctil)
- **Tween animado** al aplicar la detección automática ("Bordes detectados")
- Rotación por página con preview correcto en cualquier ángulo
- Aplicar → recorte + reprocesado real de la imagen

### 📑 Digitalización (Pantalla 3)
- Tabs **Página / Reconocimiento OCR** con segmented control iOS animado
- **OCR doble motor**: servidor (modelo de visión) si existe, o **Tesseract.js local (spa+eng)** en hosting estático — el OCR funciona también en GitHub Pages; **auto-OCR** en segundo plano tras cada captura (con pill de progreso)
- **Exportar PDF** (jsPDF, A4, una página por hoja), **exportar texto a .txt**, copiar todo y **compartir** (Web Share API)
- Badge de calidad (nitidez Laplaciano + contraste + brillo), stats de tamaño/páginas
- **Miniaturas desplegables** (mostrar/ocultar) y **navegación deslizando** horizontalmente entre páginas
- Carrusel de miniaturas + "Añadir página", acciones Recortar / Rotar / **Filtros** / Eliminar
- 3 filtros reales: **Original**, **Texto claro** y **B/N adaptativo** (por defecto en cada captura nueva) — «Texto claro» usa el pipeline F-TEXT-CLEAN: papel blanco limpio sin ruido amplificado, tinta de color preservada (sin aplastar bolígrafos/sellos a negro) y sin halos de croma; los 8 filtros históricos se migran automáticamente al abrir documentos viejos
- **Zoom por pinza/doble-toque** y **comparación antes/después**: mantén pulsada la imagen para ver el original
- Modo presentación a pantalla completa con gestos (pinza, pan, doble-tap)

### 🗂 Biblioteca (Pantalla 4)
- Vista **cuadrícula o lista** (agrupada A-Z por inicial o por tramos temporales)
- Búsqueda en títulos **y texto OCR** (con resaltado de coincidencias al abrir el documento), chips de orden: Recientes / Favoritos / A-Z / **Manual**
- **Reordenar arrastrando** por el asa ⠿ en vista de lista (persistente)
- **Etiquetas** (tags) con colores, filtrado por etiqueta, exportación de biblioteca filtrada
- Selección múltiple, favoritos, duplicar, renombrar, eliminar con confirmación
- **Papelera «Eliminados»** estilo iOS Files: borrado suave con **Deshacer**, restaurar, vaciar y purga automática a los **30 días**
- Exportar **toda la biblioteca** a un único PDF · exportar/compartir el texto OCR de un documento

### ⚙️ Ajustes
- Tema claro/oscuro/sistema, mejora automática por captura, OCR automático y calidad PDF
- Panel **"Tu biblioteca"** con estadísticas ampliadas (palabras OCR, papelera, páginas/doc), atajos de teclado y gestos documentados

### 🌓 Otros
- **Modo oscuro** completo en todas las vistas
- Persistencia local en **IndexedDB** (documentos, etiquetas, orden manual) — sin base de datos externa
- 4 pasos de **onboarding** la primera vez
- Animaciones Framer Motion, toasts estilo iOS (sonner), vibración háptica donde está disponible

---

## 🛠 Stack técnico

| Capa | Tecnología |
|---|---|
| Framework | **Next.js 16** (App Router) + React 19 |
| Lenguaje | TypeScript 5 (strict) |
| Estilos | Tailwind CSS 4 + shadcn/ui (New York) + variables iOS |
| Estado | Zustand (app) + IndexedDB (persistencia) |
| Visión | Web Worker propio (Sobel + DFS) con motor OpenCV.js opcional |
| OCR | Dual: servidor (modelo de visión) o **Tesseract.js 5 local (spa+eng)** en estático |
| PDF | jsPDF 4 |
| Iconos / animaciones | lucide-react · framer-motion · sonner |

---

## 🚀 Puesta en marcha

### Requisitos
- **Bun ≥ 1.1** (recomendado) o Node.js ≥ 20 + npm/pnpm
- Navegador moderno con soporte de cámara (la cámara es opcional: hay modo demo e importación de galería)

### Instalación

```bash
# 1. Instalar dependencias
bun install        # o: npm install

# 2. (Opcional) configurar variables de entorno
cp .env.example .env

# 3. Arrancar en desarrollo
bun run dev        # o: npm run dev
```

Abre <http://localhost:3000> en el navegador.

### Scripts disponibles

| Comando | Descripción |
|---|---|
| `bun run dev` | Servidor de desarrollo (puerto 3000) |
| `bun run build` | Build de producción (standalone) |
| `bun run start` | Servir el build de producción |
| `bun run lint` | ESLint |
| `bun run db:push` | Sincronizar el schema de Prisma con SQLite *(no requerido por el escáner)* |

> **Nota sobre el OCR:** en desarrollo con servidor la app puede usar `/api/ocr` (modelo de visión). En el despliegue estático de GitHub Pages **funciona 100 % con Tesseract.js local** (spa+eng, ~3 MB descargados la primera vez) sin intentar la ruta de servidor. Filtros, detección de bordes, recorte, rotación y PDF son 100 % locales en el navegador: **ni tus documentos ni tus fotos salen de tu dispositivo**.

---

## 📁 Estructura del proyecto

```
├── public/
│   ├── scanner/detection-worker.js   # Web Worker de OpenCV (detección de bordes)
│   └── vendor/opencv-4.5.5.js        # Build core-only de OpenCV.js
├── src/
│   ├── app/
│   │   ├── page.tsx                  # Shell con phone-frame (única ruta visible)
│   │   ├── layout.tsx                # Metadata + PWA (manifest, iconos, safe-areas)
│   │   └── globals.css               # Sistema de diseño iOS (#007AFF, #F2F2F7…)
│   ├── components/
│   │   ├── scanner/                  # Vistas (Camera, Editor, Library, Onboarding, Settings…)
│   │   └── ui/                       # shadcn/ui
│   └── lib/scanner/
│       ├── types.ts                  # Tipos del dominio (ScanPage, Quad, filtros…)
│       ├── store.ts                  # Store Zustand de la app (+ papelera)
│       ├── page-store.ts             # Persistencia IndexedDB
│       ├── image-processor.ts        # Filtros, recorte, rotación, calidad (hasta 4032 px) + importación robusta (HEIC incluido)
│       ├── detector-client.ts        # Cliente del Web Worker de detección
│       ├── pwa.ts                    # Registro del Service Worker + prompt de instalación
│       ├── image-modes.ts            # Filtros por píxel (Texto claro: pipeline F-TEXT-CLEAN)
│       ├── ocr.ts                    # OCR local (Tesseract) con salvavidas de servidor
│       ├── text-export.ts            # Exportar/copiar/compartir texto OCR
│       ├── quality.ts                # Métricas de calidad + compuerta sostenida del disparo
│       ├── motion-stabilizer.ts      # Compuerta de quietud por DeviceMotion (F-STAB)
│       ├── sensor-profiler.ts        # Tope seguro de captura por gama (F-SENSOR-PROFILER)
│       ├── pdf-export.ts             # Exportación PDF (jsPDF)
│       └── tags.ts / format.ts / mock-data.ts
├── design-specs.md                   # Especificación de los 4 diseños originales
```

---

## 🎨 Sistema de diseño iOS

| Token | Valor |
|---|---|
| Azul primario | `#007AFF` |
| Fondo claro | `#F2F2F7` |
| Rojo destructivo | `#FF3B30` |
| Verde éxito | `#34C759` |
| Gris secundario | `#8E8E93` |
| Tipografía | SF Pro / system-ui |
| Radio de tarjeta | 12px · Vista "phone" 44px |

La app se muestra dentro de un **phone-frame** centrado en escritorio y a pantalla completa en móvil, con safe-areas y home indicator.

---

## 📄 Licencia

[MIT](LICENSE) · OpenCV.js se distribuye bajo Apache 2.0 · Tesseract.js bajo Apache 2.0.
