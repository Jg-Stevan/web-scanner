# Lote 9 — Salud estructural: DRY + refactor + deuda (rama `refactor/lote9-estructural-v1`)

**Kit:** `INSTR-ws-lote9-estructural-v1` · **Agente:** B (calidad/estructura) · **PR DRAFT a main** (sin merge).
**Ejecución parcial y apilada** — ver §1 (precondiciones). Base técnica: `test/red-seguridad-v1` (los tests del Lote 6 son la red — regla madre del kit).

---

## 1 · Precondiciones del kit — estado real y decisiones

| Requisito | Estado al ejecutar | Consecuencia |
|---|---|---|
| **Lote 6 mergeado** | PR #9 DRAFT abierto (sin merge) | L9 **apilado** sobre `test/red-seguridad-v1`: los tests existen y corren en la rama. El PR de L9 mostrará también los commits de L6 hasta que #9 se mergeé (patrón stacked-PR estándar) |
| **Lote 5 mergeado** (Fase A · DRY-3) | PR #8 abierto (sin merge) | **DRY-3 EXCLUIDA** — kit: «el jsPDF dinámico del Lote 5 debe estar mergeado (tocan los mismos handlers). Rebase antes». `sharePdfFallback`/`runOcrWithProbe`/`withBusy` + `lib/share.ts` quedan para tras el merge de #8 |
| **Lote 8 mergeado** (Fases C y D) | **No existe** (ni rama ni PR) | **FASE C (DRY-1 visor unificado) y FASE D (BP-1 hooks por dominio + DRY-5 cámara al core) EXCLUIDAS** — el kit las marca «REQUIERE L8 mergeado» |
| **BP-6: warnings < 60** | lint = 159 | **BP-6 EXCLUIDA** (la elevación de reglas a `error` es del kit «una vez los warnings < 60») |
| **BP-5: smoke COMPLETO con cámara** | sandbox sin cámara física | **BP-5 EXCLUIDA** — activar `reactStrictMode` exige el smoke «cámara/detección/hidratación» completo (kit §F-E.1); sin cámara no es verificable y REGLAS #6 prohíbe marcar gates no ejecutados. Queda para el dueño con QA física |

**Ejecutado:** Fase B completa (LEG-2, LEG-6, BP-11) + Fase A parcial (DRY-4, DRY-6) + Fase E parcial (BP-9, BP-10). El kit contempla este recorte: «Si el lote crece demasiado: PRs separados por fase — **fases A+B pueden ir en PR propio antes que C+D**».

## 2 · FASE B — docs y fechas

### LEG-2 — CHANGES histórico a docs/history

- `CHANGES.md` había crecido a **221 KB / 58 entradas**. División:
  - Raíz: header + **4 entradas recientes** (Lote 6, hotfix deploy-pages, PR-limpieza, hotfix deploy-concurrency) + **sección puntero** al histórico.
  - `docs/history/CHANGES-2026.md` (nuevo): las **54 entradas restantes VERBATIM** (append-only preservado, encabezado explica la regla).
- Referencias a rutas de `CHANGES.md` en `AGENTS.md`: **ninguna** (grep — nada que actualizar).

### LEG-6 — regla de oro #0 (AGENTS.md)

- **Redacción propuesta en este doc ANTES de editar** (kit §F-B.3 — el dueño revisa en el PR). Texto aplicado a `AGENTS.md`:

