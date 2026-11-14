"use client";

import { Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  IconButton,
  Input,
  notify,
  Percent,
  PctInput,
  Select,
  SubmitButton,
} from "@/components/ui";
import { isZero } from "@/lib/pasarelas/money";
import { RETENTION_ISSUE_TEXT } from "@/lib/pasarelas/rules";
import type { RetentionCfg } from "@/lib/pasarelas/types";
import { saveGatewayRetention } from "@/server/pasarelas/actions/gateways";
import { ActionError } from "../ActionError";
import { callAction, failureOf, type ActionFailure } from "../callAction";
import { firstError, pctDraft, type FieldErrors } from "./drafts";
import { retentionDraftIssues, retentionDraftTotal, type RecipientDraft } from "./retention";

type Choice = { id: string; name: string; active: boolean };
type Row = RecipientDraft & { key: string };

/** Lo que se dice de una persona de la retención que se desactivó en Repartos: la base no la deja guardar. */
const inactiveText = (name: string): string => `${name} está desactivado: quítalo o vuelve a activarlo en Repartos.`;

/** «Titular A (50 %) y Titular B (50 %)». */
function recipientsText(retention: RetentionCfg, nameOf: (id: string) => string): string {
  const names = retention.recipients.map((recipient) => `${nameOf(recipient.beneficiaryId)} (${pctDraft(recipient.pct)} %)`);
  return names.length === 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} y ${names.at(-1) ?? ""}`;
}

/**
 * «Retención» en la ficha de la pasarela: el % de cada cobro que la pasarela retiene, los días corridos que lo
 * retiene y a quién le cae cuando lo libera (una o más personas, cada una con su %, que suman 100). Lo retenido no
 * llega al banco del negocio: cuenta como un pago que esas personas ya recibieron de su parte del reparto. Con 0 % no
 * retiene y no hay personas.
 *
 * Mientras lo escrito no valga (las reglas del motor, las mismas de la acción y de la base), el botón no guarda y se
 * dice por qué. Solo se ofrecen beneficiarios activos: si una persona guardada se desactivó, su fila lo dice (y su
 * lista la nombra así), y no se guarda hasta quitarla o volver a activarla en Repartos, como exige la base.
 * Lo ya registrado no cambia: cada cobro congeló la retención con la que se calculó, y «Recalcular» le trae la de
 * ahora. Quien la pinta le cambia la `key` cuando cambia lo guardado: así vuelve a partir de ahí.
 */
export function RetentionCard({
  gatewayId,
  retention,
  beneficiaries,
}: {
  gatewayId: string;
  /** Lo guardado: `pct` "0" si no retiene. */
  retention: RetentionCfg;
  /** Los activos, que son los que se ofrecen, y los que ya reciben la retención aunque estén desactivados. */
  beneficiaries: readonly Choice[];
}) {
  const titleId = useId();
  const issuesId = useId();
  const [pct, setPct] = useState(pctDraft(retention.pct));
  const [days, setDays] = useState(String(retention.days));
  const [rows, setRows] = useState<Row[]>(() =>
    retention.recipients.map((recipient, index) => ({
      key: `guardada-${index}`,
      beneficiaryId: recipient.beneficiaryId,
      pct: pctDraft(recipient.pct),
    })),
  );
  const [error, setError] = useState<ActionFailure | null>(null);
  const [errors, setErrors] = useState<FieldErrors>(undefined);

  const nameOf = (id: string) => beneficiaries.find((b) => b.id === id)?.name ?? "Beneficiario borrado";
  const active = beneficiaries.filter((b) => b.active);
  const isInactive = (id: string) => beneficiaries.some((b) => b.id === id && !b.active);
  // Lo que no deja guardar: las reglas del motor y, una vez cada una, las personas desactivadas.
  const blockers = [
    ...retentionDraftIssues(pct, rows).map((issue) => RETENTION_ISSUE_TEXT[issue]),
    ...[...new Set(rows.map((row) => row.beneficiaryId))].filter(isInactive).map((id) => inactiveText(nameOf(id))),
  ];
  const next = active.find((b) => !rows.some((row) => row.beneficiaryId === b.id));
  const retains = !isZero(retention.pct);

  const updateRow = (key: string, patch: Partial<RecipientDraft>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  async function save() {
    // Si se corta, se dice aquí sin perder lo escrito (si no, la ficha entera pasaría a su error).
    const result = await callAction(() =>
      saveGatewayRetention({
        gatewayId,
        pct,
        days,
        recipients: rows.map((row) => ({ beneficiaryId: row.beneficiaryId, pct: row.pct })),
      }),
    );
    if (!result.ok) {
      setError(failureOf(result));
      setErrors(result.fieldErrors);
      return;
    }
    setError(null);
    setErrors(undefined);
    notify.success("Retención guardada");
  }

  return (
    <Card>
      <section aria-labelledby={titleId}>
        <CardHeader>
          <CardTitle id={titleId}>Retención</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <p className="text-ink-soft" data-testid="retencion-resumen">
            {retains
              ? `Retiene el ${pctDraft(retention.pct)} % de cada cobro durante ${retention.days === 1 ? "1 día corrido" : `${retention.days} días corridos`} y se lo paga a ${recipientsText(retention, nameOf)}: no llega al banco del negocio. Cuenta como un pago que ya recibieron de su parte del reparto.`
              : "No retiene nada. Si la pasarela se queda con un % de cada cobro unos días y después se lo paga a ciertas personas (no al banco del negocio), escríbelo aquí: contará como un pago que ya recibieron de su parte del reparto."}
          </p>
          <form action={save} className="flex flex-col gap-4" noValidate>
            <div className="grid grid-cols-2 gap-3">
              <Field label="% que retiene" hint="0 = no retiene." error={firstError(errors, "pct")}>
                <PctInput value={pct} onChange={(event) => setPct(event.currentTarget.value)} required />
              </Field>
              <Field label="Días que la retiene" hint="Corridos." error={firstError(errors, "days")}>
                <Input
                  value={days}
                  onChange={(event) => setDays(event.currentTarget.value)}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={3}
                  className="cifra text-right"
                  required
                />
              </Field>
            </div>

            <fieldset className="flex min-w-0 flex-col gap-3">
              <legend className="mb-1.5 text-sm font-semibold text-ink">¿A quién le cae?</legend>
              {rows.length === 0 ? (
                <p className="text-sm text-ink-soft">Nadie: sin retención no le cae a nadie.</p>
              ) : null}
              {rows.map((row, index) => (
                <fieldset key={row.key} className="flex min-w-0 flex-col gap-2 rounded-card border border-rule p-3">
                  <legend className="px-1 text-sm font-semibold">Persona {index + 1}</legend>
                  {/* En el celular el beneficiario va solo en su renglón: su nombre entero se lee. */}
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:grid-cols-[minmax(0,1fr)_6.5rem_auto]">
                    <Field label="Beneficiario" className="col-span-2 sm:col-span-1">
                      <Select
                        value={row.beneficiaryId}
                        onChange={(event) => updateRow(row.key, { beneficiaryId: event.currentTarget.value })}
                      >
                        {/* Solo los activos; el desactivado, solo en su fila y dicho así, para que se vea quién es. */}
                        {beneficiaries
                          .filter((b) => b.active || b.id === row.beneficiaryId)
                          .map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.active ? b.name : `${b.name} (desactivado)`}
                            </option>
                          ))}
                      </Select>
                    </Field>
                    <Field label="Porcentaje">
                      <PctInput value={row.pct} onChange={(event) => updateRow(row.key, { pct: event.currentTarget.value })} />
                    </Field>
                    <IconButton
                      label={`Quitar la persona ${index + 1}`}
                      onClick={() => setRows((current) => current.filter((candidate) => candidate.key !== row.key))}
                    >
                      <Trash2 aria-hidden className="size-5" />
                    </IconButton>
                  </div>
                  {isInactive(row.beneficiaryId) ? (
                    <Alert tone="warning">{inactiveText(nameOf(row.beneficiaryId))}</Alert>
                  ) : null}
                </fieldset>
              ))}
              <Button
                className="self-start"
                disabled={next === undefined}
                onClick={() => {
                  if (next) setRows((current) => [...current, { key: crypto.randomUUID(), beneficiaryId: next.id, pct: "" }]);
                }}
              >
                <Plus aria-hidden className="size-5" />
                Agregar persona
              </Button>
              {active.length === 0 ? (
                <p className="text-sm text-ink-soft">No hay beneficiarios activos: agrégalos en Repartos.</p>
              ) : null}
              {rows.length > 0 ? (
                <p data-testid="retencion-suma" aria-live="polite" className="font-semibold">
                  Suman <Percent value={retentionDraftTotal(rows)} />
                </p>
              ) : null}
            </fieldset>

            {blockers.length > 0 ? (
              <div id={issuesId}>
                <Alert tone="warning" title="Todavía no se puede guardar">
                  <ul className="flex flex-col gap-1">
                    {blockers.map((text) => (
                      <li key={text}>{text}</li>
                    ))}
                  </ul>
                </Alert>
              </div>
            ) : null}
            {firstError(errors, "recipients") ? (
              <Alert tone="danger" announce>
                Revisa a quién le cae: {firstError(errors, "recipients")}
              </Alert>
            ) : null}
            <p className="text-sm text-ink-soft">
              Lo ya registrado no cambia: cada cobro guarda la retención con la que se calculó. Para dársela a cobros
              ya registrados, usa «Recalcular» en el cobro o, con varios elegidos, en la lista de Cobros.
            </p>
            <ActionError failure={error} />
            <SubmitButton
              variant="secondary"
              className="self-start"
              disabled={blockers.length > 0}
              aria-describedby={blockers.length > 0 ? issuesId : undefined}
            >
              Guardar retención
            </SubmitButton>
          </form>
        </CardBody>
      </section>
    </Card>
  );
}
