# 📱 Escáner de Documentos — Clon iOS

Aplicación web de digitalización de documentos con estética **pixel-perfect de iOS**, construida como reproducción fiel de 4 diseños originales (Cámara, Editor de perspectiva, Digitalización y Biblioteca). Toda la interfaz está en **español**.

![Versión](https://img.shields.io/badge/versión-2.0.0-007AFF)
![Framework](https://img.shields.io/badge/Next.js-16-black)
![Licencia](https://img.shields.io/badge/uso-personal%2Feducativo-34C759)

---

## ✨ Funcionalidades

### 📷 Captura (Pantalla 1)
- Cámara **nativa** del dispositivo (`<input capture="environment">`) con fallback a `getUserMedia`
- **Detección de bordes en tiempo real** con OpenCV.js en un Web Worker (`public/scanner/detection-worker.js` + `public/vendor/opencv-4.5.5.js`)
- Marco azul de detección con handles en las esquinas, indicador de estabilidad y **auto-captura**
- Sesión **multi-página** con contador, importación desde galería y página de demo

### ✂️ Editor de perspectiva (Pantalla 2)
- Marco de 4 esquinas + 4 puntos medios = **8 handles arrastrables** (pointer events, táctil)
- **Tween animado** al aplicar la detección automática ("Bordes detectados")
- Rotación por página con preview correcto en cualquier ángulo
- Aplicar → recorte + reprocesado real de la imagen

### 📑 Digitalización (Pantalla 3)
- Tabs **Página / Reconocimiento OCR** con segmented control iOS animado
- **OCR real** con modelo de visión `glm-4.6v` vía `z-ai-web-dev-sdk` (individual o todas las páginas con progreso)
- **Exportar PDF** (jsPDF, A4, una página por hoja) y **exportar texto OCR a .txt**
- Badge de calidad (nitidez Laplaciano + contraste + brillo), stats de tamaño/páginas
- Carrusel de miniaturas + "Añadir página", acciones Recortar / Rotar / **Filtros** / Eliminar
- 7 filtros reales: Automático, Grises, B/N (Otsu), Whiteboard, Documento, Color, Original
- **Comparación antes/después**: mantén pulsada la imagen para ver el original
- Modo presentación a pantalla completa con gestos (pinza, pan, doble-tap)

### 🗂 Biblioteca (Pantalla 4)
- Vista **cuadrícula o lista** (agrupada A-Z por inicial o por tramos temporales)
- Búsqueda en títulos **y texto OCR**, chips de orden: Recientes / Favoritos / A-Z / **Manual**
- **Reordenar arrastrando** por el asa ⠿ en vista de lista (persistente)
- **Etiquetas** (tags) con colores, filtrado por etiqueta, exportación de biblioteca filtrada
- Selección múltiple, favoritos, duplicar, renombrar, eliminar con confirmación
- Exportar **toda la biblioteca** a un único PDF

### ⚙️ Ajustes
- Tema claro/oscuro/sistema, ajustes de captura y calidad
- Panel **"Tu biblioteca"** con estadísticas, atajos de teclado y gestos documentados

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
| Visión | **OpenCV.js 4.5.5** en Web Worker |
| OCR | `z-ai-web-dev-sdk` → modelo de visión `glm-4.6v` |
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

> **Nota sobre el OCR:** la ruta `/api/ocr` usa `z-ai-web-dev-sdk`, que requiere las credenciales del entorno de Z.ai (`ZAI_API_KEY` en variables de entorno). Fuera de ese entorno la app funciona con normalidad; solo fallará el OCR con un mensaje de error accionable. Todos los demás procesos (filtros, detección de bordes, recorte, PDF) son 100 % locales en el navegador.

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
│   │   ├── scanner/                  # 10 componentes de vista (Camera, Editor, Detail…)
│   │   └── ui/                       # shadcn/ui
│   └── lib/scanner/
│       ├── types.ts                  # Tipos del dominio (ScanPage, Quad, filtros…)
│       ├── store.ts                  # Store Zustand de la app
│       ├── page-store.ts             # Persistencia IndexedDB
│       ├── image-processor.ts        # Filtros, recorte, rotación, calidad
│       ├── detector-client.ts        # Cliente del Web Worker de OpenCV
│       ├── quality.ts                # Métricas de calidad de captura
│       ├── pdf-export.ts             # Exportación PDF (jsPDF)
│       ├── ocr.ts / tags.ts / format.ts / mock-data.ts
├── design-specs.md                   # Especificación de los 4 diseños originales
└── worklog.md                        # Historial completo de desarrollo (13 tareas)
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

## 📄 Licencia y créditos

Proyecto personal/educativo que clona diseños propios compartidos por el usuario. OpenCV.js se distribuye bajo Apache 2.0.
