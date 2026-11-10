import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

export type AlertTone = "info" | "success" | "warning" | "danger";

const TONES: Record<AlertTone, { box: string; icon: string; Icon: LucideIcon }> = {
  info: { box: "border-info bg-info-soft", icon: "text-info", Icon: Info },
  success: { box: "border-brand bg-brand-soft", icon: "text-brand", Icon: CircleCheck },
  warning: { box: "border-warning bg-warning-soft", icon: "text-warning", Icon: TriangleAlert },
  danger: { box: "border-danger bg-danger-soft", icon: "text-danger", Icon: CircleAlert },
};

export type AlertProps = {
  tone?: AlertTone;
  /** Qué pasa, en una línea. */
  title?: ReactNode;
  /** El detalle y qué hacer. */
  children?: ReactNode;
  className?: string;
};

/**
 * Aviso dentro de la página (no se va solo; para avisos pasajeros está `notify`). Los de `warning` y
 * `danger` interrumpen al lector de pantalla (`role="alert"`); los demás se anuncian sin interrumpir.
 */
export function Alert({ tone = "info", title, children, className }: AlertProps) {
  const { box, icon, Icon } = TONES[tone];
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-control border-l-4 p-3 text-ink", box, className)}
    >
      <Icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", icon)} />
      <div className="flex min-w-0 flex-col gap-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-sm">{children}</div> : null}
      </div>
    </div>
  );
}
