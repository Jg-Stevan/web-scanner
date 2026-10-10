# SPEC e14 — BOTÓN «TEXTO» (F-OCR DEL LAB) EN EL EDITOR DE REVISIÓN

**Rev. 1 — para el agente de `Jg-Stevan/web-scanner`.**
**Base: `main` post-PR#8. Si el PR #8 (`fix/e14-ux-real`) aún NO está mergeado, ramifica `feat/e14-texto-ocr` DESDE `fix/e14-ux-real` (la barra fija, `ToolbarBtn` y el patrón del sheet de filtros viven ahí) y apila el PR.**
**Alcance: SOLO `apps/digitalizador-e14/`. PROHIBIDO tocar `apps/scanner-lab/` o `packages/scanner-core/`. PROHIBIDO instalar dependencias nuevas (el sheet se hace con el MISMO patrón del sheet de FILTROS ya existente en ReviewView — sin `vaul`).**

---

## §0. REGLA DE ORO (léela primero — está en `AGENTS.md` de la raíz)

> Lo que ya existe en el lab se COPIA verbatim con comentario `// Fuente: apps/scanner-lab/<ruta> L<ini>–L<fin>` y se adapta SOLO el re-vestido (tokens e14). Nunca re-implementar ni "simplificar".

Petición literal del dueño: **«Copiemos el botón de "Texto" (con sus funciones) de lab en el editor de e14»**.

## §1. QUÉ ES EL BOTÓN «TEXTO» EN EL LAB (análisis verificado)

En el lab, «Texto» es la función **F-OCR del editor**: un botón del toolbar de página (icono `ScanText`, estilo Adobe Scan «Editar texto») que abre un **sheet** con el texto que el OCR extrajo de la página, con contadores, copiar al portapapeles y re-reconocer. NO ejecuta el OCR al pulsar: abre el sheet y el OCR corre dentro (o ya corrió — en el lab de fondo tras cada captura).

**Bloques a copiar (todas las líneas verificadas hoy sobre `apps/scanner-lab/src/components/scanner/EditorView.tsx`):**

| # | Bloque | Líneas del lab | Destino e14 |
|---|---|---|---|
| B1 | Botón del toolbar | **L2205–2210** (`icon={ScanText} label="Texto" active={page?.ocrDone === true} onClick={() => setOcrOpen(true)}`) | 5º botón de la barra fija de ReviewView (§F1) |
| B2 | Ejecución OCR `runOcrCurrent` | **L1360–1395** (guards → elegir imagen → `requestOcr` → `ocrTextIsValid` → guardar + toasts) | store action `reconocerTextoActa` (§F2) |
| B3 | Copiar `copyOcrText` | **L1446–1455** (`navigator.clipboard.writeText` + toasts) | dentro del sheet (§F3) |
| B4 | Sheet OCR (3 estados) | **L2311–2416** (título «Texto reconocido», spinner, caja de texto, contadores, «Reconocer de nuevo» + «Copiar texto», estado vacío con «Reconocer texto») | sheet en ReviewView (§F3) |
| B5 | `OcrHighlightedText` | **L237–271** (resaltado; sin query = texto plano) | componente local de ReviewView (§F3.4) |
| B6 | `ocrStats` (contadores) | **L1563–1578** (palabras = `text.trim().split(/\s+/).length`; caracteres = `text.length`) | `useMemo` en ReviewView (§F3.3) |

**EXCLUIDOS de esta copia (con razón documentada — NO copiar):**
- **F-FIND** (barra de coincidencias amarilla L2347–2366 + `pendingFindQuery` L299–303 + efecto L1550–1560): su ÚNICO punto de entrada es la **búsqueda de la biblioteca** del lab. e14 no tiene biblioteca buscable → no hay quien escriba una query. Se copia B5 (que sin query degrada a texto plano) y queda listo para el futuro; la barra de búsqueda NO.
- **Multi-página**: `runOcrAll` L1398–1444, «Copiar texto de las N páginas» L2418–2428 y el progreso `ocrProgress` L2340–2342 — e14 trabaja UN acta de UNA página.
- **F-OCR-AUTO** (OCR de fondo L1499+): e14 **ya lo hace** — el pipeline corre `requestOcr` SIEMPRE y guarda `ocrTexto` en el acta (`scanner-core-bridge.ts` L299–302 y L328). Por eso el sheet de e14 nacerá casi siempre con texto.

