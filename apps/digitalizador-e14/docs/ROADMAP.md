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