> **REGLA DE ORO #0 — EL LAB ES LA FUENTE DE VERDAD · EXTRAE, NO COPIES**
> 1. Si existe y la necesita UNA sola app → COPIA VERBATIM el bloque a la app destino, con comentario de origen `// Fuente: apps/scanner-lab/<ruta> L<ini>–L<fin>` y adapta SOLO el «re-vestido». NUNCA re-escribas ni «simplifiques» (causó el bug F-LENS — ver D33).
> 2. Si existe y la necesitan DOS O MÁS apps (o es reutilizable del dominio) → **EXTRAER al paquete** (`scanner-core` para lógica sin React · `scanner-ui` para componentes React) e importar desde ahí. NUNCA dupliques entre apps: la copia puente es EXCEPCIÓN temporal documentada (con origen y plan de retirada), no el patrón por defecto. Extracción con API pública nueva → bump minor.
> 3. Si NO existe → specs de `apps/digitalizador-e14/docs/` + decisión en `DECISIONS.md`.
> 4. Ante la duda: extraer al paquete si es compartible; copiar del lab solo si es específico de una app. Nunca «mejorar» el lab.

- Conserva íntegro el guard anti-simplificación (F-LENS/D33) y el punto 3 original; añade la vía de extracción al paquete como CAMINO POR DEFECTO para lo compartido.

### BP-11 — `Date.now()` fuera de render

| Sitio | Antes | Ahora |
|---|---|---|
| `LibraryView` `buildListSections` (secciones temporales) | `timeSectionKey(d.updatedAt, Date.now())` DENTRO de la función llamada en render → secciones obsoletas tras medianoche | `buildListSections(docs, sort, hasActiveFilter, now)` — **pura de nuevo** (now por parámetro); el componente mantiene `sectionNowMs` (state lazy en montaje) con intervalo de 60 s que refresca SOLO si cambió el día local (comparación `toDateString`); el useMemo depende de `sectionNowMs` |
| `EditorView:499` `headerDate` | `prettyDate(reviewDoc ? reviewDoc.updatedAt : Date.now())` — impuro en render y congelado | `sessionNowMs` (state lazy) + mismo intervalo de cambio-de-día; `headerDate` deriva del estado |

Comportamiento visible idéntico (fechas correctas); deja de ser impuro/congelado. Los otros `Date.now()` de ambos archivos (L574/L801 de LibraryView, etc.) están en HANDLERS/callbacks — permitidos, no render.

## 3 · FASE A (parcial)

### DRY-4 — codec blob⇄dataURL único

- **`packages/scanner-core/src/codec.ts` (nuevo):** `dataUrlToBlob` (sincrónica, parse manual, contrato C-24: null si no hay coma; lanza en base64 inválido) y `blobToDataUrl` (FileReader) — implementaciones **verbatim** de page-store.
- **`index.ts`:** `export * from "./codec"` — additive. `page-store.ts` importa de codec y **re-exporta los mismos bindings** (API pública intacta — regla del core «quitar ROMPE»; export * doble sin conflicto porque resuelven al MISMO binding, verificado con test de identidad de referencia).
- **Bump minor: 0.2.0 → 0.3.0** (API nueva del paquete).
- **Adopción:**
  | Sitio (kit) | Sitio real | Migración |
  |---|---|---|
  | image-processor.ts:363 | image-processor.ts:22,982 | import de `./codec` (antes `./page-store`) |
  | page-store.ts:74 | page-store.ts:111,138 | implementaciones MOVIDAS a codec + re-export |
  | pdf-export.ts:74 | pdf-export.ts (canvasToJpegDataUrl) | FileReader inline → `await blobToDataUrl(blob)` (misma semántica: resuelve/rechaza; el respaldo toDataURL intacto) |
  | EditorView.tsx:192,329 | EditorView.tsx:248 (def fetch-based), 1205 (uso) | def local ELIMINADA; call-site usa la del core (sincronía ok — ya estaba en contexto async) con check explícito `blob === null \|\| blob.size === 0 → throw "blob vacío"` (misma semántica de error que la fetch-based) |
  | CameraView.tsx:513 | CameraView.tsx `downscaleImage` (FileReader inline) | → `await blobToDataUrl(blob)` (catch/respaldo intactos) |
  | CameraView.tsx:1268 | CameraView.tsx:1265 `blobToDataUrl` useCallback **con deadline/abort** | **NO migrada — EXCLUIDA documentada**: es un SUPERSET (muro de captura: aborta el FileReader a mitad y resuelve null). Unificarla con la simple del core ELIMINARÍA la cancelación → cambio de comportamiento en el HOT PATH de captura (prohibido). El dueño decide si algún día el codec crece un parámetro opcional |
