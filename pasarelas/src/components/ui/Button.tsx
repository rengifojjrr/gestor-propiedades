import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

/**
 * `primary`: la acción principal de la pantalla (una sola). `secondary`: las demás.
 * `ghost`: acciones de poco peso, sin caja. `danger`: borrar o deshacer algo.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BASE =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-control text-base leading-tight font-semibold transition-colors select-none disabled:cursor-not-allowed disabled:opacity-55";

const WITH_TEXT = "px-4 py-2";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-brand text-on-brand hover:bg-brand-strong active:bg-brand-strong",
  secondary: "border border-rule-strong bg-surface text-ink hover:bg-sunken active:bg-sunken",
  ghost: "text-brand hover:bg-brand-soft active:bg-brand-soft",
  danger: "bg-danger text-on-danger hover:opacity-90 active:opacity-90",
};

/** Las clases de un botón, para dárselas a otro elemento (así se ve `ButtonLink`). */
export function buttonClass(variant: ButtonVariant = "secondary", className?: string): string {
  return cn(BASE, WITH_TEXT, VARIANTS[variant], className);
}

export type ButtonProps = ComponentProps<"button"> & { variant?: ButtonVariant };

/** Botón. Por defecto es `type="button"`: dentro de un formulario no lo envía por accidente. */
export function Button({ variant = "secondary", type = "button", className, ...props }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, className)} {...props} />;
}

export type ButtonLinkProps = ComponentProps<typeof Link> & { variant?: ButtonVariant };

/** Un enlace interno con aspecto de botón (navega; no ejecuta nada). */
export function ButtonLink({ variant = "secondary", className, ...props }: ButtonLinkProps) {
  return <Link className={buttonClass(variant, className)} {...props} />;
}

export type IconButtonProps = Omit<ComponentProps<"button">, "aria-label" | "children"> & {
  /** Qué hace el botón: es su nombre para lectores de pantalla (el ícono solo no dice nada). */
  label: string;
  /** El ícono (decorativo: va con `aria-hidden`). */
  children: ReactNode;
  variant?: ButtonVariant;
};

/** Botón de solo ícono, de 44 × 44 px, con nombre accesible obligatorio. */
export function IconButton({ label, variant = "ghost", type = "button", className, ...props }: IconButtonProps) {
  return <button type={type} aria-label={label} className={cn(BASE, VARIANTS[variant], className)} {...props} />;
}
