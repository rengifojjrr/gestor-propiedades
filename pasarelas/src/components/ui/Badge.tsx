import type { ComponentProps } from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

const TONES: Record<BadgeTone, string> = {
  neutral: "border-rule-strong bg-sunken text-ink",
  info: "border-info bg-info-soft text-info",
  success: "border-brand bg-brand-soft text-brand",
  warning: "border-warning bg-warning-soft text-warning",
  danger: "border-danger bg-danger-soft text-danger",
};

export type BadgeProps = ComponentProps<"span"> & { tone?: BadgeTone };

/**
 * Etiqueta de estado, como un sello. El color acompaña: lo que dice el estado es el TEXTO
 * («Depositado», «En disputa»), nunca solo el color.
 */
export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-stamp border px-1.5 py-0.5 text-sm leading-tight font-semibold whitespace-nowrap",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
