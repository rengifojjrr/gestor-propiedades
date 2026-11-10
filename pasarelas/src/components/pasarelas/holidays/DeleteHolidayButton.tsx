"use client";

import { Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { ConfirmDialog, DateText, IconButton, notify } from "@/components/ui";
import type { ISODate } from "@/lib/pasarelas/types";
import { deleteHoliday } from "@/server/pasarelas/actions/holidays";

/** Quitar un feriado, preguntando antes. */
export function DeleteHolidayButton({ id, day, name }: { id: string; day: ISODate; name: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const remove = () =>
    startTransition(async () => {
      const result = await deleteHoliday({ id });
      if (!result.ok) {
        notify.error(result.error);
        return;
      }
      setOpen(false);
      notify.success("Feriado quitado.");
    });

  return (
    <>
      <IconButton label={`Quitar ${name}`} onClick={() => setOpen(true)} disabled={pending}>
        <Trash2 aria-hidden className="size-5" />
      </IconButton>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={remove}
        pending={pending}
        title="¿Quitar este feriado?"
        description={
          <>
            «{name}» (<DateText value={day} />) dejará de saltarse al estimar los depósitos en días hábiles. Puedes
            volver a agregarlo.
          </>
        }
        confirmLabel="Quitar"
        variant="danger"
      />
    </>
  );
}
