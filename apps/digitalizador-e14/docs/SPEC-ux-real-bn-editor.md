# SPEC e14 — REMEDIACIÓN UX: SIMULACIÓN CON IMAGEN REAL + B/N ADAPTATIVO POR DEFECTO + EDITOR (RECORTAR/CONTROLES)

**Rev. 1 — para el agente de `Jg-Stevan/web-scanner`. Base: `main` @ 07a8066 (PR #7 mergeado).**
**Alcance: SOLO `apps/digitalizador-e14/` + 1 archivo raíz (`AGENTS.md`, `README.md`). PROHIBIDO tocar `apps/scanner-lab/` o `packages/scanner-core/` (el core ya exporta TODO lo necesario; ver §F2/F4).**

---

## §0. CONTEXTO Y REGLA DE ORO (lea primero)

El dueño probó el flujo real de punta a punta y reportó 5 defectos. Esta spec los resuelve en orden de dependencia (§C plan de commits), NO en el orden del reporte.

**R0 — NUEVA REGLA DE ORO #0 al inicio del repo (petición literal del dueño):**
> *"No importa si es lógica o diseño: si ya existe en `apps/scanner-lab`, se COPIA (verbatim, con comentario `// Fuente: apps/scanner-lab/<ruta> L<ini>–L<fin>`) y se adapta. Nunca se re-inventa ni se 'simplifica'."*

**Tarea R0 (commit 1):**
1. Crear **`AGENTS.md` en la RAÍZ del monorepo** (hoy no existe; solo existe `apps/digitalizador-e14/AGENTS.md`) con este contenido al tope, en un bloque destacado:

```markdown
# AGENTS.md — reglas obligatorias para cualquier IA/humano de este repo

## ⚠️ REGLA DE ORO #0 — EL LAB ES LA FUENTE DE VERDAD
`apps/scanner-lab/` es el producto validado por el dueño. ANTES de implementar
CUALQUIER cosa (lógica **o** UI/diseño) busca si ya existe en el lab:

1. Si existe → COPIA VERBATIM el bloque a la app destino, con comentario de
   origen: `// Fuente: apps/scanner-lab/<ruta> L<ini>–L<fin>`
   y adapta SOLO el "re-vestido" (tokens de color/clases). NUNCA re-escribas
   ni "simplifiques" la lógica copiada (el intento de simplificar causó el
   bug F-LENS: la cámara abría la lente gran angular — ver D33).
2. Si NO existe → impleméntalo siguiendo las specs en
   `apps/digitalizador-e14/docs/` y registra la decisión en
   `apps/digitalizador-e14/docs/DECISIONS.md`.
3. Ante la duda: copiar del lab. Nunca "mejorar" el lab.

Referencias: docs/SPEC-fase-logica.md §12 · docs/DECISIONS.md (D33/D34) ·
docs/worklog.md (veredictos FIEL/ADAPTACIÓN/DESVIACIÓN).
```

2. Añadir al **tope de `README.md`** (primera línea del cuerpo) un enlace: `> ⚠️ **Regla de oro:** lee [`AGENTS.md`](./AGENTS.md) antes de escribir código — lo que existe en el lab se copia, no se re-inventa.`

---

## §1. RECURSO: LA IMAGEN REAL DE SIMULACIÓN

Foto real del dueño (Galaxy A56 5G) de un E-14 auténtico sobre mesa oscura:

| Propiedad | Valor |
|---|---|
| Archivo canónico | `acta-e14-real.jpg` |
| Tamaño | 1.417.292 bytes |
| Dimensiones | 2287×1715 (EXIF orientation=**upper-right** → se muestra 1715×2287 vertical) |
| SHA-256 | `c3f0bd7cf97671818fb5f407590834a975eb72c026cb323ba906226130a08731` |

**Cómo la obtiene el agente (en su orden):**
1. **Primaria — descarga directa (CDN, vigente hasta ~2029):**
   ```bash
   curl -L -o apps/digitalizador-e14/src/assets/acta-e14-real.jpg \
     "https://z-cdn-media.chatglm.cn/files/6461c1cc-9407-46f9-b617-11e8e07a2287.jpg?auth_key=1891587320-a508574c02474749b2180eb396ce82ee-0-0c9cef3ad1d4c10ec2ac75e311356be5"
   sha256sum apps/digitalizador-e14/src/assets/acta-e14-real.jpg
   ```
   El SHA-256 DEBE coincidir con el de la tabla. Si no coincide, PARAR y reportar.
2. **Fallback:** el dueño tiene una copia idéntica en `download/acta-e14-real.jpg` (se la puede pasar el dueño si el CDN fallara).

**Reglas del recurso (obligatorias):**
- **PROHIBIDO pre-procesarla**: ni rotarla, ni recortarla, ni recomprimirla. Los bytes deben ser idénticos (sha256). El EXIF `upper-right` (rotación 90°) es PARTE DE LA PRUEBA: el pipeline real del core ya maneja EXIF (F-IMPORT, `fileToCaptureDataUrl`) y así se prueba de verdad.
- Ubicación: `apps/digitalizador-e14/src/assets/acta-e14-real.jpg` + **import estático** (`import actaSimUrl from "@/assets/acta-e14-real.jpg"`) — Next resuelve el `basePath` `/web-scanner` del deploy estático solo. (Si el import estático diera problemas de build, alternativa: `public/scanner/acta-e14-real.jpg` + `new URL("scanner/acta-e14-real.jpg", document.baseURI)` — resuelve bien en dev sin basePath y en Pages con basePath+trailingSlash).
- Crear el directorio `src/assets/` si no existe. La imagen SOLO se descarga/decodifica al entrar a SIMULACIÓN (lazy — nunca en el bundle crítico de primera carga más allá del propio asset).

---

## §F1. SIMULACIÓN = PIPELINE REAL SOBRE LA IMAGEN INCLUIDA (mock retirado)

**Síntoma (dueño):** «Elimina la imagen de prueba por completo, no la quiero volver a ver. Utilizar una imagen real para la simulación.»

**Diagnóstico (verificado en `main`):** SIMULACIÓN hoy NO analiza ninguna imagen: `MockBridge` (`src/lib/e14/bridge.ts` L71–L186) inventa scores aleatorios (`OPTIMA_SCORES`/`ADVERTENCIA_SCORES`/`RECHAZADA_SCORES` L55–57, `generarActa` L97–165) sin foto. Por eso en revisión se ve el «papel sintético» (`ActaDocument`) con datos semilla: esa es la «imagen de prueba» que el dueño NO quiere volver a ver.

**Solución:** SIMULACIÓN pasa a ser un escaneo REAL de la imagen incluida §1, idéntico al de IMPORTAR. El resultado tiene `fotoOriginal`, `fotoProcesada`, score real, OCR real. El mock se elimina.

### F1.1 `RealCoreBridge.escanearActa` (`src/lib/e14/scanner-core-bridge.ts`)
- Al inicio de la resolución de entrada (L137–151), añadir la rama: si `opciones.fuente === "SIMULACION" && !opciones.archivo` → cargar la imagen incluida y tratarla EXACTAMENTE como un `archivo`:
  ```ts
  // SIMULACIÓN = pipeline real sobre el acta E-14 incluida (D35).
  // Mismo camino que IMPORTAR: File → fileToCaptureDataUrl (F-IMPORT: EXIF/12MP).
  entrada = { archivo: await fetchActaSimulada() };
  ```
- `fetchActaSimulada()` (helper privado del módulo, con **cache a nivel de módulo** para no re-descargar en REINTENTAR/REPETIR FOTO):
  ```ts
  import actaSimUrl from "@/assets/acta-e14-real.jpg";
  let actaSimCache: File | null = null;
  async function fetchActaSimulada(): Promise<File> {
    if (actaSimCache) return actaSimCache;
    const res = await fetch(actaSimUrl);
    if (!res.ok) throw new Error("SIMULACIÓN: no se pudo cargar la imagen incluida");
    actaSimCache = new File([await res.blob()], "acta-e14-real.jpg", { type: "image/jpeg" });
    return actaSimCache;
  }
  ```
- El timeout de 15 s (L57, L162–173) y TODO el pipeline quedan INTACTOS (la imagen es 2287×1715, mucho menor que el tope 12MP — sin riesgo F-SENSOR-PROFILER).

### F1.2 `CompositeBridge` y retirada del mock (`src/lib/e14/bridge.ts`)
- **ELIMINAR** `MockBridge` completo (L72–186) y sus helpers exclusivos: `OPTIMA_SCORES`, `ADVERTENCIA_SCORES`, `RECHAZADA_SCORES`, `pick`, `dormir` (L55–69; conservar `dosDigitos` que usa `horaEnvio`).
- **ELIMINAR** el tipo `Forzado` (L19) y el campo `forzado` de `OpcionesEscaneo` (L23).
- `CompositeBridge` (L193–232) simplificado: `escanearActa` enruta SIEMPRE al real (rechaza si `real === null`); `recortar` y `exportarPdf` cambian su gate `acta.fuente !== "SIMULACION"` por **presencia de foto** (`recortar` → `if (!acta.fotoOriginal || !this.real) …`; `exportarPdf` → `if (acta.fuente !== "SIMULACION" && this.real)` se vuelve innecesario: `exportarPdf` del real ya rechaza sin `fotoProcesada`). Dejar un comentario `// Fuente: (diseño propio e14, D35 — el mock de la fase gráfica se retiró; SIMULACIÓN = pipeline real sobre el acta incluida)`.
- `get-bridge.ts` L5: actualizar el comentario («SIMULACIÓN ahora también pasa por el real — D35»).

### F1.3 `store.ts` (`src/lib/e14/store.ts`)
- Quitar el estado `forzado` (L36), `setForzado` (L59, L207), su inicialización (L189) y su uso en `dispararEscaneo` (L240, L266).
- `rotarFoto` (L419): eliminar la cláusula `|| actaActual.fuente === "SIMULACION"` (las actas de SIMULACIÓN ya tienen foto real; el guard `!actaActual?.fotoProcesada` basta).
- El guard de ARCHIVO/CÁMARA (L243–255) NO cambia; SIMULACIÓN no requiere nada previo (la imagen va incluida).

### F1.4 `ScanView.tsx` — panel de SIMULACIÓN (L1677–1719)
- **ELIMINAR** los chips de resultado `CHIPS` (const L76–81, imports de `Forzado` L74, uso L423–424 y L1687–1705): forzar ÓPTIMA/ADVERTENCIA/RECHAZADA ya no tiene sentido con un pipeline real y determinista.
- El panel de SIMULACIÓN queda: etiqueta `Simulación` (L1684–1686) + una línea estática `font-data` que diga `IMAGEN REAL INCLUIDA · ACTA E-14 (KIT 745 — CONSULADO FRANKFURT)` + el botón offline `PASAR A OFFLINE / VOLVER EN LÍNEA` (L1706–1717, intacto).
- El fallback por fallo de cámara (L888–890 «VOLVIENDO A SIMULACIÓN») sigue funcionando igual — ahora aterriza en un escaneo real de la imagen incluida.

### F1.5 Gates `esReal` (consecuencia directa)
- `ReviewView.tsx` L142 y L431 y cualquier otro `esReal`: redefinir de «fuente ≠ SIMULACION» a **presencia de foto**: `const esReal = Boolean(acta.fotoProcesada);` con comentario `// D35: SIMULACIÓN produce fotos reales (pipeline real) — el gate es la foto, no la fuente`.
- `ReviewView` L314 (RECORTAR) ya exige `esReal && acta.fotoOriginal` → funciona igual para SIM.

---

## §F2. FILTRO POR DEFECTO «B/N ADAPTATIVO» + SELECTOR DE FILTROS (copia del lab)

**Síntoma (dueño):** «La captura sale original; por defecto toca que sea el filtro de "B/N adaptativo".»

**Diagnóstico:** el pipeline de e14 pide el filtro **hard-codeado** `"original"`:
- `scanner-core-bridge.ts` **L242**: `processImage(fotoOriginal, quad, "original")` (captura).
- `scanner-core-bridge.ts` **L374**: `processImage(fotoOriginal, quad, "original", rotacion, { manual: true })` (recorte manual).
- `scanner-core-bridge.ts` **L543**: `filter: "original" as PageFilter` (meta del PDF).

El core YA trae el sistema completo (NO se toca el core, solo se consume):
- `packages/scanner-core/src/types.ts` L14 `PageFilter = "original" | "text" | "bw"` · **L22–26 `FILTER_PRESETS`** (`{ id: "bw", label: "B/N adaptativo", description: "Blanco y negro puro, inmune a sombras" }`) · L32–52 `normalizePageFilter` (default del producto = `"bw"` L50).
- `image-processor.ts` **L821–831** `processImage(src, quad, filter, rotation = 0, opts?)`.
- El lab ya hace exactamente esto al capturar: `CameraView.tsx` **L602–604** `filter: useScannerStore.getState().settings.enhance ? "bw" : "original"` (setting «Empieza cada captura con el filtro "B/N adaptativo"», `SettingsView.tsx` L279). e14 no tiene ajustes → **el default fijo es `bw`** (default del producto, types L50).

### F2.1 Default `bw` (P0)
1. `Acta` gana el campo `filtro?: PageFilter` (`src/lib/e14/types.ts`, importando el tipo desde `@jg-stevan/scanner-core/types`).
2. `scanner-core-bridge.ts`:
   - L242 → `processImage(fotoOriginal, quad, "bw")` con comentario: `// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L602-604 (captura arranca en B/N adaptativo) + types.ts L50 (default del producto) — D36`.
   - L374 (recorte) → `processImage(fotoOriginal, quad, acta.filtro ?? "bw", rotacionOverride, { manual: true })`.
   - `construirActa` (L476–516): añadir `filtro: "bw" as PageFilter` junto a los campos reales.
   - `pipelineRecorte` retorno (L420–439): preservar `filtro: acta.filtro ?? "bw"` en el spread (el spread ya lo arrastra — verificar).
   - L543 (PDF) → `filter: (acta.filtro ?? "bw") as PageFilter`.
   - Los dos `console.info` (L278–286, L410–416): añadir `filtro=…` al log.

### F2.2 Selector de filtros en revisión (P1 — copia del lab, misma tarea)
Copia del sheet de filtros del lab (`EditorView.tsx`), re-vestida con tokens e14 y SIN dependencia nueva (e14 no tiene `vaul`; el sheet se hace con un `fixed inset-x-0 bottom-0 z-50` + `animate-editor-enter` que ya existe en `globals.css`):

| Pieza | Fuente en el lab (verbatim) | Adaptación e14 |
|---|---|---|
| `CSS_FILTERS` (previews) | `EditorView.tsx` **L89–93** | literal (comentario Fuente) |
| `handleFilter` (toast + cerrar) | `EditorView.tsx` **L1214–1218** | llama al store en vez de `updateCapturePage` |
| Sheet UI (handle, título «Filtros», 3 miniaturas con `page.original` + `style={{ filter: CSS_FILTERS[f.id] }}`, borde azul→`ok-tint`) | `EditorView.tsx` **L2253–2309** | `page.original` → `acta.fotoOriginal`; activo por `acta.filtro` |
| Gatillo «Filtros» en toolbar | `EditorView.tsx` **L2200–2204** | `ToolbarBtn` «FILTROS» en la barra fija de F3 (L5) |

**Comportamiento al elegir filtro (acción nueva de store, NO re-corre OCR/calidad — igual que `setFilterOnPage` del core `store.ts` L644–669 que solo reprocesa):**
- `store.cambiarFiltro(filtro: PageFilter)`: si `!actaActual?.fotoOriginal` → toast warn; si no, estado local `revelando` + `bridge.revelar(actaActual, filtro, onProgreso)` → acta actualizada (`fotoProcesada` + `filtro`).
- `E14Bridge` gana el método `revelar(acta: Acta, filtro: PageFilter, onProgreso?): Promise<Acta>` (contrato en `bridge.ts`; en el mock ya no existe — solo real). `RealCoreBridge.revelar`: `processImage(acta.fotoOriginal, acta.quadDetectado ?? defaultQuad(), filtro, acta.rotation ?? 0, { manual: true })` → devuelve `{ ...acta, fotoProcesada, filtro }` (sin re-OCR, sin re-calidad: el gate ya resolvió). Timeout corto de seguridad 15 s igual a `recortar` no es necesario aquí (un solo `processImage`); si el agente prefiere simetría con `recortar`, puede reusar el patrón — decisión suya, documentarla.
- Toast de éxito copiado del lab: `Filtro aplicado: ${label}` (L1216).

---

## §F3. ELIMINAR «VER FOTO» — LA FOTO REAL ES EL DEFAULT ÚNICO

**Síntoma (dueño):** «El botón "ver foto" en el editor no es necesario, elimínalo.»

**Diagnóstico:** `ReviewView.tsx` L120 `verFoto` alterna entre el papel sintético (`ActaDocument`, L287) y `fotoProcesada` (L280–285). Botones: 4ª columna del toolbar L332–338 y bloque centrado de ENVIADA L344–352.

**Cambio (depende de F1):**
1. Eliminar el estado `verFoto` (L120) y TODOS sus usos: toggle del toolbar (L332–338), bloque ENVIADA (L344–352), condicional del visor (L280–288) y el badge «FOTO REAL DISPONIBLE» (L289–295, ya no tiene sentido).
2. Visor único: `{hayFoto ? <img src={acta.fotoProcesada} … /> : <placeholder>}` — el placeholder (solo posible en un timeout del pipeline que no alcanzó a procesar) es la MISMA caja con brackets y un texto centrado `font-data` «FOTO NO DISPONIBLE». **`ActaDocument` queda fuera de ReviewView.**
3. Borrar `src/components/e14/ActaDocument.tsx` si queda sin usos (verificar con grep: hoy su único import es ReviewView L19). Si el dueño lo quiere para el futuro, queda en el historial de git — la petición es «no volver a verla».
4. Eliminar el estado local `rotacion` de ReviewView (L119) y la rama decorativa `setRotacion` del botón ROTAR (L318–323): con F1, SIMULACIÓN también rota real vía `store.rotarFoto`. El botón queda: `onClick={() => void rotarFoto()}` para todo `esReal`.
5. Actualizar el comentario de cabecera del archivo (L3–15) reflejando el nuevo contrato (D36/D37).

---

## §F4. EDITOR DE RECORTE: BOTONES «ROTAR» Y «DETECCIÓN AUTOMÁTICA»

**Síntoma (dueño):** «Cuando se entra a recortar manualmente, agrega un botón para "rotar" la imagen y "detección automática".»

**Dónde:** `src/components/e14/QuadEditor.tsx` (copia del subsistema CROP del lab, §7.5). Hoy NO tiene ninguno de los dos.

**Fuente en el lab (copiar verbatim y re-vestir):**
- **Detección automática**: `EditorView.tsx` **L1198–1212** (`handleDetect`: `detectDocumentEdges(page.original)` → actualiza el quad) + el botón pill **L2123–2141** (spinner mientras detecta, `Sparkles` → usar icono nuevo `SparklesIcon`).
- **Rotación**: la mecánica de quad-en-marco-rotado YA está en e14 QuadEditor (`rotation` prop L81/L123, `pointerToNormalized` L215–236 invierte la rotación, handles dentro del div rotado L410–417). Lo único nuevo es el botón que la cambia localmente (el lab rota en REVIEW con F-ROT-RAPID L1080–1119; aquí el botón vive DENTRO del editor de recorte, como pide el dueño).

### Diseño (respetando D19 — el editor es PURO)
1. **Estado local** `rotLocal` inicializado de `rotationProp` (reemplaza el `rotation` calculado en L123; todos los usos de `rotation` pasan a `rotLocal`).
2. **Botón ROTAR 90°** (icono `RotateIcon` de `../icons`, ya existe): `setRotLocal((r) => (r + 90) % 360)`. Añadir `transition-transform duration-300` al div interior (L416) SOLO para el giro (los arrastres no lo tocan). El quad NO se remapea: vive en fracciones de la imagen SIN rotar y el overlay rota solidario (convención documentada en la cabecera del archivo L28–31). Doble-tap seguro: es determinista, no necesita guard.
3. **Botón DETECCIÓN AUTOMÁTICA**: estado `detectando`; al pulsar → `detectDocumentEdges(fotoOriginal)` (importarlo de `@jg-stevan/scanner-core/image-processor`) → animar `displayQuad` del valor actual al detectado reusando el tween easeOutCubic 280 ms YA existente (extraer el efecto L163–188 a una función `animarQuadHacia(target)` usada por el aterrizaje inicial Y por este botón). Sin tocar el store (D19): el quad solo llega al acta al APLICAR. Si falla → mensaje inline en el readout del header (L376–383) o toast del store (`notificar` no está disponible en el componente puro → usar el readout: «NO SE PUDO DETECTAR» durante ~2 s). Prohibido `alert`.
4. **APLICAR entrega la rotación**: extender `onAplicar: (quad: Quad, rotacion: number) => void`. En `ReviewView` L390–392: `void aplicarRecorte(quad, rotacion).then(…)`.
5. **Cables del rescate**: `store.aplicarRecorte(quad, rotacionNueva?)` (L388–413) pasa la rotación explícita a `bridge.recortar(acta, quad, onProgreso, rotacionNueva)`; `RealCoreBridge.recortar` (L313–355) acepta `rotacionOverride?: number` como 4º parámetro y usa `rotacionOverride ?? acta.rotation ?? 0` (hoy L322); el retorno de `pipelineRecorte` fija `rotation: rotacionUsada`.
6. **Ubicación de los botones**: fila FIJA sobre el footer de APLICAR (dentro del bloque footer L532–552, encima del hint), dos botones del mismo estilo del footer (border-outline-dim, `font-data`, alto táctil 44px): `[ ROTAR 90° ] [ DETECCIÓN AUTOMÁTICA ]`, deshabilitados mientras `aplicando`, DETECCIÓN también mientras `detectando` (spinner dentro del botón, patrón del lab L2132–2135).
7. Iconos nuevos en `src/components/e14/icons.tsx`: `SparklesIcon` y `SlidersIcon` (trazos estilo lucide `sparkles`/`sliders-horizontal`, `strokeWidth 2`, `currentColor`), mismo patrón que los existentes.

**Criterio:** rotar en el editor y APLICAR produce una `fotoProcesada` girada (horneada, `acta.rotation` actualizada) con el quad respetado al píxel (F5-MANUAL); CANCELAR tras rotar/detectar no cambia nada.

---

## §F5. BARRA DE CONTROLES FIJA ABAJO EN REVISIÓN

**Síntoma (dueño):** «Los controles en el editor se adaptan al tamaño y la orientación del documento escaneado; deben ir fijos en la parte inferior del editor.»

**Diagnóstico:** en `ReviewView.tsx` el toolbar vive DENTRO de la tarjeta del documento (L271 `<section … h-full max-h-[calc(100vh-260px)]>` con `justify-between`, toolbar en L303–340), y ENVIADA usa otro bloque distinto (L344–352). El resultado se siente «pegado» al documento y cambia de posición/contenido según estado y orientación.

**Cambio (estructura del `main` L152–377):**
```
main (flex col, flex-1, min-h-0)
├─ visor: tarjeta del documento SOLO visual (brackets + img object-contain, flex-1)
│    · SIN toolbar dentro. La tarjeta puede medir lo que mida el documento.
└─ barra de controles: shrink-0, FULL WIDTH del editor, ALTO CONSTANTE,
   fuera de la tarjeta, anclada al borde inferior del editor (justo encima
   de los CTAs/BottomNav que ya renderiza page.tsx L35–37)
```
1. La barra: `grid grid-cols-3 gap-2 pt-2 shrink-0` (RECORTAR · ROTAR 90° · FILTROS) + `PANTALLA COMPLETA` → **grid-cols-4** con los cuatro. `ToolbarBtn` con alto mínimo táctil 44px y labels `truncate` para que NADA cambie de tamaño nunca.
2. Estados:
   - `ADVERTENCIA` / `RECHAZADA` / `OPTIMA` (esReal): barra completa con las 4 acciones (FILTROS y PANTALLA COMPLETA deshabilitados si no hay `fotoProcesada`/`fotoOriginal` según corresponda — mismos guards de hoy L314/L329).
   - `ENVIADA`: SIN barra (los CTAs de abajo ya dan EXPORTAR PDF/SEGUIR — hoy no hay más acciones ahí y VER FOTO se eliminó en F3).
3. La barra SIEMPRE al mismo alto del viewport salvo cambios de estado — **criterio de aceptación**: girar el documento RETRATO↔APAISADO (botón ROTAR 90°) NO mueve ni un píxel la barra ni cambia el tamaño de sus botones.
4. Los banners flotantes (L154–268) y los chips de envío (L356–376) quedan como están.

---

## §C. PLAN DE COMMITS (rama `fix/e14-ux-real`, 1 PR al final)

| # | Commit | Tareas | Contenido |
|---|---|---|---|
| C1 | `docs: AGENTS.md raíz con la REGLA DE ORO #0 (lab = fuente de verdad)` | R0 | `AGENTS.md` nuevo + línea al tope de `README.md` |
| C2 | `feat(e14): SIMULACIÓN = pipeline real sobre acta E-14 incluida (D35) — mock retirado` | F1 | asset §1 + fetchActaSimulada + CompositeBridge/store/ScanView/gates esReal |
| C3 | `fix(e14): fuera VER FOTO y papel sintético — la foto real es el visor único` | F3 | ReviewView visor + borrado ActaDocument |
| C4 | `fix(e14): barra de controles FIJA en la parte inferior del editor de revisión` | F5 | reestructura del main de ReviewView |
| C5 | `feat(e14): filtro B/N adaptativo por defecto + selector de filtros (copia del lab, D36)` | F2 | bridge bw + Acta.filtro + sheet + bridge.revelar |
| C6 | `feat(e14): QuadEditor con ROTAR 90° y DETECCIÓN AUTOMÁTICA (copia del lab, D37)` | F4 | QuadEditor + onAplicar(quad,rotacion) + cables store/bridge |
| C7 | `docs(e14): spec ux-real-bn-editor + D35–D38 + worklog + ROADMAP` | — | esta spec a `apps/digitalizador-e14/docs/SPEC-ux-real-bn-editor.md`, `docs/DECISIONS.md`, `docs/worklog.md`, `docs/ROADMAP.md` |

**Reglas del protocolo (iguales a PR #7):**
- Cada commit funcional lleva su sección en `docs/worklog.md` con la tabla de veredictos **FIEL / ADAPTACIÓN / DESVIACIÓN** de sus bloques copiados del lab (los de F2 y F4 son copias con Fuente; los de F1/F3/F5 son decisión propia → registrar como «DECISIÓN PROPIA (D3x)»).
- `docs/DECISIONS.md`: **D35** SIMULACIÓN = pipeline real + imagen incluida (mock retirado; chips de forzado obsoletos) · **D36** filtro default `bw` + selector (base: types.ts L50 y CameraView L602–604 del lab) · **D37** ROTAR/DETECCIÓN en el editor de recorte; `onAplicar(quad, rotacion)` · **D38** barra de controles fija (fuera de la tarjeta del documento).
- Checks OBLIGATORIOS antes del PR: `bun run lint` en la raíz + build estático de e14: `cd apps/digitalizador-e14 && BUILD_STATIC=1 bunx next build` (debe pasar con el asset y el import estático; NO subir el deploy — el dueño hará merge).
- NO tocar `apps/scanner-lab/` ni `packages/scanner-core/`. NO instalar dependencias nuevas (el sheet de filtros se hace sin `vaul`). NO cambiar rutas ni flujos fuera de lo listado.

---

## §A. CRITERIOS DE ACEPTACIÓN (los verificaré por navegador tras el merge)

1. **SIMULACIÓN**: ESCANEAR → ANALIZANDO con etapas reales → revisión muestra **la foto real del E-14** (vertical, EXIF aplicado), score/OCR reales; consola: `[e14] pipeline SIMULACION/file total=…ms`. Los chips ÓPTIMA/ADVERTENCIA/RECHAZADA ya no existen en ningún lado.
2. **Nada de papel sintético**: `ActaDocument` no aparece en revisión (el archivo está borrado); no existe el botón VER FOTO.
3. **B/N adaptativo por defecto**: toda captura (CÁMARA/IMPORTAR/SIMULACIÓN) y todo recorte sale en B/N adaptativo; el PDF se genera con `filter: "bw"`. El selector FILTROS muestra las 3 vistas previas (Original/Texto claro/B/N adaptativo) y al cambiar re-procesa sin re-OCR con toast «Filtro aplicado: …».
4. **Recortar manual**: aparecen ROTAR 90° y DETECCIÓN AUTOMÁTICA; rotar gira el preview con el quad pegado; detectar anima el marco a los bordes reales; APLICAR hornea quad+rotación; CANCELAR no toca nada.
5. **Controles fijos**: la barra RECORTAR/ROTAR/FILTROS/PANTALLA COMPLETA queda clavada abajo con alto constante al girar el documento retrato↔apaisado y en cualquier estado (ADVERTENCIA/RECHAZADA/ÓPTIMA).
6. **Regresión**: CÁMARA real sigue abriendo la lente principal (`__cameraChoice.elegida` sin palabras de lente gran angular), flash/ZSL intactos, IMPORTAR acepta `.heic`, EXPORTAR PDF funciona, offline encola, y el fallback de cámara sigue cayendo a SIMULACIÓN sin romper nada.
7. Lint + build estático en verde; `docs/worklog.md` y `DECISIONS.md` actualizados por commit.
