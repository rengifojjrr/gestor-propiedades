"use client";

import { Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Button, DateText, Dialog, IconButton, notify } from "@/components/ui";
import type { ISODate } from "@/lib/pasarelas/types";
import { deleteHoliday } from "@/server/pasarelas/actions/holidays";
import { DialogActionError } from "../ActionError";
import { callAction, failureOf, type ActionFailure } from "../callAction";
import { savedWithRefresh } from "../tx/plural";

/**
 * Quitar un feriado, preguntando antes. Si falla (o se corta), se dice en el diálogo: un aviso pasajero quedaría
 * detrás. Al quitarlo dice cuántas fechas estimadas de lo que está por caer cambiaron.
 */
export function DeleteHolidayButton({ id, day, name }: { id: string; day: ISODate; name: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  const remove = () =>
    startTransition(async () => {
      setError(null);
      const result = await callAction(() => deleteHoliday({ id }));
      if (!result.ok) {
        setError(failureOf(result));
        return;
      }
      setOpen(false);
      const said = savedWithRefresh("Feriado quitado.", result.data.refreshed);
      notify.success(said.success);
      if (said.error !== null) notify.error(said.error);
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
        <DialogActionError failure={error} />
      </Dialog>
    </>
  );
}