---

## §F1. EL BOTÓN EN LA BARRA FIJA (B1)

`src/components/e14/screens/ReviewView.tsx` — la barra de controles fija (D38) pasa de `grid-cols-4` a **`grid-cols-5`** con el nuevo botón **TEXTO en 4ª posición** (orden del lab: Recortar · Rotar · Filtros · **Texto** · …):

```
RECORTAR · ROTAR 90° · FILTROS · TEXTO · PANTALLA COMPLETA
```

1. `ToolbarBtn` (`src/components/e14/primitives.tsx` L128–142) gana una prop **opcional `active?: boolean`** — re-vestido del `ToolItem` del lab (mismo concepto, L2208): cuando `active`, el botón se distingue (p. ej. `border-ok-tint/50 text-ok-tint` manteniendo alto/tamaño idénticos — NADA cambia de tamaño, criterio F5/D38 sigue vigente).
2. `active={hayTexto}` donde `hayTexto = Boolean(acta.ocrTexto) && acta.ocrTexto !== OCR_NO_TEXT` (ver §F3.2 para `OCR_NO_TEXT`).
3. `disabled` si `!acta.fotoProcesada` (mismo guard que FILTROS hoy) — y fuera de la barra en ENVIADA (ya es así: no hay barra).
4. Icono: `ScanTextIcon` (§F4) + label `TEXTO`. Al pulsar abre el sheet (NO ejecuta OCR directamente — igual que el lab L2209).

## §F2. EJECUCIÓN OCR — `bridge.reconocerTexto` + store action (B2)

**Contrato** (`src/lib/e14/bridge.ts`, junto a `revelar`):
```ts
/** F-OCR del lab (EditorView.tsx L1360-1395): corre requestOcr sobre la
 *  imagen PROCESADA del acta y devuelve el texto crudo. */
reconocerTexto(acta: Acta): Promise<string>;
```

**RealCoreBridge** (`scanner-core-bridge.ts`): `return requestOcr(acta.fotoProcesada)`.
- `requestOcr` YA está importado (L40) y es el mismo motor que corre en el pipeline.
- **ADAPTACIÓN documentada**: el lab elige imagen con prioridad `preview ?? procesada-fresca ?? original` (L1373–1376) porque tiene previewCache; en e14 la procesada SIEMPRE está fresca (todo cambio pasa por el pipeline) → se usa `fotoProcesada` directa. El guard `previewLoading` (L1364–1370) NO aplica (no hay preview en e14) → omitido.
- **ADAPTACIÓN documentada**: sin timeout extra (igual que el lab L1379 — `requestOcr` se gobierna solo).

**Store action** (`src/lib/e14/store.ts`, junto a `cambiarFiltro`):
```ts
/** F-OCR del lab (EditorView.tsx L1360-1395, D39): re-reconoce el texto del
 *  acta sobre la PROCESADA y lo guarda. Toaster = copia de los toasts del lab. */
reconocerTextoActa(): Promise<void>;
```
Comportamiento (misma secuencia del lab):
1. Guards: `!actaActual?.fotoProcesada` → `notificar("warn", "SIN FOTO", "…")` y return; si ya está corriendo (el estado de "corriendo" lo lleva ReviewView, ver abajo) no re-entrar.
2. `const texto = await bridge.reconocerTexto(actaActual)`.
3. Si `ocrTextIsValid(texto)` (importar de `@jg-stevan/scanner-core/ocr` — la MISMA función del lab L1380): actualizar `actaActual.ocrTexto = texto` + `notificar("ok", "TEXTO RECONOCIDO", \`${texto.length} caracteres · ya puedes copiarlo\`)` (toast del lab L1382–1384, verbatim en la descripción).
4. Si no: `notificar("warn", "SIN TEXTO LEGIBLE", "La página no parece tener texto legible")` (lab L1386).
5. `catch` → `notificar("crit", "NO SE PUDO RECONOCER EL TEXTO", err.message)` (lab L1389–1391; títulos en mayúsculas = estilo de toasts e14, descripciones verbatim del lab).
- **Estado "corriendo" LOCAL en ReviewView** (igual que el lab: `ocrRunning` es del componente, L347): `setOcrEjecutando(true); try { await reconocerTextoActa(); } finally { setOcrEjecutando(false); }`.

