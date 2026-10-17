/**
 * LOTE 6 (DRY-2) — TEST DE PARIDAD worker ↔ core.
 *
 * El worker declara (detection-worker.js, bloque F-TEXT-CLEAN): «Espejo EXACTO
 * de las funciones puras de image-modes.ts». Este test VERIFICA ese contrato:
 *
 *  · Importa las funciones del core (image-modes.ts, TS, directo).
 *  · Extrae el código espejado del worker LEYENDO el archivo (nunca lo
 *    escribe) y lo evalúa en un sandbox (`new Function`) para obtener las
 *    funciones JS reales que corre el navegador.
 *  · Corre ambas versiones sobre fixtures numéricos deterministas (rango
 *    completo, bajos contrastes, imagen plana, RGBA sintético) y compara
 *    salida EXACTA (tolerancia 0 — mismo código debe dar mismo float).
 *
 * Alcance real conseguido (documentado en docs/lab/fix-lote6-red-seguridad-v1.md):
 *  · Paridad completa: whitePointStretchPct, textClaroContrast,
 *    textTargetLumaLut, edgeAwareSharpenGray + constantes (TEXT_CLARO_* y
 *    TEXT_EDGE_*) + enhanceToRgba END-TO-END en los modos text/bw/gray/raw
 *    (con todo su grafo de helpers extraído por recursión).
 *  · EXCLUIDO: unsharpRgba — el worker lo implementa vía OpenCV (cv.GaussianBlur
 *    + cv.addWeighted sobre Mats) y el core por convolución JS pura: NO son
 *    comparables sin cargar cv.js en el sandbox (pendiente de decisión del dueño).
 *
 * Si este test falla hay DRIFT REAL worker↔core: es un HALLAZGO para el dueño,
 * no se corrige aquí (decisión del propietario).
 */
import { describe, test, expect } from "bun:test";
import {
  whitePointStretchPct,
  textClaroContrast,
  textTargetLumaLut,
  edgeAwareSharpenGray,
  enhanceToRgba,
  TEXT_EDGE_GRADIENT,
  TEXT_EDGE_AMOUNT,
  TEXT_CLARO_WHITE_PCT,
  TEXT_CLARO_CONTRAST,
  TEXT_CLARO_PIVOT,
  TEXT_CLARO_BLACK_POINT,
} from "../src/image-modes";

// ─── Extracción del código espejado del worker ──────────────────────────────

const WORKER_PATH = `${import.meta.dir}/../../../apps/scanner-lab/public/scanner/detection-worker.js`;
const CORE_IMAGEMODES_PATH = `${import.meta.dir}/../src/image-modes.ts`;

/** Lexer mínimo: avanza saltando strings ('' "" ``), comentarios (// /**) y
 *  escapes — devuelve el índice del `}` que cierra el `{` en `open`, o -1. */
function matchingBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i]!;
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      i++;
      while (i < src.length) {
        if (src[i] === "\\") i++;
        else if (src[i] === quote) break;
        i++;
      }
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Índice del `)` que cierra el `(` en `open` (lexer-aware). */
function matchingParen(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i]!;
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      i++;
      while (i < src.length) {
        if (src[i] === "\\") i++;
        else if (src[i] === quote) break;
        i++;
      }
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i++;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Fuente completa de `function NAME(...){...}` (primera declaración).
 *  IMPORTANTE: los parámetros con default objeto (`opts = {}`) contienen
 *  llaves — se localiza el `{` del cuerpo DESPUÉS de cerrar la lista de
 *  parámetros, nunca el primero tras el nombre. */
function extractFunction(src: string, name: string): string | null {
  const re = new RegExp(`(^|[^\\w$])function\\s+${name}\\s*\\(`);
  const m = re.exec(src);
  if (!m) return null;
  const openParen = m.index + m[0].length - 1;
  const closeParen = matchingParen(src, openParen);
  if (closeParen < 0) return null;
  const open = src.indexOf("{", closeParen + 1);
  if (open < 0) return null;
  const close = matchingBrace(src, open);
  if (close < 0) return null;
  const start = m.index + (m[0].startsWith("function") ? 0 : 1);
  return src.slice(start, close + 1);
}

/** Fuente de `var NAME = ...;` (hasta `;` a profundidad 0). */
function extractVar(src: string, name: string): string | null {
  const re = new RegExp(`(^|[^\\w$])var\\s+${name}\\s*=`);
  const m = re.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i]!;
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      i++;
      while (i < src.length) {
        if (src[i] === "\\") i++;
        else if (src[i] === quote) break;
        i++;
      }
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === ";" && depth === 0) break;
  }
  const start = m.index + (m[0].startsWith("var") ? 0 : 1);
  return src.slice(start, i + 1);
}

