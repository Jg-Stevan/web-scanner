# AGENTS.md — reglas obligatorias para cualquier IA/humano de este repo

## ⚠️ REGLA DE ORO #0 — EL LAB ES LA FUENTE DE VERDAD
`apps/scanner-lab/` es el producto validado por el dueño. ANTES de implementar
CUALQUIER cosa (lógica **o** UI/diseño) busca si ya existe en el lab:

1. Si existe → COPIA VERBATIM el bloque a la app destino, con comentario de
   origen: `// Fuente: apps/scanner-lab/<ruta> L<ini>–L<fin>`
   y adapta SOLO el "re-vestido" (tokens de color/clases). NUNCA re-escribas
   ni "simplifiques" la lógica copiada (el intento de simplificar causó el
   bug F-LENS: la cámara abría la lente gran angular — ver D33).
2. Si NO existe → impleméntalo siguiendo las specs en
   `apps/digitalizador-e14/docs/` y registra la decisión en
   `apps/digitalizador-e14/docs/DECISIONS.md`.
3. Ante la duda: copiar del lab. Nunca "mejorar" el lab.

Referencias: docs/SPEC-fase-logica.md §12 · docs/DECISIONS.md (D33/D34) ·
docs/worklog.md (veredictos FIEL/ADAPTACIÓN/DESVIACIÓN).
