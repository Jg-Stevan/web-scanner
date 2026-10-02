import { NextResponse } from "next/server";

/**
 * OCR de una página: usa el modelo de visión (glm-4.6v) vía z-ai-web-dev-sdk.
 * Recibe { image: dataURL } y devuelve { text }.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { image?: string };
    const image = body.image;
    if (!image || !image.startsWith("data:")) {
      return NextResponse.json({ error: "Falta la imagen (data URL)" }, { status: 400 });
    }

    const { default: ZAI } = await import("z-ai-web-dev-sdk");
    const zai = await ZAI.create();

    const completion = await zai.chat.completions.createVision({
      model: "glm-4.6v",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Extrae TODO el texto de este documento escaneado. Devuelve únicamente el texto transcrito, " +
                "conservando saltos de línea y el orden de lectura. Sin comentarios ni markdown. " +
                "Si la imagen no contiene texto legible (en blanco, redactado o ilegible), " +
                "responde exactamente: (sin texto legible)",
            },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
      thinking: { type: "disabled" },
    });

    const text = completion.choices[0]?.message?.content ?? "";
    return NextResponse.json({ text: text.trim() });
  } catch (error) {
    console.error("[ocr] error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error de OCR" },
      { status: 500 }
    );
  }
}