## §F3. SHEET «TEXTO RECONOCIDO» (B4 + B3 + B6 + B5)

En `ReviewView.tsx`, con el **mismo patrón del sheet de FILTROS que ya construiste** (`fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md rounded-t-[22px] bg-surface-1 pb-safe outline-none animate-editor-enter` + backdrop con cierre — L396–409; NO vaul, cero deps nuevas). Comentario de cabecera: `// Fuente: apps/scanner-lab/src/components/scanner/EditorView.tsx L2311-2416 (vaul → patrón del sheet de filtros e14) — D39`.

**F3.1 Título** (lab L2327–2333): fila centrada con `ScanTextIcon` en color acento e14 (lab: `#007aff` → `text-ok-tint`) + «Texto reconocido» + `sr-only` con la descripción del lab adaptada: «Texto extraído por OCR del acta».

**F3.2 Tres estados** (lab L2336–2416 — idénticos):
1. **Ejecutando** (`ocrEjecutando`): spinner (`LoaderIcon` + `animate-spin`, acento e14) + texto «Reconociendo texto…» (L2342 — sin la variante multi-página).
2. **Con texto** (`acta.ocrTexto` válida):
   - Caja de texto: `max-h-[38vh] overflow-y-auto rounded-xl bg-black/40 p-3.5 ring-1 ring-inset ring-line` (lab L2367, re-vestido `ring-white/10`→`ring-line`) con `<OcrHighlightedText text={acta.ocrTexto} query={null} />`.
   - **Contadores** (lab L2370–2378 + `ocrStats` L1563–1565): dos chips pill — `{palabras} palabras` · `{caracteres} caracteres` (singulares del lab respetados). `useMemo` con la fórmula verbatim B6 (sin `matches` — F-FIND excluido).
   - Fila de botones (lab L2379–2396): **«Reconocer de nuevo»** (pill secundaria `bg-white/10 ring-white/15` re-vestida con tokens e14) → llama §F2; **«Copiar texto»** (pill primaria, acento e14, icono `CopyIcon`, `flex-[1.3]`) → `void copiarTexto()`.
   - `copiarTexto` = B3 verbatim (lab L1446–1455): `navigator.clipboard.writeText(texto)` → toast «Texto copiado al portapapeles» / «No se pudo copiar el texto» (en e14: `notificar("ok", "TEXTO COPIADO", "Texto copiado al portapapeles")` / `notificar("crit", "NO SE PUDO COPIAR")` — re-vestido de títulos).
3. **Vacío** (`!ocrTexto || ocrTexto === OCR_NO_TEXT`): icono `ScanTextIcon` tinta tenue + hint (lab L2403–2405 **adaptado**: «Extrae el texto del acta para copiarlo.» — e14 no tiene biblioteca) + botón primario **«Reconocer texto»** (lab L2407–2414) → §F2.
   - `OCR_NO_TEXT`: **importar** `OCR_NO_TEXT` de `@jg-stevan/scanner-core/ocr` (ya exportado, ocr.ts L12 — el lab no lo necesita porque usa `ocrTextIsValid`; e14 lo usa para distinguir el texto vacío que dejó el pipeline). PROHIBIDO re-declarar el string.

