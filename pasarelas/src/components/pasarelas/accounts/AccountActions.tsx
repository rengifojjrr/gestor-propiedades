"use client";

import { useState, useTransition } from "react";
import { Alert, Button, Dialog, notify } from "@/components/ui";
import { deleteBankAccount, setBankAccountActive } from "@/server/pasarelas/actions/accounts";
import { AccountFormDialog, type AccountFormValues } from "./AccountFormDialog";

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Lo que el borrado cambia, dicho en claro: cuántos cobros y cuentas de pasarela se quedan sin cuenta. */
function usageText(txCount: number, gatewayCount: number): string {
  const users = [
    txCount > 0 ? count(txCount, "cobro", "cobros") : null,
    gatewayCount > 0 ? count(gatewayCount, "cuenta de pasarela", "cuentas de pasarela") : null,
  ].filter((part) => part !== null);
  if (users.length === 0) return "Ningún cobro la usa.";
  const total = txCount + gatewayCount;
  return `${users.join(" y ")} ${total === 1 ? "la usa: quedará" : "la usan: quedarán"} sin cuenta destino, y eso cambia su historial.`;
}

/**
 * Lo que sigue pasando con una cuenta desactivada: las cuentas de pasarela que la tienen como destino no cambian
 * solas, así que los cobros nuevos de esas empresas la siguen usando.
 */
function deactivateText(gatewayCount: number): string {
  return gatewayCount === 1
    ? "Es la cuenta destino de 1 cuenta de pasarela: los cobros nuevos de esa empresa la seguirán usando hasta que la cambies en la empresa."
    : `Es la cuenta destino de ${gatewayCount} cuentas de pasarela: los cobros nuevos de esas empresas la seguirán usando hasta que la cambies en cada empresa.`;
}

/** Lo mismo, dicho dentro del diálogo de borrar, junto al consejo de desactivarla. */
function stillUsedText(gatewayCount: number): string {
  return gatewayCount === 1
    ? "La cuenta de pasarela que la usa la seguirá usando en los cobros nuevos hasta que la cambies en su empresa."
    : `Las ${gatewayCount} cuentas de pasarela que la usan la seguirán usando en los cobros nuevos hasta que la cambies en cada empresa.`;
}

type Open = "editar" | "desactivar" | "borrar" | null;

/**
 * Editar, activar o desactivar y borrar una cuenta. Borrar pregunta antes y ofrece desactivarla. Desactivar una
 * cuenta que usan cuentas de pasarela pregunta antes y avisa de que los cobros nuevos la seguirán usando.
 *
 * Lo que falla dentro de un diálogo se dice en el diálogo: un aviso pasajero quedaría detrás de él.
 */
export function AccountActions({
  id,
  active,
  values,
  txCount,
  gatewayCount,
}: {
  id: string;
  active: boolean;
  values: AccountFormValues;
  txCount: number;
  gatewayCount: number;
}) {
  const [open, setOpen] = useState<Open>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const show = (next: Open) => {
    setDialogError(null);
    setOpen(next);
  };

  /** Activa o desactiva. Desde un diálogo (`inDialog`), el fallo se dice en él; si no, con un aviso pasajero. */
  const setActive = (next: boolean, inDialog: boolean) =>
    startTransition(async () => {
      const result = await setBankAccountActive({ id, active: next });
      if (!result.ok) {
        if (inDialog) setDialogError(result.error);
        else notify.error(result.error);
        return;
      }
      setOpen(null);
      notify.success(next ? "Cuenta activada." : "Cuenta desactivada.");
    });

  const remove = () =>
    startTransition(async () => {
      setDialogError(null);
      const result = await deleteBankAccount({ id });
      if (!result.ok) {
        setDialogError(result.error);
        return;
      }
      setOpen(null);
      notify.success("Cuenta borrada.");
    });

  const toggle = () => {
    if (active && gatewayCount > 0) show("desactivar");
    else setActive(!active, false);
  };

  const error = dialogError ? (
    <Alert tone="danger" announce>
      {dialogError}
    </Alert>
  ) : null;

  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => setOpen("editar")} disabled={pending}>
        Editar
      </Button>
      <Button onClick={toggle} disabled={pending}>
        {active ? "Desactivar" : "Activar"}
      </Button>
      <Button variant="ghost" onClick={() => show("borrar")} disabled={pending}>
        Borrar
      </Button>

      <AccountFormDialog open={open === "editar"} onClose={() => setOpen(null)} id={id} initial={values} />

      <Dialog
        open={open === "desactivar"}
        onClose={() => setOpen(null)}
        role="alertdialog"
        title={`¿Desactivar «${values.alias}»?`}
        description={deactivateText(gatewayCount)}
        footer={
          <>
            <Button onClick={() => setOpen(null)} disabled={pending}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={() => setActive(false, true)} disabled={pending}>
              Desactivar
            </Button>
          </>
        }
      >
        {error}
      </Dialog>

      <Dialog
        open={open === "borrar"}
        onClose={() => setOpen(null)}
        role="alertdialog"
        title={`¿Borrar «${values.alias}»?`}
        description={`${usageText(txCount, gatewayCount)} No se puede deshacer.`}
        footer={
          <>
            <Button onClick={() => setOpen(null)} disabled={pending}>
              Cancelar
            </Button>
            {active ? (
              <Button onClick={() => setActive(false, true)} disabled={pending}>
                Desactivar
              </Button>
            ) : null}
            <Button variant="danger" onClick={remove} disabled={pending}>
              Borrar
            </Button>
          </>
        }
      >
        {error ??
          (active ? (
            <p className="text-sm text-ink-soft">
              Si ya no la usas, desactívala: deja de ofrecerse al elegir cuenta y lo registrado la conserva.
              {gatewayCount > 0 ? ` ${stillUsedText(gatewayCount)}` : null}
            </p>
          ) : null)}
      </Dialog>
    </div>
  );
}
