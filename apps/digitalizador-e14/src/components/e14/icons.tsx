/**
 * Iconos inline (copiados de los code.html del zip v2 — fuente de verdad).
 * Sin dependencias de librería de iconos: cada SVG calca el diseño original.
 */

type IconProps = { className?: string };

export const ArrowLeftIcon = ({ className = "w-6 h-6" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-2 fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </svg>
);

export const CloudCheckIcon = ({ className = "w-3.5 h-3.5" }: IconProps) => (
  <svg className={`${className} fill-current`} viewBox="0 0 24 24" aria-hidden>
    <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM10 17l-3.5-3.5 1.41-1.41L10 14.17 15.09 9.09 16.5 10.5 10 17z" />
  </svg>
);

export const CloudOffIcon = ({ className = "w-3.5 h-3.5" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-2 fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M17.5 17H6a4 4 0 0 1-1.2-7.8A6 6 0 0 1 16.7 6.6M3 3l18 18" />
  </svg>
);

export const CameraNavIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={`${className} fill-current`} viewBox="0 0 24 24" aria-hidden>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z" />
  </svg>
);

export const DocumentNavIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={`${className} fill-current`} viewBox="0 0 24 24" aria-hidden>
    <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
  </svg>
);

export const GridNavIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={`${className} fill-current`} viewBox="0 0 24 24" aria-hidden>
    <path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />
  </svg>
);

export const RefreshIcon = ({ className = "w-3.5 h-3.5" }: IconProps) => (
  <svg
    className={`${className} fill-none stroke-current stroke-2`}
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
);

export const WarnTriangleIcon = ({ className = "w-3.5 h-3.5" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-2 fill-none`}
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
);

export const CropIcon = ({ className = "w-3.5 h-3.5" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-2 fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M6.13 1L6 16a2 2 0 0 0 2 2h15" />
    <path d="M1 6.13L16 6a2 2 0 0 1 2 2v15" />
  </svg>
);

export const RotateIcon = ({ className = "w-3.5 h-3.5" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-2 fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M21.5 2v6h-6" />
    <path d="M21.34 15.57a10 10 0 1 1-.57-8.38" />
  </svg>
);

export const FullscreenIcon = ({ className = "w-3.5 h-3.5" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-2 fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
  </svg>
);

export const ChevronDownIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-2 fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const ShieldCheckIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-2 fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

export const DocScannerIcon = ({ className = "w-9 h-9" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-[1.5] fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
    <path d="M7 12h10M7 8h10M8 16h4" />
  </svg>
);

export const SensorsIcon = ({ className = "w-3 h-3" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-2 fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M12 12a2 2 0 1 0 0-.001" />
    <path d="M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 19.1a10 10 0 0 1 0-14.2M19.1 4.9a10 10 0 0 1 0 14.2" />
  </svg>
);

export const CheckIcon = ({ className = "w-3.5 h-3.5" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-2 fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

export const ImportIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-2 fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
  </svg>
);

export const EyeIcon = ({ className = "w-3.5 h-3.5" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-2 fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

/** Linterna del flash (L3 — silueta de linterna, mismo patrón SVG inline). */
export const FlashIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={`${className} fill-current`} viewBox="0 0 24 24" aria-hidden>
    <path d="M6 2h12a1 1 0 0 1 1 1v3.5a3 3 0 0 1-.88 2.12L15 11.5V21a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-9.5L5.88 8.62A3 3 0 0 1 5 6.5V3a1 1 0 0 1 1-1zm1 2v2.5a1 1 0 0 0 .29.71L10 10h4l2.71-2.79A1 1 0 0 0 17 6.5V4H7zm3 8v7h1.5v-7H10z" />
    <path d="M8.5 5.5h2l.5 2-1.5 1.5L8.5 7.5z" />
  </svg>
);

/** Encuadre de escaneo (L3 — toggle AUTO del visor, 4 esquinas del lab Scan). */
export const ScanFrameIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-2 fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
  </svg>
);
