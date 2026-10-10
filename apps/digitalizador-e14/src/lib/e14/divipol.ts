/**
 * Base DIVIPOL oficial (SPEC-e14-cabecera-clasificacion §1–§2): tipos + carga
 * + índices de consulta. Dominio E-14 NUEVO (este módulo NO existe en el lab
 * — prohibido copiar de scanner-lab; regla de oro 6 no aplica, §8 del spec).
 *
 * La base es el bundle compacto generado por `scripts/gen-divipol.mjs`
 * (§1.2: jerarquía por código, nombres una sola vez — 0,63 MB) a partir del
 * `departmentsTree.json` que la Registraduría publica para su visor ciudadano
 * (§1). Carga (§1.3): fetch de `/e14/divipol.json` (asset estático de
 * `public/`, servido junto a la app — con prefijo NEXT_PUBLIC_BASE_PATH bajo
 * /web-scanner/, mismo patrón que detector-client/ocr del core) + caché en
 * memoria + estado `cargando/cargada/falló` (aviso si falla; sin base la app
 * degrada a MANUAL puro, NUNCA a RECHAZADA).
 *
 * PROHIBIDO fetch a los dominios de la Registraduría en runtime (§8).
 * Sin dependencias externas (§2): trigramas de caracteres + Dice viven en
 * `clasificador.ts` (§3.3, ~40 líneas).
 */

/** Puesto de votación (stand): nombre + número de mesas (countTable). */
export interface DivipolPuesto {
  n: string;
  t: number;
}

/**
 * Nodo de la jerarquía: `n` = nombre; los hijos dependen del nivel:
 * dep → `m` (municipios/países) · mun → `z` (zonas) → `s` (puestos).
 */
export interface DivipolNodo {
  n: string;
  m?: Record<string, DivipolNodo & { z?: Record<string, { s: Record<string, DivipolPuesto> }> }>;
}

/** Base completa: { "<dep2>": DivipolNodo } (34 departamentos incl. 88=CONSULADOS). */
export interface DivipolBase {
  [dep2: string]: DivipolNodo;
}

/** Ruta completa a un puesto (para validar mesa — §3.3 regla 5). */
export interface RutaDivipol {
  dep: string;
  mun: string;
  zon: string;
  std: string;
}

/** Estado de la carga (§1.3) — el panel de corrección lo consulta. */
export type EstadoDivipol = "cargando" | "cargada" | "fallo";

// GitHub Pages sirve la app bajo /web-scanner/ → el asset se referencia con
// el prefijo público del build (vacío en dev/servidor local) — mismo patrón
// que detector-client.ts L160-161 del core (WORKER_URL).
const PUBLIC_BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const DIVIPOL_URL = `${PUBLIC_BASE}/e14/divipol.json`;

let cache: DivipolBase | null = null;
let estado: EstadoDivipol = "cargando";
let promesa: Promise<DivipolBase> | null = null;

/**
 * Carga la base (caché en módulo, idempotente — §2). NUNCA rechaza: si el
 * fetch falla resuelve con base VACÍA y marca `estado = "fallo"` (la app
 * degrada a MANUAL puro — §1.3, prohibido RECHAZADA por falta de base).
 */
export function cargarDivipol(): Promise<DivipolBase> {
  if (cache) return Promise.resolve(cache);
  if (promesa) return promesa;
  promesa = (async () => {
    try {
      const res = await fetch(DIVIPOL_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const base = (await res.json()) as DivipolBase;
      if (!base || typeof base !== "object" || Object.keys(base).length === 0) {
        throw new Error("BASE VACÍA O MALFORMADA");
      }
      cache = base;
      estado = "cargada";
      return base;
    } catch (err) {
      console.warn(
        `[e14] divipol: no se pudo cargar (${err instanceof Error ? err.message : "?"}) ` +
          `— la clasificación degrada a MANUAL`,
      );
      cache = {}; // vacía: clasificador → MANUAL, panel en texto libre
      estado = "fallo";
      return cache;
    }
  })();
  return promesa;
}

/** Estado actual de la carga (§1.3 — para avisos y degradación del panel). */
export function estadoDivipol(): EstadoDivipol {
  return estado;
}

/** Departamentos con código: [{ codigo: "88", nombre: "CONSULADOS" }]. */
export function departamentosDe(base: DivipolBase): Array<{ codigo: string; nombre: string }> {
  return Object.entries(base)
    .map(([codigo, dep]) => ({ codigo, nombre: dep.n }))
    .sort((a, b) => a.codigo.localeCompare(b.codigo));
}

/** Municipios/países de un departamento (§1.1: en el 88 son PAÍSES). */
export function municipiosDe(
  base: DivipolBase,
  dep2: string,
): Array<{ codigo: string; nombre: string }> {
  const dep = base[dep2];
  if (!dep?.m) return [];
  return Object.entries(dep.m)
    .map(([codigo, mun]) => ({ codigo, nombre: mun.n }))
    .sort((a, b) => a.codigo.localeCompare(b.codigo));
}

/** Zonas de un municipio (solo código — la zona no tiene nombre en la base). */
export function zonasDe(base: DivipolBase, dep2: string, mun3: string): Array<{ codigo: string }> {
  const mun = base[dep2]?.m?.[mun3];
  if (!mun?.z) return [];
  return Object.keys(mun.z)
    .sort()
    .map((codigo) => ({ codigo }));
}

/** Puestos de una zona (código + nombre + número de mesas). */
export function puestosDe(
  base: DivipolBase,
  dep2: string,
  mun3: string,
  zon2: string,
): Array<{ codigo: string; nombre: string; mesas: number }> {
  const zona = base[dep2]?.m?.[mun3]?.z?.[zon2];
  if (!zona?.s) return [];
  return Object.entries(zona.s)
    .map(([codigo, p]) => ({ codigo, nombre: p.n, mesas: p.t }))
    .sort((a, b) => a.codigo.localeCompare(b.codigo));
}

/** Mesa válida: el puesto de la ruta existe y 1 ≤ mesa ≤ countTable (§3.3 regla 5). */
export function mesaValida(base: DivipolBase, ruta: RutaDivipol, mesa: number): boolean {
  const puesto = base[ruta.dep]?.m?.[ruta.mun]?.z?.[ruta.zon]?.s?.[ruta.std];
  if (!puesto) return false;
  return Number.isInteger(mesa) && mesa >= 1 && mesa <= puesto.t;
}

/**
 * Busca puestos por NOMBRE en toda la base (§3.3 estrategia 3: deducir
 * municipio/departamento cuando el operador solo tiene el nombre — p. ej.
 * el LUGAR leído del acta). Devuelve rutas completas con similitud SIN
 * filtrar (el llamador aplica su propio umbral).
 */
export function buscarPuestosPorNombre(
  base: DivipolBase,
  nombre: string,
): Array<RutaDivipol & { nombre: string; mesas: number }> {
  const out: Array<RutaDivipol & { nombre: string; mesas: number }> = [];
  for (const [dep2, dep] of Object.entries(base)) {
    for (const [mun3, mun] of Object.entries(dep.m ?? {})) {
      for (const [zon2, zona] of Object.entries(mun.z ?? {})) {
        for (const [std, puesto] of Object.entries(zona.s ?? {})) {
          if (puesto.n === nombre) {
            out.push({ dep: dep2, mun: mun3, zon: zon2, std, nombre: puesto.n, mesas: puesto.t });
          }
        }
      }
    }
  }
  return out;
}
