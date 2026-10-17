# PR gate-calidad-v1 — E-01 + D-01 + E-02 + C-06 (auditoría 113 hallazgos)

**Rama:** `fix/gate-calidad-v1` · **Base:** `main` @ `ad4c6fa` · **Estado:** PR draft, merge lo hace el dueño tras auditoría.
**Origen:** auditoría externa de 113 hallazgos. Este PR arregla los 2 críticos (D-01, E-01 parcial) + el gate que protege el resto (E-02, C-06). PRs paralelos: `fix/leaks-recursos-v1`, `fix/pwa-gama-baja-v1` (este es el PRINCIPAL y se mergea primero).

---

## D-01 — Muro del burst a mitad de la corrección v2-A13 Fase C

### La evidencia (comentario vs valor, antes del fix)

`apps/scanner-lab/src/lib/burst-budget.ts` @ `ad4c6fa`, bloque DEFAULTS (~L92-102):

```ts
const DEFAULTS: BurstBudgetConfig = {
  enabled: true,
  /** v2-A13 Fase C — 5000 (antes 2000). Dato del lote 4 (build 89fb5dc,
   *  qa-standard-v1.1, A13): con el muro a 2 s el corte llegó tarde
   *  (adquisition 11.9–17.2 s por timers deslizándose en un hilo
   *  saturado) y el rescate guardó actas a 960 px — el track del preview.
   *  Con Fase B aliviando el hilo, 5 s dan a la foto full-res del sensor
   *  (4000 px) una ventana honesta; worst case ~5-6 s por captura con
   *  acta a 4000 px, frente a 17 s a 960 px. Dispositivos sanos (foto en
   *  0.22–1 s) jamás lo tocan. */
  timeBudgetMs: 2000,          // ← el código NO coincidía con su evidencia
  ...
  photoGraceMs: 2000,          // ← otra decisión (A13 build 73d7be2), NO se toca
```

Tres fuentes de verdad decían **5000** y el valor real era **2000**:

1. El comentario del propio campo («v2-A13 Fase C — 5000 (antes 2000)…»).
2. La cabecera §A del archivo (L14): «§A — Muro de tiempo: BURST_TIME_BUDGET_MS = 5000 desde capture_fired» — documentaba una constante que **ni siquiera existía**.
3. La justificación de evidencia medida (lote 4): con el muro a 2 s, la adquisición corría 11.9–17.2 s y el rescate guardaba actas a 960 px (track del preview, ilegibles).

