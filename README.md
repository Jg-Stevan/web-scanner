# 📱 Escáner de Documentos — Clon iOS

Aplicación web de digitalización de documentos con estética **pixel-perfect de iOS**, construida como reproducción fiel de 4 diseños originales (Cámara, Editor de perspectiva, Digitalización y Biblioteca). Toda la interfaz está en **español**.

![Versión](https://img.shields.io/badge/versión-3.0.0-007AFF)
![Framework](https://img.shields.io/badge/Next.js-16-black)
![Licencia](https://img.shields.io/badge/licencia-MIT-34C759)

---

## ✨ Funcionalidades

### 📷 Captura (Pantalla 1)
- Cámara **en vivo** con `getUserMedia`: selección automática de la lente trasera con enfoque real y **linterna (torch)** con reintento y verificación (sondas secuenciales compatibles con Android)
- **Detección de bordes en tiempo real** en un Web Worker (`public/scanner/detection-worker.js`, motor propio Sobel/DFS con motor OpenCV opcional)
- Marco azul de detección con handles en las esquinas, indicador de estabilidad y **auto-captura** (k-de-n frames estables)
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
- 7 filtros reales: Automático, Grises, B/N (Otsu), Whiteboard, Documento, Color, Original — con suavizado bilineal del mapa de iluminación (sin píxeles saltantes en «Texto claro»)
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

> **Nota sobre el OCR:** la app intenta primero `/api/ocr` (modelo de visión, disponible en desarrollo/servidor). Si el despliegue es estático (GitHub Pages) o el servidor falla, **funciona igual con Tesseract.js local** (spa+eng, ~3 MB descargados la primera vez). Filtros, detección de bordes, recorte y PDF son 100 % locales en el navegador.

---

## 📁 Estructura del proyecto

```
├── public/
│   ├── scanner/detection-worker.js   # Web Worker de OpenCV (detección de bordes)
│   └── vendor/opencv-4.5.5.js        # Build core-only de OpenCV.js
├── src/
│   ├── app/
│   │   ├── page.tsx                  # Shell con phone-frame (única ruta visible)
│   │   ├── layout.tsx                # Metadata + tema
│   │   ├── globals.css               # Sistema de diseño iOS (#007AFF, #F2F2F7…)
│   │   └── api/
│   │       ├── ocr/route.ts          # OCR con glm-4.6v
│   │       └── scan/process/route.ts # Pipeline de precisión server-side
│   ├── components/
│   │   ├── scanner/                  # Vistas (Camera, Editor, Library, Onboarding, Settings…)
│   │   └── ui/                       # shadcn/ui
│   └── lib/scanner/
│       ├── types.ts                  # Tipos del dominio (ScanPage, Quad, filtros…)
│       ├── store.ts                  # Store Zustand de la app (+ papelera)
│       ├── page-store.ts             # Persistencia IndexedDB
│       ├── image-processor.ts        # Filtros, recorte, rotación, calidad (hasta 4032 px)
│       ├── detector-client.ts        # Cliente del Web Worker de detección
│       ├── image-modes.ts            # Filtros por píxel (Texto claro con suavizado bilineal)
│       ├── ocr.ts                    # OCR dual (servidor → Tesseract local)
│       ├── text-export.ts            # Exportar/copiar/compartir texto OCR
│       ├── quality.ts                # Métricas de calidad de captura
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