/** Grafo completo: seeds + dependencias por nombre + constantes referenciadas.
 *  Las `var` TAMBIÉN se escanean: algunas ejecutan IIFE a nivel de módulo
 *  (p. ej. LUTs `var LAB_L8 = (() => …)()` que llaman a funciones espejadas). */
function extractGraph(src: string, seeds: string[]): { fns: string[]; vars: string[] } {
  const allFnNames = new Set(
    [...src.matchAll(/(^|[^\w$])function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[2]!)
  );
  const allVarNames = new Set(
    [...src.matchAll(/(^|[^\w$])var\s+([A-Z_][A-Z0-9_]*)\s*=/g)].map((m) => m[2]!)
  );
  const fns = new Map<string, string>();
  const vars = new Map<string, string>();
  const scan = (text: string) => {
    for (const id of text.matchAll(/[A-Za-z_$][\w$]*/g)) {
      const idName = id[0];
      if (allFnNames.has(idName) && !fns.has(idName)) queue.push(idName);
      else if (allVarNames.has(idName) && !vars.has(idName)) pendingVars.add(idName);
    }
  };
  const queue: string[] = [...seeds];
  const pendingVars = new Set<string>();
  while (queue.length > 0 || pendingVars.size > 0) {
    const name = queue.shift();
    if (name !== undefined) {
      if (fns.has(name)) continue;
      const body = extractFunction(src, name);
      if (body === null) continue; // p.ej. nombre citado pero no declarado → skip
      fns.set(name, body);
      scan(body);
      continue;
    }
    // Agotada la cola de funciones: resolvemos vars pendientes (que pueden
    // referenciar a más vars/funcs — iterar hasta cerrar el grafo).
    const vName = pendingVars.values().next().value as string;
    pendingVars.delete(vName);
    if (vars.has(vName)) continue;
    const v = extractVar(src, vName);
    if (v === null) continue;
    vars.set(vName, v);
    scan(v);
  }
  return { fns: [...fns.values()], vars: [...vars.values()] };
}

// ─── Sandbox con el código del worker ───────────────────────────────────────

interface WorkerMirror {
  whitePointStretchPct: (gray: Uint8ClampedArray, pct: number) => Uint8ClampedArray;
  textClaroContrast: (gray: Uint8ClampedArray, c?: number, p?: number) => Uint8ClampedArray;
  textTargetLumaLut: (c?: number, p?: number, bp?: number) => Uint8ClampedArray;
  edgeAwareSharpenGray: (src: Uint8ClampedArray, w: number, h: number) => Uint8ClampedArray;
  enhanceToRgba: (
    data: Uint8ClampedArray,
    w: number,
    h: number,
    mode: string,
    opts?: Record<string, unknown>
  ) => Uint8ClampedArray;
  TEXT_EDGE_GRADIENT: number;
  TEXT_EDGE_AMOUNT: number;
  TEXT_CLARO_WHITE_PCT: number;
  TEXT_CLARO_CONTRAST: number;
  TEXT_CLARO_PIVOT: number;
  TEXT_CLARO_BLACK_POINT: number;
}

let mirror: WorkerMirror | null = null;
let mirrorError: string | null = null;

function build(): WorkerMirror {
  const src = require("node:fs").readFileSync(WORKER_PATH, "utf8") as string;
  const seeds = [
    "whitePointStretchPct",
    "textClaroContrast",
    "textTargetLumaLut",
    "edgeAwareSharpenGray",
    "enhanceToRgba",
  ];
  const { fns, vars } = extractGraph(src, seeds);
  const factory = new Function(
    `${vars.join("\n")}\n${fns.join("\n")}\nreturn {${seeds
      .concat([
        "TEXT_EDGE_GRADIENT",
        "TEXT_EDGE_AMOUNT",
        "TEXT_CLARO_WHITE_PCT",
        "TEXT_CLARO_CONTRAST",
        "TEXT_CLARO_PIVOT",
        "TEXT_CLARO_BLACK_POINT",
      ])
      .join(",")}};`
  );
  const api = factory() as WorkerMirror;
  mirror = api;
  return api;
}

try {
  mirror = build();
} catch (e) {
  mirrorError = (e as Error).message;
}

// ─── Fixtures deterministas ─────────────────────────────────────────────────

const W = 16;
const H = 16;

/** Rampa 0..255 con ruido determinista (sin Math.random). */
function rampGray(): Uint8ClampedArray {
  const g = new Uint8ClampedArray(W * H);
  for (let i = 0; i < g.length; i++) g[i] = (i * 37 + (i % 7) * 11) % 256;
  return g;
}
/** Bajo contraste: todo entre 96 y 160. */
function lowContrastGray(): Uint8ClampedArray {
  const g = new Uint8ClampedArray(W * H);
  for (let i = 0; i < g.length; i++) g[i] = 96 + ((i * 13) % 65);
  return g;
}
/** Imagen plana (peor caso de los histogramas). */
function flatGray(v = 128): Uint8ClampedArray {
  return new Uint8ClampedArray(W * H).fill(v);
}
/** RGBA sintético tipo documento: papel claro + trazos oscuros + color. */
function syntheticRgba(): Uint8ClampedArray {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const isTextLine = y % 4 === 1 && x % 3 !== 0;
      if (isTextLine) {
        d[i] = 30;
        d[i + 1] = 28;
        d[i + 2] = 26;
      } else if (x === 0 && y === 0) {
        d[i] = 200;
        d[i + 1] = 90;
        d[i + 2] = 40; // un pixel de color (croma)
      } else {
        const v = 205 + ((x + y) % 40); // papel con grano
        d[i] = v;
        d[i + 1] = v;
        d[i + 2] = v;
      }
      d[i + 3] = 255;
    }
  }
  return d;
}

