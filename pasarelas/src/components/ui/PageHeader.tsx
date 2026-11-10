import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "./cn";

export type BackLinkProps = { href: string; children: ReactNode; className?: string };

/** Enlace para volver a la pantalla de la que cuelga esta: «Cobros», «Empresas»… */
export function BackLink({ href, children, className }: BackLinkProps) {
  return (
    <Link
      href={href}
      className={cn(
        "-ml-1.5 inline-flex min-h-11 min-w-11 items-center gap-1 self-start rounded-control pr-2 font-semibold text-brand hover:underline",
        className,
      )}
    >
      <ChevronLeft aria-hidden className="size-5" />
      {children}
    </Link>
  );
}

export type PageHeaderProps = {
  /** El título de la pantalla: su único `<h1>`. */
  title: string;
  /** Una línea que orienta, si hace falta. */
  description?: ReactNode;
  /** A dónde se vuelve: `{ href: "/pasarelas/cobros", label: "Cobros" }`. */
  back?: { href: string; label: string };
  /** Botones de la pantalla, a la derecha del título (debajo en el celular). */
  actions?: ReactNode;
};

/** Cabecera de una pantalla. */
export function PageHeader({ title, description, back, actions }: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-col gap-2">
      {back ? <BackLink href={back.href}>{back.label}</BackLink> : null}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="titulo text-2xl leading-tight md:text-3xl">{title}</h1>
          {description ? <p className="max-w-prose text-ink-soft">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
