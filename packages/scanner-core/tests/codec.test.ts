/**
 * LOTE 9 (DRY-4) — tests del codec ÚNICO blob⇄dataURL.
 * Las implementaciones son verbatim de page-store (ya cubiertas por
 * page-store.test.ts); aquí se verifica el MÓDULO nuevo y su contrato
 * exportado (misma referencia lógica desde page-store re-export).
 */
import { describe, test, expect } from "bun:test";
import { blobToDataUrl, dataUrlToBlob } from "../src/codec";
import {
  blobToDataUrl as viaPageStore,
  dataUrlToBlob as dataUrlViaPageStore,
} from "../src/page-store";

describe("codec.dataUrlToBlob (contrato exportado del módulo nuevo)", () => {
  test("base64 → Blob con mime y bytes exactos", () => {
    const b = dataUrlToBlob("data:image/png;base64,iVBORw0KGgo=");
    expect(b!.type).toBe("image/png");
    expect(b!.size).toBe(8); // 12 chars, 1 padding
  });
  test("percent-encoded → texto decodificado (SVG de mocks)", () => {
    const b = dataUrlToBlob("data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C/svg%3E");
    expect(b!.type).toBe("image/svg+xml");
  });
  test("C-24: sin coma → null (nunca Blob vacío persistible)", () => {
    expect(dataUrlToBlob("no-valido")).toBeNull();
    expect(dataUrlToBlob("")).toBeNull();
  });
  test("base64 inválido → Lanza (el llamador decide, no se traga)", () => {
    expect(() => dataUrlToBlob("data:image/png;base64,¡¡¡")).toThrow();
  });
});

describe("codec.blobToDataUrl (contrato exportado del módulo nuevo)", () => {
  test.skip("browser-only: requiere FileReader (bun no lo implementa) — igual que en page-store.test.ts", () => {
    // El contrato (resolve data URL / reject si falla el reader) queda
    // cubierto en navegador; en bun el skip es honesto y documentado.
  });
});

describe("estabilidad de API pública (re-export de page-store)", () => {
  test("page-store re-exporta EL MISMO binding de codec (sin duplicación)", () => {
    // DRY-4 garantiza una sola implementación: las referencias coinciden.
    expect(dataUrlViaPageStore).toBe(dataUrlToBlob);
    expect(viaPageStore).toBe(blobToDataUrl);
  });
});
