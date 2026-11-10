"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from "react";
import { Button, IconButton, type ButtonVariant } from "./Button";
import { cn } from "./cn";

export type DialogProps = {
  /** Si está abierto. El estado lo lleva quien lo usa. */
  open: boolean;
  /** Se llama al cerrarlo con Escape, con su botón o tocando fuera: ahí hay que poner `open` en falso. */
  onClose: () => void;
  /** El título: es además el nombre accesible del diálogo. */
  title: string;
  /** Una frase bajo el título que explica qué se va a hacer. */
  description?: ReactNode;
  children?: ReactNode;
  /** Los botones, abajo. */
  footer?: ReactNode;
  /** `bottom`: hoja pegada al borde inferior (menús en el celular). */
  placement?: "center" | "bottom";
  /** `alertdialog` cuando interrumpe para pedir una confirmación. */
  role?: "dialog" | "alertdialog";
};

/**
 * Diálogo modal sobre el `<dialog>` nativo: `showModal()` deja inerte lo de atrás y atrapa el foco, Escape
 * lo cierra y, al cerrarse, el foco vuelve a donde estaba. El contenido solo existe mientras está abierto.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  placement = "center",
  role = "dialog",
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // El <dialog> no tiene relleno: un clic cuyo destino es el propio <dialog> cayó en el fondo oscuro.
  const closeOnBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <dialog
      ref={ref}
      role={role}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={onClose}
      onClick={closeOnBackdrop}
      className={cn(
        "max-h-[calc(100dvh-2rem)] overflow-y-auto border border-rule bg-surface p-0 text-ink shadow-overlay",
        placement === "center"
          ? "m-auto w-[calc(100vw-2rem)] max-w-md rounded-card"
          : "mx-auto mt-auto mb-0 w-full max-w-md rounded-t-card border-b-0 pb-[env(safe-area-inset-bottom)]",
      )}
    >
      {open ? (
        <div className="relative flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-1 pr-11">
            <h2 id={titleId} className="titulo text-xl leading-snug">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="text-ink-soft">
                {description}
              </p>
            ) : null}
          </div>
          {children}
          {footer ? <div className="flex flex-wrap justify-end gap-2">{footer}</div> : null}
          {/* Va al final para que el foco inicial caiga en el contenido, no en «Cerrar». */}
          <IconButton label="Cerrar" onClick={onClose} className="absolute top-2 right-2">
            <X aria-hidden className="size-5" />
          </IconButton>
        </div>
      ) : null}
    </dialog>
  );
}

export type ConfirmDialogProps = {
  open: boolean;
  /** Cancelar, Escape o tocar fuera. */
  onClose: () => void;
  /** Al confirmar. Quien lo usa cierra el diálogo cuando termina. */
  onConfirm: () => void;
  /** La pregunta, con el verbo de la acción: «¿Enviar este cobro a la papelera?». */
  title: string;
  /** Qué va a pasar y si se puede deshacer. */
  description?: ReactNode;
  /** El mismo verbo del título: «Enviar a la papelera». */
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` para lo que borra o no se puede deshacer. */
  variant?: Extract<ButtonVariant, "primary" | "danger">;
  /** Mientras la acción corre: desactiva los botones. */
  pending?: boolean;
};

/** Pregunta antes de hacer algo que cuesta deshacer. El foco empieza en «Cancelar». */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancelar",
  variant = "primary",
  pending = false,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      role="alertdialog"
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button variant={variant} onClick={onConfirm} disabled={pending}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