function expectExactEquality(a: Uint8ClampedArray, b: Uint8ClampedArray, what: string) {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      throw new Error(
        `DRIFT en ${what}: primer desvio en [${i}] worker=${a[i]} core=${b[i]}`
      );
    }
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("extracción del bloque espejado del worker", () => {
  test("el sandbox extrajo y evaluó el código espejado sin errores", () => {
    if (mirrorError !== null) throw new Error(`Extracción falló: ${mirrorError}`);
    expect(mirror).not.toBeNull();
    expect(typeof mirror!.enhanceToRgba).toBe("function");
    expect(typeof mirror!.textTargetLumaLut).toBe("function");
  });

  test("constantes espejadas idénticas worker↔core", () => {
    expect(mirror!.TEXT_EDGE_GRADIENT).toBe(TEXT_EDGE_GRADIENT);
    expect(mirror!.TEXT_EDGE_AMOUNT).toBe(TEXT_EDGE_AMOUNT);
    expect(mirror!.TEXT_CLARO_WHITE_PCT).toBe(TEXT_CLARO_WHITE_PCT);
    expect(mirror!.TEXT_CLARO_CONTRAST).toBe(TEXT_CLARO_CONTRAST);
    expect(mirror!.TEXT_CLARO_PIVOT).toBe(TEXT_CLARO_PIVOT);
    expect(mirror!.TEXT_CLARO_BLACK_POINT).toBe(TEXT_CLARO_BLACK_POINT);
  });
});

describe("paridad whitePointStretchPct (estiramiento al punto blanco)", () => {
  const fixtures: [string, Uint8ClampedArray][] = [
    ["rango completo", rampGray()],
    ["bajo contraste", lowContrastGray()],
    ["imagen plana", flatGray(128)],
    ["plana a 0", flatGray(0)],
    ["plana a 255", flatGray(255)],
  ];
  for (const [name, g] of fixtures) {
    test(`salida EXACTA con ${name} (pct 0.97)`, () => {
      const w = mirror!.whitePointStretchPct(g, 0.97);
      const c = whitePointStretchPct(g, 0.97);
      expectExactEquality(w, c, `whitePointStretchPct/${name}`);
    });
    test(`salida EXACTA con ${name} (pct 0.5 y extremos)`, () => {
      for (const pct of [0.5, 0, 1, 0.97]) {
        expectExactEquality(
          mirror!.whitePointStretchPct(g, pct),
          whitePointStretchPct(g, pct),
          `whitePointStretchPct/${name}/pct${pct}`
        );
      }
    });
  }
});

