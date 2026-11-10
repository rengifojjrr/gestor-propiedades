"use client";

import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "./Button";

export type SubmitButtonProps = Omit<ButtonProps, "type"> & {
  /** Texto mientras la acción del formulario está en curso. */
  pendingLabel?: ReactNode;
};

/**
 * Botón de enviar para un `<form action={…}>`: mientras la acción corre se desactiva (no se envía dos
 * veces) y cambia el texto. Tiene que estar DENTRO del formulario.
 */
export function SubmitButton({
  children,
  pendingLabel = "Guardando…",
  variant = "primary",
  disabled,
  ...props
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={disabled || pending} aria-busy={pending || undefined} {...props}>
      {pending ? (
        <>
          <LoaderCircle aria-hidden className="size-5 animate-spin" />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
