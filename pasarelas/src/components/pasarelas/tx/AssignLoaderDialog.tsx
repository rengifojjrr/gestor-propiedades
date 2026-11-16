"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button, Dialog, Field, Select, notify } from "@/components/ui";
import type { LoaderCfg } from "@/lib/pasarelas/types";
import { assignLoader } from "@/server/pasarelas/actions/transactions";
import { DialogActionError, useRefreshOnClose } from "../ActionError";
import { callAction, failureOf, type ActionFailure } from "../callAction";
import { cobros, loaderAssignedText } from "./plural";

export type AssignLoaderDialogProps = {
  /** Los cobros elegidos (de 1 a 500). */
  ids: string[];
  /** Los cargadores que se ofrecen: los activos. */
  loaders: readonly LoaderCfg[];
  open: boolean;
  onClose: () => void;
  /** Tras asignar (antes de `onClose`). */
  onDone: () => void;
};

/**
 * «Asignar cargador…»: pone el cargador elegido (o, con «Sin cargador», quita el que tengan) a los cobros elegidos,
 * en un solo paso. Cada uno deja «Editado: cargador» en su historial; ninguna cifra cambia.
 */
export function AssignLoaderDialog({ ids, loaders, open, onClose, onDone }: AssignLoaderDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Asignar cargador"
      description={`${cobros(new Set(ids).size)}. Cada uno lo anota en su historial; ninguna cifra cambia.`}
    >
      {/* Solo existe mientras está abierto: cada vez empieza sin elegir y sin errores. */}
      {open ? <AssignLoaderForm ids={ids} loaders={loaders} onClose={onClose} onDone={onDone} /> : null}
    </Dialog>
  );
}

function AssignLoaderForm({ ids, loaders, onClose, onDone }: Omit<AssignLoaderDialogProps, "open">) {
  const [loaderId, setLoaderId] = useState(loaders[0]?.id ?? "");
  const [error, setError] = useState<ActionFailure | null>(null);
  useRefreshOnClose(error);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const chosen = loaderId === "" ? null : loaderId;
    startTransition(async () => {
      const result = await callAction(() => assignLoader({ ids, loaderId: chosen }));
      if (!result.ok) {
        setError(failureOf(result));
        return;
      }
      const name = loaders.find((loader) => loader.id === chosen)?.name ?? null;
      notify.success(loaderAssignedText(result.data.count, new Set(ids).size, name));
      onDone();
      onClose();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label="Cargador" hint="«Sin cargador» quita el que tengan.">
        <Select value={loaderId} onChange={(event) => setLoaderId(event.currentTarget.value)}>
          {loaders.map((loader) => (
            <option key={loader.id} value={loader.id}>
              {loader.name}
            </option>
          ))}
          <option value="">Sin cargador</option>
        </Select>
      </Field>
      <DialogActionError failure={error} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          Asignar
        </Button>
      </div>
    </form>
  );
}
