# HOTFIX — El deploy de main se saltaba: la concurrency del Quality Gate cancelaba la corrida llamada

**Base:** `main` @ `5874d5b` (merge de PR #4). Rama: `fix/deploy-concurrency-v1`.
**Disparo:** primer push a main con la cadena nueva del gate (merge de PR #5, `874182c`): el deploy automático quedó CANCELADO y la demo no se actualizó.

## Qué pasó (evidencia del run)

Push a main `874182c` (2026-10-16 22:18:45Z) disparó DOS corridas con el mismo commit:

| Run | Workflow | Event | Resultado |
|---|---|---|---|
| `38974978575` | Quality Gate (standalone, trigger `push`) | push | ✅ success |
| `38974978246` | Deploy to GitHub Pages (trigger `push`) | push | ❌ **cancelled** |

Jobs del run de deploy cancelado:

- `quality / checks` (workflow_call): **cancelled** — arrancó y terminó en el MISMO segundo (22:18:45), sin ejecutar ningún step.
- `build`: skipped (necesita `quality`).
- `deploy`: skipped.

Consecuencia: la demo de GitHub Pages siguió sirviendo la build de `ad4c6fa7` (sin el gate ni el muro burst de 5 s) hasta un re-deploy manual.

## Causa raíz

`quality.yml` definía concurrency **a nivel de workflow**:

```yaml
concurrency:
  group: quality-${{ github.ref }}
  cancel-in-progress: true
```

Ese bloque **también aplica cuando el workflow es invocado vía `workflow_call`** (se evalúa con el contexto del caller). En un push a main corrían DOS instancias del gate sobre el mismo `github.ref` (`refs/heads/main`):

- la **standalone** (trigger `push` de quality.yml) → grupo `quality-refs/heads/main`
- la **llamada** desde el job `quality` de `deploy-pages.yml` → el group del caller (`quality-deploy-refs/heads/main`) la protegía de OTRAS llamadas, pero el bloque workflow-level del llamado la metió de nuevo en `quality-refs/heads/main`

Ambas compartieron grupo con `cancel-in-progress: true` y arrancaron en el mismo segundo → la segunda en arrancar canceló a la primera (carrera: perdió la llamada). El job `build` de deploy-pages tiene `needs: quality` → skipped en cascada. El blindaje del PR gate-calidad-v1 (group propio del caller) era necesario pero **insuficiente**: no cubría la colisión contra la standalone.

## Fix (este PR)

Eliminar el bloque `concurrency` a nivel workflow de `quality.yml` (una sola pieza):

- **La llamada** queda protegida por el group del job caller (`quality-deploy-<ref>`, `cancel-in-progress: false`) — dos deploys de main no se pisan entre sí.
- **La standalone** corre sin grupo: nada puede cancelarla.
- **Ya no existe grupo compartido** → la carrera desaparece por construcción.

Efecto secundario aceptado: en `pull_request` se pierde `cancel-in-progress` (pushes sucesivos de una misma rama de PR acumulan runs en vez de cancelar el anterior). Es ruido de runs, no de código; el gate de cada push sigue corriendo completo.

Alternativa descartada: mover la concurrency a job-level usando `github.workflow` (que en un reusable toma el nombre del caller) para diferenciar grupos. Funciona, pero añade semántica indocumentada-sensible; la eliminación simple es predecible y verifica a simple vista.

## Verificación

- YAML parseado OK (js-yaml) — triggers y jobs intactos (solo se eliminó el bloque `concurrency` y se documentó el porqué en el propio YAML).
- CI de este PR: `Quality Gate` (trigger `pull_request`) — debe correr **sin** concurrency y dar success.
- Demostración final (tras merge, en el push a main del propio hotfix): el run `Deploy to GitHub Pages` debe completar la cadena completa `quality → build → deploy` SIN cancelaciones, en paralelo con la standalone `Quality Gate` — ambas success.
- N/A en sandbox: el race de arranque no es reproducible localmente; la verificación definitiva es el push a main del propio hotfix.

## Pendiente del dueño

- Mergear este hotfix y observar el push resultante a main (la demostración del punto anterior).
