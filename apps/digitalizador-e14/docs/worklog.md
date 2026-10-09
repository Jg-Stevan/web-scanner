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
