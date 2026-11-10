"use client";

import { Trash2 } from "lucide-react";
import { useId, useState, useTransition } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  DateText,
  Field,
  Input,
  MoneyInput,
  notify,
  PctInput,
  SubmitButton,
} from "@/components/ui";
import { formatDate } from "@/lib/pasarelas/dates";
import type { FeeVersionCfg, ISODate } from "@/lib/pasarelas/types";
import { addFeeVersion, deleteFeeVersion } from "@/server/pasarelas/actions/gateways";
import { firstError, NETWORK_TEXT, type FieldErrors } from "./drafts";
import { FeeText } from "./FeeText";

/** La fecha con la que se guarda la primera tarifa: rige «desde el inicio». */
const SINCE_START: ISODate = "2000-01-01";

const sinceText = (from: ISODate): string => (from === SINCE_START ? "desde el inicio" : `desde ${formatDate(from)}`);

/**
 * El historial de tarifas, de la más nueva a la más vieja, con la que rige hoy marcada; y el alta de una nueva con
 * su «vigente desde» (por defecto mañana). Una tarifa no se edita: cada cobro guarda congelada la que usó.
 */
export function FeeVersionsCard({
  gatewayId,
  versions,
  currentId,
  defaultFrom,
}: {
  gatewayId: string;
  /** De la más vieja a la más nueva. */
  versions: FeeVersionCfg[];
  /** La que rige hoy. */
  currentId: string | null;
  /** El «vigente desde» que se propone: mañana. */
  defaultFrom: ISODate;
}) {
  const titleId = useId();
  const [pct, setPct] = useState("");
  const [fixed, setFixed] = useState("");
  const [from, setFrom] = useState(defaultFrom);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>(undefined);
  const [removing, setRemoving] = useState<FeeVersionCfg | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function add() {
    let result;
    try {
      result = await addFeeVersion({ gatewayId, pct, fixed, effectiveFrom: from, note });
    } catch {
      // Sin conexión: se dice aquí, sin perder lo escrito (si no, la ficha entera pasaría a su error).
      setError(NETWORK_TEXT);
      return;
    }
    if (!result.ok) {
      setError(result.error);
      setErrors(result.fieldErrors);
      return;
    }
    setError(null);
    setErrors(undefined);
    setPct("");
    setFixed("");
    setFrom(defaultFrom);
    setNote("");
    notify.success("Tarifa agregada");
  }

  function remove(version: FeeVersionCfg) {
    startTransition(async () => {
      const result = await deleteFeeVersion({ id: version.id });
      setRemoving(null);
      if (!result.ok) {
        setListError(result.error);
        return;
      }
      setListError(null);
      notify.success("Tarifa borrada");
    });
  }

  const newestFirst = [...versions].reverse();

  return (
    <Card>
      <section aria-labelledby={titleId}>
        <CardHeader>
          <CardTitle id={titleId}>Tarifas</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-5">
          <ul className="flex flex-col divide-y divide-rule">
            {newestFirst.map((version) => (
              <li key={version.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    <FeeText pct={version.pct} fixed={version.fixed} />
                    {version.id === currentId ? <Badge tone="success">Vigente</Badge> : null}
                  </p>
                  <p className="text-sm text-ink-soft">
                    {version.effectiveFrom === SINCE_START ? (
                      "Desde el inicio"
                    ) : (
                      <>
                        Desde <DateText value={version.effectiveFrom} />
                      </>
                    )}
                    {version.note ? ` · ${version.note}` : null}
                  </p>
                </div>
                {versions.length > 1 ? (
                  <Button
                    variant="ghost"
                    aria-label={`Borrar la tarifa ${sinceText(version.effectiveFrom)}`}
                    onClick={() => {
                      setListError(null);
                      setRemoving(version);
                    }}
                    disabled={pending}
                  >
                    <Trash2 aria-hidden className="size-5" />
                    Borrar
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {listError ? (
            <Alert tone="danger" announce>
              {listError}
            </Alert>
          ) : null}

          <form action={add} className="flex flex-col gap-4 border-t border-rule pt-4" noValidate>
            <h3 className="titulo text-base">Agregar tarifa</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Comisión" error={firstError(errors, "pct")}>
                <PctInput value={pct} onChange={(event) => setPct(event.currentTarget.value)} required />
              </Field>
              <Field label="Cuota fija" error={firstError(errors, "fixed")}>
                <MoneyInput value={fixed} onChange={(event) => setFixed(event.currentTarget.value)} required />
              </Field>
            </div>
            <Field
              label="Vigente desde"
              hint="Por defecto, mañana. Los cobros de antes conservan la tarifa con la que se registraron."
              error={firstError(errors, "effectiveFrom")}
            >
              <Input type="date" value={from} onChange={(event) => setFrom(event.currentTarget.value)} required />
            </Field>
            <Field label="Nota" optional error={firstError(errors, "note")}>
              <Input value={note} onChange={(event) => setNote(event.currentTarget.value)} maxLength={200} />
            </Field>
            {error ? (
              <Alert tone="danger" announce>
                {error}
              </Alert>
            ) : null}
            <SubmitButton variant="secondary" className="self-start">
              Agregar tarifa
            </SubmitButton>
          </form>
        </CardBody>
      </section>
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) remove(removing);
        }}
        pending={pending}
        title="¿Borrar esta tarifa?"
        description="Solo se puede borrar si ningún cobro la usó. Lo que se registre después usará la tarifa vigente en su fecha."
        confirmLabel="Borrar tarifa"
        variant="danger"
      />
    </Card>
  );
}
