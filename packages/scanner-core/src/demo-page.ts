/**
 * demo-page — generador de página de demo (factura) para el modo simulated.
 *
 * MOVIDO DESDE image-processor.ts (B-20, kit INSTR-ws-pr4-limpieza-v1): el
 * dibujo de la factura demo no pertenece al módulo crítico de procesado.
 * Contenido íntegro, mismas firmas y misma semilla — CERO cambios de
 * comportamiento. Fuente: commit base bc38bf8, image-processor.ts.
 */
/** Genera una imagen de página de demo (factura) como data URL.
 *  Se renderiza a 3× (1920×2580) — resolución de cámara real: las capturas
 *  de demo/simulado ejercitan el pipeline completo (detect→warp→enhance)
 *  con calidad de sensor, no de preview VGA. */
export function generateDemoPage(seed = 1): string {
  const SCALE = 3;
  const W = 640;
  const H = 860;
  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.scale(SCALE, SCALE);
  // Fondo papel
  ctx.fillStyle = "#f7f4ec";
  ctx.fillRect(0, 0, W, H);
  // Sombra leve
  ctx.fillStyle = "rgba(0,0,0,0.05)";
  ctx.fillRect(12, 12, W - 24, H - 24);

  // Encabezado
  ctx.fillStyle = "#1c1c1e";
  ctx.font = "bold 26px -apple-system, sans-serif";
  ctx.fillText("GLOBAL SYNERGY LTD.", 40, 70);
  ctx.fillStyle = "#8e8e93";
  ctx.font = "14px -apple-system, sans-serif";
  ctx.fillText(`FACTURA #GSS-2026-04${seed}1`, 40, 96);
  ctx.fillText("26 October, 2026", 40, 118);

  // Tabla
  let y = 190;
  ctx.fillStyle = "#8e8e93";
  ctx.font = "600 12px -apple-system, sans-serif";
  ctx.fillText("CONCEPTO", 40, y);
  ctx.fillText("CANT.", 400, y);
  ctx.fillText("SUBTOTAL", 500, y);
  ctx.strokeStyle = "#e5e5ea";
  ctx.beginPath();
  ctx.moveTo(40, y + 10);
  ctx.lineTo(W - 40, y + 10);
  ctx.stroke();

  const rows = [
    ["Consultoría Estratégica", "1", "€3,500.00"],
    ["Licencias Software Anual", "1", "€3,600.00"],
    ["Dirección de Proyecto GSS", "1", "€3,600.00"],
  ];
  ctx.font = "15px -apple-system, sans-serif";
  rows.forEach((r, i) => {
    const ry = y + 44 + i * 40;
    ctx.fillStyle = "#1c1c1e";
    ctx.fillText(r[0], 40, ry);
    ctx.fillText(r[1], 405, ry);
    ctx.fillText(r[2], 500, ry);
    ctx.strokeStyle = "#ececf0";
    ctx.beginPath();
    ctx.moveTo(40, ry + 14);
    ctx.lineTo(W - 40, ry + 14);
    ctx.stroke();
  });

  // Total
  ctx.fillStyle = "#3c3c43";
  ctx.font = "600 13px -apple-system, sans-serif";
  ctx.fillText("TOTAL A PAGAR", 40, y + 200);
  ctx.fillStyle = "#007aff";
  ctx.font = "bold 30px -apple-system, sans-serif";
  ctx.fillText("€16,800.00", W - 240, y + 205);

  // Sello
  ctx.save();
  ctx.translate(120, H - 140);
  ctx.rotate(-0.22);
  ctx.strokeStyle = "rgba(255,59,48,0.75)";
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, 190, 54);
  ctx.fillStyle = "rgba(255,59,48,0.8)";
  ctx.font = "bold 16px -apple-system, sans-serif";
  ctx.fillText("PAID · OCT 26", 22, 34);
  ctx.restore();

  ctx.save();
  ctx.translate(W - 320, H - 190);
  ctx.rotate(0.12);
  ctx.strokeStyle = "rgba(0,122,255,0.6)";
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, 210, 54);
  ctx.fillStyle = "rgba(0,122,255,0.7)";
  ctx.font = "bold 15px -apple-system, sans-serif";
  ctx.fillText("RECEIVED", 55, 34);
  ctx.restore();

  // Firma
  ctx.fillStyle = "#3c3c43";
  ctx.font = "italic 20px Georgia, serif";
  ctx.fillText("Sarah Jenkins", W - 260, H - 80);
  ctx.fillStyle = "#8e8e93";
  ctx.font = "11px -apple-system, sans-serif";
  ctx.fillText("Director · 26/10/2026", W - 260, H - 60);

  return canvas.toDataURL("image/jpeg", 0.92);
}
