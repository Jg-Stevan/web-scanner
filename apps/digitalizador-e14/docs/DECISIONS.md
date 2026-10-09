# Decisiones — digitalizador-e14

| # | Fecha | Decisión | Motivo |
|---|-------|----------|--------|
| D1 | hoy | Bridge pattern: vistas → E14Bridge → mock ahora, scanner-core después | Conectar el core tocando 1 archivo |
| D2 | hoy | Score SIEMPRE /10 (code.html v2 confirma) — se descarta el "/30" | Claridad |
| D3 | hoy | Vistas por estado en shell único (zustand), no rutas separadas | Feel de app nativa, consistencia con scanner-lab |
| D4 | hoy | ÓPTIMA (≥8) se envía AUTOMÁTICAMENTE al capturar (chips "ENVIADO AUTOMÁTICAMENTE") | Comportamiento mostrado en los mocks |
| D5 | hoy | EN_REVISION_HUMANA es estado terminal del acta en esta fase (badge ámbar en listas) | Nueva salida del diseño v2 |
| D6 | 2026-10-09 | `ActaFirma.estado` ampliado con "TENUE" | Reproducir el marcado ámbar "TRAZO TENUE" de las pantallas de advertencia del zip v2 (7.2/7.8); aditivo, no rompe el contrato §6 |
| D7 | 2026-10-09 | La página objetivo del escaneo (mesa/tipo/pág) vive en el STORE, no en el dominio Acta | Mantener §6 exacto; la orquestación es estado de sesión |
| D8 | 2026-10-09 | Regla de desbloqueo ABSOLUTA: el 2º intento siempre genera ≥8 (aunque el chip RECHAZADA siga activo) | §7.5 literal ("si 2º rechazo → fuerza ≥8 para desbloquear el demo"): nunca hay bloqueo |
| D9 | 2026-10-09 | Breadcrumb (§7.4) y chips de envío automático se muestran en ENVIADA aunque el mock 9.8 no los tenga | El spec §7.4 los exige explícitamente; el zip superpuesta los contiene |
| D10 | 2026-10-09 | El papel del acta usa la paleta clara de Tailwind (neutral/red/amber/blue) y el cromo usa tokens §5 | El documento es contenido (papel real), no UI del tema — calca el code.html |
| D11 | 2026-10-09 | RESUMEN: barra segmentada de 12 × 4px (no la barra simple del code.html) | §7.7 explícito + DESIGN.md ("segmented progress bars for fractional data") |
| D12 | 2026-10-09 | H1 de RESUMEN corregido a "RESUMEN DE TRABAJO"; el zip v2 decía "CONTROL ACTAS E-14" | Typo del diseño fuente (docs/design/screens/resumen_de_trabajo/code.html); el nombre canónico de la pantalla es el de su carpeta (QA post-fase-gráfica, Fix B) |
| D13 | 2026-10-09 | Pages dual — digitalizador-e14 en la raíz `/` y scanner-lab en `/lab/`; se elimina el input `app` del workflow (fin del modo switch) | El dueño necesita el escáner original SIEMPRE disponible para pruebas y el E-14 como demo pública; un solo sitio Pages, artifact anidado (`out/lab`), basePath de scanner-lab desde env |
