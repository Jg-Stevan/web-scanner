# ROADMAP — digitalizador-e14 (FASE GRÁFICA)

Leyenda: [ ] pendiente · [~] en progreso · [x] hecho

- [x] G0 — Scaffold de la app en el monorepo + copiar zip v2 a docs/design/ + docs base + commit
- [x] G1 — Tokens del tema (globals.css §5) + fuentes (Hanken Grotesk, JetBrains Mono) + primitivas
- [x] G2 — Shell: TopBar + BottomNav (estilo activo v2 §8) + router de vistas (zustand) + safe-area
- [x] G3 — Dominio completo (§6) + seed mock (§6.4) + bridge mock
- [x] G4 — ESCANEAR: placeholder visor + botón disparo + panel de simulación (forzar estados)
- [x] G5 — ANALIZANDO: anillo + % + línea de escaneo + 4 barras de paso + footer
- [x] G6 — REVISIÓN: documento (§7.3) + 4 estados (§7.4) + banner rico rechazada (§7.5) + flotantes
- [x] G7 — ACTAS: CONTROL ACTAS E-14 con acordeón de mesas (§7.6)
- [x] G8 — RESUMEN: dashboard de trabajo (§7.7)
- [x] G9 — GitHub Pages: basePath + workflow parametrizado + verificación en /web-scanner/ (luego supersedido por Pages dual — ver D13)
- [x] G10 — DoD completa (§10) + revisión visual lado a lado con screen.png + QA externa (FIXES-e14-qa.md: 2 fixes aplicados y verificados)

## FASE LÓGICA (SPEC-fase-logica.md §8)

- [x] L0 — Andamiaje: dep workspace `@jg-stevan/scanner-core` + transpilePackages + assets worker/opencv en public/ + bun.lock
- [x] L1 — Contrato async (mock intacto): tipos §3 + CompositeBridge (D19) + store async con progresoAnalisis + ANALIZANDO event-driven con piso escénico (D18) — regresión cero en SIMULACIÓN
- [x] L2 — Fuente ARCHIVO real: RealCoreBridge (pipeline §5 + mapeo §4 + gate ILEGIBLE §4.2 + timeout 15 s) + chips de fuente en ScanView + ReviewView "VER FOTO" (D20–D23)
- [x] L3 — Fuente CÁMARA real + interfaz de escaneo del lab COMPLETA: CameraFrameLoop + HUD + BUSCANDO ACTA… + quad en vivo + IA·AUTO (OFF default, D24) + flash F-FLASH v3 + ZSL best-shot + ruta iOS + destello (D25-D27)
- [x] L4 — EXPORTAR PDF: adaptador §6 + CTA en REVISIÓN (solo actas reales)
- [x] L5 — Editor de recorte: COPIAR subsistema CROP de scanner-lab/EditorView.tsx (§7.5) + toolbar real de REVISIÓN (D28–D31)
- [ ] L6 — (opcional) Persistencia: localStorage + IndexedDB + "REINICIAR JORNADA"
- [ ] L7 — (opcional) Cámara sintética en SIMULACIÓN (SyntheticCamera del core)

## FIDELIDAD AL LAB (SPEC-auditoria-copias.md — fix/e14-fidelidad-lab)

- [x] H1 — F-LENS v4 completo: sondas secuenciales + chooseMainProbe + fix zoom + telemetría `__cameraChoice` (D33)
- [x] H2 — F-SENSOR-PROFILER: perfilado del track + takePhotoBlob (capas 1-2) + capa 3 decode único/tope por GAMA cubriendo CÁMARA e IMPORTAR (D34)
- [x] H3 — captureSmart: snapA ANTES del disparo (§5.4 del lab)
- [x] H4 — TORCH_HINT verbatim completo (diagnóstico de campo para el operador)
- [x] H5 — IMPORTAR: accept `.heic/.heif` en ambos inputs + guard F-IMPORT/HEIC del lab
- [ ] H6 — (DECISIÓN del autor) PWA instalable + offline (manifest + SW network-first del lab) — valioso para operadores en zona de mala conexión; NO en este PR por alcance

## UX REAL (SPEC-ux-real-bn-editor.md — fix/e14-ux-real)

- [x] R0 — AGENTS.md en la RAÍZ con la REGLA DE ORO #0 (el lab es la fuente de verdad) + enlace al tope de README.md
- [x] F1 — SIMULACIÓN = pipeline real sobre el acta E-14 REAL incluida (D35): mock retirado, chips de forzado obsoletos, gates esReal por foto
- [x] F3 — VER FOTO y papel sintético eliminados: la foto real es el visor único (ActaDocument borrado)
- [x] F5 — barra de controles FIJA en la parte inferior del editor de revisión (D38)
- [x] F2 — filtro «B/N adaptativo» por defecto + selector de filtros (copia del lab, D36)
- [x] F4 — QuadEditor con ROTAR 90° y DETECCIÓN AUTOMÁTICA (copia del lab, D37)

