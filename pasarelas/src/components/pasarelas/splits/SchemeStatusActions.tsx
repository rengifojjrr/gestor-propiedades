"use client";

import { Power, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Alert, Button, ConfirmDialog, notify } from "@/components/ui";
import { deleteScheme, setSchemeActive } from "@/server/pasarelas/actions/splits";

/**
 * Activar o desactivar el esquema, y borrarlo. Un esquema con cobros no se borra (la base no deja): se desactiva,
 * y deja de ofrecerse al registrar sin tocar lo ya repartido.
 */
export function SchemeStatusActions({ id, name, active }: { id: string; name: string; active: boolean }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    startTransition(async () => {
      const result = await setSchemeActive({ id, active: !active });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      notify.success(active ? "Esquema desactivado" : "Esquema activado");
    });
  }

  function remove() {
    startTransition(async () => {
      // Si sale bien, la acción lleva a Repartos: esta página ya no existe.
      const result = await deleteScheme({ id });
      setConfirming(false);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <>
      <Button onClick={toggle} disabled={pending}>
        <Power aria-hidden className="size-5" />
        {active ? "Desactivar" : "Activar"}
      </Button>
      <Button
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
        disabled={pending}
      >
        <Trash2 aria-hidden className="size-5" />
        Borrar esquema
      </Button>
      {error ? (
        <Alert tone="danger" announce className="basis-full">
          {error}
        </Alert>
      ) : null}
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={remove}
        pending={pending}
        title="¿Borrar este esquema?"
        description={`Se borran ${name} y todas sus versiones; la empresa que lo tenía por defecto queda sin esquema. No se puede deshacer. Si algún cobro lo usa no se borra: desactívalo.`}
        confirmLabel="Borrar esquema"
        variant="danger"
      />
    </>
  );
}
