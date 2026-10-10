/**
 * Primitivas del design system Precision Monitor (SPEC §3).
 * Tone: "ok" | "warn" | "crit" | "neutral" — siempre sobre tokens §5.
 */
"use client";

import type { ReactNode } from "react";

export type Tone = "ok" | "warn" | "crit" | "neutral";

const toneText: Record<Tone, string> = {
  ok: "text-ok-tint",
  warn: "text-warn",
  crit: "text-crit",
  neutral: "text-ink-dim",
};

const toneBg: Record<Tone, string> = {
  ok: "bg-ok-tint",
  warn: "bg-warn",
  crit: "bg-crit",
  neutral: "bg-ink-dim",
};

/** Dot de estado (8px) con latido opcional (code.html: animate-pulse-sync). */
export function StatusDot({ tone, pulse = false }: { tone: Tone; pulse?: boolean }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${toneBg[tone]} ${
        pulse ? "animate-pulse-sync" : ""
      }`}
    />
  );
}

/** Chip mono pequeño (tint 10% + borde 40% del color). */
export function Chip({
  tone = "neutral",
  solid = false,
  children,
  className = "",
}: {
  tone?: Tone;
  solid?: boolean;
  children: ReactNode;
  className?: string;
}) {
  if (solid) {
    return (
      <span
        className={`px-2 py-0.5 rounded font-data text-[10px] font-semibold whitespace-nowrap ${
          tone === "ok"
            ? "bg-ok-tint text-ok-ink"
            : tone === "warn"
              ? "bg-warn text-warn-ink"
              : tone === "crit"
                ? "bg-crit text-white"
                : "bg-ink-dim text-bg"
        } ${className}`}
      >
        {children}
      </span>
    );
  }
  return (
    <span
      className={`px-2 py-0.5 rounded font-data text-[10px] font-semibold whitespace-nowrap ${
        tone === "ok"
          ? "bg-ok-tint/15 text-ok-tint border border-ok-tint/30"
          : tone === "warn"
            ? "bg-warn/15 text-warn border border-warn/30"
            : tone === "crit"
              ? "bg-crit/15 text-crit border border-crit/30"
              : "bg-black/60 text-ink-dim border border-line"
      } ${className}`}
    >
      {children}
    </span>
  );
}

/** Badge de score ("✓ 9.8/10 ÓPTIMA" / "✕ 4.2/10 RECHAZADA"). */
export function ScoreBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded border font-data whitespace-nowrap ${
        tone === "ok"
          ? "text-ok-tint bg-ok-tint/15 border-ok-tint/30"
          : tone === "warn"
            ? "text-warn bg-warn/15 border-warn/30"
            : tone === "crit"
              ? "text-crit bg-crit/15 border-crit/30"
              : "text-ink-dim bg-black/60 border-line"
      }`}
    >
      {children}
    </span>
  );
}

/** Barra segmentada (4px) para datos fraccionarios (DESIGN.md). */
export function SegmentedBar({
  total,
  filled,
  tone = "ok",
  className = "",
}: {
  total: number;
  filled: number;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-1 w-full h-1 ${className}`} role="progressbar" aria-valuenow={filled} aria-valuemin={0} aria-valuemax={total}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`h-1 flex-1 rounded-[1px] ${i < filled ? toneBg[tone] : "bg-line"}`}
        />
      ))}
    </div>
  );
}

/** Botón de la barra fija de revisión (Recortar / Rotar / Filtros / Texto /
 *  Pantalla completa). F5/D38: alto táctil 44px GARANTIZADO y label
 *  `truncate` — la barra nunca cambia de tamaño al girar el documento o
 *  cambiar de estado. F-OCR/D39: prop opcional `active` — re-vestido del
 *  ToolItem del lab (Fuente: apps/scanner-lab/src/components/scanner/
 *  EditorView.tsx L2205-2210 — `active={page?.ocrDone === true}`, L2208):
 *  cuando active, solo cambia el TINTE (borde + texto + fondo 10%) —
 *  alto/tamaño IDÉNTICOS (criterio D38 sigue vigente). */
export function ToolbarBtn({
  icon,
  label,
  onClick,
  active = false,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  /** D39/F-OCR: distingue el botón cuando ya hay texto reconocido. */
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 min-w-0 min-h-11 h-11 px-2.5 py-1.5 rounded-xl active:scale-95 transition-all flex items-center justify-center gap-1.5 text-xs font-semibold tracking-wide border ${
        active
          ? "border-ok-tint/40 bg-ok-tint/10 text-ok-tint"
          : "bg-surface-4/90 hover:bg-surface-5 border-outline-dim/40 text-ink"
      }`}
    >
      <span className="text-ok-tint shrink-0 flex items-center justify-center">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

/**
 * Botón CTA grande del footer (h-12, rounded-xl).
 * variant: "ok" (verde sólido + glow) · "warn" (ámbar) · "crit" (rojo) · "outline" (oscuro) · "outline-crit"
 */
export function PrimaryBtn({
  variant = "ok",
  onClick,
  icon,
  children,
  ariaLabel,
  disabled = false,
}: {
  variant?: "ok" | "warn" | "crit" | "outline" | "outline-crit";
  onClick?: () => void;
  icon?: ReactNode;
  children: ReactNode;
  ariaLabel?: string;
  /** Panel §5: GUARDAR UBICACIÓN hasta completar la cascada. */
  disabled?: boolean;
}) {
  const base =
    "flex-1 h-12 px-2.5 rounded-xl flex items-center justify-center gap-1.5 font-extrabold text-[10px] md:text-[11px] uppercase tracking-wide transition-all transform active:scale-[0.98] leading-tight text-center";
  const styles: Record<string, string> = {
    ok: "bg-ok-tint hover:bg-ok active:bg-ok text-ok-ink shadow-[0_0_12px_rgba(63,229,108,0.45)]",
    warn: "bg-warn hover:bg-warn/90 active:bg-warn/80 text-warn-ink shadow-lg shadow-warn/20",
    crit: "bg-crit hover:bg-crit/90 active:bg-crit-deep text-white shadow-lg shadow-crit/30",
    outline: "bg-surface-2 hover:bg-hover text-ink-dim border border-outline-dim",
    "outline-crit": "bg-white/5 hover:bg-white/10 text-ink-dim border border-crit/30",
  };
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-disabled={disabled}
      className={`${base} ${styles[variant]} ${disabled ? "opacity-40 cursor-not-allowed shadow-none" : ""}`}
    >
      {icon && <span className="shrink-0 flex items-center justify-center">{icon}</span>}
      <span>{children}</span>
    </button>
  );
}

/** Pill de conexión ("● EN LÍNEA" / "● OFFLINE") — clicable. */
export function StatusPill({
  online,
  onClick,
  compact = false,
}: {
  online: boolean;
  onClick?: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={!online}
      title={online ? "Sincronizado en tiempo real — tocar para simular offline" : "Sin conexión — tocar para reconectar"}
      className={`flex items-center gap-1.5 ${
        compact ? "px-2 py-1" : "px-2.5 py-1.5"
      } rounded-full border transition-colors ${
        online
          ? "bg-ok-ink/60 border-ok-tint/40 text-ok-tint"
          : "bg-warn-ink/70 border-warn/40 text-warn"
      }`}
    >
      <StatusDot tone={online ? "ok" : "warn"} pulse />
      <span className="label-caps !text-[10px] tracking-widest">{online ? "EN LÍNEA" : "OFFLINE"}</span>
    </button>
  );
}
