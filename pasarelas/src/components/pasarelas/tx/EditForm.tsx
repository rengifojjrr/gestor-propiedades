"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition, type FormEvent } from "react";
import {
  activeInternational,
  isOption,
  originOf,
  withOrigin,
} from "@/components/pasarelas/gateways/international";
import { InternationalChoice } from "@/components/pasarelas/gateways/InternationalChoice";
import { ExtrasToggles } from "@/components/pasarelas/registrar/ExtrasToggles";
import { Alert, Button, ButtonLink, Field, Input, MoneyInput, Select, Textarea, notify } from "@/components/ui";
import { localInputToInstant } from "@/lib/pasarelas/dates";
import { formatAmount, parseMoney } from "@/lib/pasarelas/money";
import { defaultExtraIds } from "@/lib/pasarelas/rules";
import type { PayConfig, TxSnapshot } from "@/lib/pasarelas/types";
import { PAY_STATE_TEXT } from "@/lib/pasarelas/write";
import { editTransaction } from "@/server/pasarelas/actions/transactions";
import { ActionError } from "../ActionError";
import { callAction, failureOf, type ActionFailure } from "../callAction";

const NOTE_MAX = 280;
const FIELDS_TEXT = "Revisa los campos marcados.";

type FieldErrors = Record<string, string | undefined>;

export type EditFormProps = {
  cfg: PayConfig;
  tx: TxSnapshot;
  /** La fecha y hora del cobro en Nueva York (`AAAA-MM-DDTHH:mm`), calculada por la página. */
  occurredLocal: string;
};

const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id) => b.includes(id));

/**
 * Editar un cobro. Solo viaja lo que cambió: el motor vuelve a resolver solo eso y lo demás conserva sus reglas
 * congeladas. Al cambiar de pasarela van también sus opciones; al cambiar de empresa, el canal se vacía (es de
 * otra). La cuenta destino, si no se toca, la vuelve a elegir el motor cuando cambian la empresa o la pasarela; la
 * fecha estimada se cambia aparte, desde el detalle. «¿El pago fue nacional o internacional?» parte de lo guardado
 * (si el desglose trae el recargo internacional) y, como las opciones, viaja solo si cambia.
 *
 * Manda la versión del cobro que se abrió (`expectedUpdatedAt`): si otra pestaña lo cambió entretanto, el servidor
 * da conflicto y no se pisa lo de la otra.
 */
/** Sin suscripción: solo sirve para saber si ya se hidrató (en el servidor da `false`, en el navegador `true`). */
const noSubscription = () => () => {};

