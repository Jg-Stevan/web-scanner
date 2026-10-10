# SPEC — e14: clasificación de cabecera contra base DIVIPOL oficial + fin del «ACTA NO RECONOCIDA»

Rev. 1 — 2026-10-10 · Rama sugerida: `feat/e14-clasificacion-cabecera`
Lectura previa OBLIGATORIA: `download/ANALISIS-e14-identificacion-datos.md` (señales de página/tipo/ubicación ya verificadas en 8 documentos reales).
Archivo de trabajo del agente: `/home/z/my-project/worklog.md` (leer antes de empezar; añadir registro al terminar).

---

## 0. Alcance (decisión de producto del dueño)

**ENTRA:** extraer SOLO los datos IMPRESOS del documento (cabecera + banda + ver/pag + pie de formulario) para saber dónde va cada foto, y archivarla en su mesa/cuerpo/página. Base de datos oficial precargada. Eliminar el veredicto «ACTA NO RECONOCIDA» por fallo de OCR de cabecera.

**NO ENTRA (decisión del dueño, no simplificar ni inventar aquí):**
- Lectura de manuscritos (votaciones por candidato, firmas, cédulas, X de recuento). Los campos G.2/G.3 del análisis quedan FUERA; el flujo de revisión humana existente los sigue cubriendo.
- Consulta en vivo a AppSync (queda documentado como fase futura en el análisis §G.4.6).
- Cambios en `apps/scanner-lab` (prohibido; regla de oro). Esta spec es 100 % dominio E-14: es código NUEVO dentro de `apps/digitalizador-e14`.

---

## 1. Fuente de verdad nueva: la base DIVIPOL del visor oficial

El visor ciudadano 2026 (E14VisorCiudadano v2.3.2) consume una base que la propia Registraduría publica como JSON estáticos. Descarga verificada hoy (2026-10-10) — el WAF del portal bloquea navegadores headless pero SÍ responde a peticiones con User-Agent de navegador:

```bash
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
B="https://e14segundavueltapresidente.registraduria.gov.co"
curl -s "$B/assets/temis/divipol_json/allDepartments.json"     -H "User-Agent: $UA" -o allDepartments.json
curl -s "$B/assets/temis/divipol_json/departmentsTree.json"    -H "User-Agent: $UA" -o departmentsTree.json
```

Contenidos reales descargados:
- `allDepartments.json` (3,3 KB): 34 departamentos con `idDepartmentCode` (2 dígitos) + `departmentName`. **El 88 = CONSULADOS** (no es divipola DANE: es el código de la Registraduría para el exterior).
- `departmentsTree.json` (4,64 MB): jerarquía completa `departamento → municipio → zona → puesto (stand) → countTable`:
  - 1.189 municipios (en el 88 son PAÍSES; p. ej. `335 EGIPTO`, `120 ALEMANIA` — 67 países),
  - 3.013 zonas, **14.438 puestos** con `standCode`, `standName` y `countTable` (número de mesas del puesto).
- (Referencia, NO bundear: `allTransmissionCodes.json`, 36,7 MB — índice de actas publicadas con estados 3=pendiente / 11=publicada y `expectedName` hash del PDF.)

### 1.1 Validación contra las muestras del dueño (hecha, coincide 1:1)

| Muestra del dueño | En la base descargada |
|---|---|
| Cairo KIT 399: `ZONA 05 · PUESTO 02 · MESA 001` | `88 → 335 EGIPTO → zona 05 → puesto 02 "El Cairo - Consulado" → countTable 1` |
| Frankfurt mesa 012 | `88 → 120 ALEMANIA → zona 15 → puesto 02 "Frankfurt Consulado" → countTable 12` |
| Bremen mesas 001/002 | `88 → 120 ALEMANIA → zona 05 → puesto 02 "Berlin Consulado" → countTable 9` |

Mapeo de campos impreso→base (igual al del análisis §E): `CONSULADO/DEPARTAMENTO → idDepartmentCode`, `PAÍS/MUNICIPIO → municipalityCode`, `ZONA → idZoneCode`, `PUESTO → standCode`, `MESA → numberStand (validar ≤ countTable)`, `LUGAR → standName`.

### 1.2 Bundle compacto para la app (OBLIGATORIO generar así)

Del `departmentsTree.json` generar un único JSON compacto (estructuras por código, nombres una sola vez). Medido: **0,63 MB** (≈0,16 MB gzip). Plantilla exacta de la forma (los agentes NO deben cambiarla sin registrar por qué):

```jsonc
// { "<dep2>": { "n": "NOMBRE DEPTO", "m": { "<mun3>": { "n": "NOMBRE MUN/PAÍS", "z": { "<zon2>": { "s": { "<stand2>": { "n": "NOMBRE PUESTO", "t": countTable } } } } } } } }
```

