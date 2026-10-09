/**
 * Vars de entorno que Next.js inlina en el bundle de la app consumidora
 * (NEXT_PUBLIC_BASE_PATH, NEXT_PUBLIC_STATIC, …). El core se compila como
 * TS crudo dentro de cada app (transpilePackages), por eso NO depende de
 * @types/node: solo declara lo que realmente usa.
 */
declare const process: {
  env: Record<string, string | undefined>;
};
