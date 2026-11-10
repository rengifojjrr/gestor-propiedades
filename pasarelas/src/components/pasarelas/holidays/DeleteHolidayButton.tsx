"use client";

import { Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Alert, Button, DateText, Dialog, IconButton, notify } from "@/components/ui";
import type { ISODate } from "@/lib/pasarelas/types";
import { deleteHoliday } from "@/server/pasarelas/actions/holidays";

/** Quitar un feriado, preguntando antes. Si falla, se dice en el diálogo: un aviso pasajero quedaría detrás. */
export function DeleteHolidayButton({ id, day, name }: { id: string; day: ISODate; name: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const remove = () =>
    startTransition(async () => {
      setError(null);
      const result = await deleteHoliday({ id });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      notify.success("Feriado quitado.");
    });

  const close = () => setOpen(false);

  return (
    <>
      <IconButton
        label={`Quitar ${name}`}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        disabled={pending}
      >
        <Trash2 aria-hidden className="size-5" />
      </IconButton>
      <Dialog
        open={open}
        onClose={close}
        role="alertdialog"
        title="¿Quitar este feriado?"
        description={
          <>
            «{name}» (<DateText value={day} />) dejará de saltarse al estimar los depósitos en días hábiles. Puedes
            volver a agregarlo.
          </>
        }
        footer={
          <>
            <Button onClick={close} disabled={pending}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={remove} disabled={pending}>
              Quitar
            </Button>
          </>
        }
      >
        {error ? (
          <Alert tone="danger" announce>
            {error}
          </Alert>
        ) : null}
      </Dialog>
    </>
  );
}