Script de generación (verificado hoy, salida 0,63 MB — guardar como `apps/digitalizador-e14/scripts/gen-divipol.mjs` con la MISMA lógica; queda documentado para regenerarlo cuando la Registraduría actualice la base):

```js
// Entrada: departmentsTree.json (descargado según §1). Salida: public/e14/divipol.json
// Limpiar basura previa al primer '{' del archivo descargado antes de JSON.parse.
const edges = JSON.parse(raw.slice(raw.indexOf('{'))).data.departmentsTree.edges;
const out = {};
for (const { node: d } of edges) {
  const dep = (out[d.idDepartmentCode] ??= { n: d.departmentName, m: {} });
  for (const mu of d.municipalities) {
    const mun = (dep.m[mu.municipalityCode] ??= { n: mu.municipalityName, z: {} });
    for (const zo of mu.zones)
      for (const st of zo.stands)
        (mun.z[zo.idZoneCode] ??= { s: {} }).s[st.standCode] = { n: st.standName, t: st.countTable };
  }
}
// escribir JSON.stringify(out) sin espacios
```

Criterios: 34 deps · 1.189 mun · 3.013 zonas · 14.438 puestos. Si los conteos difieren, parar y reportar (la base pudo cambiar).

### 1.3 Carga en la app

- Guardar en `apps/digitalizador-e14/public/e14/divipol.json` y consumir con **import estático** (`import divipol from "@/../public/e14/divipol.json"` — resolver con `resolveJsonModule`) para garantizar offline (la app escanea sin red). Si el import de 0,63 MB molesta al bundle, alternativa aceptada: `fetch("/e14/divipol.json")` en arranque con caché en memoria + estado `cargada/cargando/falló` (mostrar aviso si falló; sin base la app degrada a MANUAL puro, nunca a RECHAZADA).
- Prohibido fetch a los dominios de la Registraduría en runtime (WAF + CORS + offline).

---

## 2. Módulo `src/lib/e14/divipol.ts` (NUEVO)

Tipos + carga + índices. Sin dependencias externas (nada de librerías fuzzy: implementar trigramas en ~40 líneas).

```ts
export interface DivipolPuesto { n: string; t: number }            // standName, countTable
export interface DivipolNodo {
  n: string;                                                        // nombre
  m?: Record<string, DivipolNodo & { z?: Record<string, { s: Record<string, DivipolPuesto> }> }>;
}
export interface DivipolBase { [dep2: string]: DivipolNodo }
export async function cargarDivipol(): Promise<DivipolBase>;        // caché en módulo; idempotente
export function municipiosDe(base, dep2): Array<{ codigo: string; nombre: string }>;
export function zonasDe(base, dep2, mun3): Array<{ codigo: string }>;
export function puestosDe(base, dep2, mun3, zon2): Array<{ codigo: string; nombre: string; mesas: number }>;
export function mesaValida(base, ruta, mesa: number): boolean;      // 1 ≤ mesa ≤ countTable
```

---

## 3. Módulo `src/lib/e14/clasificador.ts` (NUEVO)

Implementa EXACTAMENTE las señales del análisis (§C páginas, §D tipo, §E ubicación). Solo impresos.

### 3.1 Normalización (para nombres)
`NFKD → quitar diacríticos → MAYÚSCULAS → colapsar espacios → recortar`. Para tokens NUMÉRICOS: mapa de confusión OCR `O→0, Q→0, I→1, L→1, S→5, B→8` (solo dentro de tokens que deban ser números; nunca aplicarlo a nombres).

### 3.2 Anclas de extracción (regex tolerantes; ajustar con evidencia del OCR real, documentar cada cambio)
```
DEPARTAMENTO|CONSULADO : /^\s*(DEPARTAMENTO|CONSULADO)\s*[:.]?\s*(\d{1,2})?\s*[-–—]?\s*([A-ZÁÉÍÓÚÑÜ .'-]{3,})?/im
PAÍS|MUNICIPIO         : /^\s*(PA[IÍ]S|MUNICIPIO)\s*[:.]?\s*(\d{1,3})?\s*[-–—]?\s*([A-ZÁÉÍÓÚÑÜ .'-]{3,})?/im
ZONA                   : /ZONA\s*[:.]?\s*(\d{1,2}|URBANA|RURAL)/im
PUESTO                 : /PUESTO\s*[:.]?\s*(\d{1,2})/im
MESA                   : /MESA\s*[:.Nº#]?\s*(\d{1,3})/im
LUGAR                  : /LUGAR\s*[:.]?\s*([A-ZÁÉÍÓÚÑÜ0-9().,\-' ]{3,})/im
BANDA (tipo copia)     : /TRANSMISI[OÓ]N/  → "TRANSMISION" | /C[OÓ]NSUL|EMBAJADOR|DELEGADOS/ → "DELEGADOS"   (señal primaria §D.1; CLAVEROS existe pero NO se archiva)
VER/PAG/DE             : /Ver\.?\s*:?\s*(\d{1,2})\s*Pag\.?\s*:?\s*(\d{1,2})\s*de\s*(\d{1,2})/i
PIE (kit)              : /No\.?\s*Form\.?\s*:?\s*(\d{1,6})/i  ·  /KIT\s*(\d{1,6})/i
```
Si un anchor no matchea, es normal (campo ausente → baja a fuzzy/manual). NO relajar a ciegas.

