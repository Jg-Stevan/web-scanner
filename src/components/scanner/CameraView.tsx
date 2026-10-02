"use client";

/**
 * PANTALLA 1 — CÁMARA (fondo NEGRO puro) con DETECCIÓN EN VIVO REAL.
 * Clon del diseño 1 del usuario (ver design-specs.md) + pipeline de precisión:
 *  · Frame loop (port del frameLoop.ts del usuario): rVFC/rAF → ImageBitmap
 *    400px transferible → worker OpenCV → corners + métricas → score
 *    compuesto (0.4·nitidez + 0.3·exposición + 0.3·estabilidad) × eccentricidad.
 *  · Auto-captura k-de-n (K=4 de N=6 en 1200 ms, última buena) — constantes
 *    validadas del quality.ts del usuario.
 *  · Cámara sintética (port del fakeCamera.ts del usuario): canvas.captureStream
 *    con wobble sutil de "mano sostenida" — demo REAL sin hardware.
 *  · Overlay del quad con mapeo object-cover exacto (frame → visor).
 *  · Perfil de documento en caliente ({type:'config'} → selectQuad priores).
 *  · Fallbacks en cascada: cámara real → sintética → escena estática demo;
 *    worker real → simulación de estabilidad (la app NUNCA se rompe).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Camera,
  CheckCircle2,
  ChevronRight,
  FileDown,
  FileText,
  Gauge,
  ImagePlus,
  Layers,
  LayoutGrid,
  Loader2,
  MoreVertical,
  Sparkles,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { nextId, useScannerStore } from "@/lib/scanner/store";
import {
  DOC_PROFILES,
  defaultQuad,
  type CapturePage,
  type DocProfileId,
  type Quad,
} from "@/lib/scanner/types";
import {
  detectDocumentEdges,
  evaluateQuality,
  generateDemoPage,
  getScannerWorker,
  loadImage,
} from "@/lib/scanner/image-processor";
import {
  CameraFrameLoop,
  SyntheticCamera,
  type FrameLoopTelemetry,
} from "@/lib/scanner/frame-loop";
import { SHUTTER_SCORE } from "@/lib/scanner/quality";

type CameraStatus = "idle" | "live" | "synthetic" | "simulated";

/** Telemetría reducida para el UI (throttle ~100 ms). */
interface LiveUi {
  corners: Quad | null;
  score: number | null;
  fps: number;
  searching: boolean;
}

/** Trapecio con jitter leve — fallback simulado mientras no hay worker. */
function jitteredQuad(): Quad {
  const j = (v: number) => Math.min(0.97, Math.max(0.03, v + (Math.random() - 0.5) * 0.02));
  const q = defaultQuad();
  return [
    { x: j(q[0].x), y: j(q[0].y) },
    { x: j(q[1].x), y: j(q[1].y) },
    { x: j(q[2].x), y: j(q[2].y) },
    { x: j(q[3].x), y: j(q[3].y) },
  ];
}

/** Reduce imágenes enormes de galería para no reventar la memoria del store. */
async function downscaleDataUrl(dataUrl: string, max = 1600): Promise<string> {
  try {
    const img = await loadImage(dataUrl);
    const big = Math.max(img.width, img.height);
    if (big <= max) return dataUrl;
    const scale = max / big;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.92);
  } catch {
    return dataUrl;
  }
}

declare global {
  interface Window {
    /** QA: telemetría del frame loop desde la consola. */
    __cameraTelemetry?: FrameLoopTelemetry;
  }
}

