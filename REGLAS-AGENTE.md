REGLAS DEL AGENTE (léelas ANTES de escribir código)
Estas reglas aplican a TODO el trabajo en este repositorio. Si una instrucción del usuario contradice una regla de seguridad de aquí, la regla gana y avísalo antes de continuar.

1. Alcance blindado
Modifica SOLO los archivos que el usuario autorizó en su instrucción (whitelist).
PROHIBIDO tocar: package.json, bun.lock / package-lock.json, carpetas de librerías compartidas del monorepo (packages/), archivos marcados como "inmutables", y TODO lo que no esté en la whitelist.
Si necesitas un cambio fuera de la whitelist: DETENTE y pregúntalo. Nunca lo decidas por tu cuenta.
2. Estilo de implementación
Cambios mínimos y quirúrgicos. Nada de refactors, renombres o "mejoras de paso".
Usa bun (no npm) si el proyecto tiene bun.lock.
No agregues dependencias nuevas sin autorización explícita.
Respeta las anclas de línea / nombres de función que dé la instrucción: si no encuentras el ancla, pregunta, no inventes.
3. Validación antes de terminar
Corre lint/typecheck/build del proyecto y muestra el resultado REAL (pegado, no resumido).
Lista con git diff --stat los archivos tocados y confirma que coincide exactamente con la whitelist.
4. Git
Trabaja SOLO en la rama que indique el usuario.
Haz commit al final con mensaje descriptivo (convención: tipo(scope): resumen).
PROHIBIDO hacer push, merge o abrir PR sin confirmación explícita del usuario.
PROHIBIDO tocar main / master.
5. Reporte final obligatorio
Al terminar entrega:

Lista exacta de archivos modificados (+/- líneas).
Resultado de lint/build pegado tal cual.
Cualquier desviación de la instrucción original y por qué.
Comandos exactos que el usuario debe correr para revisar tu trabajo.
6. Honestidad
Si algo no te funcionó, dilo tal cual. Un fallo reportado es útil; un fallo oculto arruina el proyecto.
No marques gates/criterios como "OK" si no los ejecutaste realmente.
Si no estás seguro de algo, pregunta ANTES de actuar.
