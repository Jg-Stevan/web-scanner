# 📦 FUSIÓN v4 — Subir a GitHub (web-scanner)

Esta es la versión **fusión**: el trabajo nuevo completo (papelera, onboarding,
auto-OCR, búsqueda por texto, exportar/compartir texto, estadísticas, dark mode,
zoom, etc.) **+ los 4 arreglos verificados** que faltaban:

1. ✅ **OCR funciona en GitHub Pages** — motor local Tesseract.js (spa+eng) cuando
   no hay servidor. Probado E2E con la API bloqueada: extrajo el texto real.
2. ✅ **Ajustes limpios** — eliminadas las filas "Perfil de documento",
   "Captura automática", "Flash" y "Nitidez en Original".
3. ✅ **Filtro «Texto claro» parejo** — muestreo bilineal + topes de ganancia
   (sin píxeles saltantes).
4. ✅ **Editor**: botón **"Miniaturas"** para ocultar/mostrar el carrusel +
   **navegación deslizando** a izquierda/derecha entre páginas.

La cámara (lente + linterna) NO se tocó: conserva el mecanismo v2 que ya
funciona en tu teléfono.

---

## ▶️ Cómo subirlo (desde github.com, sin comandos)

1. Entra a `github.com/Jg-Stevan/web-scanner` (rama `main`).
2. Sube los archivos respetando las carpetas (puedes arrastrar varios a la vez
   desde la página de cada carpeta con **"Add file → Upload files"**):

   - `/` (raíz): `LICENSE`, `README.md`, `.gitignore`, `eslint.config.mjs`, `next.config.ts`
   - `public/downloads/`: `web-scanner-repo.zip` (REEMPLAZA el anterior)
   - `public/scanner/`: `detection-worker.js`
   - `src/app/`: `globals.css`, `layout.tsx`, `page.tsx`
   - `src/components/scanner/`: los 9 archivos `.tsx`
   - `src/hooks/`: `use-is-hydrated.ts`
   - `src/lib/scanner/`: los 10 archivos `.ts`

3. **BORRA** este archivo (ya no se usa):
   - `src/components/scanner/DocumentDetailView.tsx`
   (ábrelo en GitHub → icono de basura → "Commit changes")

4. (Opcional, recomendado para público — reduce ~11 MB de peso muerto):
   - `worklog.md` (registro de agentes, 147 KB)
   - `public/vendor/opencv-4.5.5-core.js` y `public/vendor/opencv-4.5.5.js` (8.6 MB;
     solo los usa una ruta de servidor que no existe en Pages)
   - `scripts/test-lens-logic.js` (prueba de una lógica antigua)

5. Haz "Commit changes". GitHub Actions compila y despliega a Pages solo
   (~2-4 min, pestaña **Actions**).

---

## ✅ Qué se verificó antes de empaquetar esto

- `tsc --noEmit`: **0 errores** de la app.
- Build estático idéntico al de Actions (`BUILD_STATIC=1` sin `src/app/api`):
  **exit 0**.
- El sitio estático servido bajo `/web-scanner/` renderiza sin errores.
- E2E real en navegador (420×900): Ajustes sin las 4 opciones ✔ · toggle
  Miniaturas oculta/muestra ✔ · swipe derecha/izquierda navega páginas ✔ ·
  **OCR con `/api/ocr` bloqueado extrajo el texto real vía Tesseract** ✔ ·
  filtro Texto claro aplicó con el worker parcheado ✔.

## 📄 Notas

- `parche-fusion.patch` es el diff completo contra `7fda928` por si prefieres
  `git apply` en lugar de subir archivos.
- El ZIP `public/downloads/web-scanner-repo.zip` se regeneró con este estado
  final (es el que descarga el botón "Descargar el código fuente" en Ajustes).
- La app intenta `/api/ocr` primero; en Pages da 404 y cae a Tesseract local
  (descarga ~3 MB de CDN la primera vez, luego queda en caché del navegador).
