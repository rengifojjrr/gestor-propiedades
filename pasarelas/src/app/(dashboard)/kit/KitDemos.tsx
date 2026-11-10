"use client";

import { useState, type ReactNode } from "react";
import { Button, ConfirmDialog, Dialog, Field, Input, notify, SubmitButton } from "@/components/ui";

/* Las piezas de la galería que necesitan estado o eventos. */

/** Cuántas veces llamó el diálogo a cada función de quien lo usa. Lo leen las pruebas de punta a punta. */
function Calls({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <p data-testid={testId} className="mt-2 font-mono text-sm text-ink-soft">
      Llamadas: {children}
    </p>
  );
}

export function DialogDemo() {
  const [open, setOpen] = useState(false);
  const [closes, setCloses] = useState(0);
  const close = () => setOpen(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Abrir diálogo</Button>
      <Calls testId="llamadas-dialogo">onClose {closes}</Calls>
      <Dialog
        open={open}
        onClose={() => {
          setCloses((count) => count + 1);
          close();
        }}
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
        <Field label="Comentario" optional>
          <Input name="comment" autoComplete="off" />
        </Field>
      </Dialog>
    </>
  );
}

export function ConfirmDemo() {
  const [open, setOpen] = useState(false);
  const [closes, setCloses] = useState(0);
  const [confirms, setConfirms] = useState(0);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Enviar a la papelera</Button>
      <Calls testId="llamadas-confirmacion">
        onClose {closes} · onConfirm {confirms}
      </Calls>
      <ConfirmDialog
        open={open}
        onClose={() => {
          setCloses((count) => count + 1);
          setOpen(false);
        }}
        onConfirm={() => {
          setConfirms((count) => count + 1);
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
