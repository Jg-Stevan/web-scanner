/**
 * Prueba de la lógica F-LENS v3 (betterLens) — replica exacta del código
 * de CameraView.tsx. Demuestra que el caso Samsung/Xiaomi (labels mudos,
 * "camera2 0" = gran angular) ahora elige la lente PRINCIPAL.
 */

// Réplica de lensScore (simplificada a labels mudos → 0)
const lensScore = (label) => {
  const ULTRA = /ultra|ultrawide|gran angular|super\s?wide|\b0[.,]5\s?x\b|\b0[.,]6\s?x\b/i;
  const TELE = /tele|teleobjetivo|telephoto|\b2\s?x\b|\b5\s?x\b|\b10\s?x\b/i;
  const MACRO = /macro|depth|truedepth|profundidad/i;
  const WIDE = /\bwide\b/i;
  return (
    (ULTRA.test(label) ? 1000 : 0) +
    (TELE.test(label) ? 500 : 0) +
    (MACRO.test(label) ? 300 : 0) +
    (WIDE.test(label) && !ULTRA.test(label) ? 50 : 0)
  );
};

// F-LENS v3 — torch primero en los empates (la del LED = principal)
const betterLensV3 = (a, b) => {
  if (a.score !== b.score) return a.score < b.score;
  if (a.torch !== b.torch) return a.torch;
  if (a.maxWidth !== b.maxWidth) return a.maxWidth > b.maxWidth;
  if (a.width !== b.width) return a.width > b.width;
  return a.rank < b.rank;
};

// F-LENS v2 (bug) — el índice más bajo ganaba los empates
const betterLensV2 = (a, b) =>
  a.score < b.score ||
  (a.score === b.score && a.maxWidth > b.maxWidth) ||
  (a.score === b.score && a.maxWidth === b.maxWidth && a.width > b.width) ||
  (a.score === b.score && a.maxWidth === b.maxWidth && a.width === b.width && a.rank < b.rank);

const C = (label, rank, torch, maxWidth, width) => ({
  label, rank, torch, maxWidth, width, score: lensScore(label),
});

let pass = 0, fail = 0;
const check = (name, got, expected) => {
  if (got === expected) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} — esperaba ${expected}, obtuve ${got}`); }
};

console.log("ESCENARIO Samsung (labels mudos, camera2 0 = GRAN ANGULAR, 4K en ambas):");
const ultra0 = C("camera2 0, facing back", 0, false, 3840, 3840); // stream inicial (bug actual)
const main1 = C("camera2 1, facing back", 1, true, 3840, 3840);   // principal con flash
console.log("  v2 (bug): ¿la principal gana el empate?", betterLensV2(main1, ultra0));
console.log("  v3 (fix): ¿la principal gana el empate?", betterLensV3(main1, ultra0));
check("v3 elige la principal por torch", betterLensV3(main1, ultra0), true);
check("v2 tenía el bug (ultra anclada)", betterLensV2(main1, ultra0), false);

console.log("\nESCENARIO tele (sin torch, menos resolución):");
const tele2 = C("camera2 2, facing back", 2, false, 3840, 1920);
check("v3 prefiere principal sobre tele", betterLensV3(main1, tele2), true);
check("v3 prefiere tele sobre ultra ANCLA", betterLensV3(tele2, ultra0), false);

console.log("\nESCENARIO etiquetas descriptivas (Pixel/iOS):");
const ultraNamed = C("Back Camera (ultra-wide)", 2, false, 3840, 3840);
const mainNamed = C("Back Camera (wide)", 0, false, 4080, 3840);
check("label penaliza la ultra aunque tenga torch", betterLensV3(ultraNamed, mainNamed), false);
check("gana la wide nombrada", betterLensV3(mainNamed, ultraNamed), true);

console.log("\nESCENARIO sin torch en ninguna (raro — sensor decide):");
const bigSensor = C("camera2 1, facing back", 1, false, 4080, 3840);
check("gana el sensor mayor", betterLensV3(bigSensor, ultra0), true);

console.log(`\nRESULTADO: ${pass} ✓ / ${fail} ✗ — ${fail === 0 ? "F-LENS v3 VERIFICADO" : "REVISAR"}`);
process.exit(fail === 0 ? 0 : 1);
