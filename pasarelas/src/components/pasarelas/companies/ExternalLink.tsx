import { ExternalLink as ExternalIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/components/ui";
import { buttonClass } from "@/components/ui/Button";
import { isHttpUrl } from "@/lib/pasarelas/guards";

export type ExternalLinkProps = {
  /** El link guardado. Si no es `http(s)://` no se pinta nada: un `javascript:` nunca llega a un `href`. */
  href: string;
  children: ReactNode;
  /** Lo que el lector de pantalla oye después del texto visible, para distinguir dos botones iguales. */
  context?: string;
  /** `button`: con aspecto de botón. `text`: un enlace dentro de un texto. */
  appearance?: "button" | "text";
  className?: string;
};

/**
 * Un link hacia fuera de la app (el panel de una pasarela, un link de pago, una web): se abre en otra pestaña y
 * sin darle a esa página acceso a esta (`rel="noopener noreferrer"`).
 */
export function ExternalLink({ href, children, context, appearance = "button", className }: ExternalLinkProps) {
  if (!isHttpUrl(href)) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={
        appearance === "button"
          ? buttonClass("secondary", className)
          : cn("inline-flex min-h-11 items-center gap-1 font-semibold break-all text-brand underline", className)
      }
    >
      {children}
      {context ? <span className="sr-only"> {context}</span> : null}
      <ExternalIcon aria-hidden className="size-4 shrink-0" />
      <span className="sr-only"> (se abre en otra pestaña)</span>
    </a>
  );
}
