# Política de seguridad

## Versiones con soporte

Este proyecto se desarrolla en `main`. La versión soportada es siempre la última
publicada en `main` (y en el registro de npm cuando aplique). Las versiones
antiguas no reciben parches de seguridad: actualizar a la última.

## Cómo reportar una vulnerabilidad

1. **Canal preferido:** GitHub Security Advisories — pestaña *Security* del repo
   y luego *Report a vulnerability*. Es un canal privado: el detalle no se
   expone públicamente.
2. **Alternativa:** correo al mantenedor con asunto `[SECURIDAD] <repo>`.

Incluye, si es posible: descripción del problema, pasos para reproducirlo,
impacto estimado y evidencia (logs, capturas, commits). Indica si quieres
crédito público por el reporte.

## Compromiso de respuesta

- Acuse de recibo: dentro de 72 horas.
- Evaluación y plan de mitigación: dentro de 7 días.
- Corrección y aviso público coordinado: según severidad; un problema crítico
  se atiende lo antes posible.

## Alcance

Aplica al código de este repositorio y a los paquetes que publica. Quedan fuera
de alcance: servicios de terceros, dependencias sin vía de explotación real
(reportarlas aguas arriba al proyecto correspondiente) y problemas sin impacto
de seguridad.

## Reglas para quien reporta

- Pruebas de concepto: sí. Exfiltración o destrucción de datos reales: no.
- No interrumpir servicios ni afectar datos de terceros.

## Secretos y credenciales

Ningún token, llave o credencial debe viajar en el código, commits, issues ni
documentación. Si filtraste una credencial: revócala primero, reporta después.
Los secretos de CI viven únicamente en GitHub Actions Secrets o en variables de
entorno de sesión.
