"use client";

import { CalendarPlus, LoaderCircle } from "lucide-react";
import { useTransition } from "react";
import { Button, notify } from "@/components/ui";
import { loadUsHolidays } from "@/server/pasarelas/actions/holidays";

/** Lo que se le dice a la persona después de cargar: cuántos se agregaron. */
function addedText(added: number): string {
  if (added === 0) return "Ya estaban todos: no se agregó ninguno.";
  return added === 1 ? "Se agregó 1 feriado." : `Se agregaron ${added} feriados.`;
}

/** «Cargar feriados bancarios de EE. UU. de <año>»: agrega los que falten; repetirlo no duplica nada. */
export function LoadUsHolidaysButton({ year }: { year: number }) {
  const [pending, startTransition] = useTransition();

  const load = () =>
    startTransition(async () => {
      const result = await loadUsHolidays({ year });
      if (result.ok) notify.success(addedText(result.data.added));
      else notify.error(result.error);
    });

  return (
    <Button onClick={load} disabled={pending} aria-busy={pending || undefined} className="self-start">
      {pending ? (
        <LoaderCircle aria-hidden className="size-5 animate-spin" />
      ) : (
        <CalendarPlus aria-hidden className="size-5" />
      )}
      Cargar feriados bancarios de EE. UU. de {year}
    </Button>
  );
}
