"use client";

import { CreditCard } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Checkbox,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  Input,
  Select,
  SubmitButton,
  Switch,
  notify,
} from "@/components/ui";
import { deleteCompanyGateway, saveCompanyGateway } from "@/server/pasarelas/actions/companies";
import type { CompanyGateway } from "@/server/pasarelas/queries/companies";
import { ExternalLink } from "./ExternalLink";
import { useActionForm } from "./useActionForm";

const NETWORK_TEXT = "No se pudo quitar. Revisa tu conexión e inténtalo de nuevo.";
const LINK_CLASS = "font-semibold text-brand underline";

/** Una pasarela del usuario, con lo que hace falta para elegirla y describir su cuenta en la empresa. */
export type GatewayOption = {
  id: string;
  name: string;
  active: boolean;
  payoutDays: number;
  payoutDayType: "habiles" | "corridos";
  extras: { id: string; name: string; defaultOn: boolean; active: boolean }[];
};

/** Una cuenta destino del usuario: su id y cómo se nombra («Cuenta principal ··4321»). */
export type BankAccountOption = { id: string; label: string; active: boolean };

/** «Cae el mismo día» · «Cae en 2 días hábiles». */
function payoutText(days: number, type: GatewayOption["payoutDayType"]): string {
  if (days === 0) return "Cae el mismo día";
  const unit = days === 1 ? "día" : "días";
  const kind = type === "habiles" ? (days === 1 ? "hábil" : "hábiles") : days === 1 ? "corrido" : "corridos";
  return `Cae en ${days} ${unit} ${kind}`;
}

/** Los nombres de las opciones, separados por comas; «ninguna» si no hay. */
const namesOf = (extras: readonly { name: string }[]) =>
  extras.length === 0 ? "ninguna" : extras.map((extra) => extra.name).join(", ");

type AccountValues = {
  gatewayId: string;
  dashboardUrl: string;
  checkoutUrl: string;
  bankAccountId: string;
  payoutDaysOverride: string;
  /** `null`: las que la pasarela trae encendidas. */
  defaultExtraIds: string[] | null;
};

function valuesOf(account: CompanyGateway | null, firstGatewayId: string): AccountValues {
  return {
    gatewayId: account?.gatewayId ?? firstGatewayId,
    dashboardUrl: account?.dashboardUrl ?? "",
    checkoutUrl: account?.checkoutUrl ?? "",
    bankAccountId: account?.bankAccountId ?? "",
    payoutDaysOverride: account?.payoutDaysOverride === null || !account ? "" : String(account.payoutDaysOverride),
    defaultExtraIds: account?.defaultExtraIds ?? null,
  };
}

