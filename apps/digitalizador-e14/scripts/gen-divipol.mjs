/**
 * Genera public/e14/divipol.json (bundle compacto de la base DIVIPOL oficial).
 *
 * Fuente de verdad (SPEC-e14-cabecera-clasificacion §1): el visor ciudadano
 * 2026 de la Registraduría publica JSON estáticos; el WAF del portal bloquea
 * navegadores headless pero SÍ responde con User-Agent de navegador:
 *
 *   UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
 *   B="https://e14segundavueltapresidente.registraduria.gov.co"
 *   curl -s "$B/assets/temis/divipol_json/departmentsTree.json" -H "User-Agent: $UA" -o /tmp/departmentsTree.json
 *   node scripts/gen-divipol.mjs /tmp/departmentsTree.json
 *
 * PROHIBIDO llamar a los dominios de la Registraduría desde la app en runtime
 * (WAF + CORS + offline): este script se corre UNA VEZ al preparar el release.
 *
 * Lógica VERBATIM del spec §1.2 (misma forma del JSON compacto; los conteos
 * de guard son los medidos y verificados contra las muestras del dueño:
 * Cairo KIT 399 · Frankfurt mesa 012 · Bremen mesas 001/002).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const entrada = process.argv[2] ?? "/tmp/departmentsTree.json";
const salida = resolve(__dirname, "../public/e14/divipol.json");

const raw = await readFile(entrada, "utf8");
// Limpiar basura previa al primer '{' del archivo descargado antes de JSON.parse.
const edges = JSON.parse(raw.slice(raw.indexOf("{"))).data.departmentsTree.edges;

const out = {};
let totalMun = 0,
  totalZonas = 0,
  totalPuestos = 0;
for (const { node: d } of edges) {
  const dep = (out[d.idDepartmentCode] ??= { n: d.departmentName, m: {} });
  for (const mu of d.municipalities) {
    totalMun += 1;
    const mun = (dep.m[mu.municipalityCode] ??= { n: mu.municipalityName, z: {} });
    for (const zo of mu.zones) {
      totalZonas += 1;
      for (const st of zo.stands) {
        totalPuestos += 1;
        (mun.z[zo.idZoneCode] ??= { s: {} }).s[st.standCode] = { n: st.standName, t: st.countTable };
      }
    }
  }
}

// Guard del spec §1.2: si los conteos difieren, parar y reportar (la base
// pudo cambiar). Medido y verificado 2026-10-10 contra las muestras del dueño.
const esperados = { deps: 34, mun: 1189, zonas: 3013, puestos: 14438 };
const reales = { deps: edges.length, mun: totalMun, zonas: totalZonas, puestos: totalPuestos };
for (const [k, v] of Object.entries(esperados)) {
  if (reales[k] !== v) {
    console.error(
      `ABORT: conteo ${k}=${reales[k]} ≠ esperado ${v} — la base DIVIPOL cambió; ` +
        `revisar spec §1.2 antes de regenerar (prohibido simplificar la base).`,
    );
    process.exit(1);
  }
}

await mkdir(dirname(salida), { recursive: true });
// escribir JSON.stringify(out) sin espacios
await writeFile(salida, JSON.stringify(out));
console.log(
  `OK ${salida}: ${reales.deps} deps · ${reales.mun} mun · ${reales.zonas} zonas · ` +
    `${reales.puestos} puestos · ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`,
);
