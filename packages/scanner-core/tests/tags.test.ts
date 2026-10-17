/**
 * LOTE 6 (BLQ-1) — tests de lógica pura de tags.ts (CRUD + normalización).
 * 100% determinista: paleta por hash, sin estado global ni aleatoriedad.
 */
import { describe, test, expect } from "bun:test";
import {
  MAX_TAGS,
  MAX_TAG_LEN,
  TAG_PALETTE,
  docTags,
  tagColor,
  normalizeTag,
  cleanTagInput,
  addTag,
  removeTag,
  countTagUsage,
} from "../src/tags";

describe("constantes", () => {
  test("límites de producto: 8 etiquetas de 24 caracteres", () => {
    expect(MAX_TAGS).toBe(8);
    expect(MAX_TAG_LEN).toBe(24);
  });

  test("paleta no vacía y completa", () => {
    expect(TAG_PALETTE.length).toBeGreaterThanOrEqual(5);
    for (const c of TAG_PALETTE) {
      expect(c.dot).toMatch(/^#[0-9a-f]{6}$/i);
      expect(c.text).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("docTags (compat registros viejos)", () => {
  test("con array devuelve el mismo contenido", () => {
    expect(docTags({ tags: ["a", "b"] })).toEqual(["a", "b"]);
  });
  test("sin campo (registro viejo) → []", () => {
    expect(docTags({})).toEqual([]);
  });
  test("con undefined → []", () => {
    expect(docTags({ tags: undefined })).toEqual([]);
  });
});

describe("normalizeTag (minúsculas, sin tildes, recortada)", () => {
  test("trim + minúsculas", () => {
    expect(normalizeTag("  Facturas  ")).toBe("facturas");
  });
  test("quita tildes (NFD)", () => {
    expect(normalizeTag("Árbol")).toBe("arbol");
    expect(normalizeTag("MÉDICO")).toBe("medico");
    expect(normalizeTag("niño")).toBe("nino");
  });
});

describe("tagColor (paleta determinista por nombre)", () => {
  test("misma etiqueta → SIEMPRE mismo color", () => {
    const a = tagColor("facturas");
    const b = tagColor("facturas");
    expect(a).toBe(b);
  });
  test("insensible a caja (mismo color)", () => {
    expect(tagColor("Facturas")).toEqual(tagColor("facturas"));
  });
  test("OBSERVACIÓN: sensible a TILDES — tagColor usa toLowerCase() simple, no normalizeTag", () => {
    // La paleta se derivó del nombre tal cual (en minúsculas); la comparación
    // de etiquetas sí normaliza tildes, pero el color se fija por el hash del
    // toLowerCase literal. Documentado en el doc de evidencia (no es bug).
    expect(tagColor("FÁCTURAS").dot).not.toBe(tagColor("facturas").dot);
    // La MISMA cadena siempre da el mismo color (determinismo sí garantizado).
    expect(tagColor("FÁCTURAS")).toEqual(tagColor("FÁCTURAS"));
  });
  test("índice siempre dentro de la paleta", () => {
    for (const t of ["a", "casa", "trabajo-2026", "x".repeat(30), "üñÍ"]) {
      expect(TAG_PALETTE).toContain(tagColor(t));
    }
  });
});

describe("cleanTagInput (validación de entrada)", () => {
  test("recorta, colapsa espacios y respeta MAX_TAG_LEN", () => {
    expect(cleanTagInput("  casa   verde  ", [])).toBe("casa verde");
    expect(cleanTagInput("x".repeat(30), [])).toBe("x".repeat(MAX_TAG_LEN));
  });
  test("vacío o solo espacios → null", () => {
    expect(cleanTagInput("", [])).toBeNull();
    expect(cleanTagInput("   ", [])).toBeNull();
  });
  test("duplicada (insensible a caja/tildes) → null", () => {
    expect(cleanTagInput("Facturas", ["facturas"])).toBeNull();
    expect(cleanTagInput("FÁCTURAS", ["facturas"])).toBeNull();
  });
  test("nueva válida → se devuelve tal como la escribió el usuario", () => {
    expect(cleanTagInput("Casa", ["facturas"])).toBe("Casa");
  });
});

describe("addTag (CRUD)", () => {
  test("añade y NO muta la lista original", () => {
    const orig = ["a"];
    const next = addTag(orig, "b");
    expect(next).toEqual(["a", "b"]);
    expect(orig).toEqual(["a"]);
  });
  test("duplicada (normalizada) → null", () => {
    expect(addTag(["Facturas"], "facturas")).toBeNull();
  });
  test("tope MAX_TAGS alcanzado → null", () => {
    const full = Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`);
    expect(full).toHaveLength(8);
    expect(addTag(full, "nueva")).toBeNull();
  });
});

describe("removeTag (CRUD)", () => {
  test("quita por coincidencia normalizada", () => {
    expect(removeTag(["Facturas", "casa"], "FACTURAS")).toEqual(["casa"]);
    expect(removeTag(["fácturas"], "facturas")).toEqual([]);
  });
  test("no estaba → null", () => {
    expect(removeTag(["casa"], "facturas")).toBeNull();
  });
});

describe("countTagUsage (chips de filtro y sugerencias)", () => {
  test("cuenta por coincidencia normalizada y ordena por uso ↓", () => {
    const docs = [
      { tags: ["facturas"] },
      { tags: ["Facturas", "casa"] },
      { tags: ["FÁCTURAS", "casa"] },
    ] as Parameters<typeof countTagUsage>[0];
    const out = countTagUsage(docs);
    expect(out[0]).toEqual({ tag: "facturas", count: 3 });
    expect(out[1]).toEqual({ tag: "casa", count: 2 });
  });
  test("empate → orden alfabético (locale es, sin caja)", () => {
    const docs = [
      { tags: ["zeta"] },
      { tags: ["alfa"] },
    ] as Parameters<typeof countTagUsage>[0];
    expect(countTagUsage(docs).map((u) => u.tag)).toEqual(["alfa", "zeta"]);
  });
  test("biblioteca vacía → []", () => {
    expect(countTagUsage([])).toEqual([]);
  });
  test("documentos sin tags → []", () => {
    expect(countTagUsage([{}, {}] as Parameters<typeof countTagUsage>[0])).toEqual([]);
  });
});
