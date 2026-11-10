"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  MoneyInput,
  notify,
  PctInput,
  SubmitButton,
} from "@/components/ui";
import { createGateway } from "@/server/pasarelas/actions/gateways";
import { callAction } from "../callAction";
import { EMPTY_EXTRA, EMPTY_GATEWAY, firstError, type ExtraDraft, type FieldErrors } from "./drafts";
import { ExtraFieldsInputs } from "./ExtraFieldsInputs";
import { GatewayFieldsInputs } from "./GatewayFieldsInputs";

type ExtraRow = ExtraDraft & { key: string };

/**
 * «Agregar pasarela»: sus datos, su tarifa (que rige desde el inicio) y, si tiene, sus opciones. Todo se crea de
 * una vez; al terminar lleva a su ficha.
 */
export function NewGatewayForm() {
  const router = useRouter();
  const [gateway, setGateway] = useState(EMPTY_GATEWAY);
  const [pct, setPct] = useState("");
  const [fixed, setFixed] = useState("0,00");
  const [extras, setExtras] = useState<ExtraRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>(undefined);

  const updateExtra = (key: string, next: ExtraDraft) =>
    setExtras((rows) => rows.map((row) => (row.key === key ? { ...next, key } : row)));

  async function submit() {
    // Si se corta, se dice aquí sin perder lo escrito (si no, la pantalla entera pasaría a su error). Sin «Ver cómo
    // quedó»: esta pantalla no enseña lo creado; la pasarela, si quedó, está en la lista.
    const result = await callAction(() =>
      createGateway({
        ...gateway,
        pct,
        fixed,
        extras: extras.map(({ key: _key, ...extra }) => extra),
      }),
    );
    if (!result.ok) {
      setError(result.error);
      setErrors(result.fieldErrors);
      return;
    }
    notify.success("Pasarela creada");
    router.push(`/pasarelas/pasarelas/${result.data.id}`);
  }

  const extrasError = firstError(errors, "extras");

  return (
    <form action={submit} className="flex flex-col gap-4" noValidate>
      <Card>
        <CardHeader>
          <CardTitle>Datos</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <GatewayFieldsInputs value={gateway} onChange={setGateway} errors={errors} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tarifa</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <p className="text-ink-soft">
            Rige desde el inicio. Si después cambia, agregas otra con su fecha: lo ya registrado no se toca.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Comisión" error={firstError(errors, "pct")}>
              <PctInput value={pct} onChange={(event) => setPct(event.currentTarget.value)} required />
            </Field>
            <Field label="Cuota fija" error={firstError(errors, "fixed")}>
              <MoneyInput value={fixed} onChange={(event) => setFixed(event.currentTarget.value)} />
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Opciones</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <p className="text-ink-soft">
            Lo que se cobra aparte si lo eliges al registrar, como un pago rápido. Puedes agregarlas después.
          </p>
          {extras.map((row, index) => (
            <fieldset key={row.key} className="flex min-w-0 flex-col gap-4 rounded-card border border-rule p-3">
              <legend className="px-1 font-semibold">Opción {index + 1}</legend>
              <ExtraFieldsInputs value={row} onChange={(next) => updateExtra(row.key, next)} />
              <Button
                variant="ghost"
                className="self-start"
                onClick={() => setExtras((rows) => rows.filter((other) => other.key !== row.key))}
              >
                <Trash2 aria-hidden className="size-5" />
                Quitar opción
              </Button>
            </fieldset>
          ))}
          {extrasError ? (
            <Alert tone="danger" announce>
              Revisa las opciones: {extrasError}
            </Alert>
          ) : null}
          <Button
            className="self-start"
            onClick={() => setExtras((rows) => [...rows, { ...EMPTY_EXTRA, key: crypto.randomUUID() }])}
          >
            <Plus aria-hidden className="size-5" />
            Agregar opción
          </Button>
        </CardBody>
      </Card>

      {error ? (
        <Alert tone="danger" announce>
          {error}
        </Alert>
      ) : null}
      <SubmitButton className="self-start" pendingLabel="Creando…">
        Crear pasarela
      </SubmitButton>
    </form>
  );
}