- **Tests nuevos** (`tests/codec.test.ts`): contrato del módulo (base64/padding exacto, percent-encoded, C-24 null, base64 inválido lanza) + **test de identidad de re-export** (`page-store.dataUrlToBlob === codec.dataUrlToBlob`) que garantiza una sola implementación. `blobToDataUrl` skip documentado (FileReader no existe en bun — igual que en L6).
- Verificación de async-context: los call-sites migrados ya estaban en funciones async o son síncronos compatibles (EditorView 1205 dentro de try/catch async; CameraView downscaleImage async; pdf-export canvasToJpegDataUrl async). **Ningún call-site síncrono obligatorio** → sin excepciones que reportar (kit DRY-4.2).

### DRY-6 — misceláneos

1. **Tipo `engine` duplicado** (EditorView + SaveSuccessOverlay: `engine: "opencv" | "canvas"`) → **`export type ScanEngine`** en `packages/scanner-core/src/types.ts` (nombre propio: el `PagePrecision.engine` del core es `"worker"|"canvas"` — unión DIFERENTE, no se toca) + imports en ambos.
2. **Haptics:** `hapticConfirm()` en `apps/scanner-lab/src/lib/haptics.ts` (nuevo; guard `navigator.vibrate?.` + try/catch; patrón `[28, 60, 28] as const` — sin el tipo DOM `VibratePattern` para salir con 0 warnings de no-undef). Adopción: EditorView ×2 (L1407/L1428 → guardado) + OnboardingView ×2 (HAPTIC_PATTERN local eliminada). **Inventario real:** el kit contaba ×4 — hoy son 4 los SITIOS con el patrón confirmación (2+2); LibraryView usa `vibrate?.(12)` (patrón distinto, NO es confirmación) y CameraView usa su propio mecanismo en el hot path — no migrados, documentado.
3. **`pwa.ts` app → `update-banner.ts`:** `git mv` + import actualizado en `PwaRegister.tsx`. El `pwa.ts` del CORE no se toca.
4. **3 AlertDialog → `ConfirmDialog` local** (LibraryView): shell/pill/cancel idénticos; props `title`/`description` (ReactNode — el de exportar compone JSX), `actionLabel`, `onAction`, `tone: "danger" | "primary"` (rojo eliminar ×2, azul exportar ×1). Mismos textos, misma semántica de cierre (AlertDialogAction/Cancel built-in). Verificado en smoke: abre con «Exportar todo en un PDF?», Escape cierra.

## 4 · FASE E (parcial)

### BP-9 — non-null assertions

**Inventario real: 71** en la app (el kit/auditoría citaba 15 — número obsoleto, como avisaba el kit para otros hallazgos). Desglose: `image-size.ts` ×15, CameraView ×~30, `burst-budget.ts` ×10, EditorView ×7, device-profile ×3, diag-report ×2, qa-standard-test ×2, crash-reporter ×1, LibraryView ×1.

- **Aplicadas 8 reescrituras triviales con guard** (kit: «solo quita las que un guard ya cubre») en archivos whitelisted: EditorView 967-971 (índices de quad en drag: guard `if (!pt) return`), 1133-1134 (loop de 4 sobre quad), 1583 (loop de pages), LibraryView 695 (loop de targets). Todas de la forma «índice acotado por construcción → guard explícito barato».
- **Las 63 restantes QUEDAN documentadas** (kit: «el resto quedan documentadas»): la mayoría viven en `lib/*.ts` FUERA de la whitelist de L9 (image-size, burst-budget, diag-report, device-profile, crash-reporter, qa-standard-test) y en CameraView (hot path — cada reescritura merece su propio análisis por el riesgo del motor). Pendiente de un lote propio si el dueño quiere cerrarlas.