**Consecuencia del bug:** el muro cortaba a 2 s en gama baja — exactamente el fallo que la Fase C decía haber corregido — y `wallFireMs` registraba ~2000, corrompiendo la comparabilidad 1:1 entre lotes (requisito #1 del módulo de burst).

### El fix (26ca87b)

```ts
/** v2-A13 Fase C — muro de tiempo del burst. Fuente única: DEFAULTS.timeBudgetMs
 *  deriva de aquí (D-01: el valor estaba en 2000 mientras docs y evidencia decían 5000). */
export const BURST_TIME_BUDGET_MS = 5000;

const DEFAULTS: BurstBudgetConfig = {
  enabled: true,
  /** … comentario del lote 4 intacto — ahora coincide con el valor … */
  timeBudgetMs: BURST_TIME_BUDGET_MS,
```

- El nombre `BURST_TIME_BUDGET_MS` no se inventó: es el que la cabecera §A ya documentaba.
- El comentario largo del lote 4 **se queda** (ahora sí describe el valor).
- `photoGraceMs: 2000` **INTACTO** — su comentario documenta otra decisión con otra evidencia (experimento de palanca del dueño, A13 build 73d7be2: techo del takePhoto VERDADERAMENTE colgado, NO el muro).

### Verificación

```
$ rg -n "timeBudgetMs" apps/scanner-lab/src/lib/burst-budget.ts
14: *   §A — Muro de tiempo: BURST_TIME_BUDGET_MS = 5000 desde capture_fired   ← la cabecera ahora es verdad
92:/** v2-A13 Fase C — muro de tiempo del burst. Fuente única: …
94:export const BURST_TIME_BUDGET_MS = 5000;
106:  timeBudgetMs: BURST_TIME_BUDGET_MS,
704:      if (typeof p.timeBudgetMs === "number" && Number.isFinite(p.timeBudgetMs)) {   ← parser de perfiles persistidos (clamp 0–60000), sin valor duro
705:        next.timeBudgetMs = Math.max(0, Math.min(60_000, p.timeBudgetMs));

$ rg -n "timeBudgetMs" apps packages --type ts | rg -v burst-budget
apps/scanner-lab/src/components/scanner/CameraView.tsx:1641  ← LECTURA (burstCfg.timeBudgetMs), no sobreescribe
apps/scanner-lab/src/lib/diag-report.ts:159                  ← comentario
```

Ningún otro sitio asigna `timeBudgetMs` con valor duro → el fix en DEFAULTS es completo. Los perfiles persistidos del usuario siguen siendo la palanca de tunéo (L704, con clamp ≤ 60 000).

---

## E-01 — Deploy blindado con el Quality Gate (con desvío documentado)

### Lo que dice la auditoría vs lo que hay en `ad4c6fa`

| Afirmación de la auditoría | Verificado en web-scanner `ad4c6fa` |
|---|---|
| `quality.yml` trigger `branches: ain]` (YAML corrupto) | **FALSO** — ya dice `branches: [main]`. Toda la historia del repo no contiene nunca `ain]`: el split `a9b6b83` nació corregido (la corrupción viene del monorepo viejo) |
| Deploy automático por push a main MUERTO (solo workflow_dispatch) | **FALSO** — el deploy por push está vivo (la demo Pages se regeneró tras el merge `ad4c6fa` del PR scanner-ui; check-runs build+deploy success) |
| El deploy construye y despliega sin gate (quality corre en PARALELO, no bloqueando) | **VERDADERO** — este es el defecto real y se arregla |

**Conclusión:** la auditoría mal-atribuyó la corrupción de **digielect14** (verificado hoy: `digielect14/main` tiene `branches: ain]` en `quality.yml` Y en `deploy-pages.yml`) a web-scanner. La corrupción e14 está FUERA de la whitelist de este PR — se reporta para un kit futuro. En web-scanner solo se arregla la mitad que sí aplica: el blindaje.

### El fix (abc4fa3)

1. `quality.yml`: `on:` gana `workflow_call:` (reutilizable como job).
2. `deploy-pages.yml`: job `quality` al inicio (`uses: ./.github/workflows/quality.yml`, `permissions: contents: read`) y `build: needs: quality`. El job `deploy` (ya `needs: build`) queda intocado.

Resultado: **push a main = quality (7 checks: core:check, ui:check, guard de imports, ui:build, app:check, lint, build:static) → build → deploy** · **PR = quality solamente** (deploy-pages no tiene trigger de PR).

### Micro-desvío defensivo (mismo commit, justificado)

El job `quality` lleva grupo de concurrencia propio:

```yaml
quality:
  uses: ./.github/workflows/quality.yml
  permissions:
    contents: read
  concurrency:
    group: quality-deploy-${{ github.ref }}
    cancel-in-progress: false
```

**Por qué:** en push a main, quality.yml corre STANDALONE (trigger `push: [main]` del kit, se conserva) y TAMBIÉN dentro de deploy-pages vía workflow_call. Ambas corridas heredarían el mismo grupo `quality-<ref>` con `cancel-in-progress: true` → se cancelarían entre sí al azar; si ganara la standalone, el `needs: quality` del deploy quedaría sin gate y el **deploy se saltaría**. El override de concurrencia a nivel de job de la llamada separa los grupos y elimina la carrera.

### Verificación YAML

```
$ python3 -c "import yaml; a=yaml.safe_load(open('.github/workflows/quality.yml')); b=yaml.safe_load(open('.github/workflows/deploy-pages.yml')); print('YAML OK')"
YAML OK
quality triggers: ['pull_request', 'push', 'workflow_call']
deploy triggers: ['push', 'workflow_dispatch']
deploy jobs: ['quality', 'build', 'deploy']   build needs: quality   deploy needs: build
```

---

## E-02 — Reglas de corrección en warn (fff03d8)

### Clasificación (29 reglas `off` en el bloque de apagado → 18 warn + 11 off)

**→ warn (18, corrección — ninguna a `error`, criterio del kit):**

| Grupo | Reglas |
|---|---|
| Dead code / undefined | `@typescript-eslint/no-unused-vars`, `no-unused-vars`, `no-undef`, `no-unreachable`, `no-redeclare` |
| Correctitud de hooks | `react-hooks/exhaustive-deps`, `react-hooks/purity`, `react-hooks/refs`, `react-hooks/set-state-in-effect` |
| Patrones de riesgo | `@typescript-eslint/no-non-null-assertion`, `@typescript-eslint/ban-ts-comment`, `no-debugger`, `no-empty`, `no-fallthrough`, `no-case-declarations`, `no-useless-escape` |
| Render / estilo de declaración | `react/no-unescaped-entities`, `prefer-const` (nombrada por el kit) |

**→ siguen off (11, estilo/opinión/gradualidad — sin reglas prettier en el archivo):**

`@typescript-eslint/no-explicit-any` · `@typescript-eslint/prefer-as-const` · `@typescript-eslint/no-unused-disable-directive` · `react/display-name` · `react/prop-types` · `@next/next/no-img-element` (los `<img>` del escáner son dataURLs/canvas, intencional — ver comentario en `next.config.ts`) · `@next/next/no-html-link-for-pages` · `no-console` (telemetría) · `no-irregular-whitespace` · `no-mixed-spaces-and-tabs` · **`react-compiler/react-compiler`** (desvío: su plugin no está instalado; activarlo exigiría tocar `package.json`/`bun.lock`, prohibido por el kit).

`react-hooks/rules-of-hooks` ya estaba activa — no se tocó. No se activaron reglas type-aware nuevas.

### Verificación

```
$ bun run lint
✖ 175 problems (0 errors, 175 warnings)
LINT EXIT: 0
```

Criterio de aceptación del kit cumplido: exit 0, la deuda se reporta con conteo (175 warnings ahora VISIBLES — antes: 0 visibles por apagado).

---

## C-06 (§2.4 condicional) — `ignoreBuildErrors: false` (aplicó)

```
$ bun run app:check          # desde la raíz
$ cd apps/scanner-lab && bunx tsc --noEmit
APP:CHECK EXIT: 0            ← limpio
```

Salida limpia → se aplicó el paso 2 del kit: `apps/scanner-lab/next.config.ts` `typescript.ignoreBuildErrors: true → false`. El build vuelve a validar tipos (el `tsc --noEmit` del gate y el typecheck del build ahora coinciden por construcción).

---

## Validación completa del PR (§3 del kit — salidas reales)

```
$ bun install --frozen-lockfile
1732 packages installed [6.65s]

$ bun run core:check && bun run ui:check && bun run app:check
(exit 0 en los tres — 0 errores)

$ bun run lint
✖ 175 problems (0 errors, 175 warnings)   exit 0

$ bun run build:static
✓ Compiled successfully — 3 rutas estáticas ( BUILD_STATIC=1 )

$ python3 -c "import yaml; …"
YAML OK

$ git diff --stat origin/main
 (ver PR — exactamente la whitelist: 2 workflows + burst-budget.ts + eslint.config.mjs + next.config.ts + CHANGES.md + docs/fix-gate-calidad-v1.md)
```

## Commits

1. `abc4fa3` — fix(ci): blinda deploy-pages con quality gate vía workflow_call (E-01)
2. `26ca87b` — fix(burst): timeBudgetMs 2000→5000 con fuente única BURST_TIME_BUDGET_MS (D-01)
3. `fff03d8` — chore(lint): reactiva reglas de corrección en warn (E-02) + ignoreBuildErrors:false (C-06)
4. `docs(changes)` — esta documentación (CHANGES.md + este archivo)

## Pendientes fuera de whitelist de este PR (para kits futuros)

- **digielect14**: misma corrupción `branches: ain]` en `quality.yml` y `deploy-pages.yml` (E-01 e14). Mismo patrón de blindaje aplica allí.
- **react-compiler**: añadir `eslint-plugin-react-compiler` (requiere `package.json`/`bun.lock` — otro track) para poder activar `react-compiler/react-compiler`.
- Los otros 2 PRs paralelos del audit: `fix/leaks-recursos-v1`, `fix/pwa-gama-baja-v1` — merge DESPUÉS de este.
