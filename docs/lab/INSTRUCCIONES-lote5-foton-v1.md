# INSTRUCCIONES — lote5-foton (web-scanner · scanner-lab) · v1

> **Rol:** IMPLEMENTADOR. Estas instrucciones son AUTOSUFICIENTES: no necesitas
> leer conversaciones previas. Trabajas en el repo `Jg-Stevan/web-scanner`.
> Antes de escribir código lee `REGLAS-AGENTE.md` y `AGENTS.md` del repo: si algo
> de aquí contradice una regla de seguridad del repo, gana la regla y avisa.

---

## 0. Contexto (resumen ejecutivo)

En el SM-A135M la captura sufre un «tramo opaco» de ~15 s. La evidencia cam-lab
(2026-10-14, JSON `scannerlab-camlab-SM-A135M-2026-10-14T19-04-29.json`) probó:

- `takePhoto()` **desnudo** (sin photoSettings) tarda **~15 s** en este dispositivo
  (es lo que la app dispara HOY porque el sensor nativo 2576×1932 ≤ tope 4032 →
  `overCap=false` → `buildCappedPhotoSettings()` devuelve `undefined`).
- `takePhoto({imageWidth:2048, imageHeight:1536})` tarda **~1.0 s** (devuelve
  1920×1920, ~993 KB). `takePhoto({imageWidth:1280, imageHeight:960})` ~0.9 s.
- `takePhoto({imageWidth:4032, imageHeight:3024})` → **NotSupportedError inmediato**
  (este dispositivo no soporta ese tamaño).
- El stream de preview SÍ puede subir a **1920×1440 con 26.7 fps** y nitidez
  OCR-grade (Laplaciano crop ≈ 457; umbral OCR = 100). En escena oscura los fps
  caen a ~10 por exposición (hardware) — se avisa al usuario, no se «arregla».

El lote 5 («fotón») ejecuta la vía B+C: foto rápida con escalera de photoSettings,
preview OCR-grade en Android, aviso de poca luz y telemetría diag v6.

## 1. Repositorio y rama

- Repo: `Jg-Stevan/web-scanner` (monorepo bun; app: `apps/scanner-lab`).
- **Base:** rama `perf/lote4-gracia-enhance` (HEAD 73099c4b o posterior).
  El lote 4 está aprobado por auditoría pero aún SIN merge a main → esta rama
  se apila sobre él.
- Rama nueva: **`perf/lote5-foton`** (desde la base anterior).

## 2. Whitelist CERRADA de archivos

```
docs/lab/INSTRUCCIONES-lote5-foton-v1.md   (nuevo — este documento)
apps/scanner-lab/src/components/scanner/CameraView.tsx
apps/scanner-lab/src/lib/diag-report.ts
apps/scanner-lab/src/components/scanner/SonnerToaster.tsx  (solo si el aviso lo exige)
CHANGES.md
```

PROHIBIDO tocar cualquier otra cosa, EN PARTICULAR: `packages/**` (incluido
`packages/scanner-core/**` — `sensor-profiler.ts` NO se modifica), `package.json`,
`bun.lock`, `apps/digitalizador-e14/**`, `.github/**`.

## 3. Cambios (quirúrgicos, con anclas)

### F5-A — Escalera rápida de photoSettings en Android (mata el tramo de 15 s)

Archivo: `apps/scanner-lab/src/components/scanner/CameraView.tsx`, función
`takePhotoBlob` (blobe ~líneas 1179–1302).

**Hoy:**
```ts
const profile = sensorProfileRef.current;
const settings = profile ? buildCappedPhotoSettings(profile) : undefined;
...
let res = await attempt(settings);
// Reintento sin photoSettings SOLO si el primer intento falló RÁPIDO ...
if (!res.blob && settings && !res.timedOut && res.err && (...)) {
  res = await attempt(undefined);   // ← EN EL A13 ESTE ES EL CAMINO DE 15 s
}
```

**Cambio:** cuando `settings` quede `undefined` y `CAN_TAKEPHOTO` (Android),
usar la escalera rápida; el desnudo pasa a ÚLTIMO recurso.

