# AGENTS.md — Reglas para agentes IA en digitalizador-e14

## AL INICIAR CUALQUIER SESIÓN (obligatorio, en este orden)
1. Lee `docs/worklog.md` — al menos las últimas 3 entradas.
2. Lee `docs/ROADMAP.md` — identifica la primera tarea NO completada.
3. Lee `docs/DECISIONS.md` — respeta las decisiones; no las reviertas sin registrar por qué.
4. NO asumas que el código "ya funciona": verifica (`bun run dev:e14` + revisa).

## AL TERMINAR CADA SESIÓN (obligatorio, antes de cerrar)
1. Añade UNA entrada a `docs/worklog.md` (plantilla abajo). APPEND al final; NUNCA
   sobrescribas ni edites entradas de otros.
2. Actualiza los checkboxes de `docs/ROADMAP.md` según lo real.
3. Si tomaste una decisión de arquitectura/diseño, regístrala en `docs/DECISIONS.md`.
4. Commit con Conventional Commits (`feat(e14): …`, `fix(e14): …`, `docs(e14): …`).
5. Si el contexto se está acabando o te piden parar: añade además una entrada `[HANDOFF]`.

## Plantilla de entrada de worklog
### [YYYY-MM-DD hh:mm] — <fase/tarea> — <agente o "sesión manual">
- **Hecho:** <lista concreta>
- **Archivos:** <rutas tocadas>
- **Commits:** <hashes cortos>
- **Cómo probar:** <comandos + qué debería verse>
- **Pendiente/Bloqueado:** <siguiente paso exacto, con detalle suficiente para retomar>

## Campos extra de [HANDOFF]
- **Estado del servidor:** <corriendo o no, puerto>
- **Última acción a medias:** <qué estaba pasando exactamente>
- **Primer paso de la siguiente sesión:** <instrucción precisa>

## Reglas técnicas
- No toques `apps/scanner-lab` ni `packages/scanner-core` sin necesidad explícita.
- Si necesitas un cambio en el core: NO lo hagas aquí; regístralo como `[REQUIERE-CORE]`.
- Commit pequeño y frecuente > commit gigante.
- Fase gráfica: prohibido añadir dependencias de cámara/procesado.
