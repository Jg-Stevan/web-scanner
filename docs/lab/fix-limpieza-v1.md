# fix-limpieza-v1 — PR4 LIMPIEZA (kit INSTR-ws-pr4-limpieza-v1)

**Rama:** `fix/limpieza-v1` desde `main` @ `bc38bf8` · **Base de insumos:** auditoría externa de 113 hallazgos (PR1 #5, PR2 #3, PR3 #4, hotfix concurrency #6 — ya mergeados) · **Regla del kit:** CERO cambios de comportamiento en los paths de runtime del scanner.

**Commits (convención §4 del kit):**

| # | Commit | Fases |
|---|--------|-------|
| 1 | `cb4de7d` chore(lab): elimina 27 dependencias muertas y scripts de prisma | A + B + E-24 |
| 2 | `d215fbd` chore(ui-clean): retira sistema toast shadcn muerto | C |
| 3 | `cd2f235` refactor(core): extrae generateDemoPage a demo-page.ts + dead code | D + E |
| 4 | `e7158e7` chore(infra): tailwind v3 config fuera, .gitignore/scripts/publish | F |
| 5 | `03c1448` docs: consolida REGLAS-AGENTE + mueve docs a /docs/lab | G |
| 6 | `371706c` chore(diag): versión única, EMA, guard quad, meta tipado | H |

---

## FASE A — Dependencias muertas (E-14, D-14, C-16)

**Procedimiento aplicado por dep:** `git grep -nE "from ['\"]<dep>(/|['\"])|import\(['\"]<dep>|require\(['\"]<dep>" -- apps packages` (excluyendo `docs/`), clasificación (1)/(2)/(3) del kit, `bun install` + 4 checks tras cada tanda.

**Clase (1) — cero importers verificado (grep = vacío por cada una):**
`@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, `@hookform/resolvers`, `@mdxeditor/editor`, `@reactuses/core`, `@tanstack/react-query`, `@tanstack/react-table`, `date-fns`, `next-auth`, `next-intl`, `react-markdown`, `react-syntax-highlighter`, `sharp`, `uuid`, `z-ai-web-dev-sdk`, `zod` → **17 deps fuera** de `apps/scanner-lab/package.json`.

- Nota 1: `chart.js` y `react-chartjs-2` (citadas en el kit) **no existen** en ningún package.json del repo — nada que hacer.
- Nota 2: el humo posterior `git grep "sharp"` da 64 matches — TODOS son la palabra `sharpness`/`Sharpness` en `image-processor.ts` (falso positivo del grep literal). El grep de imports reales `from ['\"]sharp['\"]` = **vacío**.
- `bun-types`: `tsconfig.json` NO tiene campo `types: [...]` y `git grep -nw "Bun" -- apps/scanner-lab/src packages` = solo un comentario de README → **fuera** (condición del kit cumplida).

**Clase (2) — pares dep+componente (cada .tsx con prueba de cero importers de app):**

| Par | Prueba | Resultado |
|-----|--------|-----------|
| `embla-carousel-react` ← `ui/carousel.tsx` | `git grep "ui/carousel"` fuera de ui = vacío | fuera |
| `react-day-picker` ← `ui/calendar.tsx` | ídem | fuera |
| `cmdk` ← `ui/command.tsx` | ídem | fuera |
| `react-resizable-panels` ← `ui/resizable.tsx` | ídem | fuera |
| `react-hook-form` ← `ui/form.tsx` | ídem | fuera |
| `input-otp` ← `ui/input-otp.tsx` | ídem | fuera |
| `recharts` ← `ui/chart.tsx` | ídem | fuera |

**Auditoría Radix (instrucción Fase A Clase 2 — re-auditar CADA `@radix-ui/react-*`):**
cierre transitivo completo de `src/components/ui/*` desde los imports reales de la app:

- **UI VIVOS (9):** `alert-dialog.tsx`, `button.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, `input.tsx`, `select.tsx`, `switch.tsx` (+ `toast.tsx`/`toaster.tsx`, muertos en Fase C).
- **Radix VIVOS (7):** `react-alert-dialog`, `react-dialog`, `react-dropdown-menu`, `react-select`, `react-slot` (via `button.tsx`), `react-switch`, `react-toast` (→ Fase C).
- **Radix MUERTOS (20):** accordion, aspect-ratio, avatar, checkbox, collapsible, context-menu, hover-card, label, menubar, navigation-menu, popover, progress, radio-group, scroll-area, separator, slider, tabs, toggle, toggle-group, tooltip — y **31 ui/*.tsx muertos** adicionales.

**DESVIACIÓN D-1 (§1.1 — stop y reporte):** eliminar esas 20 deps exige borrar sus 31 `ui/*.tsx`, que **NO están en la whitelist §6** (solo lo están carousel/calendar/command/resizable/form/input-otp/chart + toaster/toast/sonner). Aplicando la regla de oro, **NO se tocaron**: las 20 deps y sus 31 archivos quedan en el repo (tsc 0 sin ellos). Lista completa y evidencia arriba — candidata para un lote posterior si el dueño amplía la whitelist.

**KEEP verificado:** `vaul` (2 archivos — EditorView), `framer-motion` (9), `next-themes` (4), `sonner` (7), `lucide-react` (29), `zustand` (1), `jspdf` (1 — core), `heic2any` (core `image-processor.ts:186-201`), `clsx`/`tailwind-merge`/`class-variance-authority` (ui vivos + app), `tw-animate-css` (`globals.css:2`), `tailwindcss` + `@tailwindcss/postcss` (v4 activo), `next`, `react`, `react-dom`, `@types/*`, `eslint*`, `typescript`. `tailwindcss-animate` → se retira en Fase F (ver abajo). `@prisma/client`+`prisma` → Fase B.

## FASE B — Capa Prisma muerta (C-04, E-06)

- `git grep -nE "from ['\"]@prisma/client|from ['\"]prisma|lib/db"` → único match: `apps/scanner-lab/src/lib/db.ts:1` (el propio candidato) → **cero referencias reales**.
- Borrados: `apps/scanner-lab/prisma/` (schema.prisma), `apps/scanner-lab/src/lib/db.ts`, scripts `db:push`/`db:generate`/`db:migrate`/`db:reset` (lab) y `db:push` (root). Deps `prisma` + `@prisma/client` fuera.

## FASE C — Doble sistema de toasts (D-06)

- `layout.tsx`: fuera `import { Toaster } from "@/components/ui/toaster"` (L4) y `<Toaster />` (L79). `<SonnerToaster />` **intacto** (sonner directo).
- Borrados: `ui/toaster.tsx`, `ui/toast.tsx`, `hooks/use-toast.ts`, `ui/sonner.tsx` (importers de `ui/sonner` = cero; el wrapper propio importa `sonner` directo).
- Dep `@radix-ui/react-toast` fuera.
- Humo post: `git grep -n "use-toast\|ui/toaster\|ui/toast[^m]" -- apps/scanner-lab/src` = **vacío**.

## FASE D — `generateDemoPage` fuera del pipeline (B-20)

- **MOVIDO, no borrado**: bloque íntegro (comentario + función, 103 líneas, `image-processor.ts` L1294-1396 @ `bc38bf8`) → `packages/scanner-core/src/demo-page.ts` (cabecera nueva documentando el origen; firmas y semilla idénticas).
- Importers actualizados:
  - `packages/scanner-core/src/frame-loop.ts:30` → `from "./demo-page"`.
  - `CameraView.tsx`: fuera `generateDemoPage,` del bloque de import de `@jg-stevan/scanner-core/image-processor` (L52) + **1 línea nueva** `import { generateDemoPage } from "@jg-stevan/scanner-core/demo-page";` (L56) — DESVIACIÓN mínima D-2: la sustitución del módulo exige una línea de import; el resto de CameraView intocada.
  - `packages/scanner-core/src/index.ts`: añadido `export * from "./demo-page";` (la API pública del paquete conserva el símbolo — no requiere bump por esto).
- El subpath `@jg-stevan/scanner-core/demo-page` resuelve por el exports map existente `"./*": "./src/*.ts"`.
- Humo: `git grep "Factura\|PAID\|RECEIVED\|Sarah Jenkins" -- packages/scanner-core/src/image-processor.ts` = **vacío**; los 3 usos vivos apuntan a demo-page.

## FASE E — Código muerto verificado (A-16, C-26)

- **A-16:** `buildCappedPhotoSettings` — borradas las líneas 129-165 de `sensor-profiler.ts` (comentario de la función incluido) + la entrada en `__sensorTools` (L215). Cero refs restantes. **Versión `@jg-stevan/scanner-core` 0.1.0 → 0.2.0** (minor pre-1.0 por export eliminado del paquete publicado) + nota en CHANGES.
- **C-26:** `PresentationView.tsx` — fuera la declaración `const imgWrapRef = useRef<HTMLDivElement | null>(null);` (L82) y la asignación `ref={imgWrapRef}` (L528). Nada más.
- **E-21 / B-09: PENDIENTES DELIBERADOS** (kit: OPCIONALES, «ante duda, NO»): `ZoomableVisor.tsx` dead bits y símbolos muertos en `image-processor.ts`/`image-modes.ts` viven en módulos críticos; requieren análisis símbolo-por-símbolo que no cabe en este PR de limpieza sin riesgo. Sin tocar.

## FASE F — Configs e infra

- **E-12:** `tailwind.config.ts` **borrado**. Prueba previa: `git grep tailwind.config` fuera del propio archivo = vacío; comparación token a token config vs `@theme inline` de `globals.css` → **todos** los tokens del config existen en CSS v4 (background/foreground/card/popover/primary/secondary/muted/accent/destructive/border/input/ring/chart-1..5/radius-sm|md|lg + sidebar*). Ningún token huérfano. Consecuencia: `tailwindcss-animate` fuera (su único importador era el config borrado; `globals.css` NO lo referencia). **Nota de orden:** se retira en el commit `chore(infra)` junto a E-12 (no en Fase A) para que ningún commit intermedio quede con el config importando una dep inexistente.
- **E-09:** DESVIACIÓN de ubicación (§1.7): la línea `rm -rf apps/scanner-lab/src/app/api` estaba en `deploy-pages.yml:56` (el kit decía ~L40). Verificado `ls apps/scanner-lab/src/app/api` = no existe → **línea única eliminada**, nada más tocado en el workflow.
- **E-09 companion:** `.env.example` **eliminado completo** — sus únicas 2 entradas eran server-muertas: `DATABASE_URL` (Prisma, Fase B) y `ZAI_API_KEY` (comentada; para `/api/ocr` que no existe — cero refs a `api/ocr`/`ZAI_API_KEY` en src).
- **E-13:** `.gitignore` — diff mínimo (ver abajo): dedup `dev.log` (×2 → 1) y `tool-results` (`/tool-results` + `tool-results/` → solo `/tool-results`), anclaje `/test` y `/prompt` (verificado: ningún archivo trackeado se llama `test`/`prompt` en todo el árbol → nada des-ignorado en uso).

```diff
-test
-prompt
+/test
+/prompt
 /tool-results
-tool-results/
-dev.log
```

- **E-24:** `dev` → `next dev -p 3000`; `start` → `NODE_ENV=production bun .next/standalone/server.js` (sin `2>&1 | tee *.log`).
- **E-15:** en AMBOS `make-publish-package.mjs` (son copias casi fieles — difieren en 2 líneas de comentario): `delete published.scripts` reemplazado por preservación de `prepublishOnly`:

```js
const { prepublishOnly } = published.scripts ?? {};
if (prepublishOnly) published.scripts = { prepublishOnly };
else delete published.scripts;
```

- **E-05:** `@jg-stevan/scanner-core` en `packages/scanner-ui` — los 2 matches grep son **comentarios** (`ZoomableVisor.tsx:11`, `index.ts:3`), cero imports reales o type-imports → **dep quitada** (regla «cero → quitar»).
- **E-18:** exports de scanner-ui ampliados sin romper `".": `{"." , "./*": "./src/*.ts", "./*.tsx": "./src/*.tsx"}` (el único .tsx, `ZoomableVisor`, se consume vía el export raíz `.`).
- **E-16: PENDIENTE DELIBERADO** — el `cp -r` del script `build` queda igual (el cambio seguro exige script node equivalente; decisión del dueño).

## FASE G — Docs y reglas de agentes

- **E-11:** `git mv apps/scanner-lab/docs docs/lab` (14 entradas, 2.7 MB fuera del árbol de la app). Rutas actualizadas en 4 archivos (`CHANGES.md` + 3 docs que se auto-referenciaban): `git grep "apps/scanner-lab/docs" -- CHANGES.md "*.md"` → **0**.
- **E-10:** verificación previa `md5sum GEMINI.md QWEN.md REGLAS-AGENTE.md` = **31e0e930… idénticos**. `GEMINI.md` y `QWEN.md` → punteros de 3 líneas a `REGLAS-AGENTE.md`. `REGLAS-AGENTE.md` y `AGENTS.md` **sin tocar** (md5 verificado después del commit).

## FASE H — Higiene de diagnóstico

- **D-13:** constante única `DIAG_REPORT_VERSION = 6` (diag-report.ts) usada por el tipo (L81→`typeof DIAG_REPORT_VERSION`), el render JSON (`version: DIAG_REPORT_VERSION`) y el TXT (`Formato  : diag-report v${DIAG_REPORT_VERSION}`). Antes: TXT «v5» hardcodeado vs JSON 6.
- **D-15:** `perf-probe.ts` — key `avgMs` → **`emaMs`** en las 3 apariciones (tipo del Map, init, update) + comentario «mezcla exponencial (EMA)». **Consumidores del key fuera del módulo: CERO** (grep). No existe label TXT que muestre el campo (el único render es el JSON de `report()` + `console.table`) → el kit pedía «label del TXT (media exponencial)»: se documenta la media exponencial en el comentario del cálculo, que es el único sitio que la describe.
- **D-16:** `entryFromQuad` — guard temprano `if (quad.length === 0)` → `bboxW/bboxH: null` (antes `-Infinity` por `Math.max(...[])`). Tipo `bboxW/bboxH: number | null` + TXT imprime `DASH` cuando null. Solo path de diag.
- **D-09:** la augmentation `declare module "@/lib/perf-probe"` de `burst-budget.ts` ensanchaba `meta` a `Record<string, unknown>` (colaba cualquier objeto en un meta tipado para primitivos). **Tipo correcto definido en ese mismo bloque:** `Record<string, number | string | boolean | null | BurstHeapProbe>` — la unión acotada del único objeto legítimo que viaja en meta (la sonda de heap del capture, `CameraView.tsx:1109`). Nota técnica: `BurstHeapProbe` es interface sin index signature → NO es asignable a `Record<string, unknown>`; la unión debe nombrar al tipo real. Cambio 100% de tipos; CERO comportamiento; el resto de burst-budget intocada.

---

## §3 — VERIFICACIÓN OBLIGATORIA (en orden, exit codes reales)

1. `bun install` ✓ (workspace completo; `bun.lock` regenerado y committeado en cada tanda).
2. `bun run core:check` = **exit 0** · `bun run ui:check` = **exit 0** · `bun run app:check` = **exit 0** · `bun run lint` = **exit 0** (0 errores; warnings preexistentes del baseline — el PR #5 estableció la tolerancia; los borraos redujeron ~177 líneas de warning a 2).
3. `bun run build:static` = **exit 0** — prerender estático `○ /` y `○ /_not-found`.
4. **Greps de humo** — las **28 deps eliminadas** → `git grep "<dep>" -- apps packages` vacío por cada una (los 2 primeros matches de `sharp` eran `sharpness` — verificado con grep de imports = vacío). `generateDemoPage` → 3 usos vivos apuntan a `demo-page`; `image-processor.ts` sin dibujo demo. `use-toast|ui/toaster|prisma|lib/db|tailwind.config` en código → **vacío**.
5. **Smoke manual** (dev :3111 + Chromium headless, cero errores de consola/página en toda la sesión):
   - (a) **Cámara simulated genera página demo** ✓ — captura → revisión → editor mostrando la factura demo «GLOBAL SYNERGY LTD.» (screenshot guardada); el pipeline completo (detect→warp→enhance) corrió sobre ella.
   - (b) **Toasts sonner ✓** — nodo `[data-sonner-toast]` presente: «🔦 No se pudo controlar la linterna aquí…» (disparo determinista con el botón de flash no disponible); `SonnerToaster` intacto.
   - (c) **Diag coherente ✓** — JSON descargado: `"version": 6`; TXT (clipboard interceptada): «Formato  : diag-report v6». Toast «Informe TXT copiado al portapapeles».
   - (d) **Biblioteca → editor → guardado ✓** — «Digitalización guardada · 1 página · pipeline OpenCV de precisión» + botones PDF, sin errores de página.
6. **Métricas:** deps lab **70 → 42** (−28) · devDeps **10 → 9** (−1) · ui deps **1 → 0** · `node_modules` **1330 → 1260 MB** (−70 MB) · `apps/scanner-lab/docs` **2.7 MB fuera** del árbol de la app (ahora `docs/lab/`) · Radix 27 → 26 (solo `react-toast`; ver D-1).

## Pendientes deliberados (excluidos del PR, con permiso del kit)

- **D-1:** 20 deps Radix muertas + 31 ui/*.tsx muertos — fuera de whitelist §6 (para borrarlas hace falta ampliarla).
- **E-21** (dead bits ZoomableVisor) y **B-09** (símbolos muertos image-processor/image-modes) — OPCIONALES, «ante duda NO».
- **E-16** (cp -r del build en Windows) — requiere script node equivalente.
- Todos los hallazgos COMPLEJO/RIESGOSO y bug fixes conductuales del §1.5 del kit — intocados por diseño.