1. Constante de módulo (junto a `CAN_TAKEPHOTO`, ~línea 153):
```ts
/** LOTE 5 (F5-A) — escalera rápida de photoSettings para takePhoto en
 *  Android. Evidencia cam-lab SM-A135M 2026-10-14: el takePhoto DESNUDO
 *  tarda ~15 s (proceso full-res del ISP) y 2048×1536 tarda ~1.0 s.
 *  El desnudo queda como ÚLTIMO recurso (ningún dispositivo queda peor
 *  que hoy: cada peldaño solo se intenta si el anterior falló RÁPIDO). */
const FOTO_LADDER: Array<{ imageWidth: number; imageHeight: number }> = [
  { imageWidth: 2048, imageHeight: 1536 },
  { imageWidth: 1280, imageHeight: 960 },
];
```

2. En `takePhotoBlob`, tras computar `settings` del profiler:
```ts
let settings = profile ? buildCappedPhotoSettings(profile) : undefined;
// LOTE 5 (F5-A): sin photoSettings del profiler (overCap=false) y en
// Android, NO disparar desnudo: empezar por la escalera rápida.
if (!settings && CAN_TAKEPHOTO) settings = FOTO_LADDER[0];
```
(ajusta `const` → `let` solo si el compilador lo pide).

3. Sustituir el reintento único por avance de escalera: mantener la MISMA
   condición de reintento (fallo RÁPIDO, no timeout, presupuesto restante > 50 ms),
   pero el siguiente intento es el SIGUIENTE peldaño de `FOTO_LADDER`; el desnudo
   (`attempt(undefined)`) solo si la escalera se agotó. Estructura mínima
   recomendada: un índice `ladderIdx` local + bucle `while` con las mismas
   guardas de presupuesto que hoy (`deadlineAt - performance.now() > 50`);
   `res.timedOut === true` corta la escalera (sensor colgado → lista negra,
   comportamiento actual intacto).
   - **PROHIBIDO** cambiar la carrera de 5 s, el `burstDeadline`, la lista negra
     (`takePhotoBrokenRef`), el observador de foto huérfana ni la gracia.
   - **PROHIBIDO** tocar iOS: todo vive tras el guard `CAN_TAKEPHOTO` ya existente.

4. Registro para diag (F5-D): dejar expuestos en el resultado del intento
   ganador el `photoSettings` pedido (o `"naked"`) y los ms del intento
   (`performance.now()` alrededor de `attempt`). Guárdalos en un ref local
   (p. ej. `lastPhotoAttemptRef`) — CameraView ya publica refs hacia diag.

### F5-B — Preview OCR-grade en Android (1920×1440)

Archivo: `CameraView.tsx`, constantes ~líneas 154–156:

**Hoy:** `IDEAL_PREVIEW_WIDTH = CAN_TAKEPHOTO ? 960 : 1920;` (y 540 : 1440).

**Cambio:** ambas plataformas piden 1920×1440 ideal:
```ts
const IDEAL_PREVIEW_WIDTH = 1920;
const IDEAL_PREVIEW_HEIGHT = 1440;
```
con comentario LOTE 5 (F5-B): evidencia cam-lab — en SM-A135M el stream a
1920×1440 corre a 26.7 fps con nitidez OCR-grade (457), y la captura de
respaldo (ring ZSL/snapshot) deja de nacer a 0.5 MP. «ideal» nunca rechaza
(regla E3 del archivo). El loop de detección sigue remuestreando a 400 px y el
ring ya escala sus copias a ≤1280 px (FIX v4 4.5) → sin cambios aguas abajo.

NO tocar: `IDEAL_PREVIEW_FPS` (30), `AUTO_CAPTURE_IDEAL_*` (solo no-Android),
las constraints de `getUserMedia` (ya usan las constantes).

### F5-C — Aviso «poca luz»

Archivo: `CameraView.tsx` (handler `onFrame` que recibe la telemetría del loop;
hoy ya publica `window.__cameraTelemetry`).

Comportamiento:
- Fuente: `t.fps` (fps de PROCESADO del loop, ya throttleado) que llega en
  `FrameLoopTelemetry`. Es aceptable: en oscura el sensor baja a ~10 fps y el
  loop procesa hasta el throttle — si `t.fps` se mantiene bajo por oscuridad,
  también lo hará el sensor (diag: 10 fps medidos).
- Estado en refs: contador de tiempo acumulado con `fps < 12` (umbral entre la
  oscura medida 10 y la brillante ≥26) mientras la cámara está abierta.
