"use client";

import { CalendarPlus, LoaderCircle } from "lucide-react";
import { useState, useTransition } from "react";
import { Button, notify } from "@/components/ui";
import { loadUsHolidays } from "@/server/pasarelas/actions/holidays";
import { ActionError } from "../ActionError";
import { callAction, failureOf, type ActionFailure } from "../callAction";
import { savedWithRefresh } from "../tx/plural";

/** Lo que se le dice a la persona después de cargar: cuántos se agregaron. */
function addedText(added: number): string {
  if (added === 0) return "Ya estaban todos: no se agregó ninguno.";
  return added === 1 ? "Se agregó 1 feriado." : `Se agregaron ${added} feriados.`;
}

/**
 * «Cargar feriados bancarios de EE. UU. de <año>»: agrega los que falten; repetirlo no duplica nada. Dice además
 * cuántas fechas estimadas de lo que está por caer cambiaron. Si falla (o se corta), se dice debajo del botón.
 */
export function LoadUsHolidaysButton({ year }: { year: number }) {
  const [error, setError] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  const load = () =>
    startTransition(async () => {
      setError(null);
      const result = await callAction(() => loadUsHolidays({ year }));
      if (!result.ok) {
        setError(failureOf(result));
        return;
      }
      const said = savedWithRefresh(addedText(result.data.added), result.data.refreshed);
      notify.success(said.success);
      if (said.error !== null) notify.error(said.error);
    });

  return (
    <div className="flex flex-col items-start gap-2 self-start">
      <Button onClick={load} disabled={pending} aria-busy={pending || undefined}>
        {pending ? (
          <LoaderCircle aria-hidden className="size-5 animate-spin" />
        ) : (
          <CalendarPlus aria-hidden className="size-5" />
        )}
        Cargar feriados bancarios de EE. UU. de {year}
      </Button>
      <ActionError failure={error} />
    </div>
  );
}
