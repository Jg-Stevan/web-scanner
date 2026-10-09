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
- [ ] L4 — EXPORTAR PDF: adaptador §6 + CTA en REVISIÓN (solo actas reales)
- [ ] L5 — Editor de recorte: COPIAR subsistema CROP de scanner-lab/EditorView.tsx (§7.5) + toolbar real de REVISIÓN
- [ ] L6 — (opcional) Persistencia: localStorage + IndexedDB + "REINICIAR JORNADA"
- [ ] L7 — (opcional) Cámara sintética en SIMULACIÓN (SyntheticCamera del core)