- Si acumula ≥ 4 s de fps bajo y no se ha avisado en esta sesión de cámara →
  mostrar UNA vez el aviso: `toast.message("Poca luz: la cámara va lenta", { description: "Acércate a una luz o enciende el flash.", id: "poca-luz" })`
  (sonner ya está montado vía `SonnerToaster`; ampliar su whitelist SOLO si el
  compilador lo exige).
- Recuperación: si `fps ≥ 20` durante ≥ 2 s, resetea el acumulador y permite
  re-avisar (máximo 2 avisos por sesión de cámara).
- Sin timers nuevos, sin suscripciones nuevas: solo el `onFrame` existente.

### F5-D — diag v6 (aditivo)

Archivo: `apps/scanner-lab/src/lib/diag-report.ts`.

1. `version: 5` → `version: 6` en el tipo (~línea 79) y en el objeto (~línea 750).
2. Ampliar `session.camera` (tipo ~líneas 89–92 y armado ~líneas 760–762) con
   campos ADITIVOS, todos nullable para no romper nada:
   - `streamW: number | null` / `streamH: number | null` — resolución REAL del
     track (track.getSettings().width/height) capturada en un mark `camera_ready`
     (agrega el meta al emitir ese mark desde CameraView; si el mark ya existe,
     solo añade meta — no cambies su nombre).
   - `photoSettingsReq: string | null` — p. ej. `"2048x1536"` o `"naked"`.
   - `photoOutLongSide: number | null` — lado mayor del blob ganador (reusa el
     sniff `readBlobLongSide` que `dispatchPhotoBlob` ya hace; pásalo al mark).
   - `takePhotoMs: number | null` — mediana de los intentos ganadores de la sesión.
3. En el informe de TEXTO (~líneas 916–925), añade una línea por campo nuevo
   (mismo estilo `push(...)`; usa `DASH` cuando sea null).

Nada más: NO cambies campos existentes, NO renombres, NO toques el formato del
nombre de archivo del informe.

## 4. Gates de validación (obligatorios, resultados REALES pegados)

1. `bun run lint` (o el script de lint del repo/`apps/scanner-lab`) — sin errores.
2. Typecheck/build que el repo defina (`bun run build` de scanner-lab si existe).
   PROHIBIDO inventar resultados.
3. `git diff --stat main...perf/lote5-foton` (o contra la base) — debe listar
   EXACTAMENTE la whitelist de la §2. Si aparece algo más → detente y reporta.
4. `node --check` no aplica aquí; en su lugar confirma que ningún archivo de la
   whitelist tiene imports nuevos (cero dependencias nuevas).

## 5. Git

1. `git checkout -b perf/lote5-foton perf/lote4-gracia-enhance`
2. Commit único (o uno por feature F5-A..F5-D si prefieres trazabilidad):
   `perf(camera): lote5-foton — escalera takePhoto 2048, preview 1920×1440 Android, aviso poca luz, diag v6`
3. PROHIBIDO push/merge/PR sin autorización explícita en el mensaje del dueño.
   Si el dueño autorizó PR en su instrucción: PR **draft** con base
   `perf/lote4-gracia-enhance`, título «lote5-foton: mata el tramo opaco del A13
   (evidencia cam-lab 2026-10-14)», descripción = resumen de la §0 + gates reales.
   NUNCA mergear.

## 6. Reporte final (obligatorio)

- Lista exacta de archivos tocados con +/− líneas.
- Resultados de lint/build PEGADOS tal cual.
- Cualquier desviación de estas instrucciones y por qué.
- Confirmación de que `sensor-profiler.ts` y `packages/**` quedaron a 0 diff.

## 7. Criterios de aceptación

- [ ] En Android, `takePhotoBlob` nunca dispara desnudo PRIMERO (escalera).
- [ ] El desnudo sigue disponible como último recurso y tras timeouts el
      comportamiento (lista negra, gracia, huérfana) es IDÉNTICO al actual.
- [ ] iOS/no-Android: 0 cambios de comportamiento (guard `CAN_TAKEPHOTO`).
- [ ] `IDEAL_PREVIEW_*` = 1920×1440 en ambas plataformas, con comentario de evidencia.
- [ ] Aviso de poca luz: máx 2 por sesión de cámara, sin timers nuevos.
- [ ] diag v6 aditivo con `streamW/H`, `photoSettingsReq`, `photoOutLongSide`,
      `takePhotoMs`.
- [ ] Whitelist exacta, gates reales, sin dependencias nuevas.
