"use client";

/**
 * Overlay de guardado exitoso (patrón iOS): círculo verde #34C759 con check
 * que se DIBUJA (pathLength), anillo expansivo, título y subtítulo con los
 * datos de la digitalización. Se auto-descarta tras `duration` ms y entonces
 * llama a onFinished (la navegación la decide el padre).
 *
 * F-NOVIEW: con `onScanAnother`/`onDownloadPdf` aparecen las acciones del
 * flujo Adobe Scan — «Escanear otro documento» (encadena sin salir de la
 * cámara), «Guardar PDF» (DESCARGA el archivo — la 3ª interfaz con su botón
 * de exportar ya no existe) — y el auto-cierre se alarga para dar tiempo a
 * elegir. El auto-cierre lleva a la BIBLIOTECA.
 */

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Download, ScanLine } from "lucide-react";

const IOS_EASE = [0.32, 0.72, 0, 1] as const;

export function SaveSuccessOverlay({
  pageCount,
  engine,
  onFinished,
  onScanAnother,
  onDownloadPdf,
  batchCount = 0,
  duration,
}: {
  pageCount: number;
  engine: "opencv" | "canvas";
  onFinished: () => void;
  /** Modo lote: encadena otro documento tras este (opcional). */
  onScanAnother?: () => void;
  /** F-NOVIEW: descarga el PDF del documento recién guardado (opcional). */
  onDownloadPdf?: () => void;
  /** Documentos ya guardados en el lote (incluye este). */
  batchCount?: number;
  duration?: number;
}) {
  const hasActions =
    typeof onScanAnother === "function" || typeof onDownloadPdf === "function";
  const autoCloseMs = duration ?? (hasActions ? 3400 : 1750);
  const finishedRef = useRef(false);

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (!finishedRef.current) {
        finishedRef.current = true;
        onFinished();
      }
    }, autoCloseMs);
    return () => window.clearTimeout(t);
  }, [onFinished, autoCloseMs]);

  const run = (fn: () => void) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    fn();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="absolute inset-0 z-[70] flex flex-col items-center justify-center gap-5 bg-black/97 px-8 backdrop-blur-[3px]"
      role="status"
      aria-live="polite"
    >
      {/* Círculo verde con check dibujado + anillo expansivo */}
      <motion.div
        initial={{ scale: 0.35, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 17, delay: 0.04 }}
        className="relative flex size-[88px] items-center justify-center rounded-full bg-[#34c759] shadow-[0_12px_40px_rgba(52,199,89,0.45)]"
      >
        <motion.span
          aria-hidden="true"
          className="absolute inset-0 rounded-full border-[2.5px] border-[#34c759]/70"
          initial={{ scale: 1, opacity: 0.9 }}
          animate={{ scale: 1.7, opacity: 0 }}
          transition={{ duration: 0.85, delay: 0.28, ease: "easeOut" }}
        />
        <svg viewBox="0 0 40 40" className="size-11" fill="none" aria-hidden="true">
          <motion.path
            d="M9 20.5 L17 28.5 L31 12.5"
            stroke="white"
            strokeWidth={4.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.42, delay: 0.24, ease: IOS_EASE }}
          />
        </svg>
      </motion.div>

      <div className="flex flex-col items-center gap-1.5 text-center">
        <motion.h2
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.3, ease: IOS_EASE }}
          className="text-[19px] font-semibold tracking-tight text-white"
        >
          Digitalización guardada
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.42, ease: IOS_EASE }}
          className="text-[13px] leading-snug text-white/75"
        >
          {pageCount} {pageCount === 1 ? "página" : "páginas"} ·{" "}
          {engine === "opencv" ? "pipeline OpenCV de precisión" : "pipeline local"}
          {batchCount > 1 ? ` · documento ${batchCount} del lote` : ""}
        </motion.p>
      </div>

      {hasActions ? (
        /* Acciones del flujo Adobe Scan: encadenar otro documento o
           descargar el PDF guardado (auto-cierre → biblioteca). */
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, delay: 0.55, ease: IOS_EASE }}
          className="mt-1 flex w-full max-w-[300px] flex-col gap-2.5"
        >
          {onScanAnother ? (
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => run(onScanAnother)}
              className="flex h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-[#007aff] text-[16px] font-semibold text-white shadow-[0_6px_20px_rgba(0,122,255,0.4)] transition-colors active:bg-[#0062d6]"
            >
              <ScanLine className="h-[19px] w-[19px]" strokeWidth={2.2} />
              Escanear otro documento
            </motion.button>
          ) : null}
          {onDownloadPdf ? (
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => run(onDownloadPdf)}
              className="flex h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-white/10 text-[16px] font-semibold text-white/90 ring-1 ring-inset ring-white/15 backdrop-blur-sm transition-colors active:bg-white/15"
            >
              <Download className="h-[19px] w-[19px]" strokeWidth={2} />
              Guardar PDF
            </motion.button>
          ) : null}
        </motion.div>
      ) : (
        /* Barra de progreso sutil del auto-cierre */
        <div className="absolute bottom-16 h-[3px] w-24 overflow-hidden rounded-full bg-white/15">
          <motion.span
            className="block h-full rounded-full bg-[#34c759]"
            initial={{ width: "0%" }}
            animate={{ width: "100%" }}
            transition={{ duration: autoCloseMs / 1000, ease: "linear" }}
          />
        </div>
      )}
    </motion.div>
  );
}