export function EditForm({ cfg, tx: current, occurredLocal: initialLocal }: EditFormProps) {
  const router = useRouter();
  // Hasta hidratar, «Guardar cambios» no se puede tocar: lo escrito antes se perdería al hidratar (los campos son
  // controlados y vuelven al valor con que se pintaron) y se guardaría el cobro sin cambios.
  const hydrated = useSyncExternalStore(noSubscription, () => true, () => false);
  // El cobro tal como se abrió: si la pantalla se refresca detrás (tras un fallo de red), se compara con este.
  const [tx] = useState(current);
  const frozenExtras = tx.breakdown.rules.extras.map((option) => option.id);
  // Lo inactivo no se ofrece, salvo lo que el cobro ya usa.
  const companies = cfg.companies.filter((company) => company.active || company.id === tx.companyId);
  const gateways = cfg.gateways.filter((gateway) => gateway.active || gateway.id === tx.gatewayId);
  const schemes = cfg.schemes.filter((scheme) => scheme.active || scheme.id === tx.schemeId);
  const accounts = cfg.bankAccounts.filter((account) => account.active || account.id === tx.bankAccountId);

  // Lo guardado, partido: las opciones por un lado y, si fue internacional, su recargo (aunque ya esté apagado).
  const frozen = originOf(
    cfg.gateways.find((candidate) => candidate.id === tx.gatewayId),
    frozenExtras,
  );

  const [companyId, setCompanyId] = useState(tx.companyId);
  const [channelId, setChannelId] = useState(tx.channelId ?? "");
  const [gatewayId, setGatewayId] = useState(tx.gatewayId);
  const [extraIds, setExtraIds] = useState(frozen.optionIds);
  const [origin, setOrigin] = useState(frozen.origin);
  const [amount, setAmount] = useState(() => formatAmount(tx.grossOriginal));
  const [currency, setCurrency] = useState(tx.currency);
  const [occurredLocal, setOccurredLocal] = useState(initialLocal);
  const [reference, setReference] = useState(tx.reference ?? "");
  const [schemeId, setSchemeId] = useState(tx.schemeId ?? "");
  const [bankAccountId, setBankAccountId] = useState(tx.bankAccountId ?? "");
  const [note, setNote] = useState(tx.note ?? "");
  const [error, setError] = useState<ActionFailure | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();

  const channels = cfg.channels.filter(
    (channel) => channel.companyId === companyId && (channel.active || channel.id === tx.channelId),
  );
  const gateway = gateways.find((candidate) => candidate.id === gatewayId);
  const options = (gateway?.extras ?? [])
    .filter((option) => (option.active || frozenExtras.includes(option.id)) && isOption(option))
    .sort((a, b) => a.sort - b.sort);
  // El recargo que se aplica con «Internacional»: en la misma pasarela, el que el cobro congeló (si lo trae); si no,
  // el que la pasarela tiene encendido hoy.
  const international =
    gatewayId === tx.gatewayId && frozen.international !== null ? frozen.international : activeInternational(gateway);
  const appliedExtraIds = withOrigin(extraIds, international, origin);

  function chooseCompany(next: string) {
    setCompanyId(next);
    setChannelId("");
  }

  function chooseGateway(next: string) {
    setGatewayId(next);
    if (next === tx.gatewayId) {
      setExtraIds(frozen.optionIds);
      setOrigin(frozen.origin);
      return;
    }
    const nextGateway = gateways.find((candidate) => candidate.id === next);
    setExtraIds(originOf(nextGateway, defaultExtraIds(cfg, companyId, next)).optionIds);
    setOrigin("nacional");
  }

  /** Lo que cambió respecto del cobro guardado, como lo espera `editTransaction`. */
  function changes(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (companyId !== tx.companyId) out.companyId = companyId;
    if ((channelId || null) !== tx.channelId) out.channelId = channelId || null;
    if (gatewayId !== tx.gatewayId) out.gatewayId = gatewayId;
    // Con otra pasarela van siempre sus opciones: las de la anterior no son suyas.
    if (gatewayId !== tx.gatewayId || !sameIds(appliedExtraIds, frozenExtras)) out.extraIds = appliedExtraIds;
    if (parseMoney(amount) !== tx.grossOriginal) out.grossOriginal = amount;
    if (currency !== tx.currency) out.currency = currency;
    if (occurredLocal !== initialLocal) out.occurredAt = localInputToInstant(occurredLocal);
    if (reference.trim() !== (tx.reference ?? "")) out.reference = reference;
    if ((schemeId || null) !== tx.schemeId) out.schemeId = schemeId || null;
    if ((bankAccountId || null) !== tx.bankAccountId) out.bankAccountId = bankAccountId || null;
    if (note.trim() !== (tx.note ?? "")) out.note = note;
    return out;
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    let changed: Record<string, unknown>;
    try {
      changed = changes();
    } catch {
      setError({ text: FIELDS_TEXT, unsure: false });
      setFieldErrors({ occurredAt: "Elige la fecha y la hora." });
      return;
    }
    // Ya depositado, el cobro no puede ser de un día posterior al del depósito.
    if (tx.depositedOn !== null && occurredLocal.slice(0, 10) > tx.depositedOn) {
      setError({ text: FIELDS_TEXT, unsure: false });
      setFieldErrors({ occurredAt: PAY_STATE_TEXT.deposito_antes_del_cobro });
      return;
    }
    if (Object.keys(changed).length === 0) {
      setError({ text: PAY_STATE_TEXT.sin_cambios, unsure: false });
      return;
    }
    startTransition(async () => {
      const result = await callAction(() =>
        editTransaction({ id: tx.id, expectedUpdatedAt: tx.updatedAt, ...changed }),
      );
      if (!result.ok) {
        setError(failureOf(result));
        setFieldErrors(
          Object.fromEntries(Object.entries(result.fieldErrors ?? {}).map(([name, messages]) => [name, messages[0]])),
        );
        return;
      }
      notify.success("Cambios guardados.");
      router.push(`/pasarelas/cobros/${tx.id}`);
    });
  }

  return (
    <form noValidate onSubmit={save} className="flex max-w-2xl flex-col gap-4">
      <Field label="Empresa" error={fieldErrors.companyId}>
        <Select value={companyId} onChange={(event) => chooseCompany(event.currentTarget.value)}>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Canal" optional error={fieldErrors.channelId}>
        <Select value={channelId} onChange={(event) => setChannelId(event.currentTarget.value)}>
          <option value="">Sin canal</option>
          {channels.map((channel) => (
            <option key={channel.id} value={channel.id}>
              {channel.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Pasarela" error={fieldErrors.gatewayId}>
        <Select value={gatewayId} onChange={(event) => chooseGateway(event.currentTarget.value)}>
          {gateways.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </Select>
      </Field>

      {gateway ? (
        <ExtrasToggles
          gatewayName={gateway.name}
          options={options}
          selected={extraIds}
          currency={currency}
          onChange={setExtraIds}
        />
      ) : null}
      {gateway && international ? (
        <InternationalChoice
          gatewayName={gateway.name}
          international={international}
          currency={currency}
          value={origin}
          onChange={setOrigin}
        />
      ) : null}
      {fieldErrors.extraIds ? (
        <Alert tone="danger" announce>
          {fieldErrors.extraIds}
        </Alert>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)_6rem] items-start gap-3">
        <Field label="Monto" hint="Lo cobrado, antes de reembolsos." error={fieldErrors.grossOriginal}>
          <MoneyInput value={amount} onChange={(event) => setAmount(event.currentTarget.value)} />
        </Field>
        <Field label="Moneda" error={fieldErrors.currency}>
          <Input
            value={currency}
            maxLength={3}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setCurrency(event.currentTarget.value.toUpperCase())}
          />
        </Field>
      </div>

      <Field
        label="Fecha y hora"
        hint={
          tx.depositedOn === null
            ? "Hora de Nueva York."
            : "Hora de Nueva York. No puede ser de después del día del depósito."
        }
        error={fieldErrors.occurredAt}
      >
        <Input
          type="datetime-local"
          value={occurredLocal}
          max={tx.depositedOn === null ? undefined : `${tx.depositedOn}T23:59`}
          onChange={(event) => setOccurredLocal(event.currentTarget.value)}
        />
      </Field>

      <Field label="Referencia" optional hint="La que le da la pasarela al cobro." error={fieldErrors.reference}>
        <Input
          value={reference}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setReference(event.currentTarget.value)}
        />
      </Field>

      <Field label="Esquema de reparto" error={fieldErrors.schemeId}>
        <Select value={schemeId} onChange={(event) => setSchemeId(event.currentTarget.value)}>
          <option value="">Sin reparto</option>
          {schemes.map((scheme) => (
            <option key={scheme.id} value={scheme.id}>
              {scheme.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Cuenta destino"
        hint="Si cambias la empresa o la pasarela y no la tocas, pasa a ser la de esa pasarela en esa empresa."
        error={fieldErrors.bankAccountId}
      >
        <Select value={bankAccountId} onChange={(event) => setBankAccountId(event.currentTarget.value)}>
          <option value="">Sin cuenta</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.last4 === null ? account.alias : `${account.alias} ··${account.last4}`}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Nota" optional hint={`Hasta ${NOTE_MAX} caracteres.`} error={fieldErrors.note}>
        <Textarea value={note} maxLength={NOTE_MAX} onChange={(event) => setNote(event.currentTarget.value)} />
      </Field>

      <ActionError failure={error} />

      <div className="flex flex-wrap justify-end gap-2">
        <ButtonLink href={`/pasarelas/cobros/${tx.id}`}>Cancelar</ButtonLink>
        <Button type="submit" variant="primary" disabled={pending || !hydrated} aria-busy={pending || undefined}>
          {pending ? "Guardando…" : "Guardar cambios"}
        </Button>
      </div>
    </form>
  );
}