/** Alta o edición de la cuenta de una pasarela en la empresa. */
function AccountForm({
  companyId,
  account,
  gateways,
  bankAccounts,
  onSaved,
}: {
  companyId: string;
  account: CompanyGateway | null;
  /** Las pasarelas que se pueden elegir (nunca vacía). */
  gateways: readonly GatewayOption[];
  bankAccounts: readonly BankAccountOption[];
  onSaved: () => void;
}) {
  const [values, setValues] = useState<AccountValues>(() => valuesOf(account, gateways[0]?.id ?? ""));
  const { submit, formError, errorOf } = useActionForm();
  const gateway = gateways.find((option) => option.id === values.gatewayId);
  const extras = gateway?.extras.filter((extra) => extra.active || values.defaultExtraIds?.includes(extra.id)) ?? [];
  const set =
    (field: "gatewayId" | "dashboardUrl" | "checkoutUrl" | "bankAccountId" | "payoutDaysOverride") =>
    (event: { currentTarget: { value: string } }) => {
      const { value } = event.currentTarget;
      // Otra pasarela trae otras opciones: las elegidas de la anterior no valen.
      setValues((current) => ({
        ...current,
        [field]: value,
        ...(field === "gatewayId" ? { defaultExtraIds: null } : {}),
      }));
    };

  async function save() {
    const result = await submit(() =>
      saveCompanyGateway({
        ...values,
        id: account?.id,
        companyId,
        bankAccountId: values.bankAccountId || null,
      }),
    );
    if (!result.ok) return;
    notify.success(account ? "Pasarela guardada" : "Pasarela agregada");
    onSaved();
  }

  return (
    <form action={save} noValidate className="flex flex-col gap-4">
      <Field label="Pasarela" error={errorOf("gatewayId")}>
        <Select value={values.gatewayId} onChange={set("gatewayId")}>
          {gateways.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Link del panel"
        optional
        hint="El panel de la pasarela para esta empresa. Empieza por https://"
        error={errorOf("dashboardUrl")}
      >
        <Input
          value={values.dashboardUrl}
          onChange={set("dashboardUrl")}
          inputMode="url"
          autoComplete="url"
          maxLength={300}
        />
      </Field>
      <Field
        label="Link de pago"
        optional
        hint="El link que le mandas a quien te paga. Empieza por https://"
        error={errorOf("checkoutUrl")}
      >
        <Input
          value={values.checkoutUrl}
          onChange={set("checkoutUrl")}
          inputMode="url"
          autoComplete="url"
          maxLength={300}
        />
      </Field>
      <Field
        label="Cuenta destino"
        optional
        hint={
          bankAccounts.length === 0 ? (
            <>
              Todavía no hay cuentas.{" "}
              <Link href="/pasarelas/cuentas" className={LINK_CLASS}>
                Créalas en Cuentas destino
              </Link>
              .
            </>
          ) : (
            "Dónde cae lo que cobra esta pasarela en esta empresa."
          )
        }
        error={errorOf("bankAccountId")}
      >
        <Select value={values.bankAccountId} onChange={set("bankAccountId")}>
          <option value="">Sin cuenta destino</option>
          {bankAccounts
            .filter((option) => option.active || option.id === values.bankAccountId)
            .map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
        </Select>
      </Field>
      <Field
        label="Días hasta el depósito"
        optional
        hint={
          gateway
            ? `Vacío: los de la pasarela (${payoutText(gateway.payoutDays, gateway.payoutDayType).toLowerCase()}).`
            : undefined
        }
        error={errorOf("payoutDaysOverride")}
      >
        <Input
          value={values.payoutDaysOverride}
          onChange={set("payoutDaysOverride")}
          inputMode="numeric"
          autoComplete="off"
          maxLength={2}
          className="max-w-24"
        />
      </Field>
      {extras.length > 0 ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-semibold text-ink">Opciones encendidas por defecto</legend>
          <Switch
            label="Las que trae la pasarela"
            hint={`Hoy: ${namesOf(extras.filter((extra) => extra.defaultOn))}.`}
            checked={values.defaultExtraIds === null}
            onChange={(event) => {
              const { checked } = event.currentTarget;
              setValues((current) => ({
                ...current,
                defaultExtraIds: checked ? null : extras.filter((extra) => extra.defaultOn).map((extra) => extra.id),
              }));
            }}
          />
          {values.defaultExtraIds !== null
            ? extras.map((extra) => (
                <Checkbox
                  key={extra.id}
                  label={extra.name}
                  checked={values.defaultExtraIds?.includes(extra.id) ?? false}
                  onChange={(event) => {
                    const { checked } = event.currentTarget;
                    setValues((current) => {
                      const chosen = (current.defaultExtraIds ?? []).filter((id) => id !== extra.id);
                      return { ...current, defaultExtraIds: checked ? [...chosen, extra.id] : chosen };
                    });
                  }}
                />
              ))
            : null}
          {errorOf("defaultExtraIds") ? (
            <p className="text-sm font-semibold text-danger">{errorOf("defaultExtraIds")}</p>
          ) : null}
        </fieldset>
      ) : null}
      {formError ? (
        <Alert tone="danger" announce>
          {formError}
        </Alert>
      ) : null}
      <SubmitButton className="self-start">Guardar pasarela</SubmitButton>
    </form>
  );
}

/**
 * Las pasarelas con las que cobra la empresa: por cada una, «Abrir panel» y «Abrir link de pago» (en otra
 * pestaña), su cuenta destino, cuándo cae el dinero y sus opciones por defecto. Agregar, editar y quitar.
 */
export function GatewaysCard({
  companyId,
  accounts,
  gateways,
  bankAccounts,
}: {
  companyId: string;
  accounts: readonly CompanyGateway[];
  gateways: readonly GatewayOption[];
  bankAccounts: readonly BankAccountOption[];
}) {
  const titleId = useId();
  // Lo que se elige se fija al abrir: al guardar, la lista se pone al día antes de que el diálogo se cierre.
  const [editing, setEditing] = useState<{ account: CompanyGateway | null; options: GatewayOption[] } | null>(null);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const gatewayOf = (id: string) => gateways.find((option) => option.id === id);
  const nameOf = (id: string) => gatewayOf(id)?.name ?? "Pasarela";
  const used = new Set(accounts.map((account) => account.gatewayId));
  // Para agregar: las activas que aún no están; para editar: además, la que ya tiene.
  const choices = (current: CompanyGateway | null) =>
    gateways.filter((option) => option.id === current?.gatewayId || (option.active && !used.has(option.id)));

  async function remove(target: { id: string; name: string }) {
    setBusy(true);
    let result;
    try {
      result = await deleteCompanyGateway({ id: target.id });
    } catch {
      result = { ok: false as const, error: NETWORK_TEXT };
    }
    setBusy(false);
    setRemoving(null);
    if (result.ok) notify.success(`${target.name} quitada de la empresa`);
    else notify.error(result.error);
  }

  const openForm = (account: CompanyGateway | null) => setEditing({ account, options: choices(account) });

  return (
    <Card>
      <section aria-labelledby={titleId}>
        <CardHeader>
          <CardTitle id={titleId}>Pasarelas de la empresa</CardTitle>
          <Button onClick={() => openForm(null)}>Agregar pasarela</Button>
        </CardHeader>
        <CardBody>
          {accounts.length === 0 ? (
            <EmptyState
              icon={<CreditCard aria-hidden className="size-8" />}
              title="Sin pasarelas"
              description="Agrega con qué cobra esta empresa: sus links al panel y de pago, y a qué cuenta cae el dinero."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-rule">
              {accounts.map((account) => {
                const gateway = gatewayOf(account.gatewayId);
                const name = nameOf(account.gatewayId);
                const bank = bankAccounts.find((option) => option.id === account.bankAccountId);
                const extras = gateway?.extras ?? [];
                const defaults =
                  account.defaultExtraIds === null
                    ? extras.filter((extra) => extra.defaultOn)
                    : extras.filter((extra) => account.defaultExtraIds?.includes(extra.id));
                return (
                  <li key={account.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{name}</p>
                      {gateway?.active === false ? <Badge>Pasarela inactiva</Badge> : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {account.dashboardUrl ? (
                        <ExternalLink href={account.dashboardUrl} context={`de ${name}`}>
                          Abrir panel
                        </ExternalLink>
                      ) : null}
                      {account.checkoutUrl ? (
                        <ExternalLink href={account.checkoutUrl} context={`de ${name}`}>
                          Abrir link de pago
                        </ExternalLink>
                      ) : null}
                      {!account.dashboardUrl && !account.checkoutUrl ? (
                        <p className="text-sm text-ink-soft">Sin links: agrégalos al editarla.</p>
                      ) : null}
                    </div>
                    <dl className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-3 sm:gap-x-4">
                      <div className="min-w-0">
                        <dt className="text-ink-soft">Cuenta destino</dt>
                        <dd>{bank?.label ?? "Sin cuenta destino"}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-soft">Depósito</dt>
                        <dd>
                          {gateway
                            ? payoutText(account.payoutDaysOverride ?? gateway.payoutDays, gateway.payoutDayType)
                            : "—"}
                          {account.payoutDaysOverride !== null ? " (propios de esta empresa)" : null}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-ink-soft">Opciones por defecto</dt>
                        <dd>
                          {account.defaultExtraIds === null ? "Las de la pasarela: " : null}
                          {namesOf(defaults)}
                        </dd>
                      </div>
                    </dl>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="ghost" onClick={() => openForm(account)}>
                        Editar<span className="sr-only"> {name}</span>
                      </Button>
                      <Button variant="ghost" onClick={() => setRemoving({ id: account.id, name })}>
                        Quitar<span className="sr-only"> {name}</span>
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </section>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.account ? "Editar pasarela" : "Agregar pasarela"}
      >
        {editing === null ? null : editing.options.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-ink-soft">
              {gateways.length === 0
                ? "Todavía no tienes pasarelas."
                : "Ya agregaste todas tus pasarelas a esta empresa."}{" "}
              Las pasarelas, con sus tarifas y sus opciones, se crean en Pasarelas.
            </p>
            <ButtonLink href="/pasarelas/pasarelas" className="self-start">
              Ir a Pasarelas
            </ButtonLink>
          </div>
        ) : (
          <AccountForm
            key={editing.account?.id ?? "nueva"}
            companyId={companyId}
            account={editing.account}
            gateways={editing.options}
            bankAccounts={bankAccounts}
            onSaved={() => setEditing(null)}
          />
        )}
      </Dialog>
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) void remove(removing);
        }}
        title={`¿Quitar ${removing?.name ?? ""} de esta empresa?`}
        description="Se pierden sus links, su cuenta destino y sus días propios en esta empresa. Los cobros ya registrados no cambian."
        confirmLabel="Quitar pasarela"
        variant="danger"
        pending={busy}
      />
    </Card>
  );
}
