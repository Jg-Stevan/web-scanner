# RETOMA — Saga del encuadre (recorte del Tecno KN3)

> **Estado: EN PAUSA desde el 15/10/2026** (dispositivo de prueba pendiente).
> Este documento permite retomar la saga sin contexto previo.

## 1. La pregunta abierta

El dueño reportó: la página del editor sale **recortada arriba/abajo** respecto
a lo que muestra el visor (Tecno KN3, acta E-11 como documento de prueba).
Dos hipótesis en disputa:

- **Camino cámara:** el stream (p. ej. 9:16) y la foto (3:4) tienen aspectos
  distintos → el quad nato del visor mapea mal y el recorte pierde lo visto.
- **Camino detector:** la detección en background muerde más de la cuenta.

## 2. Qué ya está hecho (no repetir)

- **Lote 5.6** — telemetría de encuadre por página (`quadSource`
  overlay/detect/none, `origW/origH`, bbox %, Δaspect stream-vs-foto).
- **Lote 5.7** — puntuador de encuadre en vivo restaurado (medidor % + barra).
- **Lote 5.7.1** — telemetría persistente: marks `page_framing` (born/detect)
  que sobreviven al guardado de la sesión; el informe trae TODAS las páginas.
- Todo mergeado a main (PR #58) y desplegado en /lab/ (15/10, 17:24).
- Telemetría VALIDADA en campo: iPhone (src=overlay, Δaspect 0.0000 —
  WYSIWYG) y A13 (src=detect, Δaspect 0.1875 — el detector toma el control
  cuando el aspecto difiere). Detector consistente entre resoluciones
  (bbox 39.3% idéntica para el mismo documento).

## 3. Protocolo de retoma (cuando llegue el Tecno)

1. Abrir https://jg-stevan.github.io/web-scanner/lab/ en el Tecno (o build local).
2. Modo Calidad, ahorro de batería OFF, dispositivo frío, acta E-11.
3. Reproducir el recorte: encuadrar, capturar, abrir editor — ¿recortada?
4. Exportar diag (Ajustes › Diagnóstico) TXT+JSON DESPUÉS de guardar
   (flujo completo — el 5.7.1 debe traer TODAS las páginas en ENCUADRE).
5. Leer la sección `-- ENCUADRE (por página)`:

   | Lectura | Veredicto |
   |---|---|
   | `src=overlay` + bbox ≈ 85-100 % + recorte visible | Camino cámara: el mapeo del quad mintió (aspecto stream≠foto) → lote 5.8 = no nacer quad overlay cuando Δaspect > umbral, forzar detect o escalar el quad |
   | `src=detect` + bbox ≈ 55-80 % + recorte visible | Camino detector: el quad muerde → lote 5.8 = ajustar detección/expandir bbox |
   | bbox ≈ 85-100 % SIN recorte visible | Falso positivo — revisar el reporte del dueño |
   | `src=none` + `pending=sí` | La detección no aterrizó — problema distinto (worker/umbral) |

6. Con el veredicto: especificar lote 5.8 (fix quirúrgico, whitelist mínima).

## 4. Datos baseline (15/10/2026, build lote5.7)

| Dispositivo | Stream | Foto | Δaspect | src | bbox | Captura→guardada |
|---|---|---|---|---|---|---|
| iPhone (iOS 26.6, Safari) | 1440×1920 | 3024×4032 | 0.0000 | overlay | 39.3%×86.7% | 0.31–0.46 s |
| Samsung A13 (SM-A135M) | 540×960 | 3024×4032 | 0.1875 | detect | 39.3%×84.5% | 1.6–1.9 s rápido · 16–17 s frío |

El Tecno KN3 completará la tercera fila — su stream/foto real es EL dato del veredicto.

## 5. Observaciones menores (no bloqueantes)

- A13, sesión 08:10: «Captura 3/3: 69.8 s · manual» — el auto-shutter no
  disparó una vez en 6 capturas de modo Calidad (5/6 auto). Si vuelve a pasar
  en la retoma, abrir línea de investigación (umbral/estabilidad en gama baja).
- QA visual pendiente del dueño: encuadre 4:3 en modo Calidad (A13).
- Al CIERRE REAL de la saga: release ritual (bump de versión, tag final,
  GitHub Release con CHANGES.md como changelog).
