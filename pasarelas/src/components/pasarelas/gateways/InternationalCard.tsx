"use client";

import { X } from "lucide-react";
import { useId, useState, useTransition } from "react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  MoneyInput,
  notify,
  PctInput,
  Select,
  SubmitButton,
} from "@/components/ui";
import type { DayType, ExtraCfg } from "@/lib/pasarelas/types";
import { removeInternational, saveInternational } from "@/server/pasarelas/actions/gateways";
import { ActionError } from "../ActionError";
import { callAction, failureOf, type ActionFailure } from "../callAction";
import { DaysRangeInputs } from "./DaysRangeInputs";
import { daysDraft, firstError, moneyDraft, pctDraft, type FieldErrors } from "./drafts";
import { draftTotal, type Fee } from "./international";
import { InternationalTotal } from "./InternationalTotal";

/** ¿Un pago internacional tarda lo mismo que uno nacional, o tiene sus propios días? */
type DaysChoice = "iguales" | "propios";

/**
 * «Pagos internacionales» en la ficha de la pasarela: el recargo que suma a los pagos internacionales (porcentaje y
 * fijo, sobre el bruto), con la cuenta completa contra la tarifa vigente hoy, y cuánto tardan en caer: lo mismo que
 * los nacionales o sus propios días («de 7 a 10»). Se agrega, se cambia o se quita (se apaga: los cobros que lo
 * usaron lo guardan). Lo ya registrado no cambia.
 *
 * Quien la pinta le cambia la `key` cuando cambia lo guardado: así vuelve a partir de ahí.
 */
export function InternationalCard({
  gatewayId,
  dayType,
  fee,
  international,
}: {
  gatewayId: string;
  /** Cómo cuenta los días la pasarela: los del pago internacional se cuentan igual. */
  dayType: DayType;
  /** La tarifa que rige hoy; `null` si la pasarela no tiene ninguna. */
  fee: Fee | null;
  /** El recargo encendido, o `null` si no cobra. */
  international: ExtraCfg | null;
}) {
  const titleId = useId();
  const [pct, setPct] = useState(international ? pctDraft(international.pct) : "");
  const [fixed, setFixed] = useState(international ? moneyDraft(international.fixed) : "0,00");
  const [daysChoice, setDaysChoice] = useState<DaysChoice>(
    international?.payoutDaysOverride == null ? "iguales" : "propios",
  );
  const [days, setDays] = useState({
    min: daysDraft(international?.payoutDaysOverride ?? null),
    max: daysDraft(international?.payoutDaysOverrideMax ?? null),
  });
  const [error, setError] = useState<ActionFailure | null>(null);
  const [errors, setErrors] = useState<FieldErrors>(undefined);
  const [removing, startRemoving] = useTransition();

  async function save() {
    // Si se corta, se dice aquí sin perder lo escrito (si no, la ficha entera pasaría a su error).
    // «Tardan lo mismo»: sin días propios. Lo escrito en «De» y «A» se conserva en pantalla por si se vuelve atrás.
    const own = daysChoice === "propios";
    if (own && days.min.trim() === "") {
      setError(null);
      setErrors({ payoutDaysOverride: ["Escribe desde cuántos días («De»)"] });
      return;
    }
    const result = await callAction(() =>
      saveInternational({
        id: international?.id ?? null,
        gatewayId,
        pct,
        fixed,
        payoutDaysOverride: own ? days.min : null,
        payoutDaysOverrideMax: own ? days.max : null,
      }),
    );
    if (!result.ok) {
      setError(failureOf(result));
      setErrors(result.fieldErrors);
      return;
    }
    setError(null);
    setErrors(undefined);
    notify.success(international ? "Recargo guardado" : "Recargo agregado");
  }

  function remove(id: string) {
    startRemoving(async () => {
      setError(null);
      const result = await callAction(() => removeInternational({ id }));
      if (!result.ok) {
        setError(failureOf(result));
        return;
      }
      notify.success("Recargo quitado");
    });
  }

  const total = fee === null ? null : draftTotal(fee, { pct, fixed });

  return (
    <Card>
      <section aria-labelledby={titleId}>
        <CardHeader>
          <CardTitle id={titleId}>Pagos internacionales</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <p className="text-ink-soft">
            {international
              ? "Lo que la pasarela suma a un pago internacional, sobre el bruto. Al registrar un cobro se pregunta si fue nacional o internacional."
              : "Sin recargo: un pago internacional paga lo mismo que uno nacional. Si la pasarela cobra más por los pagos de fuera, agrégalo aquí."}
          </p>
          <form action={save} className="flex flex-col gap-4" noValidate>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Recargo" error={firstError(errors, "pct")}>
                <PctInput value={pct} onChange={(event) => setPct(event.currentTarget.value)} required />
              </Field>
              <Field label="Fijo adicional" error={firstError(errors, "fixed")}>
                <MoneyInput value={fixed} onChange={(event) => setFixed(event.currentTarget.value)} />
              </Field>
            </div>
            <InternationalTotal
              total={total}
              context="con la tarifa vigente hoy"
              missing={
                fee === null
                  ? "La pasarela no tiene una tarifa vigente hoy: agrégala para ver la cuenta."
                  : "Escribe el recargo para ver cuánto paga un pago internacional."
              }
            />
            <Field
              label="Días al depósito"
              hint={`Se cuentan como los de la pasarela: días ${dayType === "habiles" ? "hábiles" : "corridos"}.`}
            >
              <Select value={daysChoice} onChange={(event) => setDaysChoice(event.currentTarget.value as DaysChoice)}>
                <option value="iguales">Tardan lo mismo que los nacionales</option>
                <option value="propios">Tienen sus propios días</option>
              </Select>
            </Field>
            {daysChoice === "propios" ? (
              <DaysRangeInputs
                legend="Sus días al depósito"
                value={days}
                onChange={setDays}
                errors={{
                  min: firstError(errors, "payoutDaysOverride"),
                  max: firstError(errors, "payoutDaysOverrideMax"),
                }}
              />
            ) : null}
            <p className="text-sm text-ink-soft">
              Lo ya registrado no cambia: cada cobro guarda el recargo (y sus días) con el que se calculó.
            </p>
            <ActionError failure={error} />
            <div className="flex flex-wrap gap-2">
              <SubmitButton variant="secondary" disabled={removing}>
                {international ? "Guardar recargo" : "Agregar recargo"}
              </SubmitButton>
              {international ? (
                <Button
                  variant="ghost"
                  onClick={() => remove(international.id)}
                  disabled={removing}
                  aria-busy={removing || undefined}
                >
                  <X aria-hidden className="size-5" />
                  Quitar recargo
                </Button>
              ) : null}
            </div>
          </form>
        </CardBody>
      </section>
    </Card>
  );
}
