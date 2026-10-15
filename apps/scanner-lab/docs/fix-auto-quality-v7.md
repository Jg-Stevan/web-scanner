# FIX v7 — Auto-captura iOS: cero mensajes + máxima calidad posible del stream

> **APP:** `apps/scanner-lab`. **⛔ NO se tocó `apps/digitalizador-e14`**
> (0 archivos en el diff — verificado con `git diff main...HEAD`).
>
> **Rama:** `fix/ios-auto-quality-v7` · **Base:** `main` en `d20737e`
> (incluye v6 fusionado vía PR #15, más el PR #16 de e14 que entró después).
> Un commit por punto (7.1 → 7.3 → 7.2 + docs).
>
> **Reportado por el propietario (iPhone 17 Pro, también usuarios con
> Chrome en iPhone):** tras v6 la cámara ya no se queda en negro ✅, pero
> (a) aparece el toast «En iPhone: para máxima calidad dispara
> manualmente (foto nativa)» y el usuario NO quiere mensajes — quiere que
> la imagen se procese automáticamente en buena calidad; (b) parte de los
> usuarios usan **Chrome en iPhone**.

**Sobre Chrome-iOS:** usa WebKit (motor de Safari) — hereda exactamente los
mismos comportamientos. La detección POSITIVA de Android de v6 (UA `CriOS`
no contiene "Android") ya lo clasifica en el régimen iOS. **Cero
browser-sniffing nuevo**: todo va con guards (`typeof x === "function"` +
`try/catch` silencioso) y cae del mismo lado para Safari y Chrome-iOS.

## Estado

| Punto | Título | Commit |
|-------|--------|--------|
| 7.1 | Eliminar toast informativo iOS («para máxima calidad…») | `c1dd697` |
| 7.3 | Ranking del burst consciente de resolución (PRERREQUISITO de 7.2) | `1dba867` |
| 7.2 | Stream al máximo para auto-captura (applyConstraints progresivo) | `a3d2fc8` |
| docs | Este documento + CHANGES | (este commit) |

## 7.1 — Eliminar el toast «En iPhone: para máxima calidad…»

**Causa raíz:** el toast era puramente informativo (1× por sesión cuando
`!CAN_TAKEPHOTO` && auto-captura ON, `iosQualityToastShownRef`). Decisión de
producto: FUERA — el usuario no quiere mensajes; el obturador manual es
naturalmente descubrible y la auto-captura ahora entrega la mejor calidad
posible por sí sola (7.2 + 7.3).

- Borrado el bloque del toast y la declaración `iosQualityToastShownRef`
  (`rg iosQualityToast` → 0).
- NADA más cambia: shutter manual → cámara nativa 12 MB (v6 6.1) intacto,
  flujo de auto-captura intacto.

## 7.3 — Ranking del burst consciente de resolución

**FLAW crítico:** `dispatchBestFrame` elegía al ganador por `lapVar` PURO.
Los frames ZSL del ring están capados a 1280 px (`RING_MAX_LONG_SIDE`,
memoria iOS v4 4.5) mientras `snapshotVideo()` captura a resolución
COMPLETA del stream → un frame de 1280 px ligeramente más nítido le GANABA
al snapshot full-res. Aunque se suba la resolución del stream (7.2), la
auto-captura seguiría entregando 1280 px. **Este fix es prerrequisito de
7.2.**

Nuevo criterio (puerta de nitidez → gana la resolución):

- `SHARPNESS_KEEP_RATIO = 0.85`: solo compiten los frames con ≥85 % del
  lapVar del mejor.
- Entre los suficientemente nítidos gana el de MAYOR área (px); desempate
  por lapVar en paridad exacta de área.
- Sin telemetría → orden de llegada (§5.4, intacto).

**Intacto:** `F-RES-PRIORITY` (la foto full-sensor de takePhoto siempre
despacha directo, sin competir) — este cambio solo rige en la competición
frame-vs-frame del fallback. El ring sigue capado a 1280.

## 7.2 — Subida progresiva de resolución del stream (no-Android, auto ON)

**Límite físico de WebKit (Safari Y Chrome-iOS):** `takePhoto()` se cuelga
(v6 6.1) y la cámara nativa de 12 MP exige un gesto del usuario → la
auto-captura SOLO puede usar frames del stream → su calidad = la resolución
negociada del stream (hoy `1920×1440` fijado por v3 en `IDEAL_PREVIEW_*`).

Implementación:

- Constantes: `AUTO_CAPTURE_IDEAL_WIDTH/HEIGHT = 4032×3024` («ideal»,
  E3-compliant — jamás `exact/min`; el SO entrega su máximo) y
  `STREAM_UPGRADE_DELAY_MS = 2000`.
- `upgradeStreamResolution(track)`: guards — solo no-Android
  (`CAN_TAKEPHOTO` false), solo auto-captura ON (`autoRef`), solo si
  `applyConstraints` existe, solo track `live`, skip si ya ≥3000 px de
  ancho. `catch` silencioso — NUNCA un mensaje. Telemetría QA en
  `window.__streamUpgrade` (before/after, misma idea que `__sensorProfile`).
- Invocación diferida 2 s tras abrir (no toca el arranque rápido 5.3):
  en `applyStream` (guard `cancelled` del cierre del efecto) y en
  `retryRealCamera` (guard local `streamRef.current === stream`).
- Toggle a mitad de sesión (botón toolbar + MenuRow del menú ⋮): al
  ACTIVAR la auto-captura sube DIRECTO (el stream ya lleva abierto, sin
  delay).

**Calor/batería controlados:** solo no-Android, solo auto ON, delay 2 s,
sesiones cortas. `ideal` nunca rechaza (E3) — en dispositivos que no
pueden más, no cambia nada.

**Aspect agnóstico:** si Safari entrega 3840×2160 (16:9) en vez de 4:3,
todo el pipeline lo absorbe: `snapshotVideo` usa `videoWidth/Height`
reales, el mapeo del quad usa `videoDims`, y el chequeo de aspecto de
`bornQuad` compara frame vs captura del MISMO stream (±2 %). El clamp
4032 de `processImage` protege aguas abajo. El ring permanece a 1280
(snapshots full-res son transitorios: `releaseFrame`).

## Qué NO cambió (lista dura, verificada)

- `PROCESSED_MAX_LONG_SIDE = 4032`, pipeline de guardado/WYSIWYG, PDF (v3).
- `RING_MAX_LONG_SIDE = 1280` y su uso en `pushRingFrame`/scratch.
- `CAN_TAKEPHOTO` / `IS_ANDROID` (v6 6.1) y TODOS sus guards — Android
  byte a byte igual (preview 540p + takePhoto full-sensor; E2E: 0 llamadas
  a `applyConstraints` de resolución con UA Pixel 7).
- Watchdog de frescura (6.2), touch-action (6.3), presentación progresiva
  (6.4), flash/auto (5.5), modo espera (5.4), caché de cámara (5.3),
  bornQuad (5.2), displayUrl (5.1).
- Reglas E3: SOLO `ideal`, jamás `exact/min` en width/height/frameRate.
- `F-RES-PRIORITY`. **`apps/digitalizador-e14`: 0 archivos.**

## Verificación ejecutada (evidencia)

Entorno: dev server efímero `bunx next dev -p 3005` + Chromium headless con
emulación de dispositivo (iPhone 14 / Pixel 7). Parches en
`getUserMedia`/`enumerateDevices` con canvas-stream (misma técnica que v6),
`applyConstraints` del track instrumentado para registrar las llamadas.

1. ✅ `rg "En iPhone: para máxima calidad"` en `src/` → **0 matches**.
2. ✅ **AC2 (UA iPhone iOS):** apertura con
   `width:{ideal:1920}, height:{ideal:1440}` (3ª llamada de la cascada,
   capturada en el patch); a los ~2 s exactamente **1 llamada** a
   `applyConstraints({width:{ideal:4032}, height:{ideal:3024}})` y
   `window.__streamUpgrade = {before:{w:1920,h:1440}, …}` registrado
   (after queda 1920×1440 en sandbox — el track de canvas no puede subir;
   en un iPhone real negociaría su máximo).
3. ✅ **AC3 (UA Pixel 7 / Android 13):** apertura con
   `width:{ideal:960}, height:{ideal:540}`; **`applyCalls = []`** (CERO
   llamadas — ni de resolución ni de nada) y `__streamUpgrade` ausente.
   Régimen Android intacto.
4. ✅ **AC4 (ranking, burst sintético):** lógica exacta de
   `dispatchBestFrame` extraída a harness con los mismos valores:
   1280/100 vs 3840/90 → **gana 3840** (90 ≥ 0.85×100); 1280/100 vs
   3840/80 → **gana 1280** (80 < 85); paridad de área → desempate lapVar
   (100 vs 140 → 140, en ambos órdenes); extras: 3 frames con el mejor
   pequeño → gana el 4K; snapshot 4032 MUY borroso (40) → gana el 1280;
   sin telemetría → orden de llegada. **8/8 casos.**
5. ✅ **AC5 (auto-captura E2E, UA iPhone):** canvas-documento (rectángulo
   blanco con texto simulado, score de detección 0.91 > SHUTTER_SCORE
   0.8) → **disparo automático → editor abierto → página 1 creada** ·
   `__toastTexts = []` (**CERO toasts** en toda la sesión) · la preview
   del editor mide **1050×1145 px** = recorte (~55 % del ancho) de un
   frame fuente de **1920×1440** — el ranking 7.3 eligió el snapshot
   full-res y NO un frame del ring de 1280 (habría dado ~700×760).
   **Wiring de 7.3 probado en el camino real.**
6. ✅ **AC6:** `bunx tsc --noEmit` en `packages/scanner-core` y
   `apps/scanner-lab` → **0 errores** · `bun run lint` → **0 errores** ·
   `git diff main...HEAD --name-only | grep -c digitalizador-e14` → **0**.
7. ✅ **AC7:** 0 errores de página y 0 errores/warnings de consola en
   TODA la sesión de smoke (apertura iPhone + upgrade, apertura Pixel,
   auto-captura → editor).

## Pendiente de QA físico (no verificable en sandbox headless)

- **Cero toasts** al abrir cámara con auto-captura ON — en Safari Y Chrome.
- `__streamUpgrade.after` con salto real de resolución en iPhone modernos
  (en modelos que no permitan más: igual que antes, nunca peor).
- 5 auto-capturas seguidas: sin pantalla negra, sin «Reiniciando cámara…»
  espurio, sesión corta sin calentamiento anómalo.
- Shutter manual sigue abriendo la cámara nativa de 12 MP (v6 intacto).
- Pan con zoom y swipe (6.3) sin regresión.

## Cómo continuar si la sesión se corta

1. `cd /home/z/web-scanner && git status` — rama `fix/ios-auto-quality-v7`,
   4 commits esperados (7.1, 7.3, 7.2, docs).
2. Si falta el push: `git push -u origin fix/ios-auto-quality-v7` (el
   remote ya tiene el PAT embebido) y abrir el PR a `main`.
3. Tras el merge: `git checkout main && git pull` y verificar el run de
   Pages en Actions.