### BP-10 — `key={i}` justificadas

- `EditorView` (marcas del texto OCR): comentario — split estático del texto actual, orden/longitud inmutables, sin inserciones.
- `CameraView:3337` (puntos del quad overlay): comentario — tupla fija de 4 esquinas TL,TR,BR,BL en orden estable, sin reordenar.
- Nada más (kit: «Nada más»).

## 5 · Verificación obligatoria (§3 del kit)

1. **`bun test`:** ✅ **197 pass · 2 skip · 0 fail** — `Ran 199 tests across 11 files` (antes 193: **+6** — tests de codec; la red del Lote 6 intacta).
2. **`core:check && ui:check && app:check && lint`:** ✅ todos exit 0. Warnings: **151** (159 → −8 por las reescrituras BP-9; 0 errores).
3. **`build:static`:** ✅ exit 0.
4. **Smoke completo por fase (agent-browser, dev :3100):**
   - Biblioteca: 6 mocks, secciones, chips; **ConfirmDialog de exportar** abre («¿Exportar todo en un PDF?»), Escape cierra.
   - Editor: filtro «Texto claro» aplica; guardado vuelve a biblioteca; «Guardar PDF» ok; presentación a pantalla completa ok.
   - Ajustes: estadísticas/apariencia/diagnóstico renderizan.
   - **0 errores de página y de consola en todo el recorrido.**
5. **Diag de humo:** sección Diagnóstico en Ajustes operativa (botones JSON/compartir presentes), `crash-reporter` no dispara (0 errores en consola). Los módulos de diag no fueron tocados.
6. **Métricas:**
   - Líneas: `git diff --stat test/red-seguridad-v1...HEAD` ≈ +330/−160 (codec nuevo +115, ConfirmDialog −72 de duplicación, Guards BP-9 +14…).
   - Duplicaciones cerradas: **3** (dataUrlToBlob fetch-vs-sync unificada; 2 FileReader inline; 3 AlertDialog→1) + 2 tipos unificados (ScanEngine, haptics).
   - `wc -l` componentes: sin cambio estructural (las fases BP-1 no se ejecutaron — requieren L8).

## 6 · Commits (convención §4)

- `fix(dates): Date.now fuera de render (BP-11)`
- `docs: CHANGES histórico a docs/history + regla de oro #0 (LEG-2, LEG-6)`
- `refactor(core): codec blob↔dataURL único + adopción (DRY-4, bump 0.3.0)`
- `chore(app): ConfirmDialog + haptics + update-banner rename (DRY-6)`
- `chore(config): BP-9 assertions triviales con guard + BP-10 keys justificadas`
- `docs: evidencia Lote 9 (parcial — fases ejecutables sin L5/L8)`

## 7 · Desviaciones y pendientes

1. **Ejecución PARCIAL** (§1): DRY-3 (requiere L5 mergeado — PR #8), Fases C y D (requieren L8 — inexistente), BP-5 (smoke completo imposible sin cámara), BP-6 (warnings 159 > 60).
2. **`lib/haptics.ts` nuevo** — el kit pide el helper «en lib» pero la whitelist §6 no nombraba el archivo (solo share.ts para DRY-3 y update-banner para el rename). Decisión documentada: crear el archivo con el nombre correcto por cohesión en vez de colar el helper en otro módulo.
3. **CameraView:1265 `blobToDataUrl` con deadline NO migrada** — superset con cancelación del muro de captura; unificar degradaría el hot path.
4. **BP-9: 63 assertions restantes** fuera de alcance real (lib no-whitelisted + CameraView hot path).
5. **Haptics: inventario real 2+2 sitios** (no ×4 del kit); LibraryView/CameraView usan patrones distintos (12 / mecanismo propio) — no son «confirmación».
6. **Apilado sobre L6**: este PR contiene los commits de `test/red-seguridad-v1` hasta que #9 se mergeé (GitHub los oculta del diff cuando la base avance).
