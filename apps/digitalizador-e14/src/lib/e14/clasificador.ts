/**
 * Clasificador de cabecera E-14 (SPEC-e14-cabecera-clasificacion §3): extrae
 * SOLO los datos IMPRESOS del OCR (cabecera + banda + ver/pag + pie de
 * formulario — §0) y los resuelve contra la base DIVIPOL para saber dónde va
 * cada foto. Dominio E-14 NUEVO (§8: este módulo NO existe en el lab).
 *
 * Señales = anclas §3.2 (VERBATIM del spec, señales ya verificadas del
 * análisis §C páginas / §D tipo / §E ubicación — el doc `ANALISIS-e14-
 * identificacion-datos.md` referenciado por el spec no está en el repo; el
 * spec embebe las señales y es la fuente de aquí). Cada ajuste futuro a una
 * ancla DEBE llevar comentario `// Fuente:` con el texto OCR real que lo
 * justifique (§8: prohibido relajar a ciegas).
 *
 * Fuzzy §3.3: trigramas de caracteres + Dice — SIN dependencias externas.
 * Los G.2/G.3 (manuscritos) están FUERA (§0): el flujo de revisión humana
 * existente los sigue cubriendo.
 */
import type { DivipolBase } from "./divipol";

// ---------- Tipos (§3.4) ----------

export type NivelClasificacion = "AUTO" | "SUGERIDA" | "MANUAL";

/** Tipo de copia leído de la BANDA (§D.1 — sin tilde: es el literal OCR). */
export type TipoCopia = "TRANSMISION" | "DELEGADOS";

export interface ClasificacionE14 {
  departamento: { codigo: string; nombre: string } | null;
  municipio: { codigo: string; nombre: string } | null;
  zona: { codigo: string } | null;
  puesto: { codigo: string; nombre: string } | null;
  mesa: number | null;
  tipo: TipoCopia | null;
  /** Del «Ver/Pag/de» (§C). */
  pagina: { index: number; total: number } | null;
  /** KIT del pie (§G.4.5: forma parte del nombre de export). */
  kit: number | null;
  nivel: NivelClasificacion;
  confianzas: { departamento: number; municipio: number; puesto: number; tipo: number };
}

/** Regla de dominio E-14 (§4.5): la cabecera debe decir E-14/REGISTRADURÍA.
 *  Ya NO decide sola el estado del gate — solo traza/log + piso SUGERIDA. */
export const PATRON_CABECERA = /E\s*-\s*14|REGISTRADURIA|REGISTRADURÍA/i;

// ---------- Normalización (§3.1) ----------