describe("paridad textClaroContrast (S-curve)", () => {
  const fixtures: [string, Uint8ClampedArray][] = [
    ["rango completo", rampGray()],
    ["bajo contraste", lowContrastGray()],
    ["plana", flatGray(140)],
  ];
  for (const [name, g] of fixtures) {
    test(`salida EXACTA con ${name} (defaults)`, () => {
      expectExactEquality(
        mirror!.textClaroContrast(g),
        textClaroContrast(g),
        `textClaroContrast/${name}`
      );
    });
    test(`salida EXACTA con ${name} (contrast/pivot custom)`, () => {
      expectExactEquality(
        mirror!.textClaroContrast(g, 1.8, 0.7),
        textClaroContrast(g, 1.8, 0.7),
        `textClaroContrast/${name}/custom`
      );
    });
  }
});

describe("paridad textTargetLumaLut (LUT sigmoidal 256)", () => {
  test("LUT EXACTA con parámetros por defecto", () => {
    expectExactEquality(
      mirror!.textTargetLumaLut(),
      textTargetLumaLut(),
      "textTargetLumaLut/defaults"
    );
  });
  test("LUT EXACTA con parámetros custom (incluye black point)", () => {
    for (const [c, p, bp] of [
      [1.45, 0.82, 0.15],
      [1.8, 0.7, 0.3],
      [1.2, 0.5, 0.0],
      [2.0, 0.99, 0.15],
    ] as const) {
      expectExactEquality(
        mirror!.textTargetLumaLut(c, p, bp),
        textTargetLumaLut(c, p, bp),
        `textTargetLumaLut/${c}/${p}/${bp}`
      );
    }
  });
});

describe("paridad edgeAwareSharpenGray (afilado Laplaciano selectivo)", () => {
  const fixtures: [string, Uint8ClampedArray][] = [
    ["rango completo", rampGray()],
    ["bajo contraste", lowContrastGray()],
    ["plana (el papel no se afila)", flatGray(200)],
  ];
  for (const [name, g] of fixtures) {
    test(`salida EXACTA con ${name} (16×16)`, () => {
      expectExactEquality(
        mirror!.edgeAwareSharpenGray(g, W, H),
        edgeAwareSharpenGray(g, W, H),
        `edgeAwareSharpenGray/${name}`
      );
    });
  }
  test("márgenes de 1 px sin procesar, EXACTOS", () => {
    const g = rampGray();
    expectExactEquality(
      mirror!.edgeAwareSharpenGray(g, W, H),
      edgeAwareSharpenGray(g, W, H),
      "edgeAwareSharpenGray/márgenes"
    );
  });
});

describe("paridad enhanceToRgba END-TO-END (modos reales del motor)", () => {
  const rgba = syntheticRgba();
  const cases: [string, string, Record<string, unknown>][] = [
    ["raw passthrough", "raw", {}],
    ["text (pipeline F-TEXT-CLEAN)", "text", {}],
    ["text con opts custom", "text", { textContrast: 1.8, textPivot: 0.75 }],
    ["bw bradley", "bw", {}],
    ["bw sauvola + despeckle", "bw", { bwMethod: "sauvola", bwDespecklePx: 3 }],
    ["gray con estiramiento", "gray", {}],
  ];
  for (const [name, mode, opts] of cases) {
    test(`modo ${name}: RGBA EXACTO worker↔core`, () => {
      const w = mirror!.enhanceToRgba(rgba, W, H, mode, opts);
      const c = enhanceToRgba(rgba, W, H, mode as "text", opts);
      expectExactEquality(w, c, `enhanceToRgba/${mode}/${JSON.stringify(opts)}`);
    });
  }
  test("entrada degenerada (vacía) → salida vacía idéntica", () => {
    const w = mirror!.enhanceToRgba(new Uint8ClampedArray(0), 0, 0, "text");
    const c = enhanceToRgba(new Uint8ClampedArray(0), 0, 0, "text");
    expectExactEquality(w, c, "enhanceToRgba/vacío");
  });
});

describe("límites del test de paridad (documentación ejecutable)", () => {
  test("unsharpRgba NO es comparable: worker=OpenCV (Mats) vs core=JS puro", () => {
    // El unsharpRgba del worker recibe (cv, foto) y usa cv.GaussianBlur/
    // cv.addWeighted — compararlo exigiría cargar OpenCV en el sandbox.
    // Queda FUERA de alcance (kit T6.3: «documenta el alcance real»).
    const coreSrc = require("node:fs").readFileSync(
      CORE_IMAGEMODES_PATH,
      "utf8"
    ) as string;
    expect(coreSrc).toContain("export function unsharpRgba");
    const workerSrc = require("node:fs").readFileSync(WORKER_PATH, "utf8") as string;
    // El worker firma (cv, foto) → OpenCV.
    expect(workerSrc).toContain("function unsharpRgba(cv, foto)");
  });
});
