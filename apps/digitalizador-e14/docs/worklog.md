# Worklog — digitalizador-e14

Bitácora incremental (append-only). Formato en AGENTS.md.

### [INICIO] — Proyecto creado — SPEC V2
- Fuente: SPEC-digitalizador-e14-monorepo-V2.md (FASE GRÁFICA)
- Diseño: docs/design/ (zip v2, 10 pantallas + DESIGN.md)
- Próximo paso: Fase G0 del ROADMAP.md

### [2026-10-09 17:30] — G0 — Z.ai Code
- **Hecho:** scaffold de la app en el monorepo (package.json, next.config dual
  standalone/export, tsconfig, postcss, eslint), zip v2 copiado a
  docs/design/screens (10 carpetas renombradas sin prefijo) + DESIGN.md, docs
  de protocolo (AGENTS.md verbatim, worklog, ROADMAP, DECISIONS), scripts
  raíz (dev:e14, lint:e14, build:e14, e14:check), bun install en el workspace.
- **Archivos:** apps/digitalizador-e14/{package.json,next.config.ts,tsconfig.json,postcss.config.mjs,eslint.config.mjs,AGENTS.md,docs/**}, package.json (raíz)
- **Commits:** b3b82fd
- **Cómo probar:** `bun run dev:e14` (:3001) — aún sin pantallas.
- **Pendiente/Bloqueado:** G1.

### [2026-10-09 17:45] — G1 — Z.ai Code
- **Hecho:** globals.css con tokens §5 (@theme inline: superficies charcoal,
  texto, líneas, estados ok/warn/crit, radios), utilidades del design system
  (label-caps, stats-number, headline-lg, font-data, pt/pb-safe, thin-scroll),
  animaciones (pulse-sync, scan-sweep, view-enter, banner-in), barcode-lines y
  bg-scanline. Fuentes next/font (Hanken Grotesk + JetBrains Mono). Primitivas
  (StatusDot, Chip, ScoreBadge, SegmentedBar, ToolbarBtn, PrimaryBtn,
  StatusPill) + 15 iconos SVG inline copiados de los code.html.
- **Archivos:** src/app/globals.css, src/app/layout.tsx, src/components/e14/{primitives.tsx,icons.tsx}
- **Commits:** 29afbe1
- **Pendiente/Bloqueado:** G2.

### [2026-10-09 17:55] — G2 — Z.ai Code
- **Hecho:** shell único (page.tsx) con router de vistas por estado (zustand),
  transiciones 150 ms, TopBar de REVISIÓN (← + título + pill conexión),
  BottomNav con 2 modos (dark: contenedor suave verde; app: bloque sólido
  verde C6) y contador ACTAS (n), FloatingBanner (3 variantes + auto-dismiss
  4 s).
- **Archivos:** src/app/page.tsx, src/components/e14/{TopBar.tsx,BottomNav.tsx,FloatingBanner.tsx}
- **Commits:** 353b070
- **Pendiente/Bloqueado:** G3.

### [2026-10-09 18:05] — G3 — Z.ai Code
- **Hecho:** dominio §6 completo (ActaStatus con EN_REVISION_HUMANA, Mesa,
  MesaPagina, ProgresoPuesto, HistorialRow, statusDeScore), seed EXACTO §6.4
  (3 mesas, 9/12, cola 03, rescaneos 01, historial 3 filas), MockBridge
  (score aleatorio/forzado + regla de desbloqueo: 2º intento SIEMPRE ≥8 §7.5)
  y get-bridge.ts como punto único de intercambio (D1). Store zustand con el
  flujo completo: dispararEscaneo → analisisCompletado (auto-envío D4) →
  enviarActa/repetirFoto/enviarRevisionHumana + cola offline con flush al
  reconectar + reactividad en vivo (progreso, historial, mesas).
- **Archivos:** src/lib/e14/{types.ts,seed.ts,bridge.ts,get-bridge.ts,store.ts}
- **Commits:** 4a43377
- **Pendiente/Bloqueado:** G4.

### [2026-10-09 18:20] — G4+G5 — Z.ai Code
- **Hecho:** ESCANEAR (marco con corner brackets, retícula, "ESPERANDO
  CAPTURA · MODO SIMULACIÓN", disparo 72px blanco con anillo verde, ghost
  IMPORTAR IMAGEN, panel de simulación con 5 chips) y ANALIZANDO (beacon EN
  PROCESO + latencia, anillo SVG r68/dash 427.25, núcleo con línea de escaneo
  + icono + %, 4 barras de paso, etapas canónicas §7.2, sello E-14 + HASH
  SHA-256 EN COLA · MODO BA, ~2.5 s → REVISIÓN).
- **Archivos:** src/components/e14/screens/{ScanView.tsx,AnalyzingView.tsx}
- **Commits:** d7b69ea
- **Pendiente/Bloqueado:** G6.

### [2026-10-09 18:35] — G6 — Z.ai Code
- **Hecho:** ActaDocument (papel §7.3: cabecera REGISTRADURÍA + chip
  CÓDIGO NO DETECTADO/ACTA E-14, barcode-lines con overlay ILEGIBLE, grid de
  ubicación, 4 cajas de votos con blur 0.5px, firmas con variantes OK/TENUE
  ámbar/NO_DETECTADO rojo, rotación vía toolbar). ReviewView con 5 estados:
  ENVIADA (pill + breadcrumb + chips ENVIADO AUTOMÁTICAMENTE + hash),
  ADVERTENCIA (tarjeta rica ámbar), RECHAZADA ILEGIBLE (tarjeta rica roja) y
  GENERICO (pill), EN_REVISION_HUMANA (banner). Toolbar Recortar/Rotar
  90°/Pantalla completa (rotar rota). CTAs por estado anclados sobre el nav.
- **Archivos:** src/components/e14/{ActaDocument.tsx,screens/ReviewView.tsx}
- **Commits:** 008a2d4
- **Pendiente/Bloqueado:** G7.

### [2026-10-09 18:50] — G7+G8 — Z.ai Code
- **Hecho:** ACTAS (header CONTROL ACTAS E-14, puesto actual + breadcrumb +
  EN LÍNEA clicable, alerta N MESAS INCOMPLETAS + ATENCIÓN, acordeón de mesas
  una-expandida con chips P1✓/P2⚠Rescaneo/⏳ámbar/pendiente) y RESUMEN
  (progreso con barra segmentada de 12 (4px), tarjetas 03 cola ámbar / 01
  rescaneo rojo con stats-number, historial con barra izquierda 4px por
  estado + ÚLT. ACT. en vivo, scroll max-h + thin-scroll). Fixes de QA: línea
  vertical continua del historial eliminada, chips de página a 10px.
- **Archivos:** src/components/e14/screens/{ActasView.tsx,ResumenView.tsx}
- **Commits:** fdb1cf7
- **Cómo probar:** `bun run dev:e14` → flujo dorado con el panel de
  simulación (ÓPTIMA → auto-envío; ADVERTENCIA → envío manual; RECHAZADA →
  repetir/desbloqueo 2º intento o revisión humana; OFFLINE → cola y flush).
- **Pendiente/Bloqueado:** G9 (workflow Pages) y G10 (DoD final + build).

### [2026-10-09 19:10] — QA navegador + revisión visual — Z.ai Code
- **Hecho:** verificación completa con navegador headless a viewport móvil
  (390×844): flujo dorado OK (auto-envío D4, contador ACTAS, progreso 9→11
  en vivo, historial con hora real), rechazada v2 + revisión humana + toast,
  desbloqueo 2º intento (regla hecha ABSOLUTA: nunca bloquea el demo), cola
  offline 04→00 con flush y toast. Revisión visual lado a lado con VLM contra
  los screen.png (enviada, rechazada, actas, resumen): diferencias marcadas
  son decisiones del spec (breadcrumb+chips §7.4, chip cabecera §7.3, barra
  segmentada §7.7, tokens §5 sobre colores por-pantalla del zip). El botón
  flotante "N" detectado es el Next.js DevTools (solo dev, no existe en el
  build estático). Fix aplicado: contenedor del historial sin borde vertical.
- **Archivos:** src/lib/e14/bridge.ts (regla 2º intento), ResumenView, ActasView
- **Commits:** incluidos en G7+G8 y fix(e14) posterior
- **Pendiente/Bloqueado:** G9/G10.
