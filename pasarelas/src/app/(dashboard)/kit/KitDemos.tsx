"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  Field,
  Input,
  notify,
  Select,
  SubmitButton,
  Switch,
} from "@/components/ui";

/* Las piezas de la galería que necesitan estado o eventos. */

/** Cuántas veces llamó el diálogo a cada función de quien lo usa. Lo leen las pruebas de punta a punta. */
function Calls({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <p data-testid={testId} className="mt-2 font-mono text-sm text-ink-soft">
      Llamadas: {children}
    </p>
  );
}

export function DialogDemo() {
  const [open, setOpen] = useState(false);
  const [closes, setCloses] = useState(0);
  const close = () => setOpen(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Abrir diálogo</Button>
      <Calls testId="llamadas-dialogo">onClose {closes}</Calls>
      <Dialog
        open={open}
        onClose={() => {
          setCloses((count) => count + 1);
          close();
        }}
        title="Marcar como depositado"
        description="El cobro pasa a «Depositado» con la fecha en que cayó al banco."
        footer={
          <>
            <Button onClick={close}>Cancelar</Button>
            <Button
              variant="primary"
              onClick={() => {
                close();
                notify.success("Cobro marcado como depositado");
              }}
            >
              Marcar como depositado
            </Button>
          </>
        }
      >
        <Field label="Fecha del depósito">
          <Input type="date" defaultValue="2026-11-17" />
        </Field>
        <Field label="Comentario" optional>
          <Input name="comment" autoComplete="off" />
        </Field>
      </Dialog>
    </>
  );
}

export function ConfirmDemo() {
  const [open, setOpen] = useState(false);
  const [closes, setCloses] = useState(0);
  const [confirms, setConfirms] = useState(0);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Enviar a la papelera</Button>
      <Calls testId="llamadas-confirmacion">
        onClose {closes} · onConfirm {confirms}
      </Calls>
      <ConfirmDialog
        open={open}
        onClose={() => {
          setCloses((count) => count + 1);
          setOpen(false);
        }}
        onConfirm={() => {
          setConfirms((count) => count + 1);
          setOpen(false);
          notify.success("Cobro enviado a la papelera");
        }}
        title="¿Enviar este cobro a la papelera?"
        description="Deja de contar en los totales. Puedes restaurarlo cuando quieras."
        confirmLabel="Enviar a la papelera"
        variant="danger"
      />
    </>
  );
}

export function NotifyDemo() {
  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => notify.success("Cobro guardado")}>Aviso de éxito</Button>
      <Button onClick={() => notify.error("No se pudo guardar el cobro")}>Aviso de error</Button>
    </div>
  );
}

const pretendToSave = () => new Promise<void>((resolve) => setTimeout(resolve, 1200));

export function SubmitDemo() {
  return (
    <form action={pretendToSave}>
      <SubmitButton>Guardar cobro</SubmitButton>
    </form>
  );
}

/**
 * Una casilla «a medias» (`indeterminate` solo se pone desde el DOM): el `ref` que llega por props, sea función u
 * objeto, sigue llegando al `<input>`.
 */
export function IndeterminateDemo() {
  const objectRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (objectRef.current) objectRef.current.indeterminate = true;
  }, []);
  return (
    <>
      <Checkbox
        label="Todos los cobros de esta página"
        ref={(input: HTMLInputElement | null) => {
          if (input) input.indeterminate = true;
        }}
      />
      <Checkbox label="Todas las empresas" ref={objectRef} />
    </>
  );
}

const ACCOUNTS = [
  { value: "", label: "Sin cuenta destino" },
  { value: "cuenta-1234", label: "Banco Demo ··1234" },
  { value: "cuenta-5678", label: "Banco Demo ··5678" },
];

const yesNo = (on: boolean) => (on ? "sí" : "no");

/**
 * Un `<form action>` de verdad con un Select, una casilla y un interruptor controlados. Al terminar la acción,
 * React 19 reinicia el formulario: la pantalla tiene que seguir enseñando lo que dice el estado.
 */
export function FormResetDemo() {
  const [account, setAccount] = useState("");
  const [returnsFee, setReturnsFee] = useState(false);
  const [active, setActive] = useState(true);
  const [sent, setSent] = useState<string | null>(null);
  const accountLabel = (value: FormDataEntryValue | null) =>
    ACCOUNTS.find((option) => option.value === value)?.label ?? "—";

  async function save(form: FormData) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    setSent(
      `Enviado: ${accountLabel(form.get("bankAccountId"))} · devuelve la comisión: ${yesNo(form.has("refundsReturnFee"))} · canal activo: ${yesNo(form.has("active"))}`,
    );
  }

  return (
    <form action={save} aria-label="Reinicio de un formulario con acción" className="flex flex-col gap-3">
      <Field label="Cuenta destino">
        <Select name="bankAccountId" value={account} onChange={(event) => setAccount(event.target.value)}>
          {ACCOUNTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
      <Checkbox
        name="refundsReturnFee"
        label="Devuelve la comisión"
        checked={returnsFee}
        onChange={(event) => setReturnsFee(event.target.checked)}
      />
      <Switch name="active" label="Canal activo" checked={active} onChange={(event) => setActive(event.target.checked)} />
      <p data-testid="estado-reinicio" className="font-mono text-sm text-ink-soft">
        Estado: {accountLabel(account)} · devuelve la comisión: {yesNo(returnsFee)} · canal activo: {yesNo(active)}
      </p>
      {sent ? (
        <p data-testid="enviado-reinicio" className="font-mono text-sm text-ink-soft">
          {sent}
        </p>
      ) : null}
      <SubmitButton>Guardar canal</SubmitButton>
    </form>
  );
}
