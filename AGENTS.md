# AGENTS.md — reglas obligatorias para cualquier IA/humano de este repo

## ⚠️ REGLA DE ORO #0 — EL LAB ES LA FUENTE DE VERDAD · EXTRAE, NO COPIES
`apps/scanner-lab/` es el producto validado por el dueño. ANTES de implementar
CUALQUIER cosa (lógica **o** UI/diseño) busca si ya existe en el lab:

1. Si existe y la necesita UNA sola app → COPIA VERBATIM el bloque a la app
   destino, con comentario de origen: `// Fuente: apps/scanner-lab/<ruta> L<ini>–L<fin>`
   y adapta SOLO el "re-vestido" (tokens de color/clases). NUNCA re-escribas
   ni "simplifiques" la lógica copiada (el intento de simplificar causó el
   bug F-LENS: la cámara abría la lente gran angular — ver D33).
2. Si existe y la necesitan DOS O MÁS apps (o es lógica/UI reutilizable del
   dominio) → EXTRAER al paquete compartido que corresponda —
   `packages/scanner-core` (lógica sin React: motor, stores, formatos,
   cámara) o `packages/scanner-ui` (componentes React reutilizables) — e
   importar desde ahí. NUNCA dupliques el bloque entre apps: la copia
   puente es EXCEPCIÓN temporal documentada (con origen y plan de retirada),
   no el patrón por defecto. La extracción que añade API pública: bump
   minor del paquete.
3. Si NO existe → impleméntalo siguiendo las specs en
   `apps/digitalizador-e14/docs/` y registra la decisión en
   `apps/digitalizador-e14/docs/DECISIONS.md` (histórico del repo origen:
   esas rutas vivían en el monorepo pre-split; en este repo el equivalente
   es `docs/` y `docs/DECISIONS.md` de la raíz).
4. Ante la duda: extraer al paquete si es compartible; copiar del lab solo
   si es específico de una app. Nunca "mejorar" el lab.

Referencias: docs/SPEC-fase-logica.md §12 · docs/DECISIONS.md (D33/D34) ·
docs/worklog.md (veredictos FIEL/ADAPTACIÓN/DESVIACIÓN).
