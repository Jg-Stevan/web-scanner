# SPEC — FASE LÓGICA: conectar digitalizador-e14 a @jg-stevan/scanner-core

**Repo:** `web-scanner` (monorepo) · **Rama:** `feat/e14-fase-logica` → PR a `main`
**Base:** `main` actual (gráfica v2 mergeada en PR #4 + Pages dual en curso)
**Protocolo:** AGENTS.md vigente — 1 fase = 1 commit = 1 entrada en
`apps/digitalizador-e14/docs/worklog.md` (formato exacto de AGENTS.md).
**Rev. 2:** §7.5 reescrito — el editor de recorte ya NO se reconstruye desde
cero: se **COPIA el subsistema CROP** de
`apps/scanner-lab/src/components/scanner/EditorView.tsx` y se re-veste con la
estética Precision Monitor (ver mapa de copia en §7.5).
**Rev. 3:** §7 ScanView ampliado — la interfaz de escaneo del lab se copia
COMPLETA a e14 (pill "IA · AUTO", auto-captura con gate del core — default
OFF, D22 —, flash F-FLASH v3, Zero Shutter Lag, ruta iOS del disparo,
destello de captura, aviso no-detección). Solo quedan fuera "Revisar N" y
el contador multi-página (dominio: 1 acta = 1 captura).

---

## §0 Objetivo

Hoy el E-14 funciona 100% con `MockBridge` (datos inventados). Esta fase conecta el
motor REAL del monorepo — `@jg-stevan/scanner-core` (cámara, detección de bordes
OpenCV, recorte/realce, calidad, OCR, PDF) — **sin romper el diseño ni el flujo
aprobado**. El "modo simulación" NO se elimina: pasa a ser 1 de 3 fuentes de
captura, porque es el demo seguro cuando no hay cámara o acta a mano.

### Qué queda REAL y qué sigue SIMULADO (decisión de alcance — no negociable)

| Capa                                    | Estado     | Detalle                                        |
| --------------------------------------- | ---------- | ---------------------------------------------- |
| Cámara en vivo / importar archivo       | **REAL**   | `CameraFrameLoop`, `fileToCaptureDataUrl`      |
| Detección de bordes + recorte + realce  | **REAL**   | worker OpenCV del core (fallback canvas propio)|
| Score de calidad 0–10                   | **REAL**   | métricas del core mapeadas (§4)                |
| Legibilidad (rechazo ILEGIBLE)          | **REAL**   | `requestOcr` + gate de dominio (§4.2)          |
| Foto del acta en REVISIÓN               | **REAL**   | imagen procesada por el core                   |
| Export PDF del acta                     | **REAL**   | `buildDocPdf` + `downloadBlob`                 |
| Editor de recorte (quad manual)         | **REAL**   | `processImage(..., { manual: true })`          |
| Votos (101:25 …) y estado de firmas     | SIMULADO   | OCR de dígitos manuscritos = otro proyecto     |
| Ubicación (DEP/MUN/ZONA/PUESTO)         | SIMULADO   | seed actual; futuro: QR/OCR de cabecera        |
| Envío a "servidor", cola offline, hash  | SIMULADO   | no hay backend; ya documentado                 |

Todo lo simulado queda registrado en `docs/DECISIONS.md` y, donde la UI lo
muestre, no se presenta como dato extraído.

## §1 Reglas de oro

1. **`packages/scanner-core` NO se modifica.** Se consume. Si falta algo, se
   calcula en la app. Cambios al core = tarea aparte (exports aditivos).
2. **Cero regresión visual/funcional:** el modo SIMULACIÓN debe seguir operando
   EXACTAMENTE como hoy (chips ÓPTIMA/ADVERTENCIA/RECHAZADA, desbloqueo 2º
   intento, toasts). Es la red de seguridad del demo.
3. **Estética Precision Monitor intacta:** los cambios son de cableado
   (async, `<video>`, progreso), no de layout. Elementos nuevos (toggle de
   fuente, HUD de score, botón PDF) usan las primitivas existentes
   (`Chip`, `ToolbarBtn`, `PrimaryBtn`, `label-caps`, `font-data`).
4. **e14 NO usa `useScannerStore` del core** (D18): el store del core es del
   laboratorio multi-documento. e14 solo consume funciones puras, clases y
   tipos; su estado sigue siendo `useE14Store`.
5. Sirviendo bajo `/web-scanner/` (Pages), el worker y el OCR deben funcionar:
   el core resuelve sus assets vía `process.env.NEXT_PUBLIC_BASE_PATH`.

## §2 Línea base (lo que existe hoy)

- `src/lib/e14/bridge.ts`: `MockBridge` **síncrono** — `escanearActa(o): Acta`
  genera acta al instante (scores de listas, firma 2 según status, rechazo
  ILEGIBLE 80% / GENERICO 20%, regla 2º intento ≥8).
- `src/lib/e14/store.ts`: `dispararEscaneo()` síncrono → vista `analizando` →
  `AnalyzingView` temporiza ~2.5 s → `analisisCompletado()` resuelve.
- `ScanView`: marco, disparo 72px, chips SIMULACIÓN (ALEATORIO/ÓPTIMA/
  ADVERTENCIA/RECHAZADA), botón PASAR A OFFLINE. `IMPORTAR IMAGEN` es decorativo.
- `Acta` sin foto; `ActaDocument` dibuja el papel sintético del diseño.

## §3 Contrato nuevo — Bridge v2 (D12)

### 3.1 Tipos (en `src/lib/e14/types.ts`, aditivos)

```ts
export type FuenteCaptura = "SIMULACION" | "CAMARA" | "ARCHIVO";

export type EtapaAnalisis =
  | "DETECTANDO" | "RECORTANDO" | "REALZANDO" | "CALIDAD" | "OCR";

export interface ProgresoAnalisis {
  etapa: EtapaAnalisis;
  progreso: number; // 0..1 dentro de la etapa
}

// Acta gana campos OPCIONALES (compatible con seed y mocks existentes):
export interface Acta {
  // …todo lo actual…
  fuente?: FuenteCaptura;
  fotoProcesada?: string;  // data URL warp+realce (la evidencia real)
  fotoOriginal?: string;   // data URL cruda del frame/archivo
  ocrTexto?: string;       // texto detectado (debug/verificación)
  metricas?: { sharpness: number; brightness: number; contrast: number }; // 0-100
  motor?: "worker" | "canvas" | "mock";
  quadDetectado?: Quad; // esquinas de la detección automática (§5 paso 1)
  rotation?: number; // 0|90|180|270 — horneada en fotoProcesada
}
```

### 3.2 Interfaz (en `bridge.ts`, reemplaza la actual)

```ts
export interface OpcionesEscaneo {
  objetivo: PaginaObjetivo | null;
  forzado: Forzado;                    // solo aplica en SIMULACION
  intento: number;
  maxIntentos: number;
  fuente: FuenteCaptura;
  archivo?: File;                      // fuente ARCHIVO
  frameActual?: HTMLVideoElement | null; // fuente CAMARA
  onProgreso?: (p: ProgresoAnalisis) => void;
}

export interface E14Bridge {
  escanearActa(o: OpcionesEscaneo): Promise<Acta>;        // AHORA async
  exportarPdf(acta: Acta): Promise<void>;                  // §6
  horaEnvio(): string;
  horaHistorial(): string;
}
```

### 3.3 Enrutamiento (D17) — `get-bridge.ts` sigue siendo el switch

No hay "dos bridges": hay un **CompositeBridge** que enruta por `fuente`:

```ts
// get-bridge.ts (queda casi igual — el punto único de intercambio)
export function getBridge(): E14Bridge {
  if (!instancia) instancia = new CompositeBridge();
  return instancia;
}
```

- `fuente === "SIMULACION"` → delega en `MockBridge` (código actual intacto,
  envuelto en Promise).
- `fuente === "CAMARA" | "ARCHIVO"` → `RealCoreBridge` (§5).

Las vistas NUNCA importan bridges: siguen usando el store, y el store usa
`getBridge()`. Esto preserva la promesa original: mañana se cambia de motor
tocando este archivo.

## §4 Score real → estado (mapeo, D13 + D14)

### 4.1 Número (0–10)

El core da `evaluateQuality(img) → PageQuality { level, sharpness, brightness,
contrast }` (todas 0–100, `level: "excellent"|"good"|"fair"|"poor"`). Mapeo
ponderado, espejo de `WEIGHTS` del core (sharpness .4, exposure .3, stability .3;
en página estática el sustituto de "stability" es "contrast"):

```ts
const bruto = (q.sharpness * 0.4 + q.brightness * 0.3 + q.contrast * 0.3) / 10;
let score10 = Math.round(bruto * 10) / 10;          // 1 decimal, como hoy
if (q.level === "fair")  score10 = Math.min(score10, 7.9);  // techo ADVERTENCIA
if (q.level === "poor")  score10 = Math.min(score10, 6.4);  // techo RECHAZADA
```

`statusDeScore()` de `types.ts` NO cambia: ≥8 ÓPTIMA · 6.5–7.9 ADVERTENCIA ·
<6.5 RECHAZADA. En SIMULACIÓN todo sigue igual que hoy.

### 4.2 Gate de legibilidad (D14) — el OCR manda sobre el score

Regla de dominio E-14: un acta con la cabecera ilegible se RECHAZA aunque la
foto esté perfecta. Tras el OCR (`requestOcr(dataUrl, onProgreso)`):

```ts
const texto = await requestOcr(fotoProcesada, (p) => onProgreso({ etapa: "OCR", progreso: p }));
const legible = ocrTextIsValid(texto) && /E\s*-\s*14|REGISTRADURIA|REGISTRADURÍA/i.test(texto);
```

- `!legible` → `status = "RECHAZADA"`, `rechazo = { tipo: "ILEGIBLE", detalle:
  "CÓDIGO DE BARRAS Y CABECERA NO DETECTADOS" }` (calca la rechazada v2), y el
  score mostrado queda el real (el estado manda).
- `legible` → score/estado del §4.1, `ocrTexto` guardado en el Acta.
- OCR con progreso 0→1 alimenta la etapa OCR de ANALIZANDO (el Tesseract local
  descarga WASM la 1ª vez: el progreso tapa esa espera).

## §5 `RealCoreBridge` — pipeline por fuente (archivo nuevo `scanner-core-bridge.ts`)

```
ARCHIVO:  fileToCaptureDataUrl(file)  →  dataUrl crudo
CAMARA:   frame del <video> a canvas (resolución del stream) → dataUrl crudo
──────┬──────────────────────────────────────────────────────────────
 1.   detectDocumentEdges(crudo)                    → Quad   [DETECTANDO]
      · guardar el quad en acta.quadDetectado (inicio del editor §7.5)
      · sin quad → RECHAZADA ILEGIBLE inmediata (score bajo, motor real)
 2.   processImage(crudo, quad, "original")         → procesada [RECORTANDO/REALZANDO]
      · `precision.engine` → acta.motor ("worker"|"canvas")
 3.   evaluateQuality(crudo)                        → PageQuality [CALIDAD]
 4.   requestOcr(procesada, onProgreso)             → texto [OCR]
 5.   mapeo §4 → status/score/rechazo → Acta completa
```

- `fotoOriginal`/`fotoProcesada`/`metricas`/`ocrTexto`/`motor` se rellenan.
- Ubicación/tipo/página: del `objetivo` (mesa en curso) + seed de `seed.ts`
  (sigue simulado, D-listado). Votos/firmas: del seed/mock como hoy.
- Timeout de seguridad global: si el pipeline supera 15 s (worker colgado en
  un dispositivo lento), rechazar con ILEGIBLE + toast crit, nunca congelar la UI.

## §6 Export PDF (valor real, usa el core tal cual)

Adaptador local (en `scanner-core-bridge.ts` o `pdf-adapter.ts`):

```ts
import { buildDocPdf, downloadBlob, sanitizeFileName } from "@jg-stevan/scanner-core/pdf-export";
import type { ScanDocument, PageFilter } from "@jg-stevan/scanner-core/types";

function actaAScanDocument(acta: Acta): ScanDocument {
  const t = Date.now();
  return {
    id: acta.id, title: `${acta.titulo} — MESA ${acta.ubicacion.mesa}`,
    favorite: false, createdAt: t, updatedAt: t,
    pages: [{
      id: `${acta.id}-p1`,
      original: acta.fotoOriginal ?? acta.fotoProcesada!,
      processed: acta.fotoProcesada!, thumbnail: acta.fotoProcesada!,
      filter: "original" as PageFilter,
      quad: [[0,0],[1,0],[1,1],[0,1]], rotation: 0,
    }],
  };
}
// exportarPdf → buildDocPdf(actaAScanDocument(a), "standard") → downloadBlob(pdf.blob, sanitizeFileName(...))
```

(`buildDocPdf` solo lee `pages[i].processed` y `filter`; los demás campos son
relleno compatible con la interfaz congelada del core.)

**UI:** en REVISIÓN, cuando `status === "ENVIADA"` y el acta es REAL
(`fuente !== "SIMULACION"`), añadir `ToolbarBtn`/CTA "EXPORTAR PDF" junto a
SEGUIR ESCANEANDO → toast ok "PDF GENERADO". En SIMULACIÓN el botón se oculta
(no hay foto real que exportar).

## §7 Cambios por vista (cableado, no rediseño)

### ScanView
- Chips de FUENTE arriba del panel actual: `SIMULACIÓN · CÁMARA · IMPORTAR`
  (segmented con `Chip`; la activa en verde tint).
- Los chips de resultado (ÓPTIMA/ADVERTENCIA/RECHAZADA) SOLO visibles en
  SIMULACIÓN. En CÁMARA, en su lugar: HUD con score vivo del frame
  (`CameraFrameLoop.onFrame → telemetry.score.total`, formato `font-data`:
  "CALIDAD 82%") y estado de detección ("ACTA DETECTADA / NO DETECTADA").
- **Estado "BUSCANDO ACTA…"** (referencia: escáner de Google Drive; copy del
  lab `apps/scanner-lab/src/components/scanner/CameraView.tsx` L1737–1753):
  pill superior centrada con spinner + "BUSCANDO ACTA…" mientras
  `cámara viva && telemetry.corners === null` (estética Precision Monitor:
  `bg-black/60 backdrop-blur-sm rounded-full`, spinner verde `text-ok-tint`,
  texto blanco 12px). Desaparece al detectar (`corners !== null`) y el HUD
  pasa a "ACTA DETECTADA". El flag sale gratis:
  `searching = t.corners === null` (mismo mecanismo del lab, L428/L1377).
- **Quad en vivo sobre el preview** (copy del lab `CameraView.tsx`
  L1693–1711): overlay SVG dibujando `telemetry.corners` (`Quad | null`,
  ya viene del frame-loop del core L51) en verde `ok-tint` con transición
  CSS ~150 ms — el core throttlea la detección (~80–450 ms) para que el
  marco no parpadee. En SIMULACIÓN no hay overlay (no hay video).
- **Pill "IA · AUTO"** (copy del lab `CameraView.tsx` L1553–1566): pill
  compacta junto al HUD con punto pulsante mientras la IA rastrea (en e14
  el punto es verde `ok-tint`, no azul) + label del modo de disparo
  (AUTO/MANUAL).
- **Auto-captura — toggle "AUTO"** (copy del lab L394/L396 y L1576–1590;
  el gate viene del core, NO se reescribe): botón en el visor que arma el
  disparo automático (amarillo en el lab → verde `ok-tint` en e14 cuando
  está armado). El core ya resuelve el gate completo: `CameraFrameLoop`
  dispara `onTrigger` solo con k-de-n de score sostenido > SHUTTER_SCORE,
  cooldown 1500 ms, re-arme tras re-encuadre y bloqueo por movimiento del
  dispositivo (`stabilizer.isDeviceStable(280)` — frame-loop L375–400). El
  componente solo filtra `if (!auto) return; if (processing) return;`
  (lab L1380–1385) y muestra overlay "armado" (lab L1802). **Default en
  e14: OFF (D22)** — los intentos del acta son finitos (máx. 2) y un
  auto-disparo errado consume intento; el operador decide si arma AUTO.
  El anillo del disparo manual sigue: verde si `score.total > 0.8`.
- **Aviso "no detecto nada"** (copy del lab L1386–1390):
  `onNoDetectTimeout` del core (frame-loop L70/L329) → toast warn e14:
  "NO DETECTO EL ACTA · ACÉRCALA AL ENCUADRE".
- **Flash real — F-FLASH v3 del lab** (copy de `CameraView.tsx` L486–555 y
  L1404–1416): botón SIEMPRE activo con cámara real; la verdad se
  descubre al pulsar — `applyConstraints({ torch: true })` + verificar
  `getSettings().torch` después (el lab ya resolvió los bugs reales:
  "flash fantasma" con LED apagado en Android, iPhone sin
  `getCapabilities()`, re-aplicar torch tras re-arranque del stream —
  `flashRef`). Sin soporte → toast informativo (jamás botón muerto). En
  SIMULACIÓN → hint "la linterna necesita cámara real".
- **Zero Shutter Lag — best-shot ring** (copy del lab L779–805 y
  L1395–1400): el disparo manual NO usa el frame del instante del tap —
  toma el mejor frame (lapVar) del buffer de los 80–450 ms ANTERIORES
  (anti tap-shock: el impacto del dedo mueve el teléfono y borra texto).
  Ring de canvases liberado al desmontar (RAM, lab L1395–1400). Cooldown
  anti doble-disparo 1500 ms (§5.2 del lab).
- **Ruta iOS del disparo (HQ-iOS §5.2 del lab)** (copy de `onShutter`
  L902–925): con stream + ImageCapture (Chrome/Android) → `captureSmart()`
  (foto full-res con revalidación de burst); con stream SIN ImageCapture
  (Safari/iOS) → cámara NATIVA del sistema vía
  `<input type="file" capture="environment">` — el click del shutter ES el
  gesto de usuario que iOS exige, y la foto entra al mismo pipeline (como
  ARCHIVO, L2). En SIMULACIÓN → demo como hoy.
- **Destello blanco breve al capturar** (copy del lab L569): feedback de
  obturador ~120 ms (`flashKey`), estética e14.
- **Fuera de alcance del ESCANEAR:** la píldora "Revisar N" + contador
  multi-página (lab/Drive) NO aplican: e14 es 1 acta = 1 captura →
  análisis inmediato con gate de intentos; no existe cola de páginas
  pre-análisis. Todo lo demás de la interfaz de escaneo del lab SÍ se
  copia (con vestimenta Precision Monitor).
- `IMPORTAR IMAGEN` pasa a real: `<input type="file" accept="image/*">`
  oculto + label; HEIC soportado por el core (`fileToCaptureDataUrl`).
- CÁMARA: `<video playsInline muted>` dentro del marco existente (mismos
  corner brackets), `facingMode: "environment"`, limpiar stream en unmount y
  al cambiar de vista. Permiso denegado/sin HTTPS → toast warn + volver a
  SIMULACIÓN automáticamente.
- Disparo: POR PLATAFORMA según la ruta iOS de arriba (no es el frame
  crudo del instante del tap: usa ZSL o la cámara nativa).

### AnalyzingView
- Etapas canónicas ahora vienen de `onProgreso` (store: `progresoAnalisis`).
  Mapeo a la UI existente: DETECTANDO→barra 1, RECORTANDO→2, REALZANDO→3,
  CALIDAD+OCR→4; % central = progreso ponderado (pesos libres, p. ej.
  0.15/0.15/0.2/0.15/0.35 — el OCR domina). Latencia del beacon = ms reales.
- Piso escénico 1.2 s (D16): si el pipeline termina antes, dejar que la
  animación complete — evita el "flash" y mantiene el feeling del diseño.

### ReviewView
- Toolbar +1 botón "VER FOTO": alterna papel sintético ↔ `fotoProcesada`
  (misma caja, object-contain). Por defecto papel (diseño aprobado); si el
  acta es REAL, badge pequeño "FOTO REAL DISPONIBLE".
- CTA "EXPORTAR PDF" según §6.
- **Toolbar REAL (solo actas con `fuente !== "SIMULACION"`):**
  - "RECORTAR" → abre el editor de quad (§7.5) sobre `fotoOriginal`.
  - "ROTAR 90°" → helper copiado del lab `rotateProcessedDataUrl`
    (EditorView L189, canvas puro, sin dependencias) girando `fotoProcesada`
    90° y actualizando el acta — la rotación queda horneada para el PDF.
    Es rotación determinista, NO re-ejecuta warp ni detección (igual que hace
    el lab en L1095). En SIMULACIÓN conserva su comportamiento actual de
    rotar el papel.
  - "PANTALLA COMPLETA" → visor modal con `fotoProcesada` object-contain
    (tap/Esc cierra). En SIMULACIÓN sigue como hoy (decorativo).

### §7.5 Editor de recorte — COPIAR el subsistema del lab, re-vestirlo (D19, rev. 2)

El lab ya resolvió el editor completo en
`apps/scanner-lab/src/components/scanner/EditorView.tsx` (2,554 líneas: 8
puntos arrastrables, lupa 3×, tween de auto-detección). **No se re-inventa:
se COPIA el subsistema CROP y se re-veste con la estética Precision
Monitor.** PERO no se copia el archivo entero: ~1,900 líneas no aplican al
modelo de e14 (modo DOC multi-página, zoom F-ZOOM 1×–6×, sheet OCR, sheet de
filtros, carrusel de miniaturas) y arrastra dependencias que e14 NO tiene
(framer-motion, vaul, sonner — package.json de e14: solo
next/react/zustand).

**Mapa de copia** (fuente → destino `src/components/e14/QuadEditor.tsx`):

| Pieza fuente (EditorView.tsx, línea aprox.) | Acción | Adaptación en e14 |
| --- | --- | --- |
| `clampN` (L127), `loupeCenterAt` (L135), `quadsClose` (L143) | COPIAR literal | ninguna — funciones puras |
| Estado del editor: `quad`, `drag`, `loupe` (~L310–420, parte crop) | COPIAR | `mode` desaparece: lo maneja ReviewView con `editando: boolean` |
| `pointerToNormalized`, `onStagePointerDown`, `onHandleDown`, `endDrag` (~L950–1050) | COPIAR literal | ninguna — React puro, sin dependencias |
| `updateLoupe` (~L957) | COPIAR | ninguna |
| JSX de asas: 4 esquinas + 4 puntos medios (~L2005–2040) | COPIAR estructura | re-vestir: `#007AFF`/blanco iOS → verde `#00c853` + tokens e14 (`border-ok-tint`, `bg-surface-1`, `font-data`) |
| Lupa 3× (~L2087–2130) | COPIAR | re-vestir al tema |
| `rotateProcessedDataUrl` (L189) | COPIAR | ninguna — canvas puro |
| Flujo enter/apply/cancel (L1148–1196) | COPIAR el patrón | `APLICAR` llama `aplicarRecorte(quad)` del store e14 (no al store del core) |
| Tween de auto-detección (framer-motion, L39) | REEMPLAZAR | transición CSS ~280 ms — e14 NO agrega framer-motion |
| Sheet filtros (vaul), zoom 1×–6×, OCR, modo DOC, carrusel | NO COPIAR | fuera de alcance del modelo de 1 acta |

**Reglas duras de la copia:**

- Prohibido `import { useScannerStore }` (D18): el editor es puro — recibe
  `fotoOriginal`, `quadInicial` y `onAplicar(quad)` por props; ReviewView lo
  monta con estado `editando: boolean`. El store expone
  `aplicarRecorte(quad: Quad)` con loading en el botón APLICAR.
- Con la copia, las asas de punto medio y la lupa 3× **ENTRAN en v1** (se
  recortaban al construir de cero por costo; ahora son copy-paste ya
  probadas en táctil real).
- Overlay a pantalla completa sobre `fotoOriginal`; quad inicial =
  `acta.quadDetectado` (o `defaultQuad()` del core si no hubo detección).
- Coordenadas en fracciones del contenedor mapeadas a píxeles de la imagen
  original; decodificar UNA vez con `loadImage` (regla del core: evitar
  re-decodes de 12 MP).
- "CANCELAR" descarta (sin tocar el acta) · "APLICAR" →
  `processImage(fotoOriginal, quadManual, "original", rotation, { manual: true })`
  (F5-MANUAL del core: sin refine, respeta el quad al píxel) → re-evalúa
  `evaluateQuality` + re-corre el gate OCR (§4.2) → actualiza
  `score`/`status`/`rechazo`/`fotoProcesada` del acta y cierra con toast.
- Reglas de rescate (D20): recortar NO consume intento (no es captura
  nueva). Si el rescate deja el acta en ADVERTENCIA u ÓPTIMA, se ofrecen los
  CTAs de envío manual (como advertencia) — sin auto-envío D4 para evitar
  semánticas de doble transmisión. Si sigue RECHAZADA, todo queda igual.
- Presupuesto: ~400–500 líneas netas en `QuadEditor.tsx` (vs ~700+
  escribiéndolo de cero) y con menos riesgo: la lógica de arrastre del lab ya
  pasó QA real en dispositivos táctiles.

### store.ts
- `dispararEscaneo(intento?)` → async: set vista `analizando` →
  `await getBridge().escanearActa({...})` con `onProgreso` → set `actaActual`,
  `progresoAnalisis` y resolver con la MISMA lógica de hoy
  (`analisisCompletado` se conserva tal cual: auto-envío D4, rescaneos,
  toasts). `fuente` y `archivo`/`frame` pasan por el store (set desde la vista).
- `repetirFoto` y `enviarRevisionHumana` no cambian (reusan dispararEscaneo).
- Manejo de error del pipeline: try/catch → toast crit "ERROR DE PROCESADO" +
  volver a `escanear` (nunca quedar en analizando).

## §8 Fases de implementación (1 commit + worklog por fase)

- **L0 — Andamiaje (sin comportamiento):**
  - `apps/digitalizador-e14/package.json`: + `"@jg-stevan/scanner-core": "workspace:*"`.
  - `next.config.ts`: + `transpilePackages: ["@jg-stevan/scanner-core"]`
    (**CRÍTICO**: el core sirve TS crudo; sin esto el build falla).
  - Copiar de `apps/scanner-lab/public/` → `apps/digitalizador-e14/public/`:
    `scanner/detection-worker.js`, `vendor/opencv-4.5.5.js`,
    `vendor/opencv-4.5.5-core.js` (mismos bytes, sin forks).
  - Smoke: import de `evaluateQuality`/`processImage` compila (`e14:check`).
- **L1 — Contrato async (mock intacto):** tipos §3, CompositeBridge, store
  async + `progresoAnalisis`, AnalyzingView por eventos, SIMULACIÓN delega en
  el mock actual envuelto en Promise. Regresión: flujo dorado idéntico.
- **L2 — Fuente ARCHIVO real:** pipeline §5 (sin cámara), mapeo §4, gate
  ILEGIBLE, `Acta` extendida, ReviewView "VER FOTO". Probar con foto de un
  acta/papel impreso.
- **L3 — Fuente CÁMARA real + interfaz de escaneo del lab COMPLETA:**
  video + `CameraFrameLoop` + HUD + pill "BUSCANDO ACTA…" + quad en vivo +
  pill "IA · AUTO" + toggle auto-captura (default OFF, D22) + flash
  F-FLASH + ZSL best-shot + ruta iOS del disparo + destello de captura
  (todo según §7 ScanView, copiado del lab `CameraView.tsx`) + fallbacks
  de permiso. Probar en móvil (HTTPS de Pages) y en desktop.
- **L4 — EXPORTAR PDF:** adaptador §6 + CTA + toasts.
- **L5 — Editor de recorte (Recortar/Rotar/Pantalla completa REALES):**
  `QuadEditor.tsx` según §7.5 — COPIANDO el subsistema CROP de
  `apps/scanner-lab/src/components/scanner/EditorView.tsx` con el mapa de
  copia (8 asas + lupa 3×) y re-vestido Precision Monitor. Wiring del
  toolbar de ReviewView + reglas de rescate; ROTAR usa el helper copiado
  `rotateProcessedDataUrl`. En SIMULACIÓN no aparecen editor ni visor (no hay
  foto real); ROTAR conserva su rotación de papel actual.
- **L6 — (opcional) Persistencia:** guardar actas (metadata en localStorage,
  fotos en IndexedDB ~40 líneas sin dependencias) para sobrevivir recargas.
  Si se hace: botón discreto "REINICIAR JORNADA" (limpiar estado) en RESUMEN.
- **L7 — (opcional) Cámara sintética en SIMULACIÓN:** `SyntheticCamera` del
  core (genera documento de prueba 1920×2560) para que el demo de Pages tenga
  "cámara" en desktop. Extra, no bloquea nada.

## §9 Riesgos y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| iOS/Safari: getUserMedia exige gesto + HTTPS | Disparo siempre manual; fallback automático a SIMULACIÓN con toast |
| Worker OpenCV pesa y tarda | `warmUpScannerWorker()` al montar ScanView; el core ya tiene fallback canvas (`precision.engine`) |
| Tesseract descarga WASM la 1ª vez | onProgress en etapa OCR + caché del navegador |
| Fotos 12 MP en canvas viejo | `maxLongSide` por defecto del core (4032) + `getMaxProcessedLongSide()` si hace falta |
| Worker colgado en gama baja | Timeout global 15 s → rechazo controlado, nunca UI congelada |
| Regresión del demo (lo peor) | SIMULACIÓN invulnerable: mismo MockBridge de hoy; QA de regresión en cada fase |
| Editor de quad en táctil pequeño | Lógica de arrastre COPIADA del lab (ya probada en táctil real); asas ≥44px y hit-area como en el origen; probar en móvil de todas formas |

## §10 Definition of Done (checklist final)

1. `bun install --frozen-lockfile` ✓ · `bun run lint:e14` ✓ · `bun run e14:check` ✓
2. SIMULACIÓN: flujo dorado completo idéntico al de hoy (regresión cero).
3. IMPORTAR: foto real de papel → ANALIZANDO con etapas reales → REVISIÓN con
   "VER FOTO" mostrando la imagen procesada del core → score coherente con la
   calidad → papel borroso da RECHAZADA/ADVERTENCIA, papel nítido da ≥8.
4. Gate ILEGIBLE: foto nítida sin cabecera E-14 → RECHAZADA ILEGIBLE (v2).
5. CÁMARA en móvil: preview en el marco, HUD de calidad, pill "BUSCANDO
   ACTA…" + quad en vivo verde, pill "IA · AUTO", flash real, disparo con
   destello; con AUTO armado dispara solo con acta quieta y nítida; en
   iPhone el shutter abre la cámara nativa; mismo pipeline.
6. EXPORTAR PDF descarga un PDF válido con la foto del acta.
7. EDITOR: acta RECHAZADA por recorte malo → RECORTAR → ajustar esquinas
   (8 asas arrastrables + lupa 3×, copiado del lab) → APLICAR → re-evaluación
   real (calidad + gate OCR) que puede rescatar el acta a ADVERTENCIA/ÓPTIMA
   con envío manual; ROTAR 90° hornea la rotación; PANTALLA COMPLETA muestra
   la foto a tamaño completo; CANCELAR no toca nada.
8. Pages: `detection-worker.js` y `opencv-4.5.5*.js` responden 200 bajo
   `/web-scanner/`; OCR local funciona (sin backend).
9. `docs/DECISIONS.md` con D12–D22 (async, composite, mapeo, gate OCR, foto
   real, piso escénico, no-useScannerStore, editor quad COPIADO del lab y
   re-vestido, rescate sin intento, visor, interfaz de escaneo copiada con
   AUTO default OFF). `docs/ROADMAP.md` actualizado.
10. PR `feat/e14-fase-logica` → `main` con las fases como commits separados.

## §11 Fuera de alcance (explícito — no discutir en el PR)

- Lectura de votos/firmas desde la foto (OCR manuscrito) · QR/barcode real ·
  backend de transmisión · modificar scanner-core · cambiar el diseño aprobado.
