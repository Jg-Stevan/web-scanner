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

### [2026-10-09 19:40] — G9+G10 — Z.ai Code
- **Hecho:** workflow deploy-pages.yml parametrizado (workflow_dispatch con
  input choice `app` digitalizador-e14|scanner-lab, default e14; push a main
  despliega el default; working-directory y artifact path parametrizados vía
  step output; rm de API routes parametrizado). Build estático verificado:
  `out/` generado sin errores, servido localmente bajo /web-scanner/ con
  assets (chunks JS + woff2) en 200 y navegador interactivo completo (scan →
  análisis → revisión). Toast crit añadido al rechazo (3 variantes del DoD).
  lint:e14 y e14:check verdes; scanner-lab y scanner-core SIN cambios vs main
  (git diff --name-only → 0 archivos).
- **Archivos:** .github/workflows/deploy-pages.yml, src/lib/e14/store.ts, docs/*
- **Commits:** c661208 + fix(e14) final
- **Cómo probar:** `bun run build:e14` → servir apps/digitalizador-e14/out
  bajo /web-scanner/ (o fusionar y ver el deploy de Pages del workflow).
- **Pendiente/Bloqueado:** desplegar en Pages real requiere merge a main
  (el workflow despliega e14 por defecto). FASE LÓGICA (§11) pendiente de
  aprobación de la gráfica.

### [2026-10-09 13:40 (Bogotá)] — Pages dual (SPEC-pages-dual-apps.md) — Z.ai Code
- **Hecho:** SPEC-pages-dual-apps.md analizado y ejecutado — el sitio de Pages
  publica AHORA ambas apps: e14 en la raíz y scanner-lab en `/lab/`.
  - Cambio 1: `apps/scanner-lab/next.config.ts` — el basePath estático pasa a
    leerse de `NEXT_PUBLIC_BASE_PATH` (fallback `/web-scanner`); dev intacto.
    Grep anti-rutas-sueltas en `apps/scanner-lab/src|public`: sin resultados.
  - Cambio 2: `deploy-pages.yml` — steps "Resolver app" y `app` input
    ELIMINADOS (fin del modo switch); build de ambas apps (scanner-lab con
    `NEXT_PUBLIC_BASE_PATH=/web-scanner/lab` a nivel de step) + anidado con
    `cp -r apps/scanner-lab/out apps/digitalizador-e14/out/lab` + artifact
    único desde `apps/digitalizador-e14/out`. YAML validado con PyYAML.
  - Coherencia basePath verificada en los `out/`: e14 → `/web-scanner/_next/…`;
    lab → `/web-scanner/lab/_next/…`; URL del worker inlinada
    `/web-scanner/lab/scanner/detection-worker.js` en el chunk compilado del
    core; manifest `/web-scanner/lab/manifest.webmanifest`. El SW (network-first)
    queda auto-escopado a `/lab/` (scope más específico gana) y los iconos
    derivan de la misma var.
  - DoD 1 local COMPLETA: builds estáticos de ambas apps OK; sitio dual montado
    bajo prefijo `/web-scanner/` (servidor estático): raíz e14 200, `/lab/` 200,
    worker 200, opencv 200. Navegador: e14 flujo dorado (ÓPTIMA → pill
    "✓ 9.8/10 ÓPTIMA"); lab onboarding → Omitir → biblioteca "Mis documentos"
    hidratada con mock data. Recarga dura en AMBAS URLs: 0 404 de assets (solo
    el probe de favicon del origen, preexistente), 0 errores de página/consola.
- **Archivos:** apps/scanner-lab/next.config.ts,
  .github/workflows/deploy-pages.yml, docs/worklog.md, docs/DECISIONS.md,
  docs/ROADMAP.md, DEPLOY.md (raíz)
- **Commits:** en feat/pages-dual-apps (ver git log)
- **Cómo probar:** push/merge a main → https://jg-stevan.github.io/web-scanner/
  (E-14) y https://jg-stevan.github.io/web-scanner/lab/ (escáner original).
  Local: `bun run build:e14` + `BUILD_STATIC=1 NEXT_PUBLIC_STATIC=1
  NEXT_PUBLIC_BASE_PATH=/web-scanner/lab bunx next build` (en apps/scanner-lab)
  + `cp -r apps/scanner-lab/out apps/digitalizador-e14/out/lab` + servir
  `out/` bajo prefijo `/web-scanner/`.
- **Pendiente/Bloqueado:** merge a main + smoke test en Pages real. FASE LÓGICA
  (§11) sigue pendiente de aprobación del dueño.

### [2026-10-09 14:25 (Bogotá)] — L0 andamiaje — Z.ai Code
- **Hecho:** FASE LÓGICA arrancada (SPEC en docs/SPEC-fase-logica.md, rev.3,
  commit propio). Andamiaje sin comportamiento:
  - `package.json`: dep `@jg-stevan/scanner-core: workspace:*` + `bun install`
    (bun.lock +1 línea — obligatorio para `--frozen-lockfile` de CI).
  - `next.config.ts`: `transpilePackages` (el core sirve TS crudo).
  - Assets del core copiados a `public/`: `scanner/detection-worker.js`
    (md5 idéntico al del lab) + `vendor/opencv-4.5.5.js` + `opencv-4.5.5-core.js`.
  - Smoke de resolución: 13/13 símbolos del core importables desde la app
    (evaluateQuality, processImage, detectDocumentEdges, requestOcr, …).
  - `e14:check` (tsc --noEmit) verde.
- **Archivos:** package.json, next.config.ts, public/scanner/, public/vendor/, bun.lock
- **Commits:** (ver git log de feat/e14-fase-logica)
- **Cómo probar:** `bun run e14:check` + `bun -e 'await import("@jg-stevan/scanner-core")'`.
- **Pendiente/Bloqueado:** L1 (contrato async, mock intacto). MAPA API del core
  verificado: detectDocumentEdges(image-processor:459), processImage(:821,
  ProcessResult{processed,thumbnail,precision.engine}), evaluateQuality(:1014,
  PageQuality{level,sharpness,brightness,contrast}), requestOcr(ocr:155, con
  NEXT_PUBLIC_STATIC=1 va directo a Tesseract local), ocrTextIsValid(:182),
  buildDocPdf(pdf-export:352), downloadBlob/sanitizeFileName, fileToCaptureDataUrl
  (image-processor:225), CameraFrameLoop(frame-loop:76, start(video,{onFrame,
  onTrigger,onNoDetectTimeout})), defaultQuad(types:210). captureSmart vive en el
  LAB (CameraView.tsx), no en el core. NOTA numeración: los D12–D22 del spec
  (redactado antes de D12/D13 del repo) se registrarán como D14–D24 en DECISIONS.

### [2026-10-09 19:33 (Bogotá)] — L1 contrato async — Z.ai Code (Task 6-L1)
- **Hecho:** FASE LÓGICA L1 (SPEC §8-L1) — el bridge pasa a async con eventos
  de progreso, el store consume Promise y ANALIZANDO se vuelve event-driven.
  El MODO SIMULACIÓN queda visualmente idéntico (regresión cero verificada).
  - `types.ts` (§3.1 aditivo): `FuenteCaptura`, `EtapaAnalisis` (5 etapas),
    `ProgresoAnalisis` y campos OPCIONALES en `Acta` (fuente, fotoProcesada,
    fotoOriginal, ocrTexto, metricas, motor, quadDetectado — `Quad` importado
    del core —, rotation). Seed/mocks intactos (todo opcional).
  - `bridge.ts` (§3.2): `OpcionesEscaneo` gana `fuente/archivo/frameActual/
    onProgreso`; `E14Bridge.escanearActa` → `Promise<Acta>` + `exportarPdf`.
    `MockBridge.escanearActa` async: lógica ORIGINAL intacta (regla 2º intento
    ≥8 D8, scores, firma2, rechazo 80/20) + progreso SINTÉTICO de 5 etapas
    (~350–600 ms c/u, ~2.3 s total, 2–3 saltos por etapa; sin onProgreso la
    temporización es la misma) y resuelve con `fuente:"SIMULACION"` +
    `motor:"mock"`. `MockBridge.exportarPdf` → throw "EXPORTACIÓN NO
    DISPONIBLE EN SIMULACIÓN". NUEVA `CompositeBridge` (D17/D19): enruta por
    fuente (SIM→mock interno; CAMARA/ARCHIVO→real o throw "FUENTE REAL NO
    IMPLEMENTADA (L2)"); horas delegan al mock.
  - `get-bridge.ts`: instancia `new CompositeBridge(null)` — mismo contrato de
    export; L2 inyectará el RealCoreBridge aquí (punto único, D1/D17).
  - `store.ts`: estado nuevo `fuente` (SIM por defecto), `setFuente`,
    `archivoPendiente`, `setArchivoPendiente`, `progresoAnalisis`,
    `analisisResuelto`; `dispararEscaneo` → async (vista analizando primero,
    actaActual null, onProgreso → set, error → toast crit "ERROR DE PROCESADO"
    + volver a escanear). `analisisCompletado`/`enviarActa`/`repetirFoto`/
    `enviarRevisionHumana` SIN cambios de lógica.
  - `AnalyzingView.tsx` (§7): setInterval fake ELIMINADO. % ponderado por
    etapa (DETECTANDO .15 · RECORTANDO .15 · REALZANDO .20 · CALIDAD .15 ·
    OCR .35) suavizado con lerp por rAF (τ=140 ms); piso escénico D16/D18:
    nunca 100 hasta (pipeline resuelto && ≥1200 ms), luego anima a 100 y
    `analisisCompletado()` tras 350 ms (mismo patrón). Latencia del beacon =
    ms reales desde el mount (~cada 180 ms). 4 barras + 4 labels de ETAPAS
    intactos (mismas fórmulas floor/ceil que la fase gráfica).
  - `eslint.config.mjs`: ignores `public/vendor/**` + `public/scanner/**`
    (mismo patrón que scanner-lab) — SIN esto lint:e14 fallaba con 9 errores
    por el opencv minificado que L0 copió a public/ (gap de L0).
  - QA navegador (agent-browser 390×844, dev :3001): flujo dorado ÓPTIMA →
    "✓ 8.2/10 ÓPTIMA" + "ENVIADO CORRECTAMENTE" + auto-envío D4 ✓;
    ADVERTENCIA → "⚠ 7.5/10 MODERADA" → ENVIAR A TRANSMISIÓN → "✓ 7.5/10
    ENVIADA CON ADVERTENCIA" ✓; RECHAZADA → toast crit "ACTA NO RECONOCIDA"
    + ILEGIBLE + "OBLIGATORIO REPETIR FOTO (INTENTO 1 DE 2)" ✓; REPETIR →
    "✓ 8.6/10 ÓPTIMA" (2º intento ≥8, D8) ✓. Muestreo del ANALIZANDO: 8%@360ms
    → 20%@720 → 39%@1260 → 55%@1620 → 77%@2160 → 99%@2520 (piso) → 100% →
    REVISIÓN; latencia real 360→2520 ms. `agent-browser errors` y consola:
    0 errores. Tests bun del contrato: mock 2174 ms/14 eventos, composite-SIM
    2º intento 9.4, CAMARA→throw L2, exportarPdf→throw SIM, error-path del
    store → toast + vista escanear (nunca atascado en analizando).
  - lint:e14 + e14:check: 0 errores. ScanView/ReviewView/seed/core/lab: 0
    cambios (chips de fuente llegan en L2/L3).
- **Archivos:** src/lib/e14/{types.ts,bridge.ts,get-bridge.ts,store.ts},
  src/components/e14/screens/AnalyzingView.tsx, eslint.config.mjs,
  docs/{worklog.md,DECISIONS.md,ROADMAP.md}
- **Commits:** (commit único de esta entrada — ver git log de feat/e14-fase-logica)
- **Cómo probar:** `bun run lint:e14 && bun run e14:check` → 0 errores;
  `bun run dev:e14` → chip ÓPTIMA → Escanear → ANALIZANDO ~2.3 s con anillo y
  barras avanzando → REVISIÓN auto-enviada. En consola del dev no hay errores.
- **Pendiente/Bloqueado:** L2 — fuente ARCHIVO real: `scanner-core-bridge.ts`
  (pipeline §5: fileToCaptureDataUrl → detectDocumentEdges → processImage →
  evaluateQuality → requestOcr + gate ILEGIBLE §4.2), mapeo §4.1, ReviewView
  "VER FOTO", inyectar RealCoreBridge en get-bridge.ts y chips de fuente en
  ScanView. La numeración de DECISIONS sigue el corrimiento D12→D14 del spec.

### [2026-10-09 19:55 (Bogotá)] — L2 fuente ARCHIVO real — Z.ai Code (Task 6-L2)
- **Hecho:** FASE LÓGICA L2 (SPEC §8-L2, §5+§4+§7) — el pipeline REAL del
  core analiza imágenes importadas; SIMULACIÓN intacta (regresión cero
  verificada de los 4 caminos dorados).
  - `scanner-core-bridge.ts` (NUEVO): `RealCoreBridge implements E14Bridge`.
    Pipeline §5: `fileToCaptureDataUrl → detectDocumentEdges →
    processImage(quad, "original") → evaluateQuality → requestOcr → mapeo §4
    → Acta`. Mapeo §4.1 (bruto .4/.3/.3 /10, techos fair≤7.9 y poor≤6.4);
    gate §4.2 `ocrTextIsValid && /E-?14|REGISTRADURÍA/i` → ILEGIBLE calca la
    rechazada v2 (score real queda); legible → statusDeScore (RECHAZADA
    GENERICO "SCORE INSUFICIENTE…"). Timeout global 15 s: RESUELVE acta
    RECHAZADA ILEGIBLE "TIEMPO DE PROCESADO EXCEDIDO" (nunca reject — el
    toast crit sale del flujo normal del store) + flag `vencido` para no
    emitir progreso/descartar el resultado tardío. Excepción de
    detectDocumentEdges → RECHAZADA ILEGIBLE inmediata (el core SIEMPRE
    devuelve Quad: excepción = no detectable). Progreso: rampas interpoladas
    en las esperas opacas (DETECTANDO 0→.5→.9→1 · RECORTANDO .2→.6 ·
    REALZANDO .4→1 · CALIDAD 0→1) y progreso REAL del Tesseract en OCR.
    Relleno simulado idéntico al mock (seed ACTA_MOCK, firma2 TENUE/
    NO_DETECTADO coherente) + campos reales (fuente, fotoOriginal,
    fotoProcesada, ocrTexto, metricas, motor=precision.engine??"canvas",
    quadDetectado, rotation 0). CAMARA → throw "CÁMARA LLEGA EN LA FASE L3";
    exportarPdf → throw "…L4". Log `[e14-L2] pipeline …ms` por etapa
    (decode/detect/proceso/calidad/ocr + motor + metricas).
  - `get-bridge.ts`: `new CompositeBridge(new RealCoreBridge())` — punto
    único intacto (D1/D17).
  - `store.ts`: `notificar` expuesto como acción (L2: toast CÁMARA→L3; L3
    lo reusará para permisos). Guard ARCHIVO: disparo sin archivo → toast
    warn "ELIGE UNA IMAGEN" + vista escanear (REPETIR FOTO en fuente ARCHIVO
    vuelve al picker en vez de reventar).
  - `ScanView.tsx` (§7): fila de chips de FUENTE (SIMULACIÓN · CÁMARA ·
    IMPORTAR, activa en verde tint) encima del panel; CÁMARA → toast warn
    "CÁMARA LLEGA EN LA FASE L3" (visible, no muerto); IMPORTAR/chip/botón
    IMPORTAR IMAGEN → picker real → `setArchivoPendiente +
    setFuente("ARCHIVO") + dispararEscaneo()` (análisis inmediato); chips de
    resultado solo en SIMULACIÓN (panel no-SIM = estado de fuente + botón
    IMPORTAR; PASAR A OFFLINE siempre); label del visor según fuente;
    `warmUpScannerWorker()` al montar (§9).
  - `ReviewView.tsx` (§7): `ToolbarBtn "VER FOTO"` (ADVERTENCIA/RECHAZADA:
    4ª columna; ENVIADA real: toggle centrado) — alterna papel sintético ↔
    `<img fotoProcesada>` (misma caja, object-contain); badge
    "FOTO REAL DISPONIBLE" (font-data ok-tint) cuando hay foto y se muestra
    el papel. En SIM (sin foto) todo queda como la fase gráfica. EyeIcon
    nuevo en icons.tsx (mismo patrón SVG inline).
  - QA navegador (agent-browser 390×844, dev :3001):
    - SIM: ÓPTIMA → "✓ 9.1/10 ÓPTIMA"+"ENVIADO CORRECTAMENTE"+auto-envío;
      ADVERTENCIA → "⚠ 7.2/10 MODERADA" → ENVIAR A TRANSMISIÓN → "✓ 7.2/10
      ENVIADA CON ADVERTENCIA"; RECHAZADA → toast crit "ACTA NO RECONOCIDA
      (Score 3.8/10)" + ILEGIBLE + "INTENTO 1 DE 2"; REPETIR → "✓ 9.4/10
      ÓPTIMA" (D8). Chips de fuente presentes, SIM por defecto.
    - ARCHIVO nítida (test-acta-nitida.png): pipeline motor=worker,
      legible=true, **score 9.3 → ÓPTIMA auto-enviada**, VER FOTO muestra
      el warp del core (PNG 1466×1988, centrado, sin distorsión — verificado
      con VLM); metricas reales {sharpness 100, brightness 77, contrast
      100, level excellent} → bruto 9.31 → 9.3 coherente.
    - ARCHIVO ilegible (test-acta-ilegible.png): gate OCR → **RECHAZADA**
      (score REAL 7.8 — el estado manda sobre el score) + toast crit
      "ACTA NO RECONOCIDA Score 7.8/10" + CTAs de rechazo; metricas
      {sharpness 61, brightness 78, contrast 100, level good}.
    - CÁMARA chip → toast "CÁMARA LLEGA EN LA FASE L3". REPETIR en ARCHIVO
      sin archivo → toast warn + picker (nunca atascado en analizando).
    - Timeout (QA con TIMEOUT_MS=800 temporal, revertido): acta RECHAZADA
      "TIEMPO DE PROCESADO EXCEDIDO" + toast crit; el pipeline tardío se
      descarta sin unhandled rejection.
    - Tiempos REALES del pipeline (log `[e14-L2]`, headless): nítida 1ª vez
      total=3719 ms (decode 84 · detect 57 · proceso 382 · calidad 29 · OCR
      3168 — 1ª descarga del motor Tesseract CDN); nítida 2ª (WASM cacheado)
      total=2164 ms (85 · 32 · 306 · 28 · 1713); ilegible total=1082 ms
      (85 · 33 · 275 · 27 · 665). Muy por debajo del timeout de 15 s (no
      hizo falta reintentar). `window.__scannerPrecision()` → {ready:true,
      dead:false} (worker OpenCV vivo — motor "worker" en las 3 corridas).
    - `agent-browser errors` + consola: 0 errores de app. Único ruido
      esperado: `POST /api/ocr 404` en dev (requestOcr del core intenta el
      endpoint antes de caer al Tesseract local — fallback documentado del
      core, no error de e14).
  - lint:e14 + e14:check: 0 errores. scanner-core/scanner-lab: 0 cambios.
- **Archivos:** src/lib/e14/{scanner-core-bridge.ts(get nuevo),get-bridge.ts,store.ts},
  src/components/e14/{icons.tsx,screens/ScanView.tsx,screens/ReviewView.tsx},
  docs/{worklog.md,DECISIONS.md,ROADMAP.md}
- **Commits:** (commit único de esta entrada — ver git log de feat/e14-fase-logica)
- **Cómo probar:** `bun run dev:e14` → chip IMPORTAR (o IMPORTAR IMAGEN) →
  elegir foto de un acta → ANALIZANDO con etapas reales → REVISIÓN con VER
  FOTO. Con imagen borrosa/sin cabecera → RECHAZADA ILEGIBLE. El modo
  SIMULACIÓN sigue idéntico (chips ÓPTIMA/ADVERTENCIA/RECHAZADA).
- **Pendiente/Bloqueado:** L3 — fuente CÁMARA real + interfaz de escaneo
  del lab COMPLETA (HUD, BUSCANDO ACTA…, quad en vivo, IA·AUTO, flash,
  ZSL, ruta iOS). El copy fijo de la tarjeta ILEGIBLE (diseño v2) sigue
  mostrando "CÓDIGO DE BARRAS Y CABECERA NO DETECTADOS" también para el
  timeout — el detalle real vive en `acta.rechazo.detalle` (dato, no UI).

### [2026-10-09 20:25 (Bogotá)] — L3 cámara real + interfaz del lab — Z.ai Code (Task 6-L3)
- **Hecho:** FASE LÓGICA L3 (SPEC §8-L3 + §7 rev.3) — la fuente CÁMARA es REAL
  (video + CameraFrameLoop del core) y la interfaz de escaneo del lab
  (CameraView.tsx) se copió COMPLETA re-vestida con Precision Monitor, sin
  dependencias nuevas (rg de useScannerStore/framer/vaul/sonner → VACÍO).
  SIMULACIÓN/IMPORTAR quedan EXACTOS a L2 (diff de píxeles del visor ≈0.8/255).
  - `scanner-core-bridge.ts`: soporte CAMARA con dos entradas (§5): `archivo`
    (foto ZSL/captureSmart/iOS) → MISMO pipeline que ARCHIVO; sin archivo y con
    `frameActual` (video vivo) → grab síncrono a canvas a RESOLUCIÓN DEL STREAM
    (videoWidth/Height, antes de que React desmonte el visor) → dataUrl →
    pipeline con ETIQUETAS DE ETAPA idénticas. Timeout 15 s/gate/mapeo intactos.
    Log `[e14] pipeline CAMARA/file|video-grab …`.
  - `store.ts`: `framePendiente/setFramePendiente` (video vivo para el grab) +
    guard CAMARA sin captura (toast warn "CAPTURA UNA FOTO" + vista escanear,
    espejo de D23) + `frameActual` pasado al bridge.
  - `ScanView.tsx` (§7 rev.3 completo, copiado del lab):
    · `<video playsInline muted autoPlay>` dentro del marco existente (mismos
      corner brackets, z-30); getUserMedia con cascada exact environment
      (ideal 1920×1080) → environment → video; stop() del stream + loop +
      ring en unmount y cambio de fuente/vista.
    · Fallback: permiso denegado / sin HTTPS / sin getUserMedia / track muerto
      (B3) → toast warn + vuelta automática a SIMULACIÓN (§7, D27).
    · CameraFrameLoop montado sobre el video: onFrame → telemetría (throttle
      UI ~10 Hz) + feed del ring ZSL (~5 Hz); onTrigger → gate del lab
      L1380-1385 (`if (!autoArmado || procesando || cooldown) return` — el gate
      fino vive en el core); onNoDetectTimeout → toast warn "NO DETECTO EL
      ACTA" / "Acércala más al encuadre.".
    · HUD: "CALIDAD 82%" (score.total, ok-tint >80) + "ACTA DETECTADA /
      NO DETECTADA" + pill "IA · AUTO / IA · MANUAL" (punto pulsante ok-tint).
    · Pill "BUSCANDO ACTA…" superior centrada (bg-black/60 + blur + spinner
      ok-tint + texto blanco 12px) mientras corners === null.
    · Quad overlay SVG en vivo (mapeo object-cover exacto con ResizeObserver,
      lab L1493-1515) en ok-tint + máscara 32% + 4 puntos blancos, fade 150 ms.
    · Toggle AUTO default OFF (D22 spec → D24) en la fila [FLASH | shutter |
      AUTO]; overlay "MANTÉN INMÓVIL EL ACTA…" cuando armado + score>0.8
      (lab L1802); anillo del shutter verde si score.total > SHUTTER_SCORE.
    · Flash F-FLASH v3 (lab L486-555/L1404-1416): applyConstraints +
      verificación getSettings().torch + flashRef con reintentos
      0/250/700/1500 ms + re-aplicación en "playing"; sin stream → hint
      "LA LINTERNA NECESITA CÁMARA REAL" (D26).
    · Disparo POR PLATAFORMA (D25): ImageCapture → captureSmart (takePhoto
      full-res, carrera 8 s); iOS/Safari sin ImageCapture → input
      capture="environment" (cámara nativa, mismo pipeline); otros sin IC →
      best frame ZSL; último recurso → grab del video vivo (frameActual).
      ZSL ring de 8 canvases, ventana 80-450 ms, liberación R-14.
    · Destello blanco ~120 ms (flashKey, keyframe nuevo en globals.css) +
      navegación a ANALIZANDO diferida ~260 ms para que se vea; vibrate(30).
    · Toast iOS único: "CÁMARA NATIVA EN IPHONE". Fuera de alcance (spec):
      "Revisar N" + multi-página NO copiados.
  - `globals.css`: keyframe `animate-capture-flash` (120 ms). `icons.tsx`:
    FlashIcon + ScanFrameIcon (SVG inline). Fix de estilo: la liberación de
    canvases del ring vive en función de módulo `liberarCanvas` (espejo del
    releaseFrame del lab) para satisfacer `react-hooks/immutability` 7.1.x.
  - QA navegador (agent-browser 390×844, dev :3001):
    - SIM regresión: ÓPTIMA "✓ 8.2/10 ÓPTIMA"+"ENVIADO CORRECTAMENTE"
      (auto-envío D4); ADVERTENCIA "⚠ 7.0/10 MODERADA" → ENVIAR A
      TRANSMISIÓN → "✓ 7.0/10 ENVIADA CON ADVERTENCIA"; RECHAZADA toast
      "ACTA NO RECONOCIDA Score 4.2/10" + "INTENTO 1 DE 2" + ILEGIBLE;
      REPETIR → "✓ 9.4/10 ÓPTIMA" (D8). Visor SIM idéntico a L2 (diff píxel
      0.81/255 muestreado).
    - ARCHIVO nítida: "✓ 9.3/10 ÓPTIMA" (motor=worker, log `[e14] pipeline
      ARCHIVO/file total=3359ms … score=9.3`), VER FOTO = warp real centrado
      sin distorsión (verificado con VLM).
    - CÁMARA headless (sin cámara): click chip → getUserMedia falla → toast
      warn "CÁMARA NO DISPONIBLE" / "No hay cámara accesible (permiso
      denegado, sin hardware o sin conexión segura). VOLVIENDO A
      SIMULACIÓN." + fuente vuelve a SIMULACIÓN (chip SIM activo, panel
      Simulación, IMPORTAR IMAGEN visible) y el flujo dorado sigue
      operativo (ÓPTIMA 9.4 tras el fallback). Cambio rápido de chips
      CÁMARA→SIM→CÁMARA estable. `agent-browser errors` + consola: 0 errores
      de app.
    - Test bun aislado del store: guard CAMARA (toast warn + escanear) y
      error-path con frameActual inválido (toast crit ERROR DE PROCESADO +
      escanear, nunca atascado en analizando).
  - lint:e14 + e14:check: 0 errores. scanner-core/scanner-lab: 0 cambios.
  - HONESTO: la cámara REAL (preview, quad, HUD, flash, AUTO, iOS nativo) NO
    es verificable en headless — el dueño la prueba en el teléfono (Pages
    HTTPS). Lo verificado aquí es el fallback + todo lo no-cámara.
- **Archivos:** src/lib/e14/{scanner-core-bridge.ts,store.ts},
  src/components/e14/{icons.tsx,screens/ScanView.tsx},
  src/app/globals.css, docs/{worklog.md,DECISIONS.md,ROADMAP.md}
- **Commits:** (commit único de esta entrada — ver git log de feat/e14-fase-logica)
- **Cómo probar:** `bun run dev:e14` → chip CÁMARA (en teléfono: HTTPS +
  permiso) → quad verde en vivo + HUD CALIDAD; armar AUTO → dispara sola con
  el acta quieta; FLASH para la linterna; en iPhone el shutter abre la cámara
  nativa. Sin cámara (desktop headless) → toast + vuelta a SIMULACIÓN. El
  modo SIMULACIÓN sigue idéntico (chips ÓPTIMA/ADVERTENCIA/RECHAZADA).
- **Pendiente/Bloqueado:** L4 — EXPORTAR PDF (adaptador §6 buildDocPdf +
  CTA "EXPORTAR PDF" en REVISIÓN solo actas reales). Riesgos conocidos para
  el teléfono real: el preview pide 1920×1080 (más GPU que el 540p del lab
  en gama baja — si se ve pesado, bajar a 960×540); sin F-LENS v4 del lab
  (sondeo de lentes) Chrome elige la trasera por defecto; takePhoto sin
  sensor-profiler (el clamp de 48MP lo cubre maxLongSide del core al decodar).

### [2026-10-09 15:35 (Bogotá)] — L4 EXPORTAR PDF — Z.ai Code (Task 6-L4)
- **Hecho:** export real §6 con el core tal cual:
  - `scanner-core-bridge.ts`: `exportarPdf(acta)` implementado — adaptador
    Acta→ScanDocument (pages[0] con processed=fotoProcesada, filter "original",
    quad unitario en Points, quality de metricas vía `makeQuality` o
    `excellentQuality`, `ocrDone`/`createdAt` requeridos por la interfaz
    congelada) → `buildDocPdf(doc, "standard")` → `pdf.output("blob")` →
    `downloadBlob(blob, sanitizeFileName(title)+".pdf")` (patrón canónico del
    lab). Sin foto real → throw "SIN FOTO REAL PARA EXPORTAR".
  - `store.ts`: acción `exportarPdfActa` (guard SIN FOTO REAL → toast warn;
    try/catch → toast ok "PDF GENERADO" / crit "ERROR DE EXPORTACIÓN").
  - `ReviewView.tsx` (ReviewCtas): ENVIADA + acta REAL → fila con EXPORTAR PDF
    (outline + DownloadIcon) JUNTO a SEGUIR ESCANEANDO (flex-1 verde). En
    SIMULACIÓN el botón se OCULTA (spec §6). DownloadIcon añadido a icons.tsx.
- **QA (agent-browser 390×844, dev :3001):**
  - ARCHIVO nítida → ÓPTIMA → ENVIADA → EXPORTAR PDF → blob capturado con spy
    de anchor.click: **{size: 333721, type: "application/pdf", name: "ROMA -
    CONSULADO — MESA 002.pdf"}** + toast "PDF GENERADO" ✓
  - SIM ÓPTIMA → ENVIADA → footer SOLO "seguir escaneando" (botón oculto) ✓
  - lint:e14 + e14:check: 0 errores · sin page errors.
- **Archivos:** scanner-core-bridge.ts, store.ts, ReviewView.tsx, icons.tsx
- **Commits:** (este commit)
- **Cómo probar:** IMPORTAR imagen → esperar ÓPTIMA/ENVIADA → EXPORTAR PDF →
  descarga + toast. En SIM el botón no existe.
- **Pendiente/Bloqueado:** L5 (QuadEditor copiado del lab + toolbar real +
  rescate D20).

### [2026-10-10 00:55 (Bogotá)] — L5 editor de recorte + toolbar REAL + rescate — Z.ai Code (Task 6-L5)
- **Hecho:** FASE LÓGICA L5 (SPEC §8-L5 + §7.5 + §7 ReviewView) — el editor de
  recorte NO se inventó: se COPIÓ el subsistema CROP del lab
  (EditorView.tsx) y se re-vestió Precision Monitor, sin deps nuevas
  (rg de store del core/lib de animación/drawer/toasts → VACÍO).
  - `src/components/e14/QuadEditor.tsx` (NUEVO, ~470 líneas netas): COPIA
    según el mapa §7.5 — `clampN`/`loupeCenterAt`/`quadsClose` (L127-147
    literal), estado quad/drag/loupe + refs, `pointerToNormalized`/
    `updateLoupe`/`onHandleDown`/`onContainerPointerMove`/
    `onContainerPointerUp` (L950-1050 literal, con setPointerCapture y
    clamp 0-1), 8 asas 44×44 (4 esquinas + 4 medios que trasladan la arista
    completa), lupa 3× Ø168 en el lado opuesto al dedo con crosshair ámbar,
    polígono SVG ok-tint, Escape cancela (bloqueado mientras aplica).
    Aterrizaje del quad con el rAF del lab (easeOutCubic 280 ms); entrada del
    overlay y pulso del asa → keyframes CSS (globals.css). loadImage UNA vez;
    rotación del acta en CSS con la misma inversión de coords del lab.
    CANCELAR descarta · APLICAR full-width verde con spinner "PROCESANDO…".
  - `src/lib/e14/image-utils.ts` (NUEVO): `rotateProcessedDataUrl` del lab
    (L189-224, canvas puro) para ROTAR 90° sin re-procesar el pipeline.
  - `bridge.ts` + `scanner-core-bridge.ts`: método aditivo `recortar(acta,
    quad, onProgreso)` — Mock/Composite → error canónico en SIM;
    RealCoreBridge re-ejecuta §5 con F5-MANUAL (`processImage(fotoOriginal,
    quad, "original", rotation, { manual: true })`), evaluateQuality +
    requestOcr + mapeo §4.1 + gate §4.2, emite RECORTANDO/REALZANDO/CALIDAD/
    OCR, timeout 15 s → RECHAZADA "TIEMPO DE PROCESADO EXCEDIDO", y devuelve
    el acta por SPREAD (intento/fuente/paginación IGUALES — rescate D20 sin
    intento) con firmas coherentes al status.
  - `store.ts`: `aplicarRecorte(quad)` (guard SIN FOTO ORIGINAL → warn;
    recortando → toasts ACTA RECUPERADA/LISTA PARA ENVÍO MANUAL · SIGUE
    RECHAZADA (SCORE X.X/10) · ERROR DE RECORTADO) + `rotarFoto()` (gira
    fotoProcesada y hornea rotation para el PDF §6) + `enviarActa` relajada
    a ADVERTENCIA u OPTIMA (envío MANUAL tras rescate, sin auto-envío D4).
  - `ReviewView.tsx`: toolbar REAL con fuente ≠ SIMULACIÓN — RECORTAR abre
    el QuadEditor (quadInicial = quadDetectado ?? defaultQuad) · ROTAR 90°
    real/Papel en SIM · PANTALLA COMPLETA = visor modal (tap/Esc cierran).
    Pill "ÓPTIMA · Recuperada — envío manual" + CTAs OPTIMA rescatada
    (ENVIAR A TRANSMISIÓN verde + REPETIR). En SIM todo queda como hoy.
  - `globals.css`: keyframes `editor-enter` (280 ms) y `handle-pulse`
    (1.3 s) — reemplazo CSS de las animaciones del lab.
  - **QA (agent-browser 390×844, dev :3001):**
    - SIM regresión COMPLETA: ÓPTIMA 9.8 auto-enviada (✓ ENVIADO
      AUTOMÁTICAMENTE + SHA-256) · ADVERTENCIA 7.2 → ENVIAR A TRANSMISIÓN →
      "ENVIADA CON ADVERTENCIA" · RECHAZADA 4.9 + toast "ACTA NO RECONOCIDA
      Score 4.9/10" + INTENTO 1 DE 2 · ROTAR papel SIM (rotate(90deg)) ·
      RECORTAR SIM decorativo (sin dialog) · 2º intento 9.8 ÓPTIMA (D8).
    - ARCHIVO nítida: 9.3 ÓPTIMA (motor=worker) → ENVIADA → EXPORTAR PDF →
      blob {name: "ROMA - CONSULADO — MESA 003.pdf"} + toast "PDF GENERADO".
    - EDITOR con ilegible: 7.8 RECHAZADA (gate) → RECORTAR → overlay con la
      ORIGINAL + quad detectado → drag de asa (Vértice 1 → 39.9%/20.8%,
      lupa visible durante el arrastre y desaparece al soltar) → APLICAR →
      "PROCESANDO…" → pipeline re-corre (log `[e14] recorte ARCHIVO
      total=1279ms … motor=worker legible=false score=7.8`) → sigue
      RECHAZADA 7.8 + toast "SIGUE RECHAZADA SCORE 7.8/10" + **INTENTO 1 DE
      2 IGUAL (no consume intento)** · CANCELAR con drag previo: score
      antes/después 7.8 idéntico.
    - RESCATE D20 exitoso (imagen diseñada test-acta-croppable.png: header
      E-14 fuera del quad auto): 9.2 RECHAZADA por gate → RECORTAR → arista
      superior 24.5%→0% (incluye header) → APLICAR → **toast "ACTA
      RECUPERADA / LISTA PARA ENVÍO MANUAL" + "9.2/10 ÓPTIMA" + CTAs
      ENVIAR A TRANSMISIÓN/REPETIR** (manual, sin auto-envío) → enviar →
      ENVIADA + "ENVIADO CORRECTAMENTE" (log `recorte … legible=true
      score=9.2 motor=worker`).
    - ROTAR real: VER FOTO 1553×1995 → ROTAR 90° → 1995×1553 (girada,
      rotation horneada) · PANTALLA COMPLETA: abre (img girada) + tap y Esc
      cierran · VLM del editor: quad verde 8 asas + lupa circular +
      CANCELAR/AJUSTAR BORDES/APLICAR RECORTE ✓.
    - `agent-browser errors`: 0 errores de app. lint:e14 + e14:check: 0
      errores. scanner-core/scanner-lab: 0 cambios.
- **Archivos:** src/components/e14/QuadEditor.tsx (nuevo),
  src/lib/e14/{image-utils.ts (nuevo), bridge.ts, scanner-core-bridge.ts,
  store.ts}, src/components/e14/screens/ReviewView.tsx,
  src/app/globals.css, docs/{worklog.md,DECISIONS.md,ROADMAP.md}
- **Commits:** (commit único de esta entrada — ver git log de feat/e14-fase-logica)
- **Cómo probar:** IMPORTAR una foto borrosa/sin cabecera → RECHAZADA →
  RECORTAR → arrastrar las 8 asas (la lupa amplía el punto de corte) →
  APLICAR → el pipeline re-corre y el acta se actualiza SIN consumir intento
  (mejoró → CTAs de envío manual). ROTAR 90° gira la foto real; PANTALLA
  COMPLETA la muestra a pantalla completa. En SIM todo queda como hoy.
- **Pendiente/Bloqueado:** L6 (opcional, persistencia localStorage+
  IndexedDB) y L7 (opcional, cámara sintética en SIM). La fase lógica
  OBLIGATORIA (L0-L5) está COMPLETA — queda la DoD §10 final (regresión
  dorada ya verificada aquí).

### [2026-10-09 16:30 (Bogotá)] — Cierre de FASE LÓGICA: QA integral + build estático — Z.ai Code (Task 6-final)
- **Hecho:** QA integral de cierre (DoD §10):
  - `bun install --frozen-lockfile` ✓ · `lint:e14` ✓ · `e14:check` ✓.
  - SIM dorado completo (ADVERTENCIA manual → "✓ 7.8/10 ENVIADA CON ADVERTENCIA").
  - ARCHIVO croppable: RECHAZADA 9.2 (gate) → RECORTAR (drag asa superior real con
    mouse) → APLICAR → "✓ 9.2/10 ÓPTIMA" + ENVIAR A TRANSMISIÓN manual (rescate
    D20 SIN auto-envío, SIN consumir intento) → ENVIADA con EXPORTAR PDF en footer.
  - Build estático (BUILD_STATIC=1, basePath /web-scanner): out/ con
    scanner/detection-worker.js + vendor/opencv×2; URL del worker inlinada
    `/web-scanner/scanner/detection-worker.js` en el chunk; servido bajo prefijo
    /web-scanner/ → pipeline REAL en navegador: upload nítida → "✓ 9.3/10 ÓPTIMA"
    (tesseract CDN 200, motor worker). Todos los assets 200.
  - D32 registrada (no-useScannerStore, spec D18) — cierra la cobertura D12-D22
    del spec (→ repo D14-D31 + D32).
- **Archivos:** docs/{DECISIONS,worklog,ROADMAP}.md
- **Commits:** (docs final de cierre)
- **Cómo probar:** ver entradas L0-L5. DoD 5 (cámara real en móvil) queda para el
  teléfono del dueño en Pages (headless sin cámara: fallback verificado).
- **Pendiente/Bloqueado:** push + PR feat/e14-fase-logica → main + deploy Pages +
  smoke test producción (DoD 8). L6/L7 opcionales sin hacer (no bloquean).

### [2026-10-10 09:10 (Bogotá)] — AUDITORÍA DE COPIAS vs lab (SPEC-auditoria-copias.md §1) — Z.ai Code (rama fix/e14-fidelidad-lab)

**Metodología (§1):** censo de huellas auto-declaradas (`rg "simplific|abrevi|adaptad|resumid|omitid"`
sobre src/) → diff bloque a bloque contra `apps/scanner-lab/src/components/scanner/CameraView.tsx`
y `EditorView.tsx` → tabla con veredicto → remediación verbatim (Regla de oro 6). El spec fuente
quedó en `docs/SPEC-auditoria-copias.md` (Rev. 2). La auditoría cubre el 100 % del checklist §4.

**Censo de huellas (§1.1):** ScanView L64 («adaptadas al task §2»), L85 («TORCH_HINT del lab,
abreviado»), L379 («simplificado sin sensor-profiler»), L429 («adaptada a e14»), L516
(«simplificado: real o fallback SIM») + scanner-core-bridge L520 («adaptador Acta→ScanDocument»,
§6 legit) + image-utils L9 (nota de mapeo, legit). Cada una entra a la tabla.

**Tabla de hallazgos (veredicto por bloque del checklist §4):**

| # | Bloque | e14 (archivo + líneas) | Lab (ref) | e14 hace | Lab hace | Veredicto | Sev. | Acción |
|---|--------|------------------------|-----------|----------|----------|-----------|------|--------|
| 1 | Arranque de cámara | ScanView L516–634 | CameraView L996–1252 + L1095–1207 | Solo cascada `facingMode` (red de seguridad del lab) | Sondas secuenciales cerrando cada cámara + `chooseMainProbe` (D3/D6) + fix zoom + telemetría `__cameraChoice` | **DESVIACIÓN** | P0 | H1 — copiar mapa §12 (L116–223 + L1095–1207) |
| 2 | Perfilado del sensor | ScanView — AUSENTE | CameraView L440 + L448–454 + L245–290 | Nada (sin `profileSensor`, sin `downscaleImage`) | Perfila el track al abrir el stream; tope por GAMA 4032/3200 | **DESVIACIÓN** | P0 | H2 — copiar 5 bloques |
| 3 | takePhoto (blob) | ScanView L382–400 | CameraView L645–681 | `takePhoto()` crudo, sin tope (blob gigante llega al decode) | 3 capas: photoSettings (ISP) + retry sin settings + `clampBlobToSafeCap` | **DESVIACIÓN** | P0 | H2 — reemplazo literal de takePhotoBlob |
| 4 | Dispatch / decode único + tope | ScanView L413–427 (despacharCaptura) + L754–761 (IMPORTAR) | CameraView L574–589 | File directo al bridge (sin decode previo) | Decode ÚNICO + `downscaleImage(decoded, safeCapPx)` antes del pipeline | **DESVIACIÓN** | P0 | H2 capa 3 en el punto de entrada (cubre CÁMARA + IMPORTAR + iOS nativa) |
| 5 | captureSmart | ScanView L436–510 | CameraView L785–885 | `tomarZsl()` → `await tomarFoto()` → recién ahí `snapA/snapB` | `snapA = snapshotVideo()` ANTES de `await takePhotoBlob()` (§5.4); snapB después (bracket) | **DESVIACIÓN** (orden snapA) | P1 | H3 — mover snapA antes del await + comentario §5.4. F-RES-PRIORITY ✓ FIEL (foto gana siempre, L446–455), aviso honesto de fallback ✓ |
| 6 | Ring ZSL | ScanView L298–336 + L357–377 | CameraView L707–770 | Máx 8, copia dedicada, liberación del expulsado YA (R-14), ventana 80–450 ms | Igual | **FIEL** | — | Sin acción |
| 7 | Flash F-FLASH v3 | ScanView L252–292 + L711–727 | CameraView L473–520 + L1404–1422 | `applyConstraints` + verificación `getSettings().torch` + reintentos 0/250/700/1500 + re-aplicación por «playing» | Igual | **FIEL** | — | Falta solo H4 (hint) |
| 8 | TORCH_HINT | ScanView L85–88 | CameraView L119–127 | Versión abreviada (2 líneas) | Diagnóstico completo de campo (navegador, WebView in-app, lente sin LED, qué hacer) | **DESVIACIÓN** | P1 | H4 — copiar verbatim |
| 9 | Ruta iOS del disparo | ScanView L730–751 + input L816–824 | CameraView L902–925 + L1521–1531 | `input capture="environment"` con el click del shutter como gesto de usuario | Igual | **FIEL** (transporte File→bridge = §3 legítima) | — | — |
| 10 | Aviso no-detección | ScanView L697–699 | CameraView L1386–1390 | `onNoDetectTimeout` → toast «NO DETECTO EL ACTA» | `onNoDetectTimeout` → toast | **FIEL** | — | — |
| 11 | Cooldown / notifyCaptured | ScanView L437–440 | CameraView L786–789 | 1500 ms + `notifyCaptured()` (re-arme del loop del core) | Igual | **FIEL** | — | — |
| 12 | IMPORTAR: accept del picker | ScanView L811 + L819 | CameraView L1536 (galería) | `accept="image/*"` a secas (HEIC fuera del picker en Android/Chrome) | `accept="image/*,.heic,.heif"` | **DESVIACIÓN** | P2 | H5 — añadir `,.heic,.heif` a ambos inputs (spec Rev. 2; el lab solo en galería, pero la cámara nativa iOS también entrega HEIC) |
| 13 | Guard looksImage/looksHeic | ScanView — AUSENTE | CameraView L937–961 | Sin guard: cualquier File entra al pipeline | Guard de imagen + toast de conversión HEIC + error verbatim | **DESVIACIÓN** | P2 | H5 — copiar guard + mensajes |
| 14 | Preview ideal | ScanView L64–68 (1920×1080) | CameraView L107–111 (960×540) | 1920×1080 | 960×540 | **ADAPTACIÓN LEGÍTIMA** (§3, D27) | — | No tocar: frames del video alimentan el pipeline en iOS (e14 sin takePhoto ahí) |
| 15 | `esErrorPermiso` | ScanView L534–535 | CameraView L1051–1052 | Equivalente exacto de `isPermError` | — | **FIEL** (§3: reutilizar, no duplicar) | — | — |
| 16 | B3 track «ended» | ScanView L601–610 | CameraView L1013–1027 | Toast + vuelta a SIMULACIÓN | Re-arranque completo del flujo (nonce) | **ADAPTACIÓN LEGÍTIMA** | — | Documentada en L3: el objetivo de B3 (visor nunca congelado) se cumple vía fallback SIM; e14 no tiene sesión multi-página |
| 17 | QuadEditor: clampN / loupeCenterAt / quadsClose | QuadEditor L51–70 | EditorView L127–149 | Copia LITERAL (diff verificado en esta auditoría) | — | **FIEL** | — | — |
| 18 | QuadEditor: arrastre + 8 asas + lupa 3× | QuadEditor (subistema CROP) | EditorView L928–1049 + L2005–2040 + L2087–2130 | Puerto fiel (L5, verificado con QA de drag + VLM) | — | **FIEL** | — | — |
| 19 | rotateProcessedDataUrl + encodePngDataUrl | image-utils L14 + L40–72 | EditorView L163–224 | Copia LITERAL (diff verificado en esta auditoría) | — | **FIEL** | — | — |
| 20 | Bridge: decode del pipeline | scanner-core-bridge L204–263 | CameraView L574–578 | File→dataUrl 1× (fileToCaptureDataUrl, tope nativo 4032 del core) + warp decode en processImage | Decode único del dispatch | **ADAPTACIÓN LEGÍTIMA** + nota | — | Con H2 capa 3 el File llega YA ≤cap: el decode del bridge opera sobre imagen ≤tope (coste +1 decode vs lab, aceptado; el riesgo real —blob gigante decodificado— queda eliminado) |

**Cobertura §5 (novedades.md v5.0.0→v6.3):** ver tabla por novedad en
`docs/SPEC-auditoria-copias.md` §5 — conclusiones idénticas: HEREDADO todo lo del core/worker
(cascada, HEIC, EXIF, F-STAB, F-PERF, OCR, warp) · COPIADO el glue del componente (ZSL, torch,
rotación, F-RES-PRIORITY, viewport-fit) · FALTAN las 2 piezas críticas (H1 cámara, H2 tope de
sensor) + 3 cosméticas (H3, H4, H5). H6 (PWA) queda como DECISIÓN de alcance del autor (fuera
de este PR). §3 (adaptaciones legítimas: D27, File→bridge, re-vestimiento, esErrorPermiso) NO
se toca — tocarlas sería regresión.

**Remediación (orden §6.1):** H1 → H2 → H3 → H4 → H5, todo con copia verbatim + comentarios de
origen (`// Fuente: apps/scanner-lab/... L…`). Commits separados: audit / F-LENS v4 / F-SENSOR-
PROFILER / snapA+TORCH_HINT+accept.

### [2026-10-10 10:30 (Bogotá)] — H1: F-LENS v4 completo (§12 fase lógica Rev. 4) — Z.ai Code (rama fix/e14-fidelidad-lab)
- **Hecho:** Arranque de cámara de ScanView ahora abre la PRINCIPAL, no la lente por defecto de Chrome:
  - Bloques de módulo copiados verbatim con comentarios de origen: `BACK_CAMERA_RE`/`FRONT_CAMERA_RE` (lab L116-117), `CameraProbeResult` (L129-137), `REAL_AF_MODES`+`hasRealAF` (L139-144), `readCapsNum` (L146-148), `probeCamera` (L150-188 — abre, mide, CIERRA; `finally` garantiza nunca dos cámaras abiertas), `chooseMainProbe` (L190-223 — D3/D6: AF real → mayor resolución, torch desempata, sin AF → label más simple) + comentario E4/F-LENS v4 A/B (L76-92).
  - Efecto de arranque: `abrirCamaraPrincipal` (lab `openMainCamera` L1095-1207 verbatim: unlock de labels → sondas secuenciales → elección → apertura SOLO de la ganadora con fallbacks) + fix de zoom (<1 → 1, L1152-1175) + telemetría `window.__cameraChoice` (L1176-1199, misma forma que el lab para el QA del dueño). La cascada facingMode anterior quedó como `abrirConCascada` (red de seguridad, lab L1055-1093). Fallback e14 a SIMULACIÓN intacto.
  - `window.__cameraChoice` declarado en `declare global`.
- **Archivos:** src/components/e14/screens/ScanView.tsx
- **Commits:** de056aa
- **Cómo probar:** en el teléfono Android: abrir CÁMARA → `window.__cameraChoice.elegida` muestra la principal (label sin palabras de lente) y `sondas` con las resoluciones medidas.
- **Pendiente/Bloqueado:** verificación en hardware real del dueño (headless sin cámara: probes fallan → cascade → SIM, verificado).

### [2026-10-10 10:50 (Bogotá)] — H2: F-SENSOR-PROFILER (5 bloques del lab) — Z.ai Code (rama fix/e14-fidelidad-lab)
- **Hecho:** El pipeline de e14 nunca toca una foto por encima del tope seguro de memoria:
  - Imports del core (lab L61-67): `profileSensor`, `buildCappedPhotoSettings`, `clampBlobToSafeCap`, `getSensorSafeCap`, `SensorProfile` — cero cambios en el core.
  - `downscaleImage` COPIADA del lab (L245-290, canvas puro, NO existe en el core — regla de oro 6) con sus comentarios (bug v3 de CALIDAD, C13 toBlob async).
  - `sensorProfileRef` + `profileActiveSensor` (lab L433-454) invocado al abrir el stream ganador (L1032-1034 del lab).
  - `tomarFoto` = takePhotoBlob COMPLETO (lab L637-681): capa 1 photoSettings al ISP + retry sin settings + carrera 8 s + capa 2 `clampBlobToSafeCap`.
  - Capa 3 en el punto de entrada: `archivoDentroDeTope` (lab L574-589 decode único + tope por GAMA) + `blobToDataUrl` (L625-635) + `despacharArchivo` — cubre CÁMARA (takePhoto/ZSL), IMPORTAR (12-48 MP vía F-IMPORT robusto del core) y foto nativa iOS (HEIC); el File llega al bridge YA ≤tope. Error F-IMPORT → toast (lab L954-961 re-vestido).
- **QA (agent-browser 390×844, dev :3001):** IMPORTAR 1553×1995 → 8.5 ÓPTIMA real (motor=worker) SIN re-encode (dentro del tope, fetch-probe vacío = original intacto, F-RES-PRIORITY). IMPORTAR 6000×4800 → análisis OK sin freeze (7.9). Con benchmark simulado gama media (3200): fetch-probe capturó el re-encode de la capa 3 + decode del bridge 523→98 ms (la foto llega ya ≤tope). 0 errores de página.
- **Archivos:** src/components/e14/screens/ScanView.tsx
- **Commits:** 103aa89
- **Cómo probar:** importar una foto grande de galería — entra al análisis sin freeze; en gama media/baja el decode de ANALIZANDO es visiblemente más corto.
- **Pendiente/Bloqueado:** verificación en el 50MP del dueño (capa 1+2 requieren ImageCapture real).

### [2026-10-10 11:05 (Bogotá)] — H3+H4+H5: snapA + TORCH_HINT + accept HEIC — Z.ai Code (rama fix/e14-fidelidad-lab)
- **Hecho:**
  - H3: `snapA = instantanea()` ANTES de `await tomarFoto()` (lab §5.4 L843-845 + comentario verbatim) — si takePhoto cuelga 8 s ya queda un candidato medido del momento real del tap; snapB queda tras la foto (bracket); burst `[zsl, snapA, snapB]` como hoy con snapA del instante correcto; liberación R-14 de snapA cuando la foto gana. (Seguro: empujarAnillo hace copia dedicada — el canvas de snapA es independiente del ring, misma invariante del lab.)
  - H4: TORCH_HINT verbatim (lab L119-127) reemplaza el hint abreviado — diagnóstico completo de campo (Safari 17.4+/iOS, Chrome/Firefox iOS, WebViews in-app, lente sin LED, qué hacer) vía toast "LINTERNA NO CONTROLADA".
  - H5: `accept="image/*,.heic,.heif"` en AMBOS inputs (lab L1536; la cámara nativa iOS también entrega HEIC) + guard `pareceImagen`/`esHeic` del lab (L927-948) en ambos handlers + toast "CONVIRTIENDO HEIC…" y error de conversión (L954-961 re-vestido).
- **QA:** SIM dorado completo (ÓPTIMA 8.6 auto-envío · RECHAZADA + INTENTO 1 DE 2 · REPETIR → 2º intento ÓPTIMA) · CÁMARA headless → probes fallan → cascade → toast + vuelta a SIM (chip activo) · `agent-browser errors` limpio · lint:e14 + e14:check 0 errores · build estático BUILD_STATIC=1 basePath /web-scanner (worker+opencv en out/, F-LENS presente en chunks).
- **Archivos:** src/components/e14/screens/ScanView.tsx
- **Commits:** baa4990
- **Cómo probar:** lint+check limpios; flujo dorado SIM idéntico; IMPORTAR archivo no-imagen → toast "ARCHIVO NO VÁLIDO".
- **Pendiente/Bloqueado:** QA en el teléfono del dueño (checklist §6.2 del spec de auditoría) + push/PR/merge/deploy.

### [2026-10-10 12:20 (Bogotá)] — R0 + F1: REGLA DE ORO #0 + SIMULACIÓN = pipeline real — Z.ai Code (rama fix/e14-ux-real)
**Spec:** docs/SPEC-ux-real-bn-editor.md (Rev. 1) — 5 defectos del flujo real reportados por el dueño.
- **Hecho (R0 / commit 4675f52):** `AGENTS.md` NUEVO en la raíz del monorepo con la REGLA DE ORO #0 (petición literal del dueño: «si ya existe en apps/scanner-lab, se COPIA verbatim con comentario de Fuente; nunca se re-inventa ni se simplifica» — referencia al bug F-LENS/D33) + línea de advertencia al tope del cuerpo de `README.md`.
- **Hecho (F1 / commit 04ba712):** asset canónico `src/assets/acta-e14-real.jpg` (copia del dueño vía upload: 1.417.292 bytes, sha256 `c3f0bd7c…` — VERIFICADO idéntico a la tabla §1; CDN no fue necesario). `RealCoreBridge.escanearActa` (async) gana la rama SIMULACIÓN → `fetchActaSimulada()` (caché de módulo; `StaticImageData.src` resuelve basePath) tratada EXACTAMENTE como archivo IMPORTAR. MockBridge + Forzado + OPTIMA/ADVERTENCIA/RECHAZADA_SCORES + pick + dormir ELIMINADOS; CompositeBridge simplificado (escanearActa siempre al real; recortar/exportarPdf gatean por FOTO); store sin `forzado`; ScanView sin chips (línea estática «IMAGEN REAL INCLUIDA · ACTA E-14 (KIT 745 — CONSULADO FRANKFURT)»); `rotarFoto` sin cláusula SIM; `esReal` = foto en ReviewView.
- **Veredictos de fidelidad (bloques F1):**
  | Bloque | Origen | Veredicto |
  |---|---|---|
  | fetchActaSimulada + rama SIMULACION | SPEC §F1.1 (código dado) | FIEL (verbatim del spec) |
  | MockBridge/Forzado/gates | SPEC §F1.2–F1.5 | DECISIÓN PROPIA (D35) — el spec ordena la RETIRADA del mock: no hay bloque del lab que copiar (la fuente es la spec misma) |
  | Timeout 15 s + pipeline §5 | diseño propio e14 (L2) | INTACTO (no se tocó — spec §F1.1) |
- **QA:** lint:e14 + e14:check 0 errores.
- **Archivos:** AGENTS.md, README.md, src/assets/acta-e14-real.jpg, src/lib/e14/{bridge,scanner-core-bridge,store,get-bridge,types}.ts, src/components/e14/screens/{ScanView,ReviewView}.tsx
- **Commits:** 4675f52, 04ba712

### [2026-10-10 12:35 (Bogotá)] — F3 + F5: visor único + barra fija — Z.ai Code (rama fix/e14-ux-real)
- **Hecho (F3 / commit 2610dcd):** `verFoto`, toggle del toolbar, bloque ENVIADA, badge «FOTO REAL DISPONIBLE» y `rotacion` local ELIMINADOS de ReviewView; visor único `{hayFoto ? <img fotoProcesada> : placeholder «FOTO NO DISPONIBLE»}` (misma caja con brackets); `ActaDocument.tsx` BORRADO (grep: su único import era ReviewView — queda en el historial de git por si el dueño lo quiere); ROTAR 90° siempre real (store.rotarFoto).
- **Hecho (F5 / commit 553af8a):** main reestructurado — tarjeta SOLO visual (flex-1, sin toolbar dentro, sin max-h) + barra `grid grid-cols-3` (→4 en F2) `shrink-0` anclada abajo encima de los CTAs; ToolbarBtn con `min-h-11` + label `truncate`; ENVIADA sin barra; banners flotantes y chips de envío intactos.
- **Veredictos de fidelidad:**
  | Bloque | Origen | Veredicto |
  |---|---|---|
  | Visor único + placeholder | SPEC §F3 | DECISIÓN PROPIA (D35/F3) — eliminación dirigida por la spec, el layout de la caja existente se conserva |
  | Barra fija (estructura main) | SPEC §F5 | DECISIÓN PROPIA (D38) — la spec define el árbol (visor flex-1 + barra shrink-0); re-vestido con tokens existentes |
- **QA:** lint:e14 + e14:check 0 errores.
- **Archivos:** src/components/e14/screens/ReviewView.tsx (−ActaDocument.tsx), src/components/e14/primitives.tsx
- **Commits:** 2610dcd, 553af8a

### [2026-10-10 12:50 (Bogotá)] — F2: B/N adaptativo por defecto + selector de filtros — Z.ai Code (rama fix/e14-ux-real)
- **Hecho (commit 1daae7f):** `Acta.filtro?: PageFilter` (types); captura con `processImage(..., "bw")` (Fuente: CameraView L602-604 + types L50); recorte conserva `acta.filtro ?? "bw"`; `construirActa` fija `filtro: "bw"`; PDF con `acta.filtro ?? "bw"`; logs con `filtro=`; `E14Bridge.revelar` (contrato + CompositeBridge + RealCoreBridge — espejo de setFilterOnPage: SOLO processImage, sin re-OCR/re-calidad, sin timeout — ADAPTACIÓN documentada); store `cambiarFiltro` + `revelando` + toast «Filtro aplicado: …»; ReviewView: gatillo FILTROS (grid-cols-4) + sheet con 3 miniaturas; `SlidersIcon` en icons.tsx.
- **Veredictos de fidelidad (copias del lab, regla de oro 6):**
  | Bloque | Origen (lab) | Veredicto |
  |---|---|---|
  | `CSS_FILTERS` | EditorView.tsx L89-93 | FIEL (literal + comentario Fuente) |
  | Sheet UI (handle/título «Filtros»/3 miniaturas 78×104/borde activo) | EditorView.tsx L2253-2309 | ADAPTACIÓN (re-vestido: vaul → fixed bottom + animate-editor-enter — e14 NO instala deps; #007AFF→ok-tint; page.original→acta.fotoOriginal; activo por acta.filtro) |
  | `handleFilter` (aplica+cierra+toast) | EditorView.tsx L1214-1218 | ADAPTACIÓN (llama a store.cambiarFiltro en vez de updateCapturePage; toast verbatim «Filtro aplicado: ${label}» lo emite el store) |
  | Gatillo «Filtros» del toolbar | EditorView.tsx L2200-2204 | ADAPTACIÓN (ToolItem lucide → ToolbarBtn e14 con SlidersIcon) |
  | `revelar` (solo processImage) | store.ts L644-669 (setFilterOnPage) | ADAPTACIÓN (quad = quadDetectado ?? defaultQuad; sin timeout — decisión del agente permitida por §F2.2, documentada) |
  | Default `bw` en captura | CameraView.tsx L602-604 + types.ts L50 | FIEL (misma regla: e14 sin ajustes → default fijo del producto) |
- **QA:** lint:e14 + e14:check 0 errores.
- **Archivos:** src/lib/e14/{types,bridge,scanner-core-bridge,store}.ts, src/components/e14/screens/ReviewView.tsx, src/components/e14/icons.tsx
- **Commits:** 1daae7f

### [2026-10-10 13:05 (Bogotá)] — F4: QuadEditor con ROTAR 90° + DETECCIÓN AUTOMÁTICA — Z.ai Code (rama fix/e14-ux-real)
- **Hecho (commit 0a9394b):** `rotLocal` (estado local, inicial = rotationProp; todos los usos de `rotation` pasan por ella); botón ROTAR 90° (determinista, sin guard); `transition-transform duration-300` SOLO en el div interior (los arrastres no lo tocan — el transform del div no cambia con los drags); DETECCIÓN AUTOMÁTICA (detectDocumentEdges del core + tween reutilizado: efecto de aterrizaje extraído a `animarQuadHacia` — misma curva easeOutCubic 280 ms para el aterrizaje Y el botón; cancela rAF previo); fallo → «NO SE PUDO DETECTAR» en el readout del header ~2 s (sin alert, sin store — D19); APLICAR entrega `onAplicar(quad, rotLocal)`; fila de botones 44px sobre el hint en el footer; cables: ReviewView → `store.aplicarRecorte(quad, rotacion)` → `bridge.recortar(..., rotacionOverride)` → `rotacion = rotacionOverride ?? acta.rotation ?? 0` y `rotation: rotacion` HORNEADA en el retorno del rescate. `SparklesIcon` en icons.tsx.
- **Veredictos de fidelidad (copias del lab, regla de oro 6):**
  | Bloque | Origen (lab) | Veredicto |
  |---|---|---|
  | `handleDetect` (detectDocumentEdges→quad) | EditorView.tsx L1198-1212 | ADAPTACIÓN (actualiza el quad LOCAL por tween en vez de updateCapturePage al store — D19 prohíbe store en el editor; el quad llega al acta al APLICAR) |
  | Botón DETECCIÓN (spinner dentro) | EditorView.tsx L2123-2141 | ADAPTACIÓN (pill lucide → botón del footer e14; Sparkles lucide → SparklesIcon propio) |
  | Tween easeOutCubic 280 ms | EditorView.tsx L873-887 | FIEL (mismo rAF; extraído a función para reuso — refactor interno) |
  | ROTAR dentro del editor | SPEC §F4.2 (el lab rota en REVIEW F-ROT-RAPID L1080-1119) | DECISIÓN PROPIA (D37) — el dueño pide el botón DENTRO del editor; la mecánica quad-en-marco-rotado ya estaba en QuadEditor |
  | `onAplicar(quad, rotacion)` + rotacionOverride | SPEC §F4.4/F4.5 | FIEL (cableado según spec) |
- **QA:** lint:e14 + e14:check 0 errores (tras corregir import `./icons` en QuadEditor).
- **Archivos:** src/components/e14/QuadEditor.tsx, src/components/e14/screens/ReviewView.tsx, src/lib/e14/{bridge,scanner-core-bridge,store}.ts, src/components/e14/icons.tsx
- **Commits:** 0a9394b

### [2026-10-10 13:55 (Bogotá)] — QA integral con navegador (agent-browser 390×844) + fix h-dvh — Z.ai Code (rama fix/e14-ux-real)
- **Hallazgo y fix (commit 0ea4a20):** con el re-estruccionado F5, el caso RETRATO desbordaba el viewport (scrollH=1313 > 844): la cadena de alturas era INDEFINIDA (shell `min-h-dvh` crece con el contenido) y la altura INTRÍNSECA de la foto (acta 1715×2287) empujaba la barra a y=1103 (bajo el fold). Fix: shell `h-dvh overflow-hidden` en page.tsx — cadena DEFINITA (main flex-1 → tarjeta flex-1 → img h-full object-contain); Actas/Resumen ya gestionan su scroll interno (overflow-y-auto) y ScanView cabe por diseño (verificado: scrollH=844 en las 5 vistas).
- **Verificación por navegador (todo en dev :3001, headless Chromium):**
  1. **F1 SIMULACIÓN real:** ESCANEAR → pipeline real → consola `[e14] pipeline SIMULACION/file total=8220ms (decode=2092 detect=110 proceso=491 calidad=37 ocr=5489 motor=worker legible=false score=8.1 filtro=bw metricas={sharpness:100 brightness:36 contrast:100 level:excellent})` — foto real del E-14 VERTICAL (EXIF aplicado, VLM confirma «ACTA ELECTORAL — ELECCIONES PRESIDENCIALES», procesado monocromo B/N), chips ÓPTIMA/ADVERTENCIA/RECHAZADA inexistentes, panel SIM con la línea «IMAGEN REAL INCLUIDA · ACTA E-14 (KIT 745 — CONSULADO FRANKFURT)». Resultado real: RECHAZADA por gate OCR (legible=false) con score 8.1 — ver A/B abajo.
  2. **A/B del gate (F2 no es la causa):** recorte re-ejecutado con filtro `original` → `[e14] recorte SIMULACION total=5018ms … legible=false score=8.1 filtro=original` — el gate falla IGUAL sin B/N: es la foto real (mesa oscura, brightness 36) la que el OCR local no resuelve como E-14/REGISTRADURÍA, NO una regresión del default `bw`. La salida de rescate (recorte manual para incluir cabecera) queda disponible para el dueño.
  3. **F2 selector:** sheet con 3 miniaturas (Original/Texto claro/B/N adaptativo, 78×104, borde ok-tint en la activa) + toast verbatim «Filtro aplicado: Original» + foto re-procesada sin re-OCR.
  4. **F4 editor:** VLM confirma fila [ROTAR 90° · DETECCIÓN AUTOMÁTICA] sobre el hint y APLICAR; ROTAR gira el preview (transition 300 ms, quad solidario); DETECCIÓN re-detecta (sin errores); APLICAR hornea quad+rotación (console recorte, rotation devuelta); CANCELAR tras rotar NO toca el acta (foto sigue retrato 0°, img 324×520).
  5. **F5 barra fija (criterio al píxel):** barY=635/barH=44 en 0°, 90°, 180° y 270° — IDÉNTICA; scrollH=844 en todos los estados; CTAs/BottomNav bottom=844; ENVIADA sin barra (código — el flujo no era alcanzable con esta acta RECHAZADA).
  6. **Regresión:** ScanView cabe (scrollH=844), ACTAS/RESUMEN sin overflow y con scroll interno intacto, cero errores de página y cero warnings de consola en toda la sesión.
- **Build estático (§C):** `BUILD_STATIC=1 bunx next build` VERDE — asset emitido `out/_next/static/media/acta-e14-real.*.jpg` con sha256 idéntico (`c3f0bd7c…`) y referencia con prefijo `/web-scanner` en los chunks (basePath resuelto por el import estático).
- **Archivos:** src/app/page.tsx
- **Commits:** 0ea4a20
- **Cómo probar (dueño):** Preview → SIMULACIÓN → ESCANEAR → ANALIZANDO real (~8 s) → REVISIÓN con la foto real en B/N; probar FILTROS (sheet), RECORTAR (ROTAR 90° + DETECCIÓN AUTOMÁTICA + APLICAR/CANCELAR), ROTAR 90° de la barra (la barra no se mueve) y EXPORTAR PDF en una acta ENVIADA real (CÁMARA/IMPORTAR).
- **Pendiente/Bloqueado:** verificación de CÁMARA real y del flujo ENVIADA→EXPORTAR PDF en el teléfono del dueño (headless no tiene cámara); merge del PR por el dueño.

### [2026-10-10 14:40 (Bogotá)] — MERGE PR #8 + smoke test de PRODUCCIÓN — Z.ai Code (main)
- **Hecho:** merge del PR #8 (`fix/e14-ux-real` → `main`, merge commit `eda6714`, método **merge** — narrativa de 9 commits preservada, sin squash) por orden del dueño. CI `Deploy to GitHub Pages` (run `38008050760`) → **success** en ~1 min. Deploy a producción verificado con agent-browser (desktop + móvil 390×844):
  1. **Rutas:** e14 `/web-scanner/` 200 (13,4 KB HTML) · lab `/web-scanner/lab/` 200 (onboarding + «Mis documentos» sin errores — SIN regresión) · asset real `acta-e14-real.0w8iv2-_so1fz.jpg` 200 con 1.417.292 bytes (mismo tamaño del original — sha256 `c3f0bd7c…`).
  2. **Golden path SIMULACIÓN:** ESCANEAR → pipeline real (~12 s en prod) → REVISIÓN «ACTA NO RECONOCIDA · 8.1/10 RECHAZADA · CÓDIGO DE BARRAS Y CABECERA NO DETECTADOS · INTENTO 1 DE 2» — MISMO resultado que el QA dev (esperado: el gate OCR no resuelve la foto real, mesa oscura brightness 36; ver A/B en la entrada 13:55 — NO es regresión del filtro `bw`).
  3. **F4 editor (prod):** RECORTAR → AJUSTAR BORDES (8 asas) → ROTAR 90° ×2 (180°) + DETECCIÓN AUTOMÁTICA sin errores → APLICAR → recorte con rotación horneada, vuelta a REVISIÓN.
  4. **F2 filtros (prod):** FILTROS → sheet con las 3 opciones (Original · Texto claro · B/N adaptativo) → aplicar «Original» → sheet cierra + re-proceso (toast verificado en QA dev).
  5. **F5 barra fija al píxel (prod):** DESKTOP x=538 y=368 (98×44) y MÓVIL x=107.5 y=635 (83.5×44) — **IDÉNTICAS antes/después de ROTAR 90°** (mismos números que el QA dev: barY=635/barH=44).
  6. **h-dvh (prod):** `scrollHeight=844` exacto en 390×844 para ESCANEAR/ACTAS/RESUMEN/REVISIÓN — sin overflow.
  7. **ACTAS/RESUMEN** renderizan (mesas desplegables, historial, 75%).
  8. **Consola:** cero errores de página y cero warnings en AMBAS apps durante toda la sesión de smoke.
- **Archivos:** (sin cambios de código — solo este registro)
- **Commits:** `eda6714` (merge en GitHub; este docs-commit va directo a main siguiendo la convención `c225fbe`)
- **Cómo probar:** abrir `https://jg-stevan.github.io/web-scanner/` → SIMULACIÓN → ESCANEAR → ANALIZANDO real (~12 s) → REVISIÓN; probar RECORTAR (ROTAR 90°/DETECCIÓN/APLICAR), FILTROS y que la barra no se mueva al rotar.
- **Pendiente/Bloqueado:** verificación en el TELÉFONO del dueño de: CÁMARA real, IMPORTAR (incl. HEIC), flujo ENVIADA→EXPORTAR PDF con foto real, y el chequeo §6.2 del spec de auditoría. H6 (PWA) sigue siendo decisión del autor.

### [2026-10-10 15:50 (Bogotá)] — F-OCR: botón TEXTO del lab en la barra de revisión — Z.ai Code (rama feat/e14-texto-ocr)
**Spec:** docs/SPEC-texto-ocr-editor.md (Rev. 1) — petición literal del dueño: «Copiemos el botón de "Texto" (con sus funciones) de lab en el editor de e14». Base: main post-PR#8 (eda6714).
- **Hecho (C1 / commit da97a5f):** B1–B6 del lab en la barra fija (§F1): `ToolbarBtn` gana `active?: boolean` (tinte único, D38 intacto) y la barra pasa a **grid-cols-5** con **TEXTO en 4ª posición** (orden del lab: Recortar · Rotar 90° · Filtros · **Texto** · Pantalla completa), `active={hayTexto}` (`ocrTexto && ocrTexto !== OCR_NO_TEXT`, IMPORTADO del core ocr.ts L12). §F2: `E14Bridge.reconocerTexto` + `RealCoreBridge` (`requestOcr(fotoProcesada)` — requestOcr ya importado L40, mismo motor del pipeline) + `CompositeBridge` gate por PRESENCIA DE FOTO + `store.reconocerTextoActa` (guards → `ocrTextIsValid` → guardar + toasts del lab re-vestidos). §F3: sheet «Texto reconocido» con el MISMO patrón del sheet de filtros (sin vaul, cero deps) — 3 estados: spinner «Reconociendo texto…» / caja de texto + contadores (B6 sin matches) + «Reconocer de nuevo» + «Copiar texto» (B3) / vacío con hint adaptado + «Reconocer texto». §F4: `ScanTextIcon` (scan-text), `CopyIcon` (copy), `LoaderIcon` (loader-circle) — lucide calados SVG inline.
- **Veredictos de fidelidad (copias del lab, regla de oro 6):**
  | Bloque | Origen (lab) | Veredicto |
  |---|---|---|
  | B1 Botón del toolbar | EditorView.tsx L2205-2210 | ADAPTACIÓN (ToolItem lucide → ToolbarBtn e14; `active` re-vestido con tokens ok-tint — mismo concepto L2208; label «Texto», NO ejecuta OCR: abre el sheet) |
  | B2 Ejecución OCR runOcrCurrent | EditorView.tsx L1360-1395 | ADAPTACIÓN (imagen: `fotoProcesada` directa — el lab usa preview/cache L1373-1376; guard previewLoading L1364-1370 N/A; sin timeout como L1379; toasts: descripciones verbatim, títulos mayúsculas estilo e14; ocrRunning LOCAL como L347) |
  | B3 Copiar copyOcrText | EditorView.tsx L1446-1455 | FIEL (misma secuencia navigator.clipboard + catch; toasts re-vestidos de título) |
  | B4 Sheet OCR (3 estados) | EditorView.tsx L2311-2416 | ADAPTACIÓN (vaul → patrón fixed del sheet de filtros e14; #007AFF → ok-tint; #8e8e93 → ink-faint; ring-white/10 → ring-line; motion.button → button+active:scale; F-FIND L2347-2366 y multi-página EXCLUIDOS con razón) |
  | B5 OcrHighlightedText | EditorView.tsx L237-271 | FIEL (componente completo con mark #ffd60a literal — hoy query={null} degrada a texto plano; listo para F-FIND futuro) |
  | B6 ocrStats (contadores) | EditorView.tsx L1563-1578 | ADAPTACIÓN (fórmula verbatim palabras/caracteres; sin `matches` — F-FIND excluido) |
- **QA (agent-browser 390×844, dev :3001):** barra 5 botones con y=635 h=44 **IDÉNTICA antes/después de ROTAR 90°** (D38 verificado con 5 columnas; «Pantalla completa» trunca sin romper el grid; scrollH=844) · SIMULACIÓN → revisión → TEXTO abre el sheet **con el texto real del OCR del pipeline** («ACTA DE ESCRUTINIO… CONSULADO: 88 — CONSULADOS… 170 palabras | 745 caracteres») · «Reconocer de nuevo» → spinner «Reconociendo texto…» → toast «TEXTO RECONOCIDO» + botón TEXTO queda `active` · «Copiar texto» → toast «TEXTO COPIADO» · recorte a zona en blanco → pipeline deja ocrTexto vacío → botón INACTIVO + sheet en estado **vacío** («Extrae el texto del acta para copiarlo.» + «Reconocer texto») → OCR honesto → toast «SIN TEXTO LEGIBLE» sin inventar texto · cierre por backdrop + reabrir conserva el texto · lint:e14 + e14:check 0 errores · `BUILD_STATIC=1` build verde · 0 errores de página/consola.
- **Archivos:** src/components/e14/{screens/ReviewView.tsx, primitives.tsx, icons.tsx}, src/lib/e14/{bridge.ts, scanner-core-bridge.ts, store.ts}, docs/SPEC-texto-ocr-editor.md
- **Commits:** da97a5f (C1) + este docs (C2)
- **Cómo probar (dueño):** Preview → SIMULACIÓN → ESCANEAR → REVISIÓN → **TEXTO**: el sheet nace con el texto del OCR del pipeline (~12 s); «Reconocer de nuevo» re-corre el OCR sobre la procesada; «Copiar texto» al portapapeles; recortar una zona sin texto → TEXTO gris → sheet vacío → «Reconocer texto».
- **Pendiente/Bloqueado:** PR abierto para verificación del dueño (§A) — NO se hace merge ni deploy hasta su visto bueno (spec §C: «NO subir deploy»).

### [2026-10-10 16:15 (Bogotá)] — MERGE PR #9 + smoke test de PRODUCCIÓN — Z.ai Code (main)
- **Hecho:** merge del PR #9 (`feat/e14-texto-ocr` → `main`, merge commit `83e5838`, método **merge** — narrativa de 2 commits preservada, sin squash) por orden del dueño («merge de este PR (contra main 9227d47)» = visto bueno del §A). Base: `9227d47` exacto, `mergeable_state: clean`. CI `Deploy to GitHub Pages` (run `38012198805`) → **success**. Deploy a producción verificado con agent-browser (móvil 390×844 + desktop 1280×800):
  1. **Rutas:** e14 `/web-scanner/` 200 («Digitalizador E-14 — Precisión electoral») · lab `/web-scanner/lab/` 200 (onboarding «Digitaliza cualquier documento…» sin errores — SIN regresión).
  2. **Golden path SIMULACIÓN:** ESCANEAR → pipeline real → REVISIÓN «ACTA NO RECONOCIDA · INTENTO 1 DE 2» — mismo resultado esperado del gate OCR con la foto real (ver A/B entrada 13:55; NO es regresión).
  3. **F-OCR TEXTO (prod, móvil):** barra **grid-cols-5** con TEXTO en 4ª posición (Recortar · Rotar 90° · Filtros · **Texto** · Pantalla completa) → sheet «Texto reconocido» nace con el **texto REAL del OCR del pipeline** («[OPD] ACTA DE ESCRUTINIO DE LOS JURADOS DE VOTACIÓN… ELECCIÓN PRESIDENCIAL… CONSULADO: 88 — CONSULADOS · PAÍS: 120 — ALEMANIA · MESA: 012 · LUGAR: Frankfurt Consulado… ABELARDO DE LA ESPRIELLA · JOSÉ MANUEL RESTREPO… KIT 745») + contadores **170 palabras | 745 caracteres** — IDÉNTICOS al QA dev (entrada 15:50).
  4. **«Reconocer de nuevo»:** spinner «Reconociendo texto…» → re-OCR sobre fotoProcesada (~8 s) → el texto vuelve al sheet.
  5. **Botón TEXTO `active`:** clases `border-ok-tint/40 bg-ok-tint/10 text-ok-tint` con ocrTexto válido — tinte único, D38 intacto.
  6. **«Copiar texto»:** toast **«TEXTO COPIADO»** capturado (B3 FIEL).
  7. **Sheet backdrop:** clic fuera del sheet → cierra ✓.
  8. **F5 barra fija al píxel (con 5 columnas):** Rotar 90°/Texto en y=635 h=44 **IDÉNTICOS antes/después de ROTAR 90°**; scrollHeight=844 exacto (móvil) y =800 exacto (desktop) — h-dvh sin overflow.
  9. **Consola:** cero errores de página y cero warnings en AMBAS apps durante toda la sesión de smoke.
- **Archivos:** (sin cambios de código — solo este registro + ROADMAP)
- **Commits:** `83e5838` (merge en GitHub; este docs-commit va directo a main siguiendo la convención `c225fbe`/`9227d47`)
- **Cómo probar (dueño):** abrir `https://jg-stevan.github.io/web-scanner/` → SIMULACIÓN → ESCANEAR → REVISIÓN → **TEXTO**: el sheet nace con el texto del OCR del pipeline; «Reconocer de nuevo» re-corre el OCR; «Copiar texto» al portapapeles; cerrar tocando fuera; la barra no se mueve al rotar.
- **Pendiente/Bloqueado:** verificación en el TELÉFONO del dueño de: CÁMARA real, IMPORTAR (incl. HEIC), flujo ENVIADA→EXPORTAR PDF con foto real. H6 (PWA) sigue siendo decisión del autor. F-FIND queda como extensión futura (ROADMAP).

### [2026-10-10 17:30 (Bogotá)] — CLASIFICACIÓN DE CABECERA contra base DIVIPOL oficial + fin del «ACTA NO RECONOCIDA» — Z.ai Code (rama feat/e14-clasificacion-cabecera)
**Spec:** docs/SPEC-e14-cabecera-clasificacion.md (Rev. 1, subida por el dueño). Base: main@489f671 (post-PR #9). Dominio E-14 NUEVO (§8: nada se copia del lab — este módulo no existe allí; las copias verbatim son DEL PROPIO SPEC).
- **Hecho (§1 / commit fbec763):** base DIVIPOL descargada del visor oficial (WAF: responde con UA de navegador) — `allDepartments.json` (3,3 KB) + `departmentsTree.json` (4,64 MB). **Conteos EXACTOS del spec: 34 deps · 1.189 mun · 3.013 zonas · 14.438 puestos** (67 países en el 88). Validación 1:1 contra las muestras del dueño: Cairo KIT 399 → `88→335 EGIPTO→zona 05→puesto 02 «El Cairo - Consulado»→countTable 1` · Frankfurt 012 → `88→120 ALEMANIA→zona 15→puesto 02 «Frankfurt Consulado»→countTable 12` · Bremen → `zona 05→«Berlin Consulado»→countTable 9`. Bundle compacto `public/e14/divipol.json` **620 KB** (0,63 MB medidos — igual al spec) vía `scripts/gen-divipol.mjs` (lógica VERBATIM §1.2 + guard de conteos que ABORTA si la base cambia). `divipol.ts` (§2): carga por fetch local con prefijo `NEXT_PUBLIC_BASE_PATH` (inlineado `/web-scanner/e14/divipol.json` en el chunk del build estático — verificado) + caché de módulo idempotente + estado cargando/cargada/falló (NUNCA rechaza: falla → base vacía → MANUAL puro, §1.3) + índices de consulta. Cero fetch a Registraduría en runtime (§8; el único externo del log es el CDN de tesseract del core — preexistente, no es Registraduría).
- **Hecho (§3 / commit fbec763):** `clasificador.ts` — anclas de extracción VERBATIM §3.2 (CONSULADO/PAÍS/ZONA/PUESTO/MESA/LUGAR/BANDA/Ver-Pag/KIT-No.Form, sin relajaciones: la evidencia OCR actual lee los dígitos limpios — el mapa de confusión O→0/Q→0/I→1/L→1/S→5/B→8 queda aplicado defensivamente a los tokens numéricos) + normalización NFKD + fuzzy trigramas-Dice (~40 líneas, sin deps) + estrategia §3.3 (código exacto → nombre fuzzy acotado al padre → municipio global único deduce dep → PUESTO numérico con LUGAR como desambiguación/verificación → mesaValida 1..countTable) + veredicto §3.4 con PATRON_CABECERA como piso SUGERIDA (nunca pase libre a AUTO). **AC2 verificado con el OCR REAL del acta Frankfurt incluida: AUTO `88·120·15·02·012·TRANSMISION`** (el OCR leyó «ZONA: 18» — inexistente en ALEMANIA: la resolución del puesto por LUGAR «Frankfurt Consulaco»≈0,88 dedujo zona 15 y desambiguó de «Berlin Consulado»≈0,39) y con OCR sintético de la muestra Cairo §1.1: AUTO `88·335·05·02·001`.
- **Hecho (§4 / commit da7033b):** gate REVISADO — helper ÚNICO `evaluarGate` (§4.4) aplicado a AMBOS pipelines (escaneo y recorte): RECHAZADA **solo por CALIDAD** (score < 6.5, vía statusDeScore; tarjeta «ACTA NO RECONOCIDA» reservada a ese caso; 2 intentos intactos — AC4 verificado: imagen borrosa 3.6/10 → RECHAZADA «OBLIGATORIO REPETIR FOTO INTENTO 1 DE 2» + `clasif={sin-clasificar}`) · calidad OK + **AUTO** → status por score + clasificacion persistida (**AC3 «después»: la MISMA foto 8.1/10 cuyo OCR no contiene E-14/REGISTRADURÍA — el caso «ACTA NO RECONOCIDA» de PR #8/#9 — ahora clasifica AUTO → OPTIMA → D4 auto-envío «ENVIADO CORRECTAMENTE»**) · calidad OK + SUGERIDA/MANUAL (incluye OCR sin texto §4.3) → **EN_REVISION_HUMANA, PROHIBIDO RECHAZADA por cabecera** (verificado con imagen nítida sin cabecera legible: 7.5/10 → panel). PATRON_CABECERA movido a clasificador.ts (§4.5: solo traza — log `cabeceraE14=false`). Log §4.6 con `clasif={dep:88,mun:120,zon:15,std:02,mesa:012,tipo:T,nivel:AUTO}` (formato EXACTO del ejemplo del spec, AC7).
- **Hecho (§5 / commit da7033b):** `PanelClasificacion.tsx` NUEVO — se muestra SOLO con status EN_REVISION_HUMANA + clasificacion pendiente (el camino C4 de RECHAZADA→revisión humana no lleva clasificacion → no aparece, «sin quitar nada»): selects en cascada Dep (34)→Mun→Zona→Puesto→Mesa input numérico (1..countTable) + toggle TRANSMISIÓN/DELEGADOS (§D.4: nunca asumido) + páginas 1/2 (2 deshabilitada si formato 1 pág según Ver/Pag, default 2) · «código — nombre» (335 — EGIPTO, 02 — El Cairo - Consulado) · precarga de la sugerencia (deduce zona del puesto sugerido si venía sin zona) · **GUARDAR UBICACIÓN** (disabled hasta cascada completa → store.guardarUbicacion: nivel AUTO-manual + archiva hueco + status ADVERTENCIA «pasa a flujo normal de envío») + **REPETIR FOTO** · sin base → 5 campos texto libre (§1.3) · max-h-96 overflow-y-auto, touch ≥44 px, selects nativos estilizados con tokens e14 · PrimaryBtn gana `disabled` opcional · MapPinIcon nuevo.
- **Hecho (§6 / commit da7033b):** Fase B — `store.archivadas` por clave de mesa `${dep}-${mun}-${zon}-${std}-${mesa}` (códigos con ceros: 88-335-05-02-001) con huecos `TipoPagina × pág 1/2`; **duplicado del mismo hueco → reemplaza y AVISA** (§G.4.1 — verificado en vivo: toast «HUECO REEMPLAZADO — Frankfurt Consulado · MESA 12 — la foto anterior queda sustituida») · `registrarEnvio` archiva las AUTO (idempotente: el re-archivo del mismo acta es silencioso) · vista ACTAS renderiza sección «MESAS CLASIFICADAS (n)» con tarjetas `standName · MESA {mesa}` ANTES del seed demo (este se mantiene íntegro — §6) · REVISIÓN muestra la ubicación real cuando hay AUTO (breadcrumb ruta dinámica + detalle ADVERTENCIA + chips tipo/página) · export §G.4.5: `E14_{KIT}_{dep}_{mun}_{zon}_{puesto}_{mesa}_{TIPO}-{pag}.pdf` (verificado en vivo: descarga real «E14_SINKIT_88_335_05_02_001_TRANSMISION-1.pdf» — SINKIT = placeholder documentado cuando el panel clasifica sin KIT leído; el acta Frankfurt real con KIT 745 produce E14_745_88_120_15_02_012_TRANSMISION-1, verificado en test del clasificador).
- **Veredictos de fidelidad (dominio NUEVO §8 — no hay bloques del lab; las fuentes son el SPEC y la base oficial):**
  | Bloque | Origen | Veredicto |
  |---|---|---|
  | Script gen-divipol.mjs + forma del bundle | SPEC §1.2 (código dado) | FIEL (misma lógica + guard de conteos añadido — exigido por el propio §1.2) |
  | Tipos/carga divipol.ts | SPEC §2 (firmas dadas) | FIEL (firmas idénticas; fetch con PUBLIC_BASE como detector-client del core — §1.3 alternativa aceptada) |
  | Anclas regex | SPEC §3.2 | FIEL (VERBATIM, sin relajar; mapa de confusión §3.1 aplicado defensivamente — documentado) |
  | Tipos ClasificacionE14 + niveles | SPEC §3.4 | FIEL (estructura textual del spec) |
  | Panel (UI) | SPEC §5 | DECISIÓN PROPIA (D40) — re-vestido con el sistema de componentes e14 (primitives + selects nativos estilizados + tokens), prohibido vaul/deps nuevas |
  | Fase B (archivadas + ACTAS + export) | SPEC §6 | ADAPTACIÓN (clave/huecos/avisos según spec; extensión .pdf del template .jpg del análisis §G.4.5 — el export real es PDF §6, documentado) |
- **QA (agent-browser 390×844, dev :3001):** AC1 divipol 200 local (4 fetch = 4 page loads, caché por carga) · AC2 Frankfurt real AUTO (log clasif exacto) + Cairo sintético AUTO · AC3 reproducido antes (PR #8/#9: 8.1/10 RECHAZADA «ACTA NO RECONOCIDA» por cabecera) y después (AUTO→OPTIMA→ENVIADA; nítida sin cabecera 7.5/10 → panel, NUNCA RECHAZADA) · AC4 borrosa 3.6/10 → RECHAZADA igual que hoy · AC5 ambas vías (AUTO: Frankfurt TRANSMISIÓN P1 ✓ en su mesa; manual: cascada Egipto→GUARDAR→ENVIAR→hueco ✓) · AC6 tsc + eslint 0 errores, `git diff apps/scanner-lab` VACÍO · AC7 clasif={...} en ambos pipelines · build estático `BUILD_STATIC=1` VERDE con out/e14/divipol.json + basePath inlineado · h-dvh 844 exacto con panel abierto · barra de 5 botones + todo lo aprobado PR #8/D38/D39 intacto (verificada tras GUARDAR en ADVERTENCIA) · 0 errores de página/consola.
- **Archivos:** scripts/gen-divipol.mjs · public/e14/divipol.json · src/lib/e14/{divipol,clasificador,types,store,scanner-core-bridge}.ts · src/components/e14/{PanelClasificacion.tsx, primitives.tsx, icons.tsx, screens/ReviewView.tsx, screens/ActasView.tsx} · docs/SPEC-e14-cabecera-clasificacion.md
- **Commits:** fbec763 (§1-§3) + da7033b (§4-§6) + este docs
- **Cómo probar (dueño):** SIMULACIÓN → ESCANEAR → la acta Frankfurt ahora **se envía sola** (AUTO 8.1/10 OPTIMA, log `clasif={...nivel:AUTO}` en consola) → ACTAS muestra «Frankfurt Consulado · MESA 12» con TRANSMISIÓN P1 ✓ · IMPORTAR una foto nítida sin cabecera legible → panel «CORREGIR UBICACIÓN» precargado → cascada → GUARDAR UBICACIÓN → toast + ADVERTENCIA → ENVIAR · IMPORTAR una foto borrosa → RECHAZADA como siempre (2 intentos) · EXPORTAR PDF en una clasificada → archivo `E14_{KIT}_..._{TIPO}-{pag}.pdf`.
- **Pendiente/Bloqueado:** foto real del Cairo KIT 399 del dueño no está en el sandbox — su clasificación se validó con OCR sintético según la muestra §1.1 (la del acta Frankfurt incluida sí es el OCR real) · verificación en el TELÉFONO del dueño (cámara real, HEIC, flujo completo) · Consulta viva AppSync y manuscritos G.2/G.3 FUERA de alcance por decisión del dueño (§0) · H6 (PWA) decisión del autor.
