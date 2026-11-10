"use client";

import { useState, useTransition } from "react";
import { Alert, Button, ConfirmDialog, notify } from "@/components/ui";
import { purgeTransactions, restoreTransactions } from "@/server/pasarelas/actions/transactions";
import { cobros } from "./plural";

/** Lo más que borra `purgeTransactions` de una vez (el tope de un lote de cobros en el servidor). */
const PURGE_BATCH = 500;

/** Lo que se pierde al borrar del todo, dicho igual en un cobro y al vaciar. */
const LOST_TEXT = "con su reparto, su historial y también sus comprobantes. No se puede deshacer.";

/** «Restaurar» y «Borrar del todo» de un cobro de la papelera. `label` lo nombra para el lector de pantalla. */
export function TrashRowActions({ id, label }: { id: string; label: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function restore() {
    setError(null);
    startTransition(async () => {
      const result = await restoreTransactions({ ids: [id] });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      notify.success("Cobro restaurado.");
    });
  }

  function purge() {
    setError(null);
    startTransition(async () => {
      const result = await purgeTransactions({ ids: [id] });
      setConfirming(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      notify.success("Cobro borrado del todo.");
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={restore} disabled={pending}>
          Restaurar<span className="sr-only"> {label}</span>
        </Button>
        <Button variant="danger" onClick={() => setConfirming(true)} disabled={pending}>
          Borrar del todo<span className="sr-only"> {label}</span>
        </Button>
      </div>
      {error ? (
        <Alert tone="danger" announce>
          {error}
        </Alert>
      ) : null}
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={purge}
        title="¿Borrar este cobro del todo?"
        description={`Se borra para siempre, ${LOST_TEXT}`}
        confirmLabel="Borrar del todo"
        variant="danger"
        pending={pending}
      />
    </div>
  );
}

/**
 * «Vaciar la papelera»: borra del todo todos sus cobros, por lotes de hasta 500. Si un lote falla, se detiene ahí y
 * dice cuántos alcanzó a borrar.
 */
export function EmptyTrashButton({ ids }: { ids: string[] }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function empty() {
    setError(null);
    startTransition(async () => {
      let purged = 0;
      for (let start = 0; start < ids.length; start += PURGE_BATCH) {
        const result = await purgeTransactions({ ids: ids.slice(start, start + PURGE_BATCH) });
        if (!result.ok) {
          setConfirming(false);
          setError(purged === 0 ? result.error : `${result.error} Se alcanzaron a borrar ${cobros(purged)}.`);
          return;
        }
        purged += result.data.count;
      }
      setConfirming(false);
      notify.success(`${cobros(purged)} ${purged === 1 ? "borrado" : "borrados"} del todo.`);
    });
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button variant="danger" onClick={() => setConfirming(true)} disabled={pending}>
        Vaciar la papelera
      </Button>
      {error ? (
        <Alert tone="danger" announce>
          {error}
        </Alert>
      ) : null}
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={empty}
        title="¿Vaciar la papelera?"
        description={`Se borran para siempre ${ids.length === 1 ? "el cobro" : `los ${cobros(ids.length)}`} de la papelera, ${LOST_TEXT}`}
        confirmLabel="Vaciar la papelera"
        variant="danger"
        pending={pending}
      />
    </div>
  );
}
