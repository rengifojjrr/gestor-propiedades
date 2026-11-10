"use client";

import { useState } from "react";
import { Button, ConfirmDialog, Dialog, Field, Input, notify, SubmitButton } from "@/components/ui";

/* Las piezas de la galería que necesitan estado o eventos. */

export function DialogDemo() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Abrir diálogo</Button>
      <Dialog
        open={open}
        onClose={close}
        title="Marcar como depositado"
        description="El cobro pasa a «Depositado» con la fecha en que cayó al banco."
        footer={
          <>
            <Button onClick={close}>Cancelar</Button>
            <Button
              variant="primary"
              onClick={() => {
                close();
                notify.success("Cobro marcado como depositado");
              }}
            >
              Marcar como depositado
            </Button>
          </>
        }
      >
        <Field label="Fecha del depósito">
          <Input type="date" defaultValue="2026-11-17" />
        </Field>
      </Dialog>
    </>
  );
}

export function ConfirmDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Enviar a la papelera</Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={() => {
          setOpen(false);
          notify.success("Cobro enviado a la papelera");
        }}
        title="¿Enviar este cobro a la papelera?"
        description="Deja de contar en los totales. Puedes restaurarlo cuando quieras."
        confirmLabel="Enviar a la papelera"
        variant="danger"
      />
    </>
  );
}

export function NotifyDemo() {
  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => notify.success("Cobro guardado")}>Aviso de éxito</Button>
      <Button onClick={() => notify.error("No se pudo guardar el cobro")}>Aviso de error</Button>
    </div>
  );
}

const pretendToSave = () => new Promise<void>((resolve) => setTimeout(resolve, 1200));

export function SubmitDemo() {
  return (
    <form action={pretendToSave}>
      <SubmitButton>Guardar cobro</SubmitButton>
    </form>
  );
}
