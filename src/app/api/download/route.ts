import { readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { NextRequest } from "next/server";

/**
 * Sirve archivos descargables de la carpeta `download/` del proyecto
 * (no rastreada por git) — p. ej. el snapshot ZIP del repositorio para
 * actualizar el repo remoto del usuario.
 *
 * Seguridad: solo la raíz de `download/`, solo `.zip`, nombre plano sin
 * rutas (basename === nombre), límite de 200 MB y verificación de que
 * la ruta resuelta sigue DENTRO del directorio.
 */

export const dynamic = "force-dynamic";

/** Tamaño máximo servible (los videos de QA de 82 MB NO se sirven). */
const MAX_BYTES = 200 * 1024 * 1024;

/** Nombre de archivo plano y .zip — sin rutas, sin caracteres raros. */
function safeZipName(raw: string): string | null {
  if (!raw || basename(raw) !== raw) return null;
  return /^[\w][\w .-]*\.zip$/i.test(raw) ? raw : null;
}

/** Directorio `download/` — robusto en dev y en el build standalone. */
function resolveDownloadDir(): string | null {
  const candidates = [
    process.env.DOWNLOAD_DIR,
    join(process.cwd(), "download"),
    join(process.cwd(), "..", "download"),
    join(process.cwd(), "..", "..", "download"),
    "/home/z/my-project/download",
  ].filter((c): c is string => typeof c === "string" && c.length > 0);
  for (const c of candidates) {
    try {
      const st = statSync(c);
      if (st.isDirectory()) return resolve(c);
    } catch {
      /* siguiente candidato */
    }
  }
  return null;
}

function locateFile(name: string): { path: string; size: number } | null {
  const dir = resolveDownloadDir();
  if (!dir) return null;
  const path = resolve(dir, name);
  if (!path.startsWith(dir + "/") && path !== dir) return null; // fuera del dir → NO
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size <= 0 || st.size > MAX_BYTES) return null;
    return { path, size: st.size };
  } catch {
    return null;
  }
}

function jsonResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  const name = safeZipName(req.nextUrl.searchParams.get("file") ?? "");
  if (!name) return jsonResponse("Nombre de archivo no válido", 400);
  const found = locateFile(name);
  if (!found) return jsonResponse("Archivo no encontrado", 404);
  try {
    const data = readFileSync(found.path);
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(found.size),
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return jsonResponse("No se pudo leer el archivo", 500);
  }
}

export async function HEAD(req: NextRequest): Promise<Response> {
  const name = safeZipName(req.nextUrl.searchParams.get("file") ?? "");
  if (!name) return new Response(null, { status: 400 });
  const found = locateFile(name);
  if (!found) return new Response(null, { status: 404 });
  return new Response(null, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(found.size),
      "Cache-Control": "no-store",
    },
  });
}
