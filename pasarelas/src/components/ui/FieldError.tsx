import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";

/**
 * El mensaje de error de un control: ícono y texto en tinta roja (nunca solo color). Su `id` es el que el control
 * apunta con `aria-describedby`. Lo usan `Field`, `Checkbox` y `Switch`; no se exporta del kit.
 */
export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="flex items-start gap-1.5 text-sm font-semibold text-danger">
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      {children}
    </p>
  );
}