/** Nombres: NFKD → quitar diacríticos → MAYÚSCULAS → colapsar espacios → recortar. */
export function normalizarNombre(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Mapa de confusión OCR para tokens NUMÉRICOS (§3.1) — SOLO dentro de
 *  tokens que deban ser números; NUNCA aplicarlo a nombres. */
const MAPA_CONFUSION_OCR: Record<string, string> = {
  O: "0",
  Q: "0",
  I: "1",
  L: "1",
  S: "5",
  B: "8",
};

/** Códigos: MAYÚSCULAS + mapa de confusión (la evidencia OCR actual lee los
 *  dígitos limpios — p. ej. «CONSULADO: 88 - CONSULADOS», «MESA: 012» — el
 *  mapa queda aplicado defensivamente para lecturas futuras con letras). */
export function normalizarCodigo(s: string): string {
  return s
    .toUpperCase()
    .trim()
    .replace(/[OQILSB]/g, (c) => MAPA_CONFUSION_OCR[c] ?? c);
}

// ---------- Fuzzy (§3.3: trigramas de caracteres + Dice) ----------

function trigramas(s: string): Set<string> {
  const out = new Set<string>();
  if (s.length === 0) return out;
  if (s.length < 3) {
    out.add(s);
    return out;
  }
  for (let i = 0; i <= s.length - 3; i += 1) out.add(s.slice(i, i + 3));
  return out;
}

/** Similitud Dice sobre trigramas: 2·|A∩B| / (|A|+|B|). */
export function similitud(a: string, b: string): number {
  const A = trigramas(a);
  const B = trigramas(b);
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let interseccion = 0;
  for (const t of A) if (B.has(t)) interseccion += 1;
  return (2 * interseccion) / (A.size + B.size);
}

// ---------- Anclas de extracción (§3.2 — VERBATIM del spec) ----------

const ANCLA_DEPARTAMENTO = /^\s*(DEPARTAMENTO|CONSULADO)\s*[:.]?\s*(\d{1,2})?\s*[-–—]?\s*([A-ZÁÉÍÓÚÑÜ .'-]{3,})?/im;
const ANCLA_PAIS = /^\s*(PA[IÍ]S|MUNICIPIO)\s*[:.]?\s*(\d{1,3})?\s*[-–—]?\s*([A-ZÁÉÍÓÚÑÜ .'-]{3,})?/im;
const ANCLA_ZONA = /ZONA\s*[:.]?\s*(\d{1,2}|URBANA|RURAL)/im;
const ANCLA_PUESTO = /PUESTO\s*[:.]?\s*(\d{1,2})/im;
const ANCLA_MESA = /MESA\s*[:.Nº#]?\s*(\d{1,3})/im;
const ANCLA_LUGAR = /LUGAR\s*[:.]?\s*([A-ZÁÉÍÓÚÑÜ0-9().,\-' ]{3,})/im;
const ANCLA_VERPAG = /Ver\.?\s*:?\s*(\d{1,2})\s*Pag\.?\s*:?\s*(\d{1,2})\s*de\s*(\d{1,2})/i;
const ANCLA_KIT = /KIT\s*(\d{1,6})/i;
const ANCLA_FORM = /No\.?\s*Form\.?\s*:?\s*(\d{1,6})/i;

// Código 1D IMPRESO debajo del barcode (ANALISIS §D.2/§F — 8/8 muestras):
// 15 dígitos · d9: 3=TRANSMISIÓN, 2=CÓNSUL/EMBAJADOR · d12-13: página ·
// d14-15: total. Evidencia en vivo: «710003993010102» → d9=3 (T), d12-15=01/02.
const ANCLA_CODIGO_1D = /\b(\d{15})\b/g;

// BANDA (tipo copia, §D.1): señal primaria — CLAVEROS existe pero NO se archiva.
// CORRECCIÓN con evidencia (captura del dueño 2026-10-10): el `C[OÓ]NSUL` suelto
// matcheaba la caja impresa «CONSULADO: 88 - CONSULADOS» (presente en TODAS las
// copias de consulado) y marcaba DELEGADOS falso en un acta TRANSMISIÓN. La
// banda de delegados imprime el literal «CÓNSUL/EMBAJADOR» (ANALISIS §D.1) →
// EMBAJADOR ya la cubre sin colisionar con la caja del encabezado.
const BANDA_TRANSMISION = /TRANSMISI[OÓ]N/;
const BANDA_DELEGADOS = /EMBAJADOR|DELEGADOS/;

// ---------- Umbrales (§3.3) ----------

const UMBRAL_AUTO = 0.82;
const UMBRAL_SUGERIDA = 0.6;
/** LUGAR muy distinto del standName del puesto elegido (regla 4 §3.3). */
const UMBRAL_VERIFICACION_LUGAR = 0.55;

interface Mejor<T> {
  candidato: T;
  sim: number;
}

function mejorPorNombre<T>(candidatos: T[], nombre: (c: T) => string, leido: string): Mejor<T> | null {
  let mejor: Mejor<T> | null = null;
  for (const c of candidatos) {
    const sim = similitud(leido, normalizarNombre(nombre(c)));
    if (!mejor || sim > mejor.sim) mejor = { candidato: c, sim };
  }
  return mejor;
}

/** Puestos candidatos de un municipio (con su zona — para deducirla §3.3
 *  regla 4 cuando el ZONA leído no existe o no se leyó). */
interface PuestoCandidato {
  zon: string;
  std: string;
  nombre: string;
  mesas: number;
}

function puestosDelMunicipio(base: DivipolBase, dep2: string, mun3: string): PuestoCandidato[] {
  const zonas = base[dep2]?.m?.[mun3]?.z ?? {};
  const out: PuestoCandidato[] = [];
  for (const [zon, z] of Object.entries(zonas)) {
    for (const [std, p] of Object.entries(z.s ?? {})) {
      out.push({ zon, std, nombre: p.n, mesas: p.t });
    }
  }
  return out;
}

function numeroLimpio(crudo: string): number {
  const n = parseInt(normalizarCodigo(crudo), 10);
  return Number.isFinite(n) ? n : Number.NaN;
}

// ---------- Clasificación (§3.4) ----------

/**
 * Clasifica la cabecera IMPRESA de un acta a partir de su OCR completo.
 * Los anclas que no matchean son normales (campo ausente → baja a
 * fuzzy/manual, §3.2): NUNCA lanza, siempre devuelve un veredicto.
 */
export function clasificarCabecera(ocrTexto: string, base: DivipolBase): ClasificacionE14 {
  const texto = ocrTexto ?? "";

  // ---- Anclas §3.2 (primera aparición; evidencia: OCR real del acta
  // Frankfurt incluida — «CONSULADO: 88 - CONSULADOS», «PAIS: 120 -
  // ALEMANIA», «ZONA: 18 PUESTO: 02 MESA: 012», «LUGAR: Frankfurt
  // Consulaco», «TRANSMISIÓN», «KIT 745»). ----
  const mDep = texto.match(ANCLA_DEPARTAMENTO);
  const mPais = texto.match(ANCLA_PAIS);
  const mZona = texto.match(ANCLA_ZONA);
  const mPuesto = texto.match(ANCLA_PUESTO);
  const mMesa = texto.match(ANCLA_MESA);
  const mLugar = texto.match(ANCLA_LUGAR);
  const mVerPag = texto.match(ANCLA_VERPAG);
  const mKit = texto.match(ANCLA_KIT);
  const mForm = texto.match(ANCLA_FORM);

  // Códigos con ancho fijo de la base (dep 2 · mun 3 · zon 2 · std 2).
  const depCodLeido = mDep?.[2] ? normalizarCodigo(mDep[2]).padStart(2, "0") : null;
  const depNomLeido = mDep?.[3] ? normalizarNombre(mDep[3]) : null;
  const munCodLeido = mPais?.[2] ? normalizarCodigo(mPais[2]).padStart(3, "0") : null;
  const munNomLeido = mPais?.[3] ? normalizarNombre(mPais[3]) : null;
  // ZONA: URBANA/RURAL es señal de tipo de zona, no un código → no resuelve.
  const zonaLeida =
    mZona && /^\d/.test(mZona[1]) ? normalizarCodigo(mZona[1]).padStart(2, "0") : null;
  const puestoCodLeido = mPuesto?.[1] ? normalizarCodigo(mPuesto[1]).padStart(2, "0") : null;
  const mesaLeida = mMesa ? numeroLimpio(mMesa[1]) : null;
  const lugarLeido = mLugar?.[1] ? normalizarNombre(mLugar[1]) : null;

  // ---- PÁGINA (§C): «Ver/Pag/de» impreso primero; respaldo d12-13/d14-15 del
  //      código 1D impreso (ANALISIS §D.2 — «710003993010102» → 01/02 = «1 de 2»,
  //      verificado en vivo con el OCR del dueño). Solo si hay UN único código
  //      de 15 dígitos y la aritmética cuadra. ----
  const codigos1D = [...texto.matchAll(ANCLA_CODIGO_1D)].map((m) => m[1]);
  const codigo1DUnico = codigos1D.length === 1 ? codigos1D[0] : null;
  const pagina =
    mVerPag && Number.isFinite(numeroLimpio(mVerPag[2]))
      ? {
          index: Math.max(1, numeroLimpio(mVerPag[1]) || 1),
          total: Math.max(1, numeroLimpio(mVerPag[3]) || 2),
        }
      : codigo1DUnico
        ? (() => {
            const idx = parseInt(codigo1DUnico.slice(11, 13), 10);
            const tot = parseInt(codigo1DUnico.slice(13, 15), 10);
            return Number.isFinite(idx) && Number.isFinite(tot) && idx >= 1 && tot >= idx && tot <= 9
              ? { index: idx, total: tot }
              : null;
          })()
        : null;
  // ---- KIT (pie — §3.2: KIT preferido, No. Form de respaldo). ----
  const kit =
    mKit && Number.isFinite(numeroLimpio(mKit[1]))
      ? numeroLimpio(mKit[1])
      : mForm && Number.isFinite(numeroLimpio(mForm[1]))
        ? numeroLimpio(mForm[1])
        : null;

  // ---- TIPO (banda §D.1 — orden del spec: TRANSMISIÓN primero, DELEGADOS
  //      solo si la banda de transmisión NO aparece). Respaldo §D.2: dígito 9
  //      del código 1D impreso (3=TRANSMISIÓN, 2=DELEGADOS) SOLO si la banda
  //      no se leyó; confianza 0.9 (señal impresa verificada 8/8, §F). ----
  let tipo: TipoCopia | null = null;
  let confianzaTipo = 0;
  if (BANDA_TRANSMISION.test(texto)) {
    tipo = "TRANSMISION";
    confianzaTipo = 1;
  } else if (BANDA_DELEGADOS.test(texto)) {
    tipo = "DELEGADOS";
    confianzaTipo = 1;
  } else {
    const codigos = [...texto.matchAll(ANCLA_CODIGO_1D)].map((m) => m[1]);
    if (codigos.length >= 1) {
      const novenos = new Set(codigos.map((c) => c[8]));
      if (novenos.size === 1 && (novenos.has("3") || novenos.has("2"))) {
        tipo = novenos.has("3") ? "TRANSMISION" : "DELEGADOS";
        confianzaTipo = 0.9;
      }
    }
  }

  // ---- DEPARTAMENTO (§3.3 regla 1-2) ----
  let departamento: ClasificacionE14["departamento"] = null;
  let confDep = 0;
  let depResuelto = false;
  if (depCodLeido && base[depCodLeido]) {
    departamento = { codigo: depCodLeido, nombre: base[depCodLeido].n };
    confDep = 1;
    depResuelto = true;
  } else if (depNomLeido) {
    const deps = Object.entries(base).map(([codigo, d]) => ({ codigo, nombre: d.n }));
    const mejor = mejorPorNombre(deps, (d) => d.nombre, depNomLeido);
    if (mejor && mejor.sim >= UMBRAL_SUGERIDA) {
      departamento = { codigo: mejor.candidato.codigo, nombre: mejor.candidato.nombre };
      confDep = mejor.sim;
      depResuelto = mejor.sim >= UMBRAL_AUTO;
    }
  }

  // ---- MUNICIPIO (§3.3 regla 1-2; regla 3 si no hay departamento) ----
  let municipio: ClasificacionE14["municipio"] = null;
  let confMun = 0;
  let munResuelto = false;
  if (departamento) {
    const muns = base[departamento.codigo]?.m ?? {};
    if (munCodLeido && muns[munCodLeido]) {
      municipio = { codigo: munCodLeido, nombre: muns[munCodLeido].n };
      confMun = 1;
      munResuelto = true;
    } else if (munNomLeido) {
      const lista = Object.entries(muns).map(([codigo, m]) => ({ codigo, nombre: m.n }));
      const mejor = mejorPorNombre(lista, (m) => m.nombre, munNomLeido);
      if (mejor && mejor.sim >= UMBRAL_SUGERIDA) {
        municipio = { codigo: mejor.candidato.codigo, nombre: mejor.candidato.nombre };
        confMun = mejor.sim;
        munResuelto = mejor.sim >= UMBRAL_AUTO;
      }
    }
  } else if (munCodLeido || munNomLeido) {
    // Regla 3: municipio sin departamento legible — global en toda la base
    // (los códigos/nombres se repiten entre departamentos: 2+ → MANUAL, el
    // panel de corrección muestra la lista).
    const candidatos: Array<{ dep2: string; depNombre: string; mun3: string; munNombre: string }> = [];
    for (const [dep2, d] of Object.entries(base)) {
      for (const [mun3, m] of Object.entries(d.m ?? {})) {
        if (munCodLeido && mun3 === munCodLeido) {
          candidatos.push({ dep2, depNombre: d.n, mun3, munNombre: m.n });
        } else if (!munCodLeido && munNomLeido && similitud(munNomLeido, normalizarNombre(m.n)) >= UMBRAL_AUTO) {
          candidatos.push({ dep2, depNombre: d.n, mun3, munNombre: m.n });
        }
      }
    }
    if (candidatos.length === 1) {
      const unico = candidatos[0];
      municipio = { codigo: unico.mun3, nombre: unico.munNombre };
      confMun = munCodLeido ? 1 : UMBRAL_AUTO;
      munResuelto = true;
      // Departamento DEDUCIDO (único en toda la base).
      departamento = { codigo: unico.dep2, nombre: unico.depNombre };
      confDep = munCodLeido ? 0.9 : UMBRAL_AUTO;
      depResuelto = true;
    }
    // 2+ candidatos (o 0): municipio null → MANUAL con lista (panel §5).
  }

  // ---- ZONA (código exacto bajo dep+mun; si no existe — p. ej. OCR
  //      «ZONA: 18» cuando ALEMANIA solo tiene 05/15 — queda pendiente y la
  //      deduce la resolución del puesto por LUGAR, regla 4). ----
  let zona: ClasificacionE14["zona"] = null;
  if (
    departamento &&
    municipio &&
    zonaLeida &&
    base[departamento.codigo]?.m?.[municipio.codigo]?.z?.[zonaLeida]
  ) {
    zona = { codigo: zonaLeida };
  }

  // ---- PUESTO (regla 4: preferir PUESTO numérico; LUGAR como
  //      verificación/desambiguación; deduce zona si faltaba). ----
  let puesto: ClasificacionE14["puesto"] = null;
  let confPuesto = 0;
  let puestoResuelto = false;
  if (departamento && municipio) {
    const candidatos = puestosDelMunicipio(base, departamento.codigo, municipio.codigo);

    if (puestoCodLeido) {
      const conCodigo = candidatos.filter((c) => c.std === puestoCodLeido);
      if (zona) {
        // const local: el narrowing de `zona` no sobrevive al callback (zona
        // es let y se reasigna abajo al deducir la zona del puesto).
        const zonCodigo = zona.codigo;
        const enZona = conCodigo.find((c) => c.zon === zonCodigo);
        if (enZona) {
          puesto = { codigo: enZona.std, nombre: enZona.nombre };
          confPuesto = 1;
          puestoResuelto = true;
        } else if (conCodigo.length === 1) {
          // El código leído vive en otra zona: confía en el código del
          // puesto y deduce su zona real.
          puesto = { codigo: conCodigo[0].std, nombre: conCodigo[0].nombre };
          zona = { codigo: conCodigo[0].zon };
          confPuesto = 0.9;
          puestoResuelto = true;
        }
      } else if (conCodigo.length === 1) {
        puesto = { codigo: conCodigo[0].std, nombre: conCodigo[0].nombre };
        zona = { codigo: conCodigo[0].zon };
        confPuesto = 0.9;
        puestoResuelto = true;
      } else if (conCodigo.length > 1 && lugarLeido) {
        // Mismo código en varias zonas (p. ej. ALEMANIA: 02 en zona 15
        // «Frankfurt Consulado» y en 05 «Berlin Consulado») → desambigua
        // por LUGAR.
        const mejor = mejorPorNombre(conCodigo, (c) => c.nombre, lugarLeido);
        if (mejor && mejor.sim >= UMBRAL_SUGERIDA) {
          puesto = { codigo: mejor.candidato.std, nombre: mejor.candidato.nombre };
          zona = { codigo: mejor.candidato.zon };
          confPuesto = mejor.sim;
          puestoResuelto = mejor.sim >= UMBRAL_AUTO;
        }
      }
    } else if (lugarLeido) {
      const mejor = mejorPorNombre(candidatos, (c) => c.nombre, lugarLeido);
      if (mejor && mejor.sim >= UMBRAL_SUGERIDA) {
        puesto = { codigo: mejor.candidato.std, nombre: mejor.candidato.nombre };
        zona ??= { codigo: mejor.candidato.zon };
        confPuesto = mejor.sim;
        puestoResuelto = mejor.sim >= UMBRAL_AUTO;
      }
    }

    // Verificación LUGAR (regla 4): contra el standName del puesto elegido;
    // si difiere mucho → baja la confianza (techo SUGERIDA).
    if (puesto && lugarLeido && confPuesto >= UMBRAL_AUTO) {
      const verificacion = similitud(lugarLeido, normalizarNombre(puesto.nombre));
      if (verificacion < UMBRAL_VERIFICACION_LUGAR) {
        confPuesto = Math.min(confPuesto, 0.75);
        puestoResuelto = false;
      }
    }
  }

  // ---- MESA (regla 5: validar 1 ≤ mesa ≤ countTable; si falla → sugerida
  //      con aviso, NUNCA descartar el número leído). ----
  const rutaCompleta = Boolean(departamento && municipio && zona && puesto);
  const mesaValidaLeida =
    mesaLeida !== null &&
    Number.isFinite(mesaLeida) &&
    rutaCompleta &&
    (() => {
      const p = base[departamento!.codigo]?.m?.[municipio!.codigo]?.z?.[zona!.codigo]?.s?.[puesto!.codigo];
      return Boolean(p && mesaLeida >= 1 && mesaLeida <= p.t);
    })();

  // ---- NIVEL (§3.4): AUTO exige dep+mun+puesto resueltos (código o ≥0.82)
  //      + mesa válida + tipo leído. Sin tipo → máx SUGERIDA (§D.4: prohibido
  //      asumir el tipo). PATRON_CABECERA matchea pero no llega a AUTO →
  //      SUGERIDA (nunca es pase libre a AUTO). ----
  const algoResuelto =
    departamento !== null ||
    municipio !== null ||
    puesto !== null ||
    (mesaLeida !== null && Number.isFinite(mesaLeida)) ||
    tipo !== null;
  let nivel: NivelClasificacion;
  if (depResuelto && munResuelto && puestoResuelto && mesaValidaLeida && tipo !== null) {
    nivel = "AUTO";
  } else if (algoResuelto) {
    nivel = "SUGERIDA";
  } else {
    nivel = "MANUAL";
  }
  if (nivel !== "AUTO" && PATRON_CABECERA.test(texto)) {
    nivel = "SUGERIDA";
  }

  return {
    departamento,
    municipio,
    zona,
    puesto,
    mesa: Number.isFinite(mesaLeida) ? mesaLeida : null,
    tipo,
    pagina,
    kit,
    nivel,
    confianzas: {
      departamento: Math.round(confDep * 100) / 100,
      municipio: Math.round(confMun * 100) / 100,
      puesto: Math.round(confPuesto * 100) / 100,
      tipo: confianzaTipo,
    },
  };
}

// ---------- Utilidades para el panel (§5) y Fase B (§6) ----------

/** Literal de TipoPagina (types.ts L89) — sin import para evitar ciclo de
 *  tipos: los literales son estructuralmente idénticos. */
export function tipoPaginaDe(tipo: TipoCopia): "DELEGADOS" | "TRANSMISIÓN" {
  return tipo === "TRANSMISION" ? "TRANSMISIÓN" : "DELEGADOS";
}

/** Clave de mesa §6: ${dep}-${mun}-${zon}-${std}-${mesa} con ceros
 *  (p. ej. «88-335-05-02-001»). Códigos ya vienen con ancho de la base;
 *  se rellenan defensivamente para el modo texto libre. */
export function claveDeMesa(c: ClasificacionE14): string | null {
  if (!c.departamento || !c.municipio || !c.zona || !c.puesto || c.mesa === null) return null;
  const dep = c.departamento.codigo.padStart(2, "0");
  const mun = c.municipio.codigo.padStart(3, "0");
  const zon = c.zona.codigo.padStart(2, "0");
  const std = c.puesto.codigo.padStart(2, "0");
  const mesa = String(c.mesa).padStart(3, "0");
  return `${dep}-${mun}-${zon}-${std}-${mesa}`;
}

/** Nombre de salida al exportar (§6 / §G.4.5):
 *  E14_{KIT}_{dep}_{mun}_{zon}_{puesto}_{mesa}_{TIPO}-{pag}. Extensión la
 *  pone el exportador real (PDF §6 — adaptación documentada). */
export function nombreExportacion(c: ClasificacionE14): string | null {
  const clave = claveDeMesa(c);
  if (!clave || !c.tipo) return null;
  const kit = c.kit !== null ? String(c.kit) : "SINKIT";
  const tipo = c.tipo; // ASCII: TRANSMISION/DELEGADOS
  const pag = c.pagina?.index ?? 1;
  return `E14_${kit}_${clave.replaceAll("-", "_")}_${tipo}-${pag}`;
}

// ---------- Título y ubicación reales (SPEC-titulo-ubicacion §1) ----------

/**
 * Deriva el TÍTULO y la UBICACIÓN del acta desde una clasificación RESUELTA
 * (nivel AUTO — del gate o del panel de corrección). Devuelve null cuando la
 * clasificación no está en AUTO o le falta la ruta — el llamador conserva el
 * seed (§0: sin datos reales no se inventa nada).
 *
 * Convención de ActaUbicacion (igual que ACTA_MOCK): departamento/municipio
 * por NOMBRE, zona/puesto por CÓDIGO, mesa con 3 dígitos. El título es el
 * standName del puesto en MAYÚSCULAS (p. ej. «EL CAIRO - CONSULADO») — la
 * TarjetaRica ya lo renderiza uppercase; el visor y el export lo usan crudo.
 */
export function tituloYUbicacionDe(
  c: ClasificacionE14 | null | undefined,
): {
  titulo: string;
  ubicacion: { departamento: string; municipio: string; zona: string; puesto: string; mesa: string };
} | null {
  if (!c || c.nivel !== "AUTO" || !c.puesto || c.mesa === null) return null;
  return {
    titulo: (c.puesto.nombre || "PUESTO SIN NOMBRE").toUpperCase(),
    ubicacion: {
      departamento: c.departamento?.nombre ?? "",
      municipio: c.municipio?.nombre ?? "",
      zona: c.zona?.codigo ?? "",
      puesto: c.puesto.codigo,
      mesa: String(c.mesa).padStart(3, "0"),
    },
  };
}
