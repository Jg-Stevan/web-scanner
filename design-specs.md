# 🎨 ESPECIFICACIÓN DE DISEÑO — Escáner Móvil estilo iOS (pixel-perfect)

Fuente: 4 imágenes reales del usuario (issue #3 Jg-Stevan/mobile-scanner). **EL OBJETIVO ES CLONAR EXACTAMENTE ESTOS DISEÑOS.**

## Paleta global iOS (OBLIGATORIA)

```css
--ios-blue: #007AFF;        /* Acento principal */
--ios-bg: #F2F2F7;          /* Fondo claro (systemGroupedBackground) */
--ios-red: #FF3B30;         /* Eliminar / destructivo */
--ios-green: #34C759;       /* Éxito / checkmarks */
--ios-gray: #8E8E93;        /* Texto secundario */
--ios-gray2: #3C3C43;       /* Texto terciario oscuro */
--ios-gray4: #E5E5EA;       /* Separadores */
--ios-gray5: #C7C7CC;       /* Bordes inactivos */
--ios-dark: #1C1C1E;        /* Cards oscuras (dark elevated) */
--ios-dark2: #2C2C2E;       /* Botones oscuros secundarios */
--ios-dark3: #3A3A3C;       /* Bordes oscuros sutiles */
--ios-white: #FFFFFF;
```

- Fuentes: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui` (usar `font-sans` con fallback).
- Títulos: 17px semibold (600). Labels toolbar: 11px. Cuerpo: 13-14px. Tooltips: 14px.
- Radio de cards: 12px. Sombras suaves: `0 2px 8px rgba(0,0,0,0.08)`.
- El contenedor móvil es un "phone frame" centrado en desktop (max-w-[420px] h-[100svh] con bordes redondeados y sombra en pantallas grandes).

---

## 📱 PANTALLA 1 — CÁMARA (fondo NEGRO)

1. **Top bar** (sobre la vista de cámara, padding 16px):
   - Izquierda: botón X (cerrar), icono blanco 20px, en círculo `rgba(0,0,0,0.3)` 36x36 con backdrop-blur.
   - Centro: pill `rgba(0,0,0,0.4)` + blur, altura 36px, radius completo, contiene: icono cuadrado con "IA" (fondo blanco, texto negro, 18x18, radius 4) + icono grid 2x2 blanco + punto azul #007AFF 6px + texto "AUTO" blanco semibold 13px tracking-wide.
   - Derecha: menú ⋮ (3 puntos verticales) blanco 20px.
2. **Viewport central** (65-70% altura): vista de cámara o fondo negro con ilustración.
   - **Marco de detección**: 4 líneas azules #007AFF de 2px formando trapecio de perspectiva. En cada vértice: círculo blanco 10px. Overlay oscuro sutil fuera del marco.
   - **Toast flotante** centrado (aparece cuando documento estable): pill `rgba(0,0,0,0.75)`, radius 20px, sombra `0 4px 12px rgba(0,0,0,0.3)`, contiene: círculo azul #007AFF 8px + texto "Mantén inmóvil el dispositivo…" blanco 14px.
3. **Bottom bar** (90px, fondo `rgba(20,20,20,0.85)` + backdrop-blur(20px), borde superior `rgba(255,255,255,0.1)`):
   - 4 zonas equiespaciadas + shutter central elevado -20px:
     - **Importar**: icono documento-flecha-abajo blanco 24px, label "Importar" #8E8E93 11px.
     - **Páginas**: icono stack de documentos blanco, badge círculo azul #007AFF con número blanco 10px bold (top-right -4px), label "N páginas" blanco 11px.
     - **SHUTTER central**: círculo 72x72, borde 4px sólido blanco, fondo `rgba(255,255,255,0.1)`, icono interior 32x32 blanco (símbolo documento/crop, stroke 2px), sombra `0 6px 20px rgba(0,0,0,0.4)`.
     - **Auto**: icono compartir/simbolo 24px blanco, label "Auto: Sí" #8E8E93 11px.
   - Home indicator: barra blanca 134x5px radius completa, opacidad 0.4, centrada abajo (8px).
4. **Método de captura PRIMARIO**: `<input type="file" accept="image/*" capture="environment">` (abre cámara nativa del móvil — getUserMedia solo como secundaria en contexto seguro). Si no hay cámara: fondo negro con ilustración de cámara elegante + botones grandes "Escanear con cámara" (azul #007AFF pill) e "Importar desde galería".
5. **Auto-capture**: cuando el marco está estable 1.5s, captura automáticamente con flash blanco y toast "Página capturada".

---

## ✂️ PANTALLA 2 — EDITOR (fondo NEGRO puro, post-captura)

1. **Top bar**: izquierda "< Editor" (chevron + título blanco semibold 17px). Derecha: botón pill "Continuar ✓" fondo #007AFF texto blanco 15px semibold (con icono check).
2. **Miniatura flotante**: círculo 80x80 top-right (debajo del botón continuar), preview circular de la foto original, overlay inferior negro semitransparente con texto "ORIGINAL" blanco 10px, sombra suave.
3. **Preview central**: foto del documento aspect-fit.
   - **Marco de perspectiva AZUL**: líneas #007AFF 2-3px conectando 4 vértices.
   - **4 handles de esquina**: círculos blancos 22-24px con borde 2px #007AFF, sombra `rgba(0,0,0,0.4)` — **ARRASTRABLES con pointer events** (al mover, las líneas adyacentes se estiran).
   - **4 handles de punto medio**: círculos blancos 12-14px borde azul (también arrastrables).
   - **Badge "Bordes detectados"**: pill flotante cerca del vértice superior izquierdo, fondo `#1C1C1E` (o rgba(28,28,30,0.9)) + blur, texto blanco 12px.
4. **Botón central** (entre preview y toolbar): pill "✨ Detección automática" fondo #2C2C2E, borde 1px #3A3A3C, icono ✨/wand azul o blanco, texto blanco 15px medium. Recalcula los bordes.
5. **Bottom toolbar** (2 filas sobre fondo negro):
   - **Fila 1** (4 items equiespaciados): Retocar bordes (icono marco) / Rotar (flecha circular) / Limpiar (varita) / Filtros (dial/sliders) — iconos 24px #8E8E93, labels 11px #8E8E93. "Filtros" abre sheet con carrusel de filtros: Original, Color, Escala de grises, Blanco y negro, Pizarra, Documento — con previews en vivo.
   - **Fila 2** (3 acciones): "Repetir" (rojo #FF3B30 texto) | "Seguir escaneando" (texto blanco) | **"Guardar ✓"** (pill azul #007AFF o texto azul semibold). Guardar → aplica recorte de perspectiva + filtro → va a Digitalización.
6. Rotar: rota 90° con animación. Limpiar: aplica filtro de limpieza (aumenta contraste/blancos).

---

## 📄 PANTALLA 3/4 — DIGITALIZACIÓN (detalle del documento, fondo #F2F2F7)

1. **Header blanco** (sticky, borde inferior #E5E5EA):
   - Izquierda: chevron-left azul #007AFF 20px + título "Digitalización N" negro semibold 17px + icono lápiz #8E8E93 18px.
   - Derecha: contador "1/3" #8E8E93 15px + botón "✓ Guardar PDF" azul #007AFF semibold 17px.
2. **Badge de calidad** (bajo el header, card blanco): pill fondo #F2F2F7 con "✓ Líneas nítidas • Color • 100 DPI" — texto 12px #8E8E93 con checks verdes #34C759.
3. **Tabs segmented control** (iOS): contenedor fondo #E5E5EA radius 8px padding 2px, 2 segmentos 50%:
   - **"Página" activo**: fondo blanco, sombra sutil, icono documento azul, texto negro semibold 13px.
   - **"Reconocimiento OCR" inactivo**: transparente, icono + texto #8E8E93.
   - A la derecha: "100 DPI" #8E8E93 11px.
4. **Card principal** (blanco, radius 12px, sombra `0 2px 8px rgba(0,0,0,0.08)`, padding 16px):
   - Vista previa grande de la página procesada (imagen recortada+filtrada) con contenido tipo factura.
   - Bajo la imagen (tab Página): stats en grid — Páginas / Tamaño / OCR / Calidad con valores.
5. **Tab OCR**: muestra texto extraído en tipografía mono/serif sobre card blanco, con botón "Copiar texto" y "OCR en todas las páginas" si hay varias sin OCR.
6. **Carrusel de miniaturas** (scroll horizontal bajo la card):
   - **Botón "Añadir página"**: 70x90px, borde 2px dashed #C7C7CC, fondo #FAFAFA, icono + en círculo #E5E5EA, label "Añadir página" #8E8E93 10px.
   - **Miniaturas**: 70x90px, borde 2px #007AFF si activa (con sombra azul) o 1px #C7C7CC inactiva, badge número de página esquina (círculo azul/semitransparente, texto blanco 10px).
7. **Bottom bar blanca** (sticky, borde superior #E5E5EA, 4 botones):
   - **Recortar** (icono crop AZUL #007AFF) / **Rotar** (azul) / **Filtros** (azul) / **Eliminar** (icono trash ROJO #FF3B30). Labels 11px con el mismo color del icono.

---

## 🏠 BIBLIOTECA (Mis documentos) — pantalla home

- Fondo #F2F2F7. Header: "Mis documentos" negro semibold 28-34px + botón ajustes (gear #007AFF).
- Barra de búsqueda (pill blanco radius 12, icono lupa #8E8E93, placeholder "Buscar documentos").
- Chips de orden: Recientes / Favoritos / A-Z (pill, activo = negro/blanco, inactivo = blanco/texto secundario).
- Toggle vista grid/lista.
- Grid 2 columnas de cards (blanco radius 12 sombra suave): miniatura del documento (imagen preview), título negro semibold 14px, subtítulo "N páginas · hace Xh" #8E8E93 12px, estrella favorito (esquina). Long-press o botón menú: renombrar/eliminar.
- **FAB "Nuevo escaneo"**: pill flotante bottom-center elevada sobre la nav: fondo #007AFF, icono documento-blanco + texto blanco semibold, sombra azul `0 8px 24px rgba(0,122,255,0.35)`.
- **Bottom nav**: 3 tabs — Documentos (icono carpeta) / Escanear (botón central destacado) / Ajustes (gear). Activo = #007AFF, inactivo = #8E8E93. Fondo blanco con borde superior #E5E5EA.
- Empty state: ilustración documentos + "Aún no hay documentos" + botón "Escanear primer documento".

## ⚙️ AJUSTES

- Grupos estilo iOS (cards blancas radius 12): Captura (auto-capture switch, flash switch), Procesamiento (mejora automática, OCR switch), Exportación (calidad PDF select), Almacenamiento (uso + "Borrar todos los datos" rojo), Acerca de (versión).
- Switches estilo iOS (azul cuando activos).
