"use client";

import { Power, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Button, ConfirmDialog, notify } from "@/components/ui";
import { deleteGateway, setGatewayActive } from "@/server/pasarelas/actions/gateways";
import { ActionError } from "../ActionError";
import { callAction, failureOf, type ActionFailure } from "../callAction";

/**
 * Activar o desactivar la pasarela, y borrarla. Una pasarela con cobros no se borra (la base no deja): se
 * desactiva, y deja de ofrecerse al registrar sin tocar lo ya registrado.
 */
export function GatewayStatusActions({ id, name, active }: { id: string; name: string; active: boolean }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<ActionFailure | null>(null);

  function toggle() {
    startTransition(async () => {
      const result = await callAction(() => setGatewayActive({ id, active: !active }));
      if (!result.ok) {
        setError(failureOf(result));
        return;
      }
      setError(null);
      notify.success(active ? "Pasarela desactivada" : "Pasarela activada");
    });
  }

  function remove() {
    startTransition(async () => {
      // Si sale bien, la acción lleva a la lista: esta ficha ya no existe.
      const result = await callAction(() => deleteGateway({ id }));
      setConfirming(false);
      if (!result.ok) setError(failureOf(result));
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
        Borrar pasarela
      </Button>
      <ActionError failure={error} className="basis-full" />
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={remove}
        pending={pending}
        title="¿Borrar esta pasarela?"
        description={`Se borran ${name}, sus tarifas, sus opciones y sus cuentas en las empresas. No se puede deshacer. Si tiene cobros no se borra: desactívala.`}
        confirmLabel="Borrar pasarela"
        variant="danger"
      />
    </>
  );
}
