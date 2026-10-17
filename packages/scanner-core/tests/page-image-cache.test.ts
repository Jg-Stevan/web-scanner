/**
 * Tests de la LRU de materialización (BLQ-6, lote 7).
 * PageImageCache es pura e inyectable (create/dispose) — sin DOM ni
 * IndexedDB: bun test la ejercita directamente.
 */
import { describe, expect, test } from "bun:test";
import { PageImageCache } from "../src/page-store";

type Val = { id: string; url: string };

function makeCache(max: number, opts?: { failKeys?: string[] }) {
  const created: string[] = [];
  const disposed: string[] = [];
  const cache = new PageImageCache<Val>(
    max,
    async (key) => {
      if (opts?.failKeys?.includes(key)) throw new Error(`fallo ${key}`);
      created.push(key);
      return { id: key, url: `blob:${key}` };
    },
    (v) => {
      disposed.push(v.id);
    },
  );
  return { cache, created, disposed };
}

describe("PageImageCache (BLQ-6 lote7)", () => {
  test("crea on-demand y reutiliza sin duplicar (hit)", async () => {
    const { cache, created } = makeCache(4);
    const a1 = await cache.get("a");
    const a2 = await cache.get("a");
    expect(a1.url).toBe("blob:a");
    expect(a2.url).toBe("blob:a");
    expect(created).toEqual(["a"]);
  });

  test("evicta la entrada más vieja al superar el máximo", async () => {
    const { cache, created, disposed } = makeCache(2);
    await cache.get("a");
    await cache.get("b");
    await cache.get("c"); // expulsa "a"
    expect(created).toEqual(["a", "b", "c"]);
    expect(disposed).toEqual(["a"]);
    // "a" expirada: un nuevo get la vuelve a crear
    await cache.get("a");
    expect(created).toEqual(["a", "b", "c", "a"]);
    expect(disposed).toEqual(["a", "b"]); // expulsa "b" (la más vieja viva)
  });

  test("el acceso refresca la posición LRU", async () => {
    const { cache, disposed } = makeCache(2);
    await cache.get("a");
    await cache.get("b");
    await cache.get("a"); // refresca "a" → la más vieja es "b"
    await cache.get("c");
    expect(disposed).toEqual(["b"]);
  });

  test("release libera y expulsa explícitamente", async () => {
    const { cache, disposed } = makeCache(4);
    await cache.get("a");
    cache.release("a");
    await new Promise((r) => setTimeout(r, 0)); // dispose corre en microtask
    expect(disposed).toEqual(["a"]);
    // release de clave inexistente: no-op sin lanzar
    expect(() => cache.release("zz")).not.toThrow();
  });

  test("create que falla: la promesa fallida no se cachea (retry posible)", async () => {
    const { cache } = makeCache(4, { failKeys: ["x"] });
    await expect(cache.get("x")).rejects.toThrow("fallo x");
    await new Promise((r) => setTimeout(r, 0));
    // la promesa fallida NO se conservó en el mapa → un get posterior reintenta
    expect(cache.peek("x")).toBeUndefined();
  });

  test("claves con docId|pageId comparten promesa en llamadas concurrentes", async () => {
    const { cache, created } = makeCache(8);
    const [p1, p2] = [cache.get("doc1|pag1"), cache.get("doc1|pag1")];
    const [v1, v2] = await Promise.all([p1, p2]);
    expect(v1).toBe(v2);
    expect(created).toEqual(["doc1|pag1"]);
  });
});
