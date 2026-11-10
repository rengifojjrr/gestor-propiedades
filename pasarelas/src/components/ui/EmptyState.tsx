import type { ReactNode } from "react";
import { cn } from "./cn";

export type EmptyStateProps = {
  /** Ícono decorativo (con `aria-hidden`). */
  icon?: ReactNode;
  /** Qué falta, dicho en claro: «Todavía no hay cobros». */
  title: string;
  /** Qué hacer para que deje de estar vacío. */
  description?: ReactNode;
  /** El botón o enlace que lo resuelve. */
  action?: ReactNode;
  className?: string;
};

/** Lo que se muestra cuando una lista o una sección no tiene nada: dice qué falta y cómo empezar. */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-3 rounded-card border border-dashed border-rule-strong px-4 py-6",
        className,
      )}
    >
      {icon ? <span className="text-ink-soft">{icon}</span> : null}
      <div className="flex flex-col gap-1">
        <p className="titulo text-lg leading-snug">{title}</p>
        {description ? <p className="max-w-prose text-ink-soft">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