### 3.3 Fuzzy (trigramas de caracteres + Dice)
```ts
function similitud(a: string, b: string): number  // trigramas, Dice: 2·|A∩B| / (|A|+|B|)
```
Estrategia por campo (en orden):
1. **Código leído + existe bajo el padre correcto** → match exacto, confianza 1.0.
2. **Nombre leído** → fuzzy contra los hijos del padre ya resuelto (acota candidatos: municipio ∈ dep; puesto ∈ mun+zona). Similitud ≥ 0.82 → AUTO; 0.60–0.81 → SUGERIDA; < 0.60 → MANUAL.
3. **Municipio sin departamento legible**: si el nombre matchea UN solo municipio en toda la base ≥ 0.82 → deducir departamento (la base tiene repetidos: si hay 2+ candidatos, MANUAL con lista).
4. **Puesto**: preferir el `PUESTO:` numérico; usar `LUGAR:` como verificación (fuzzy contra standName del puesto elegido; si difiere mucho → bajar un nivel de confianza).
5. **Mesa**: número; validar `1 ≤ mesa ≤ countTable` (si falla → SUGERIDA con aviso, nunca descartar).

### 3.4 Veredicto
```ts
export type NivelClasificacion = "AUTO" | "SUGERIDA" | "MANUAL";
export interface ClasificacionE14 {
  departamento: { codigo: string; nombre: string } | null;
  municipio:    { codigo: string; nombre: string } | null;
  zona:         { codigo: string } | null;
  puesto:       { codigo: string; nombre: string } | null;
  mesa:         number | null;
  tipo:         "TRANSMISION" | "DELEGADOS" | null;
  pagina:       { index: number; total: number } | null;   // del "Ver/Pag/de"
  kit:          number | null;
  nivel:        NivelClasificacion;
  confianzas:   { departamento: number; municipio: number; puesto: number; tipo: number };
}
export function clasificarCabecera(ocrTexto: string, base: DivipolBase): ClasificacionE14;
```
Reglas: `AUTO` exige dep+mun+puesto resueltos con código o ≥0.82 y mesa válida y tipo leído. Si falta tipo → `tipo: null` y nivel máx. SUGERIDA (el análisis §D.4 prohíbe asumir el tipo). Si `PATRON_CABECERA` actual matchea pero el clasificador no llega a AUTO → SUGERIDA (nunca usar el regex como pase libre).

---

## 4. Cambio del gate «ACTA NO RECONOCIDA» (`scanner-core-bridge.ts`)

Hoy (L72, L309–311 y L446–449):
```ts
const PATRON_CABECERA = /E\s*-\s*14|REGISTRADURIA|REGISTRADURÍA/i;
const legible = ocrTextIsValid(texto) && PATRON_CABECERA.test(texto);
const status: ActaStatus = legible ? statusDeScore(score) : "RECHAZADA";
```
Problema real medido: el OCR lee 147 palabras correctas del acta pero no el literal "E-14"/"REGISTRADURÍA" → veredicto RECHAZADA con foto perfecta (hallazgo del worklog anterior). Nuevo comportamiento:

1. **RECHAZADA solo por CALIDAD de imagen** (`score < 6.5`, vía `statusDeScore`). El copy y la tarjeta «ACTA NO RECONOCIDA» (ReviewView L321) quedan reservados a este caso. La regla de 2 intentos queda intacta.
2. **Calidad suficiente (≥ 6.5) + OCR válido:**
   - `nivel === "AUTO"` → status por score (OPTIMA/ADVERTENCIA) como hoy + persistir `acta.clasificacion` + (Fase B) archivar en su mesa.
   - `nivel === "SUGERIDA"` o `"MANUAL"` → **`EN_REVISION_HUMANA`** con el panel de corrección (§5) precargado con la sugerencia. **PROHIBIDO** RECHAZADA por cabecera. La foto era buena: lo único fallido fue leer la cabecera, y eso lo corrige el operador en 5 toques.
3. `ocrTextIsValid` falso (sin texto) + calidad ≥ 6.5 → también `EN_REVISION_HUMANA` (panel vacío), NO RECHAZADA.
4. El gate se aplica en AMBOS pipelines (escaneo L309–311 y recorte L446–449) con el mismo criterio — extraer a un helper único `evaluarGate(score, ocrTexto, base)` para no duplicar.
5. `PATRON_CABECERA` se mantiene como constante (se usa para traza/log), pero ya NO decide sola el estado.
6. Log de pipeline (L313–322): añadir `clasif={dep:88,mun:335,zon:05,std:02,mesa:001,tipo:T,nivel:AUTO}` para auditoría en consola.