**Estado:** PR #8 MERGEADO a `main` (merge commit `eda6714`, 2026-10-10) · CI Pages verde · smoke test de producción OK (golden path + editor + filtros + barra fija al píxel + h-dvh móvil + lab sin regresión — ver worklog 14:40). **En producción:** https://jg-stevan.github.io/web-scanner/

## F-OCR — BOTÓN «TEXTO» (SPEC-texto-ocr-editor.md — feat/e14-texto-ocr)

- [x] B1 — ToolbarBtn.active (re-vestido ToolItem L2208) + barra grid-cols-5 con TEXTO en 4ª posición, `active={hayTexto}` (D39)
- [x] B2 — bridge.reconocerTexto (requestOcr sobre fotoProcesada) + store.reconocerTextoActa con toasts del lab (D39)
- [x] B3+B4+B6 — sheet «Texto reconocido» 3 estados + contadores + «Reconocer de nuevo»/«Copiar texto» (patrón del sheet de filtros, sin vaul) (D39)
- [x] B5 — OcrHighlightedText completo (mark #ffd60a literal, query={null} hoy) (D39)
- [ ] F-FIND — barra de coincidencias del lab (L2347-2366 + pendingFindQuery): EXCLUIDA de esta copia — su único punto de entrada es la búsqueda de la biblioteca del lab; e14 no tiene biblioteca. `OcrHighlightedText` YA queda listo (solo faltará pasarle la query cuando exista un buscador).

**Estado:** PR #9 MERGEADO a `main` (merge commit `83e5838`, 2026-10-10) · CI Pages verde (run `38012198805`) · smoke test de producción OK (TEXTO con el OCR real del pipeline: 170 palabras | 745 caracteres idénticos al QA dev · Reconocer de nuevo · Copiar texto + toast · botón active · barra fija al píxel con 5 columnas · h-dvh · lab sin regresión — ver worklog 16:15). **En producción:** https://jg-stevan.github.io/web-scanner/

## F-CLASIF — CLASIFICACIÓN DE CABECERA contra DIVIPOL oficial (SPEC-e14-cabecera-clasificacion.md — feat/e14-clasificacion-cabecera)

- [x] §1 — base DIVIPOL del visor oficial (34 deps · 1.189 mun · 3.013 zonas · 14.438 puestos — validada 1:1 con Cairo/Frankfurt/Bremen) + bundle compacto `public/e14/divipol.json` (620 KB) + `scripts/gen-divipol.mjs` con guard de conteos
- [x] §2 — `divipol.ts`: carga fetch local (basePath, caché, estado, NUNCA falla) + índices + trigramas/Dice sin deps
- [x] §3 — `clasificador.ts`: anclas VERBATIM §3.2 + normalización NFKD + fuzzy Dice + estrategia §3.3 + veredicto AUTO/SUGERIDA/MANUAL (PATRON_CABECERA nunca es pase libre)
- [x] §4 — gate REVISADO (evaluarGate único para escaneo y recorte): RECHAZADA solo por CALIDAD · AUTO → status por score · SUGERIDA/MANUAL → EN_REVISION_HUMANA (PROHIBIDO rechazar por cabecera) · log `clasif={...}` (§4.6)
- [x] §5 — PanelClasificacion: cascada Dep→Mun→Zona→Puesto→Mesa + tipo + páginas, precarga de la sugerencia, GUARDAR UBICACIÓN + REPETIR FOTO, texto libre sin base, max-h-96, touch 44 px
- [x] §6 — Fase B: archivadas por clave de mesa (ceros) + huecos DELEGADOS|TRANSMISIÓN × 1/2, duplicado → reemplaza y avisa (§G.4.1), ACTAS «MESAS CLASIFICADAS» antes del seed, export `E14_{KIT}_{...}_{TIPO}-{pag}.pdf` (§G.4.5)

**Estado:** rama `feat/e14-clasificacion-cabecera` (fbec763 + da7033b + docs) lista para PR — QA AC1-AC7 completo en dev (ver worklog 17:30): la acta Frankfurt real pasa de «ACTA NO RECONOCIDA» a **AUTO 88·120·15·02·012·TRANSMISION → OPTIMA → envío automático**; build estático verde con basePath inlineado. **Nota:** dominio E-14 nuevo — cero código del lab (§8).

### Fuera de alcance (decisión del dueño, §0/§8)
- [ ] Manuscritos G.2/G.3 (votos/firmas/cédulas) — cubiertos por la revisión humana existente
- [ ] Consulta viva AppSync (§G.4.6, fase futura)
- [ ] H6 PWA — decisión del autor