export default function CameraView() {
  // ── Store ──
  const setView = useScannerStore((s) => s.setView);
  const capturePages = useScannerStore((s) => s.capturePages);
  const addCapturePage = useScannerStore((s) => s.addCapturePage);
  const settings = useScannerStore((s) => s.settings);
  const updateSettings = useScannerStore((s) => s.updateSettings);
  const batchSavedCount = useScannerStore((s) => s.batchSavedCount);

  // ── Refs y estado ──
  const captureInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const viewerRef = useRef<HTMLElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const syntheticRef = useRef<SyntheticCamera | null>(null);
  const loopRef = useRef<CameraFrameLoop | null>(null);
  const processingRef = useRef(false);
  const cooldownRef = useRef(0);
  const autoRef = useRef(settings.autoCapture);
  const lastTelemetryAt = useRef(0);

  const [status, setStatus] = useState<CameraStatus>("idle");
  const [stable, setStable] = useState(false); // solo fallback simulado
  const [quad, setQuad] = useState<Quad>(() => defaultQuad());
  const [processing, setProcessing] = useState(false);
  const [flashKey, setFlashKey] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [precisionReady, setPrecisionReady] = useState(false);
  const [live, setLive] = useState<LiveUi>({ corners: null, score: null, fps: 0, searching: true });
  const [videoDims, setVideoDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [boxSize, setBoxSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  autoRef.current = settings.autoCapture;

  const pageCount = capturePages.length;
  const hasStream = status === "live" || status === "synthetic";
  const precisionLive = hasStream && precisionReady;

  /* ── Captura ─────────────────────────────────────────────────────── */

  /** Pipeline tras obtener la imagen: flash → bordes → calidad → store. */
  const handleCaptureDataUrl = useCallback(
    async (rawDataUrl: string) => {
      if (processingRef.current) return;
      if (!rawDataUrl) {
        toast.error("No se pudo capturar la imagen");
        return;
      }
      processingRef.current = true;
      setProcessing(true);
      setFlashKey((k) => k + 1); // flash blanco breve
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(30);
      }
      try {
        const dataUrl = await downscaleDataUrl(rawDataUrl);
        const [detectedQuad, quality] = await Promise.all([
          detectDocumentEdges(dataUrl),
          evaluateQuality(dataUrl),
        ]);
        const page: CapturePage = {
          id: nextId("page"),
          original: dataUrl,
          quad: detectedQuad,
          filter: "auto",
          rotation: 0,
          quality,
        };
        addCapturePage(page);
        toast.success("Página capturada", { id: "page-captured", duration: 1800 });
      } catch {
        toast.error("No se pudo procesar la imagen");
      } finally {
        processingRef.current = false;
        setProcessing(false);
      }
    },
    [addCapturePage]
  );

  /** Toma un frame del <video> (stream real o sintético) a resolución del track. */
  const captureVideoFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) return;
    // Cooldown post-captura del usuario (1500 ms anti doble-disparo).
    loopRef.current?.notifyCaptured();
    cooldownRef.current = Date.now() + 1500;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    void handleCaptureDataUrl(canvas.toDataURL("image/jpeg", 0.92));
  }, [handleCaptureDataUrl]);

  const captureVideoFrameRef = useRef(captureVideoFrame);
  captureVideoFrameRef.current = captureVideoFrame;

  /** Página de demo (factura) para probar sin cámara ni stream. */
  const captureDemo = useCallback(() => {
    setMenuOpen(false);
    void handleCaptureDataUrl(generateDemoPage(pageCount + 1));
  }, [handleCaptureDataUrl, pageCount]);

  /** Escena estática para la vista simulada sin stream (último recurso). */
  const demoPreview = useMemo(
    () => (status === "simulated" ? generateDemoPage(1) : ""),
    [status]
  );

  /** Shutter: frame del stream si lo hay; demo si es escena estática; si no, cámara nativa. */
  const onShutter = useCallback(() => {
    if (processingRef.current) return;
    if (hasStream && videoRef.current && videoRef.current.readyState >= 2) {
      captureVideoFrame();
    } else if (status === "simulated") {
      captureDemo();
    } else {
      captureInputRef.current?.click();
    }
  }, [hasStream, status, captureVideoFrame, captureDemo]);

  const onFilePicked = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        toast.error("El archivo seleccionado no es una imagen");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => void handleCaptureDataUrl(String(reader.result ?? ""));
      reader.onerror = () => toast.error("No se pudo leer la imagen");
      reader.readAsDataURL(file);
    },
    [handleCaptureDataUrl]
  );

  const goToEditor = useCallback(() => {
    if (pageCount === 0) {
      toast("Captura primero una página");
      return;
    }
    setView("editor");
  }, [pageCount, setView]);

  /* ── Arranque de cámara: real → sintética → estática ─────────────── */

  useEffect(() => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return;
    let cancelled = false;
    const media = navigator.mediaDevices;
    if (!media || typeof media.getUserMedia !== "function" || !window.isSecureContext) {
      void startSynthetic();
      return;
    }
    try {
      media
        .getUserMedia({ video: { facingMode: "environment" }, audio: false })
        .then((stream) => {
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          streamRef.current = stream;
          setStatus("live");
          // Linterna: solo si el track la soporta (teléfonos reales).
          try {
            const track = stream.getVideoTracks()[0];
            const caps = track?.getCapabilities?.() as { torch?: boolean } | undefined;
            if (caps?.torch) setTorchAvailable(true);
          } catch {
            /* sin capabilities */
          }
        })
        .catch(() => {
          if (!cancelled) void startSynthetic();
        });
    } catch {
      void startSynthetic();
    }

    async function startSynthetic(): Promise<void> {
      const cam = new SyntheticCamera();
      const stream = await cam.start();
      if (cancelled || !stream) {
        cam.stop();
        if (!cancelled) setStatus("simulated");
        return;
      }
      syntheticRef.current = cam;
      streamRef.current = stream;
      setStatus("synthetic");
    }

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      syntheticRef.current?.stop();
      syntheticRef.current = null;
    };
  }, []);

  // Asigna el stream al <video> (real o sintético)
  useEffect(() => {
    if (!hasStream) return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
  }, [hasStream, status]);

  // Dimensiones del video (para el mapeo object-cover del overlay)
  const onVideoMeta = useCallback(() => {
    const v = videoRef.current;
    if (v?.videoWidth) setVideoDims({ w: v.videoWidth, h: v.videoHeight });
  }, []);

  // Tamaño del visor (ResizeObserver — para el mapeo del overlay)
  useEffect(() => {
    const el = viewerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setBoxSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ── Readiness del pipeline de precisión (worker + OpenCV) ───────── */

  useEffect(() => {
    let stop = false;
    const check = () => {
      const c = getScannerWorker();
      if (c?.isReady) {
        if (!stop) setPrecisionReady(true);
        return true;
      }
      if (c && !c.isDead) {
        void c.waitReady().then((ok) => {
          if (ok && !stop) setPrecisionReady(true);
        });
      }
      return false;
    };
    check();
    const iv = window.setInterval(() => {
      if (check()) window.clearInterval(iv);
    }, 1000);
    return () => {
      stop = true;
      window.clearInterval(iv);
    };
  }, []);

  // Perfil de documento en caliente → priores de selectQuad (R4-B2)
  useEffect(() => {
    const c = getScannerWorker();
    if (c) c.setDocProfile(settings.docProfile);
  }, [settings.docProfile, precisionReady]);

  /* ── FRAME LOOP REAL: detección en vivo + k-de-n ─────────────────── */

  useEffect(() => {
    if (!precisionLive) return;
    const video = videoRef.current;
    if (!video) return;
    const loop = new CameraFrameLoop();
    loopRef.current = loop;
    loop.start(video, {
      onFrame: (t) => {
        window.__cameraTelemetry = t;
        const now = performance.now();
        if (now - lastTelemetryAt.current < 100) return; // throttle UI ~10 Hz
        lastTelemetryAt.current = now;
        setLive({
          corners: t.corners,
          score: t.score ? t.score.total : null,
          fps: t.fps,
          searching: t.corners === null,
        });
      },
      onTrigger: () => {
        if (!autoRef.current) return;
        if (processingRef.current) return;
        if (cooldownRef.current > Date.now()) return;
        captureVideoFrameRef.current();
      },
      onNoDetectTimeout: () => {
        toast("No detecto el documento · acércalo más al encuadre", {
          icon: "🔍",
        });
      },
    });
    return () => {
      loop.stop();
      loopRef.current = null;
    };
  }, [precisionLive]);

  // Linterna (solo cámara real con soporte)
  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({
        advanced: [{ torch: !torchOn }],
      } as MediaTrackConstraints & { advanced: unknown[] });
      setTorchOn((v) => !v);
    } catch {
      toast.error("No se pudo controlar la linterna");
    }
  }, [torchOn]);

  /* ── Fallback simulado (sin worker): estabilidad + jitter ─────────── */

  useEffect(() => {
    if (status !== "simulated" && !(hasStream && !precisionReady)) {
      setStable(false);
      return;
    }
    let cancelled = false;
    const timers: number[] = [];
    const schedule = (fn: () => void, ms: number) => {
      timers.push(
        window.setTimeout(() => {
          if (!cancelled) fn();
        }, ms)
      );
    };
    const runCycle = () => {
      schedule(() => setStable(true), 2600);
      schedule(() => {
        setStable(false);
        runCycle();
      }, 9800);
    };
    runCycle();
    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [status, hasStream, precisionReady]);

  useEffect(() => {
    if (precisionLive) return; // el quad real manda
    if (status === "idle" || stable) {
      setQuad(defaultQuad());
      return;
    }
    const id = window.setInterval(() => setQuad(jitteredQuad()), 700);
    return () => window.clearInterval(id);
  }, [status, stable, precisionLive]);

  // Auto-captura del fallback simulado (sin pipeline real)
  useEffect(() => {
    if (precisionLive || !settings.autoCapture) return;
    if (!(status === "live" && stable)) return;
    if (cooldownRef.current > Date.now()) return;
    const t = window.setTimeout(() => {
      cooldownRef.current = Date.now() + 7000;
      setStable(false);
      captureVideoFrame();
    }, 1500);
    return () => window.clearTimeout(t);
  }, [precisionLive, status, stable, settings.autoCapture, captureVideoFrame]);

  // Cierra el menú ⋮ con Escape
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  /* ── Overlay: quad REAL con mapeo object-cover ───────────────────── */

  /** Mapea fracciones del FRAME → % del visor visible (object-cover). */
  const mapPoint = useCallback(
    (p: { x: number; y: number }) => {
      if (!boxSize.w || !videoDims.w) return { x: p.x * 100, y: p.y * 100 };
      const scale = Math.max(boxSize.w / videoDims.w, boxSize.h / videoDims.h);
      const dw = videoDims.w * scale;
      const dh = videoDims.h * scale;
      const ox = (boxSize.w - dw) / 2;
      const oy = (boxSize.h - dh) / 2;
      return {
        x: ((ox + p.x * dw) / boxSize.w) * 100,
        y: ((oy + p.y * dh) / boxSize.h) * 100,
      };
    },
    [boxSize, videoDims]
  );

  const overlayQuad = precisionLive ? live.corners : hasStream || status === "simulated" ? quad : null;
  const quadPoints = overlayQuad
    ?.map((p) => {
      const m = mapPoint(p);
      return `${m.x.toFixed(2)} ${m.y.toFixed(2)}`;
    })
    .join(" L ");
  const overlayStable = precisionLive
    ? (live.score ?? 0) > SHUTTER_SCORE
    : stable;
  const scorePct = live.score !== null ? Math.round(live.score * 100) : null;

  return (
    <div className="relative flex h-full w-full flex-col bg-black">
      {/* Inputs de captura ocultos (método PRIMARIO: cámara nativa en móvil) */}
      <input
        ref={captureInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onFilePicked}
        className="hidden"
        aria-hidden="true"
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        onChange={onFilePicked}
        className="hidden"
        aria-hidden="true"
      />

      {/* ── Top bar ── */}
      <header className="relative z-20 flex shrink-0 items-center justify-between px-4 pb-3 pt-safe">
        <button
          type="button"
          aria-label="Cerrar cámara y volver a la biblioteca"
          onClick={() => setView("library")}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-black/30 backdrop-blur-md transition-transform duration-150 active:scale-90"
        >
          <X className="h-5 w-5 text-white" strokeWidth={2.2} />
        </button>

        {/* Pill IA · AUTO — punto azul pulsante al rastrear (diseño del usuario) */}
        <div className="flex h-9 items-center gap-2 rounded-full bg-black/40 px-3.5 backdrop-blur-md">
          <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[4px] bg-white text-[9px] font-bold tracking-tight text-black">
            IA
          </span>
          <LayoutGrid className="h-3.5 w-3.5 text-white" strokeWidth={2.4} aria-hidden="true" />
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full bg-[#007aff]",
              precisionLive && !overlayStable && "animate-pulse"
            )}
            aria-hidden="true"
          />
          <span className="text-[13px] font-semibold tracking-wide text-white">AUTO</span>
        </div>

        <button
          type="button"
          aria-label="Más opciones"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className="flex h-9 w-9 items-center justify-center rounded-full transition-transform duration-150 active:scale-90"
        >
          <MoreVertical className="h-5 w-5 text-white" strokeWidth={2.2} />
        </button>
      </header>

      {/* ── Chip de lote: documentos guardados en cadena durante esta sesión ── */}
      <AnimatePresence>
        {batchSavedCount > 0 && (
          <motion.div
            key="batch-chip"
            initial={{ opacity: 0, y: -10, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 420, damping: 28 }}
            className="pointer-events-none absolute left-1/2 top-[calc(env(safe-area-inset-top,0px)+58px)] z-20 -translate-x-1/2"
            role="status"
          >
            <div className="flex items-center gap-1.5 rounded-full bg-[#34c759]/18 px-3 py-1.5 ring-1 ring-inset ring-[#34c759]/40 backdrop-blur-md">
              <CheckCircle2
                className="h-3.5 w-3.5 text-[#34c759]"
                strokeWidth={2.4}
                aria-hidden="true"
              />
              <span className="text-[12px] font-semibold tracking-tight text-white">
                Lote · {batchSavedCount} {batchSavedCount === 1 ? "documento guardado" : "documentos guardados"}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Visor central ── */}
      <section
        ref={viewerRef}
        className="relative min-h-0 flex-1 overflow-hidden"
        aria-label="Visor de cámara"
      >
        {hasStream && (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            disablePictureInPicture
            onLoadedMetadata={onVideoMeta}
            aria-label="Vista previa de la cámara"
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}

        {/* Escena estática (sin stream ni sintética): documento sobre escritorio */}
        {status === "simulated" && demoPreview && (
          <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
            <div
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(165deg, #57493c 0%, #443729 42%, #2f251c 100%)",
              }}
            />
            <div
              className="absolute inset-0 backdrop-blur-[3px]"
              style={{ background: "rgba(18,14,10,0.42)" }}
            />
            <motion.img
              src={demoPreview}
              alt=""
              initial={{ opacity: 0, scale: 1.04 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="absolute left-1/2 top-1/2 w-[76%] -translate-x-1/2 -translate-y-[52%] rounded-[5px] shadow-[0_22px_60px_rgba(0,0,0,0.6)]"
              style={{ rotate: "-2.5deg" }}
            />
            <div
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(130% 95% at 50% 42%, transparent 42%, rgba(0,0,0,0.5) 100%)",
              }}
            />
          </div>
        )}

        {/* Marco de detección: quad REAL (o fallback) mapeado al visor */}
        {quadPoints && (
          <div
            className={cn("absolute inset-0", overlayStable && "animate-doc-stable")}
            aria-hidden="true"
          >
            <svg
              className="absolute inset-0 h-full w-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              <path
                d={`M 0 0 L 100 0 L 100 100 L 0 100 Z M ${quadPoints} Z`}
                fill="rgba(0,0,0,0.32)"
                fillRule="evenodd"
              />
              <path
                d={`M ${quadPoints} Z`}
                fill="none"
                stroke="#007aff"
                strokeWidth={2}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {overlayQuad?.map((p, i) => {
              const m = mapPoint(p);
              return (
                <span
                  key={i}
                  className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_1.5px_rgba(0,122,255,0.9),0_1px_4px_rgba(0,0,0,0.5)]"
                  style={{ left: `${m.x}%`, top: `${m.y}%` }}
                />
              );
            })}
          </div>
        )}

        {/* Estado: iniciando cámara */}
        {status === "idle" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <Loader2
              className="h-7 w-7 animate-spin text-white/50"
              strokeWidth={2}
              aria-hidden="true"
            />
            <p className="text-[13px] text-white/50">Iniciando cámara…</p>
          </div>
        )}

        {/* IA calentando / buscando documento */}
        <AnimatePresence>
          {precisionLive && live.searching && !processing && (
            <motion.div
              key="searching-pill"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.2 }}
              className="pointer-events-none absolute inset-x-0 top-5 z-30 flex justify-center px-6"
            >
              <div className="flex items-center gap-2 rounded-full bg-black/60 px-3.5 py-1.5 backdrop-blur-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#007aff]" aria-hidden="true" />
                <p className="text-[12px] font-medium text-white/85">Buscando documento…</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Toast flotante: documento estable / listo para auto-captura */}
        <AnimatePresence>
          {settings.autoCapture && overlayStable && !processing && (precisionLive || hasStream || status === "simulated") && (
            <motion.div
              key="stable-toast"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.2 }}
              className="pointer-events-none absolute inset-x-0 top-[42%] z-30 flex justify-center px-6"
            >
              <div className="flex items-center gap-2.5 rounded-[20px] bg-black/75 px-4 py-2.5 shadow-[0_4px_12px_rgba(0,0,0,0.3)] backdrop-blur-sm">
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    precisionLive ? "bg-[#007aff]" : "animate-pulse bg-[#007aff]"
                  )}
                  aria-hidden="true"
                />
                <p className="text-[14px] font-medium text-white">
                  Mantén inmóvil el dispositivo…
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Meter de calidad EN VIVO (pipeline real) */}
        <AnimatePresence>
          {precisionLive && scorePct !== null && (
            <motion.div
              key="score-meter"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.22 }}
              className="pointer-events-none absolute bottom-9 left-3 z-20"
              role="status"
              aria-label={`Calidad de encuadre ${scorePct} por ciento`}
            >
              <div className="flex h-8 items-center gap-2.5 rounded-full bg-black/55 px-3 shadow-[0_4px_14px_rgba(0,0,0,0.35)] backdrop-blur-md">
                <Gauge
                  className={cn(
                    "h-3.5 w-3.5",
                    scorePct > SHUTTER_SCORE * 100 ? "text-[#34c759]" : "text-white/80"
                  )}
                  strokeWidth={2.2}
                  aria-hidden="true"
                />
                <div className="h-1 w-14 overflow-hidden rounded-full bg-white/20">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-300 ease-out",
                      scorePct > SHUTTER_SCORE * 100
                        ? "bg-gradient-to-r from-[#30d158] to-[#34c759]"
                        : scorePct > 55
                          ? "bg-gradient-to-r from-[#007aff] to-[#4da2ff]"
                          : "bg-white/50"
                    )}
                    style={{ width: `${Math.min(100, Math.max(4, scorePct))}%` }}
                  />
                </div>
                <span
                  className={cn(
                    "min-w-7 text-right text-[11px] font-semibold tabular-nums",
                    scorePct > SHUTTER_SCORE * 100 ? "text-[#34c759]" : "text-white/85"
                  )}
                >
                  {scorePct}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Pista sutil de vista demo (sintética o estática) */}
        {(status === "synthetic" || status === "simulated") && !processing && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center">
            <span className="rounded-full bg-black/40 px-3 py-1 text-[11px] font-medium text-white/55 backdrop-blur-sm">
              {status === "synthetic"
                ? "Demo en vivo · IA detectando de verdad"
                : "Vista de demostración · obturador para capturar"}
            </span>
          </div>
        )}

        {/* Procesando captura */}
        {processing && (
          <div className="pointer-events-none absolute inset-x-0 top-[42%] z-30 flex justify-center px-6">
            <div className="flex items-center gap-2.5 rounded-[20px] bg-black/75 px-4 py-2.5 shadow-[0_4px_12px_rgba(0,0,0,0.3)] backdrop-blur-sm">
              <Loader2 className="h-4 w-4 animate-spin text-[#007aff]" aria-hidden="true" />
              <p className="text-[14px] font-medium text-white">Detectando bordes…</p>
            </div>
          </div>
        )}

        {/* Botón flotante: Revisar N páginas */}
        <AnimatePresence>
          {pageCount > 0 && (
            <motion.button
              key="review-pages"
              type="button"
              onClick={goToEditor}
              initial={{ opacity: 0, y: 12, x: "-50%" }}
              animate={{ opacity: 1, y: 0, x: "-50%" }}
              exit={{ opacity: 0, y: 12, x: "-50%" }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="absolute bottom-9 left-1/2 z-30 flex items-center gap-1.5 rounded-full bg-[#007aff] py-2 pl-4 pr-3 text-[13px] font-semibold text-white shadow-[0_6px_20px_rgba(0,122,255,0.45)]"
            >
              Revisar {pageCount}
              <ChevronRight className="h-4 w-4" strokeWidth={2.4} aria-hidden="true" />
            </motion.button>
          )}
        </AnimatePresence>
      </section>

      {/* ── Bottom bar ── */}
      <footer className="ios-blur-bar relative z-20 shrink-0 pb-safe">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center px-2 pt-3">
          {/* Zona izquierda: Importar · Páginas */}
          <div className="flex items-center justify-around">
            <button
              type="button"
              aria-label="Importar imagen desde la galería"
              onClick={() => galleryInputRef.current?.click()}
              className="flex flex-col items-center gap-1.5 rounded-xl px-2 py-1 transition-opacity active:opacity-60"
            >
              <FileDown className="h-6 w-6 text-white" strokeWidth={1.8} aria-hidden="true" />
              <span className="text-[11px] font-medium text-[#8e8e93]">Importar</span>
            </button>
            <button
              type="button"
              aria-label={`Ver ${pageCount} ${pageCount === 1 ? "página capturada" : "páginas capturadas"}`}
              onClick={goToEditor}
              className="flex flex-col items-center gap-1.5 rounded-xl px-2 py-1 transition-opacity active:opacity-60"
            >
              <span className="relative">
                <Layers className="h-6 w-6 text-white" strokeWidth={1.8} aria-hidden="true" />
                {pageCount > 0 && (
                  <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#007aff] px-1 text-[10px] font-bold leading-none text-white">
                    {pageCount}
                  </span>
                )}
              </span>
              <span className="text-[11px] font-medium text-white">
                {pageCount === 1 ? "1 página" : `${pageCount} páginas`}
              </span>
            </button>
          </div>

          {/* SHUTTER central elevado -20px */}
          <button
            type="button"
            aria-label="Capturar página"
            onClick={onShutter}
            disabled={processing}
            className={cn(
              "relative -mt-[20px] flex h-[72px] w-[72px] items-center justify-center rounded-full border-4 border-white bg-white/10",
              "shadow-[0_6px_20px_rgba(0,0,0,0.4)] transition-all duration-150 active:scale-90",
              processing && "opacity-50"
            )}
          >
            <FileText className="h-8 w-8 text-white" strokeWidth={2} aria-hidden="true" />
          </button>

          {/* Zona derecha: Auto */}
          <div className="flex justify-center">
            <button
              type="button"
              aria-label={`Captura automática: ${settings.autoCapture ? "activada" : "desactivada"}`}
              aria-pressed={settings.autoCapture}
              onClick={() => updateSettings({ autoCapture: !settings.autoCapture })}
              className="flex flex-col items-center gap-1.5 rounded-xl px-2 py-1 transition-opacity active:opacity-60"
            >
              <Zap
                className={cn(
                  "h-6 w-6",
                  settings.autoCapture ? "text-[#ffd60a]" : "text-white"
                )}
                strokeWidth={1.8}
                aria-hidden="true"
              />
              <span className="text-[11px] font-medium text-[#8e8e93]">
                Auto: {settings.autoCapture ? "Sí" : "No"}
              </span>
            </button>
          </div>
        </div>

        <div className="home-indicator mb-2 mt-1.5" aria-hidden="true" />
      </footer>

      {/* ── Menú ⋮ ── */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            key="camera-menu-layer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 z-40"
          >
            <button
              type="button"
              aria-label="Cerrar menú"
              className="absolute inset-0 cursor-default"
              onClick={() => setMenuOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -4 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
              style={{ top: "calc(max(env(safe-area-inset-top), 12px) + 56px)" }}
              className="absolute right-3 max-h-[70%] w-64 overflow-y-auto rounded-2xl border border-white/10 bg-[#1c1c1e]/95 shadow-[0_12px_40px_rgba(0,0,0,0.55)] backdrop-blur-xl divide-y divide-white/[0.08]"
              role="menu"
            >
              <MenuRow
                icon={Zap}
                label="Auto-captura"
                value={settings.autoCapture ? "Sí" : "No"}
                onClick={() => updateSettings({ autoCapture: !settings.autoCapture })}
              />
              {torchAvailable && (
                <MenuRow
                  icon={Sparkles}
                  label="Linterna"
                  value={torchOn ? "Encendida" : "Apagada"}
                  onClick={() => void toggleTorch()}
                />
              )}
              <MenuRow icon={Sparkles} label="Añadir página de demo" onClick={captureDemo} />
              <MenuRow
                icon={Camera}
                label="Escanear con cámara"
                onClick={() => {
                  setMenuOpen(false);
                  captureInputRef.current?.click();
                }}
              />
              <MenuRow
                icon={ImagePlus}
                label="Importar desde galería"
                onClick={() => {
                  setMenuOpen(false);
                  galleryInputRef.current?.click();
                }}
              />
              {/* Perfil de documento → priores de selectQuad en caliente */}
              <div className="px-4 pb-1.5 pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8e8e93]">
                  Perfil de documento
                </p>
              </div>
              {DOC_PROFILES.map((p) => (
                <MenuRow
                  key={p.id}
                  icon={LayoutGrid}
                  label={p.label}
                  sublabel={p.hint}
                  value={settings.docProfile === p.id ? "✓" : undefined}
                  onClick={() => updateSettings({ docProfile: p.id as DocProfileId })}
                />
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Flash blanco de captura */}
      {flashKey > 0 && (
        <div
          key={flashKey}
          className="animate-capture-flash pointer-events-none absolute inset-0 z-50 bg-white"
          aria-hidden="true"
        />
      )}
    </div>
  );
}

/** Fila del menú ⋮ estilo iOS. */
function MenuRow({
  icon: Icon,
  label,
  sublabel,
  value,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  sublabel?: string;
  value?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5 active:bg-white/10"
    >
      <Icon className="h-[18px] w-[18px] text-[#8e8e93]" strokeWidth={1.8} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-white">{label}</span>
        {sublabel && (
          <span className="block truncate text-[11px] text-[#8e8e93]">{sublabel}</span>
        )}
      </span>
      {value && (
        <span
          className={cn(
            "text-[13px] font-semibold",
            value === "Sí" || value === "✓" || value === "Encendida"
              ? "text-[#007aff]"
              : "text-[#8e8e93]"
          )}
        >
          {value}
        </span>
      )}
    </button>
  );
}