**F3.3 Apertura/cierre**: `textoAbierto` estado local en ReviewView (como `filtrosAbiertos`); abre el botón TEXTO; cierra por backdrop (mismo mecanismo del sheet de filtros). El sheet renderiza solo si `acta` existe.

**F3.4 `OcrHighlightedText`** (B5, lab L237–271): copiar el componente COMPLETO (función local de ReviewView, comentario Fuente) aunque e14 hoy siempre pasa `query={null}` (degrada a texto plano, L245–250) — queda listo para F-FIND futuro. El `<mark>` amarillo `#ffd60a` se conserva literal (re-vestido no aplica: no hay token equivalente en e14).

## §F4. ICONOS NUEVOS (`src/components/e14/icons.tsx`)

Mismo patrón de los existentes (`SparklesIcon`/`SlidersIcon` de F4 — SVG inline, `strokeWidth 2`, `currentColor`, `IconProps`):
- `ScanTextIcon` — trazo de lucide **`scan-text`**.
- `CopyIcon` — trazo de lucide **`copy`**.
- `LoaderIcon` — trazo de lucide **`loader-circle`** (se usa con clase `animate-spin`).

## §C. PLAN DE COMMITS (rama `feat/e14-texto-ocr`, 1 PR)

| # | Commit | Contenido |
|---|---|---|
| C1 | `feat(e14): botón TEXTO (F-OCR del lab) en la barra de revisión — D39` | B1–B6: ToolbarBtn.active + grid-cols-5 + ScanTextIcon/CopyIcon/LoaderIcon + bridge.reconocerTexto + store.reconocerTextoActa + sheet completo |
| C2 | `docs(e14): spec texto-ocr + D39 + worklog + ROADMAP` | esta spec a `apps/digitalizador-e14/docs/SPEC-texto-ocr-editor.md`; `DECISIONS.md` **D39** (F-OCR del lab en revisión: qué se copió, qué se excluyó y por qué — F-FIND sin punto de entrada, multi-página N/A, F-OCR-AUTO ya existe en el pipeline); `worklog.md` con la tabla de veredictos **FIEL/ADAPTACIÓN** por bloque (B1 FIEL, B2 ADAPTACIÓN imagen/guards, B3 FIEL, B4 ADAPTACIÓN vaul→fixed, B5 FIEL, B6 ADAPTACIÓN sin matches); `ROADMAP.md` nota F-FIND futuro |

**Checks OBLIGATORIOS antes del PR**: `bun run lint` en raíz + lint/check de e14 + `bunx tsc --noEmit` + `BUILD_STATIC=1 bunx next build` (todo verde). NO subir deploy.

## §A. CRITERIOS DE ACEPTACIÓN (los verificaré por navegador tras el PR)

1. La barra fija muestra **5 botones**: RECORTAR · ROTAR 90° · FILTROS · TEXTO · PANTALLA COMPLETA — alto constante y **y idéntica** (criterio D38) al girar el documento; labels truncados sin romper el grid.
2. SIMULACIÓN → revisión → TEXTO abre el sheet: con el acta incluida y OCR válido muestra el texto real + contadores; si el OCR del pipeline no extrajo texto → estado vacío con «Reconocer texto».
3. «Reconocer de nuevo»: spinner + al terminar toast «TEXTO RECONOCIDO · N caracteres…» y el texto/contadores se actualizan (el botón TEXTO queda `active`).
4. «Copiar texto»: toast de éxito (o el toast honesto de fallo de portapapeles en headless — el catch del lab debe verse).
5. Con la foto del dueño (gate RECHAZADA) el sheet funciona igual — el texto es el crudo del OCR, sea bueno o malo (el sheet NO re-etiqueta el acta; solo muestra texto — igual que el lab).
6. Cierre por backdrop; sin leaks de estado (reabrir conserva el texto; ENVIADA sin barra; el sheet no aparece en otros estados).
7. Lint + tsc + build estático en verde; D39 + worklog + ROADMAP actualizados.