## 5. Panel de corrección manual (ReviewView, NUEVO bloque)

Se muestra cuando `status === "EN_REVISION_HUMANA"` y hay `clasificacion` pendiente (encima de las acciones actuales, sin quitar nada):
- Selects en cascada con datos de la base: Departamento (34) → Municipio/PAÍS del dep → Zona del mun → Puesto de la zona → Mesa (`1..countTable`, input numérico) + toggle tipo **TRANSMISIÓN / DELEGADOS** + páginas 1/2 (deshabilitar 2 si el formato de esta mesa es de 1 página… default 2, según `Ver/Pag/de`).
- Cada select muestra `código — nombre` (p. ej. `335 — EGIPTO`, `02 — El Cairo - Consulado`). Precargados con la sugerencia SUGERIDA.
- Estilo: componentes existentes (`components/ui`), máx-h con scroll si crece (`max-h-96 overflow-y-auto`), touch targets ≥44px.
- Botón **GUARDAR UBICACIÓN** → persiste `acta.clasificacion` con nivel AUTO-manual → pasa a flujo normal de envío (ADVERTENCIA-equivalente). Botón secundario **REPETIR FOTO** → comportamiento actual de rescaneo.
- Sin base cargada: el panel abre con los 5 campos como texto libre (degradación, §1.3).

## 6. Fase B — archivado «dónde va» (vista ACTAS con mesas reales)

- Clave de mesa: `${dep}-${mun}-${zon}-${std}-${mesa}` (códigos con ceros, p. ej. `88-335-05-02-001`).
- `store.ts`: las mesas de la vista ACTAS dejan de ser solo el seed — la lista se construye de las `clasificacion` guardadas (mesa nueva = tarjeta nueva con título `standName · MESA {mesa}`); el seed se mantiene para el modo demo actual. Cuerpos `DELEGADOS | TRANSMISIÓN` × páginas 1/2 (modelo `TipoPagina` ya existente en types.ts L89) — la foto clasificada ocupa su hueco; duplicado de un mismo hueco → reemplaza y avisa (análisis §G.4.1).
- Persistencia local ya existente del store (queda igual); campos nuevos en `Acta`: `clasificacion?: ClasificacionE14` (types.ts, opcional — compatible con seed).
- Nombre de salida al exportar (§G.4.5 del análisis): `E14_{KIT}_{dep}_{mun}_{zon}_{puesto}_{mesa}_{TIPO}-{pag}.jpg`.

## 7. Criterios de aceptación (verificables por el auditor con Agent Browser + consola)

- **AC1** `public/e14/divipol.json` presente con exactamente 34 deps / 1.189 mun / 3.013 zonas / 14.438 puestos; cargable offline (sin fetch externo en runtime).
- **AC2** Con el OCR real de las muestras del dueño (Cairo KIT 399 y Frankfurt): clasificación AUTO `88·335·05·02·001·TRANSMISION` y `88·120·15·02·012` respectivamente (o SUGERIDA con 1 corrección si el OCR de esa foto degradado no llega al umbral — demostrar cuál y por qué).
- **AC3** Foto nítida cuyo OCR no contiene "E-14"/"REGISTRADURÍA": estado `EN_REVISION_HUMANA` con panel de corrección (NUNCA RECHAZADA). Es el caso que hoy produce «ACTA NO RECONOCIDA» — reproducir antes y después.
- **AC4** Foto borrosa (score < 6.5): RECHAZADA igual que hoy (regla de calidad intacta, 2 intentos).
- **AC5** Tras GUARDAR UBICACIÓN, el acta queda archivada en la mesa/clave correcta en la vista ACTAS (Fase B) con su tipo y página.
- **AC6** `bun run lint` + `tsc --noEmit` limpios. Cero cambios en `apps/scanner-lab`.
- **AC7** Log de pipeline incluye `clasif={...}` por captura.

## 8. Prohibiciones (regla de oro)

- Nada de `apps/scanner-lab` (ni leer para copiar: este módulo NO existe en el lab; es dominio E-14 nuevo).
- NO extraer manuscritos, NO inventar campos G.2/G.3, NO relajar los anchors regex más allá de lo evidenciado (cada ajuste → comentario `// Fuente:` con el motivo y el texto OCR real que lo justifica).
- NO simplificar la base (prohibido recortar puestos/zonas "que no se usan").
- NO llamar a los dominios de la Registraduría desde la app en runtime.
- Mantener la barra de 5 botones y todo lo aprobado en PR #8 / D38 / D39 intacto.
