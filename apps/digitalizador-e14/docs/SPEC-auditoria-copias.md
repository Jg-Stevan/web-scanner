# SPEC — AUDITORÍA DE COPIAS: digitalizador-e14 vs lab (y remediación)

**Repo:** `web-scanner` (monorepo) · **Rama:** `fix/e14-fidelidad-lab` → PR a `main`
**Base:** `main` (fase lógica mergeada en PR #6) · **Depende de:** §12 HOTFIX
F-LENS de `SPEC-e14-fase-logica.md` Rev. 4 (se ejecuta en la MISMA rama/PR).
**Rev. 1:** plan inicial — incluye 4 hallazgos ya auditados por QA externo con
mapa de copia, para que la auditoría no empiece de cero.
**Rev. 2:** auditoría de cobertura de `novedades.md` (v5.0.0→v6.3 del lab) —
nueva §6 con veredicto por novedad; H2 ampliado (el tope de resolución cubre
TAMBIÉN la ruta IMPORTAR, no solo la cámara); H5 nuevo (accept HEIC, P2);
H6 (PWA) registrado como decisión de alcance pendiente del autor — NO en
este PR.

---

## §0 Mandato

El autor del proyecto (dueño del lab) verificó un bug en producción: la cámara
de e14 abría la GRAN ANGULAR en vez de la principal (50MP). Causa raíz: durante
la fase lógica se **re-escribió («simplificó»)** lógica del lab que ya resolvía
el problema — violando el principio de copia. El lab es la fuente de verdad: el
autor lo creó y **sabe que funciona** en hardware real.

**La auditoría ya encontró que no fue el único «simplificado»** (§2: hay un
segundo P0 confirmado). Este spec ordena:

1. **AUTO-AUDITORÍA** sistemática de TODO lo copiado del lab a e14 (§1).
2. **REMEDIACIÓN** de cada desviación con copia VERBATIM (código + comentarios
   de origen), per Regla de oro 6 (`SPEC-e14-fase-logica.md` §1.6).
3. **QA** de no-regresión y verificación en producción (§6).

**Prohibido:** «mejorar» el lab al portarlo, omitir comentarios de origen, o
declarar fiel algo sin comparar bloque a bloque. Ante la duda: copiar MÁS y
borrar menos. Si e14 realmente necesita comportamiento distinto al lab, NO es
una simplificación silenciosa: es una decisión que se documenta en
`docs/DECISIONS.md` con su motivo.

## §1 Metodología de auditoría (obligatoria, en orden)

1. **Censo de huellas auto-declaradas** — el código previo dejó fingerprints:
   ```bash
   rg -n "simplific|abrevi|adaptad|resumid|omitid|solo en e14|no copiad" \
      apps/digitalizador-e14/src
   ```
   Cada hit entra a la tabla de hallazgos (paso 3). Los conocidos hoy:
   `ScanView.tsx` L64, L85, L379, L429, L516 (y cualquier otro que aparezca).
2. **Diff bloque a bloque** — para CADA bloque que cite «lab L…» (en código,
   comentarios o SPEC), abrir el archivo del lab y comparar: función por
   función, constante por constante, guard por guard, comentario por
   comentario. **Criterio de severidad:** si un comentario del lab documenta
   un problema real que se resolvió ahí (NotReadableError, OOM, tap-shock,
   flash fantasma, toBlob vs toDataURL…) y e14 NO tiene esa defensa → es
   desviación (P0 si rompe en hardware real; P1 si degrada).
3. **Tabla de hallazgos** → append en `apps/digitalizador-e14/docs/worklog.md`
   (sección «AUDITORÍA DE COPIAS»), columnas: archivo e14 + líneas · referencia
   lab (archivo + L…) · qué hace e14 · qué hace el lab · veredicto (`FIEL` /
   `ADAPTACIÓN LEGÍTIMA` / `DESVIACIÓN`) · severidad · acción.
4. **Remediación** — toda `DESVIACIÓN` se corrige con copia verbatim del lab,
   encabezada por `// Fuente: apps/scanner-lab/<ruta> L<ini>–L<fin>` + el
   comentario original íntegro. Re-vestimiento permitido SOLO en
   colores/nombres e14 (verde `ok-tint`, estilo Precision Monitor, copy en
   español del dominio actas).
5. **Nada queda sin veredicto** — la tabla cubre el 100% de los bloques del
   checklist §4, incluidos los que salgan `FIEL`.

## §2 Hallazgos pre-auditados por QA externo (punto de partida)

### H1 — P0 · F-LENS v4 ausente (el bug visible: gran angular, no 50MP)

- **e14:** `ScanView.tsx` L516 «lab L996-1252, simplificado» — solo quedó la
  cascada `facingMode` (L539–558), la red de seguridad del lab.
- **Lab:** `CameraView.tsx` — sondas secuenciales + `chooseMainProbe` +
  fix zoom + telemetría.
- **Acción:** ejecutar el mapa de copia completo de **§12 de
  `SPEC-e14-fase-logica.md` Rev. 4** (7 bloques, L116–223 + L1095–1207).
- **Síntoma corregido:** cámara principal (50MP) en Android;
  `window.__cameraChoice.elegida` con label sin palabras de lente.

### H2 — P0 · F-SENSOR-PROFILER ausente (el SIGUIENTE error que iba a ver el autor)

- **e14:** `ScanView.tsx` L379 «DUAL PIPELINE (lab L645-681, **simplificado
  sin sensor-profiler**)» — `tomarFoto()` llama `capture.takePhoto()` CRUDO,
  sin tope. El bridge (`scanner-core-bridge.ts` L242/L374) manda esa foto
  directa a `processImage` sin downscale previo.
- **Por qué rompe EN SU TELÉFONO:** con H1 arreglado, la principal de 50MP
  dispara a ~8160×6144. El decode en canvas de una imagen así son ~200 MB de
  bitmap RGBA y el pipeline hace varias copias → en gama media/baja: freeze,
  `Canvas area` exceptions o crash de pestaña. El lab lo resolvió con 3 capas.
- **Lab (fuente):** `CameraView.tsx`
  - L61–67: imports del core (`profileSensor`, `getSensorSafeCap`,
    `buildCappedPhotoSettings`, `clampBlobToSafeCap`, tipo `SensorProfile`) —
    **el core YA exporta todo** (`packages/scanner-core/src/sensor-profiler.ts`):
    cero cambios en el core.
  - L256–~275: `downscaleImage(img, max)` — función de módulo del lab (canvas
    puro). **NO existe en el core → se COPIA** (regla de oro 6).
  - L440 + L449–453: `sensorProfileRef` + perfilado único del track al abrir
    el stream (`void profileSensor(track).then(...)`).
  - L645–681: `takePhotoBlob` COMPLETO — capa 1: `buildCappedPhotoSettings(profile)`
    en el disparo (el blob gigante jamás llega a decodificarse); retry sin
    settings si el hardware rechaza; carrera 8 s (error #29); capa 2:
    `clampBlobToSafeCap(blob, profile?.safeCapPx ?? getSensorSafeCap())`.
  - L574–589: en el dispatch, decode ÚNICO + capa 3:
    `downscaleImage(decoded, safeCapPx)` (tope por GAMA: 4032 alta / 3200
    media-baja) antes de entregar al pipeline.
- **Acción:** copiar los 5 bloques a `ScanView.tsx` (tomarFoto → reemplazo
  literal de takePhotoBlob; perfilado dentro del efecto de arranque, tras
  abrir el stream ganador). **La capa 3 (downscale al tope) se aplica en el
  ÚNICO punto de entrada del pipeline** — `dispararEscaneo()` de `ScanView.tsx`,
  que ya reciben CÁMARA (File) e IMPORTAR (File) — de modo que TAMBIÉN las
  fotos de galería de 12–48+ MP queden dentro del tope antes de tocar el
  bridge (el lab hace exactamente esto en su dispatch único L574–589: decode
  una vez → `downscaleImage(decoded, safeCapPx)` → seguir). El pipeline de
  e14 recibe la foto ya dentro del tope, sin importar la fuente.
- **QA específico:** con el teléfono 50MP del autor: disparo manual → la foto
  entra al análisis SIN freeze y el PDF sale correcto. En consola no hay
  `Canvas`/OOM. (H1+H2 juntos: la lente correcta Y la foto dentro del tope.)

### H3 — P1 · captureSmart: snapA debe existir ANTES del disparo (§5.4 del lab)

- **e14:** `ScanView.tsx` L444–465 — `tomarZsl()` → `await tomarFoto()` (puede
  colgar 8 s) → recién ahí `snapA = instantanea(); snapB = instantanea();`.
- **Lab:** L851–853 — `const snapA = snapshotVideo();` ANTES de
  `await takePhotoBlob()`: si takePhoto cuelga y cae, ya hay un candidato
  medido del momento real del tap; snapB va DESPUÉS de la foto (bracket).
- **Acción:** mover la toma de `snapA` antes del `await tomarFoto()`;
  en la rama de fallback el burst queda `[zsl, snapA, snapB]` como hoy (con
  snapA del instante correcto). Copiar el comentario §5.4 del lab.

### H4 — P1 · TORCH_HINT abreviado

- **e14:** `ScanView.tsx` L85 «TORCH_HINT del lab, abreviado».
- **Lab:** L119–127 — diagnóstico completo para el operador: navegador sin
  soporte (iPhone: Safari 17.4+; Chrome/Firefox iOS no exponen torch),
  WebView in-app (Instagram/WhatsApp), lente sin LED, y qué hacer.
- **Acción:** copiar verbatim (es copy de UX de campo — el operador electoral
  necesita el diagnóstico completo, no la versión corta).

### H5 — P2 · El picker de IMPORTAR rechaza HEIC (.heic/.heif)

- **e14:** `ScanView.tsx` L811 y L819 — `accept="image/*"` a secas.
- **Lab:** `CameraView.tsx` L1536 — `accept="image/*,.heic,.heif"`: en
  Android/Chrome los HEIC llegan con MIME vacío o raro y `image/*` a secas
  los deja FUERA del picker (el core ya convierte HEIC: F-HEIC en
  `image-processor.ts` L121–140, heic2any inline — heredado ✓; sin el
  accept, esa capacidad jamás se ejercita).
- **Acción:** añadir `,.heic,.heif` a ambos inputs (1 línea × 2). Copiar el
  guard `looksHeic`/mensaje de error del lab L937–957 si e14 no lo tiene.

### H6 — P3 · PWA instalable + offline (DECISIÓN DE ALCANCE — NO en este PR)

- El lab tiene PWA (manifest + Service Worker network-first + guía iOS
  «Añadir a inicio»). e14 NO la copió — y BIEN: no era parte de la fase
  lógica. Pero para operadores en zona con mala conexión es VALIOSO
  (abrir sin conexión, instalar como app).
- **Acción:** NO implementar en este PR. Registrar en `docs/ROADMAP.md` como
  candidato y preguntar al autor. Si el autor dice sí → spec aparte
  (SW + manifest + estrategias offline de la cola SIMULADA→real).

## §3 Adaptaciones LEGÍTIMAS (ya auditadas — NO «arreglar»)

Estas NO son desviaciones; tocarlas sería regresión:

| Zona | e14 | Por qué es legítima |
|------|-----|---------------------|
| Preview 1920×1080 ideal | ScanView L64, D27 | Decisión documentada (frames del video alimentan el pipeline en iOS); el lab usa 960×540 por su dual pipeline propio |
| Captura como `File` → bridge | captureSmart «adaptada» | Dominio e14 (1 acta = 1 captura, bridge asíncrono); la LÓGICA de selección de frame debe ser fiel (ver H3), el transporte puede diferir |
| Re-vestimiento Precision Monitor | colores `ok-tint`, copy español | Per spec §7; el veredicto `FIEL` es sobre lógica, no sobre estética |
| `esErrorPermiso` local | ScanView L534 | Equivalente exacto del lab `isPermError` L1049–1053 — reutilizar, no duplicar |

## §4 Checklist de verificación bloque a bloque (obligatorio, aun si «funciona»)

Marcar cada fila en la tabla del worklog con veredicto:

**ScanView ↔ lab `CameraView.tsx`:**

| Bloque | Lab | Nota de comparación |
|--------|-----|---------------------|
| Arranque de cámara | L996–1252 | H1 — cubierto por §12 |
| Perfilado del sensor | L440, L449–453, L256+ | H2 |
| takePhoto (blob) | L645–681 | H2 |
| captureSmart | L785–885 | H3 + verificar orden F-RES-PRIORITY y aviso honesto |
| Ring ZSL | L707–730 | máx 8, copia dedicada, liberación del expulsado YA (no GC), ventana 80–450 ms al recuperar |
| Flash F-FLASH v3 | L486–555 + L1404–1416 | verificado FIEL (getSettings + re-aplicación por stream); falta solo H4 |
| Ruta iOS del disparo | L902–925 | input capture="environment" + gesto de usuario |
| Aviso no-detección | L1386–1390 | onNoDetectTimeout → toast |
| Cooldown/notifyCaptured | L785–791 | 1500 ms + re-arme del loop |

**QuadEditor ↔ lab `EditorView.tsx`:** clampN (L127), loupeCenter (L135),
arrastre (L928–1049), 8 asas (L2005–2040), lupa 3× (L2087–2130) — primer
escaneo: puerto fiel (LITERAL declarado); confirmar en la tabla igualmente.

**image-utils ↔ lab `EditorView.tsx` L163–224:** `rotateProcessedDataUrl` —
copia literal verificada; confirmar.

**Bridge/analyzing:** `scanner-core-bridge.ts` — verificar que el pipeline no
decodifique la misma foto N veces sin necesidad (lección decode único del lab,
L574–578) y que la foto llega YA dentro del tope (H2 capa 3).

## §5 Cobertura de `novedades.md` (v5.0.0 → v6.3 del lab) — veredicto por novedad

Auditoría de la lista oficial de novedades del lab contra e14. El veredicto
distingue: **COPIADO** (el agente lo portó), **HEREDADO** (vive en el core o
en assets públicos idénticos — e14 lo recibe gratis), **FALTA** (hallazgo
H#, remediar en este PR), **N/A** (no aplica al dominio/diseño de e14) o
**DECISIÓN** (pendiente del autor).

| Novedad (novedades.md) | Dónde vive | Veredicto e14 |
|---|---|---|
| Perspectiva mejorada: cascada multi-umbral | worker público | **HEREDADO** — `public/scanner/detection-worker.js` de e14 es md5-idéntico al lab (`21c77ac2…`) |
| Warp a resolución del sensor (4032) | core `processImage` | **HEREDADO** (y H2 añade el tope seguro por gama) |
| Rotación instantánea ~0,2 s | copiada a e14 | **COPIADO** — `image-utils.ts`, literal (verificado) |
| Importación robusta 12–48 MP + EXIF | core `fileToCaptureDataUrl` (decode nativo + EXIF L194–225) | **HEREDADO** decode · **FALTA tope** → **H2 ampliado** (capa 3 en `dispararEscaneo`, cubre IMPORTAR) |
| Soporte HEIC completo (libheif) | core F-HEIC `image-processor.ts` L121–140 (heic2any inline, sin .wasm) | **HEREDADO** conversión · **FALTA picker** → **H5** (`accept` L811/L819) |
| Benchmark del dispositivo (4032/3200 por gama) | core exports + glue del lab | **FALTA glue** → **H2** (es la misma pieza: profiler + topes) · La UI de Ajustes = **N/A** (e14 no tiene pantalla Ajustes) |
| F-RES-PRIORITY (foto del sensor siempre gana) | e14 captureSmart | **COPIADO** ✓ (+ orden snapA en **H3**) |
| Procesado mínimo 3200 px en gama baja | sensor-profiler | **FALTA** → **H2** (misma pieza) |
| F-DEFER-CROP (editor al instante) | lab | **N/A** — e14 usa la pantalla ANALIZANDO del diseño aprobado; el pico de espera ya lo cubre esa pantalla |
| Dual Pipeline (preview ligero + foto sensor) | lab (960×540) / e14 (1920×1080) | **COPIADO con decisión D27** — legítima (§3) |
| Sensor Profiler (topes 48/108 MP) | core exports + lab glue | **FALTA** → **H2 (P0)** — el crash que el autor iba a ver |
| F-STAB (estabilizador de quietud) | core `frame-loop.ts` L84–165 (`MotionStabilizer`) | **HEREDADO** ✓ (verificar en QA: AUTO no dispara moviendo el teléfono) |
| F-ZSL (anti tap-shock) | e14 ScanView | **COPIADO** ✓ (verificado FIEL) |
| F-PERF (throttle adaptativo 15→5 FPS) | core `frame-loop.ts` L87–105 | **HEREDADO** ✓ |
| F-TEXT-CLEAN + filtros (B/N adaptativo default) | lab (worker + fallback) | **N/A** — e14 no tiene UI de filtros (diseño aprobado); candidato futuro si el autor lo quiere |
| PWA instalable + SW network-first + offline | lab (PwaRegister + SW) | **DECISIÓN** → **H6** (fuera de este PR) |
| viewport-fit=cover + dvh | e14 `layout.tsx` L32 | **COPIADO** ✓ (mismo patrón que el lab) |
| OCR Tesseract local (spa) + gate | core `ocr.ts` | **HEREDADO** ✓ (gate ILEGIBLE ya cableado — DoD fase lógica) |
| Torch con reintento y verificación | e14 ScanView | **COPIADO** ✓ (verificado FIEL; solo falta H4 hint) |

**Conclusión de la cobertura:** las novedades que viven en el CORE o en el
worker público llegaron enteras a e14 (cascada, HEIC, EXIF, F-STAB, F-PERF,
OCR, warp). Las que eran GLUE del componente del lab se copiaron casi todas
bien (ZSL, torch, rotación, F-RES-PRIORITY). Las ausentes son exactamente
las 2 piezas de glue más críticas del arranque/captura (H1 cámara + H2
tope de sensor) y 2 cosméticas de bajo riesgo (H3, H4, H5).

## §6 QA final y protocolo

1. Orden de ejecución: §1 pasos 1–3 (auditoría + tabla) → remediación H1 →
   H2 → H3 → H4 → H5 → desviaciones nuevas que surgan → §6 QA.
2. QA en móvil real del autor (el mismo del bug):
   - CÁMARA abre la principal 50MP (`window.__cameraChoice.elegida`).
   - Disparo manual + AUTO: foto entra al análisis sin freeze; PDF correcto.
   - Flash funciona en la principal; hint completo al fallar.
   - RECORTAR: 8 asas + lupa 3× + arrastre fluido (táctil).
   - ROTAR 90° hornea y el PDF sale girado.
   - **Regresión SIMULACIÓN:** flujo dorado idéntico (no pasa por este código).
   - IMPORTAR: una foto de galería grande entra al análisis sin freeze
     (capa 3 de H2 cubre IMPORTAR); un .heic SÍ aparece en el picker (H5)
     y se convierte solo.
   - Desktop: sondas encuentran 1 cámara → gana; sin permiso → cascada → SIM.
3. `bun install --frozen-lockfile` ✓ · `bun run lint:e14` ✓ · `bun run e14:check` ✓.
4. Protocolo: rama **`fix/e14-fidelidad-lab`** (continúa la de §12) → PR a
   `main` con commits separados: `audit(e14): tabla de fidelidad vs lab`,
   `fix(e14): F-LENS v4 …` (§12), `fix(e14): F-SENSOR-PROFILER …` (H2),
   `fix(e14): captureSmart snapA + TORCH_HINT + accept HEIC` (H3+H4+H5).
5. Docs: worklog (tabla AUDITORÍA + entradas por commit) · `DECISIONS.md`:
   **D33** (F-LENS, ver §12 fase lógica) + **D34** — «F-SENSOR-PROFILER
   portado del lab (3 capas de tope: photoSettings, clampBlob, downscale por
   gama); sin tope, una foto de 50MP revienta el decode en gama media/baja».
6. Deploy Pages → re-verificación del checklist 2 en producción.
