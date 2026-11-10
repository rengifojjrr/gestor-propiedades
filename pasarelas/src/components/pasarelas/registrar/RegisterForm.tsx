"use client";

import { ChevronDown, LoaderCircle, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ReceiptPicker } from "@/components/pasarelas/receipts/ReceiptPicker";
import { checkReceiptFile } from "@/components/pasarelas/receipts/check";
import { uploadReceipt } from "@/components/pasarelas/receipts/upload";
import { Alert, Button, Field, Input, Money, MoneyInput, PageHeader, Select, Textarea, notify } from "@/components/ui";
import { notifyAction } from "@/components/ui/notify";
import { instantToLocalInput, localInputToInstant } from "@/lib/pasarelas/dates";
import { parseMoney } from "@/lib/pasarelas/money";
import { defaultExtraIds } from "@/lib/pasarelas/rules";
import { LIFECYCLE_LABEL } from "@/lib/pasarelas/status";
import type { Currency, Money as MoneyText, PayConfig } from "@/lib/pasarelas/types";
import { createTransaction } from "@/server/pasarelas/actions/transactions";
import { ExtrasToggles } from "./ExtrasToggles";
import { LivePreview } from "./LivePreview";

/** Lo que se elige al registrar un cobro y se repite en el siguiente. */
export type RegisterSelection = {
  companyId: string;
  channelId: string | null;
  gatewayId: string;
  extraIds: string[];
  schemeId: string | null;
  currency: string;
};

export type RegisterFormProps = {
  /** La configuración del usuario: la misma con la que calcula el servidor. */
  cfg: PayConfig;
  /** El id del primer cobro, puesto por la página (en el servidor): el mismo al pintar y al hidratar. */
  initialId: string;
  /** «Ahora» en Nueva York (`AAAA-MM-DDTHH:mm`), calculado por la página. */
  now: string;
  /** La selección del último cobro, para «Repetir el último». */
  last: RegisterSelection | null;
};

type InitialStatus = "registrado" | "en_transito" | "depositado";
const INITIAL_STATUSES: InitialStatus[] = ["registrado", "en_transito", "depositado"];

/** Los campos que viven dentro de «Más opciones»: si alguno trae error, se abre. */
const MORE_FIELDS = ["schemeId", "bankAccountId", "estimatedDepositOn", "status", "depositedOn", "note"];

const NOTE_MAX = 280;
const FIELDS_TEXT = "Revisa los campos marcados.";
const OFFLINE_TEXT = "No se pudo guardar el cobro. Revisa tu conexión e inténtalo de nuevo.";

type FieldErrors = Record<string, string | undefined>;

/**
 * Un comprobante que no se pudo subir a un cobro que sí quedó guardado. Lleva lo justo para que la persona sepa de
 * qué cobro es (monto y referencia), porque puede haber varios pendientes mientras sigue registrando.
 */
type PendingReceipt = {
  file: File;
  transactionId: string;
  error: string;
  gross: MoneyText | null;
  currency: Currency;
  reference: string;
  retrying: boolean;
};

/**
 * «Registrar cobro» en un solo paso, en el orden del spec: empresa → canal → pasarela (con sus opciones) → monto y
 * moneda → fecha y hora → referencia → comprobante, y lo demás en «Más opciones». La vista previa se calcula al
 * momento con el mismo motor que el servidor; lo que se guarda lo vuelve a calcular el servidor.
 *
 * El id del cobro viaja con el envío: el mismo envío repetido no registra dos cobros. Cambia solo después de un
 * guardado correcto.
 */
export function RegisterForm({ cfg, initialId, now, last }: RegisterFormProps) {
  const router = useRouter();
  const companies = cfg.companies.filter((company) => company.active);
  const gateways = cfg.gateways.filter((gateway) => gateway.active);
  const schemes = cfg.schemes.filter((scheme) => scheme.active);
  const accounts = cfg.bankAccounts.filter((account) => account.active);

  /** Lo que sale elegido para una empresa: su moneda, su esquema por defecto y ningún canal. */
  const companyDefaults = (companyId: string) => {
    const company = companies.find((candidate) => candidate.id === companyId);
    const scheme = company?.defaultSchemeId ?? null;
    return {
      currency: company?.currency ?? "USD",
      schemeId: scheme !== null && schemes.some((candidate) => candidate.id === scheme) ? scheme : "",
    };
  };
  const extrasFor = (companyId: string, gatewayId: string) =>
    gatewayId === "" ? [] : defaultExtraIds(cfg, companyId, gatewayId);

  // Con una sola empresa o una sola pasarela, ya sale elegida.
  const [companyId, setCompanyId] = useState(() => (companies.length === 1 ? (companies[0]?.id ?? "") : ""));
  const [channelId, setChannelId] = useState("");
  const [gatewayId, setGatewayId] = useState(() => (gateways.length === 1 ? (gateways[0]?.id ?? "") : ""));
  const [extraIds, setExtraIds] = useState(() => extrasFor(companyId, gatewayId));
  const [currency, setCurrency] = useState(() => companyDefaults(companyId).currency);
  const [amount, setAmount] = useState("");
  const [occurredLocal, setOccurredLocal] = useState(now);
  const [reference, setReference] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  // Cambiarla vuelve a montar el selector de comprobante: así olvida el archivo elegido.
  const [pickerKey, setPickerKey] = useState(0);

  const [moreOpen, setMoreOpen] = useState(false);
  const [schemeId, setSchemeId] = useState(() => companyDefaults(companyId).schemeId);
  const [bankAccountId, setBankAccountId] = useState("");
  const [manualEstimate, setManualEstimate] = useState("");
  const [status, setStatus] = useState<InitialStatus>("registrado");
  const [depositedOn, setDepositedOn] = useState("");
  const [note, setNote] = useState("");

  const [id, setId] = useState(initialId);
  const [saving, setSaving] = useState(false);
  // El estado tarda un pintado en llegar al botón: esta marca frena en el acto un segundo envío.
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  // Uno por cobro: guardar otro cobro no borra ni reemplaza el reintento de uno anterior.
  const [pendingReceipts, setPendingReceipts] = useState<PendingReceipt[]>([]);
  // El último cobro cuyo comprobante falló: su aviso se trae a la vista (en el celular «Guardar» queda al pie).
  const [lastFailedId, setLastFailedId] = useState<string | null>(null);
  const pendingRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (lastFailedId === null) return;
    pendingRef.current
      ?.querySelector(`[data-transaction-id="${lastFailedId}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [lastFailedId]);

  const channels = cfg.channels.filter((channel) => channel.active && channel.companyId === companyId);
  const gateway = gateways.find((candidate) => candidate.id === gatewayId);
  const options = (gateway?.extras ?? []).filter((option) => option.active).sort((a, b) => a.sort - b.sort);

  const canRepeat =
    last !== null &&
    companies.some((company) => company.id === last.companyId) &&
    gateways.some((candidate) => candidate.id === last.gatewayId);

  function chooseCompany(next: string) {
    setCompanyId(next);
    setChannelId("");
    const defaults = companyDefaults(next);
    setCurrency(defaults.currency);
    setSchemeId(defaults.schemeId);
    setExtraIds(extrasFor(next, gatewayId));
  }

  function chooseGateway(next: string) {
    setGatewayId(next);
    setExtraIds(extrasFor(companyId, next));
  }

  function repeatLast() {
    if (last === null) return;
    const lastGateway = gateways.find((candidate) => candidate.id === last.gatewayId);
    const activeChannel = cfg.channels.some(
      (channel) => channel.id === last.channelId && channel.active && channel.companyId === last.companyId,
    );
    const activeScheme = schemes.some((scheme) => scheme.id === last.schemeId);
    setCompanyId(last.companyId);
    setChannelId(activeChannel && last.channelId !== null ? last.channelId : "");
    setGatewayId(last.gatewayId);
    setExtraIds(
      (lastGateway?.extras ?? [])
        .filter((option) => option.active && last.extraIds.includes(option.id))
        .sort((a, b) => a.sort - b.sort)
        .map((option) => option.id),
    );
    setCurrency(last.currency);
    setSchemeId(activeScheme && last.schemeId !== null ? last.schemeId : "");
  }

  function pickReceipt(picked: File | null) {
    setFile(picked);
    setFileError(picked === null ? null : checkReceiptFile(picked));
  }

  function showErrors(message: string, errors: FieldErrors) {
    setError(message);
    setFieldErrors(errors);
    if (MORE_FIELDS.some((name) => errors[name] !== undefined)) setMoreOpen(true);
  }

  /** Lo que se puede decir sin ir al servidor: lo que falta elegir o escribir. */
  function missing(): FieldErrors {
    const errors: FieldErrors = {};
    if (companyId === "") errors.companyId = "Elige la empresa.";
    if (gatewayId === "") errors.gatewayId = "Elige la pasarela.";
    if (amount.trim() === "") errors.grossOriginal = "Escribe el monto.";
    try {
      localInputToInstant(occurredLocal);
    } catch {
      errors.occurredAt = "Elige la fecha y la hora.";
    }
    if (status === "depositado" && depositedOn === "") errors.depositedOn = "Escribe cuándo se depositó.";
    return errors;
  }

  /** Deja el formulario listo para el siguiente cobro: misma selección, lo demás vacío y la hora de ahora. */
  function resetForNext() {
    setId(crypto.randomUUID());
    setAmount("");
    setReference("");
    setOccurredLocal(instantToLocalInput(new Date().toISOString()));
    setFile(null);
    setFileError(null);
    setPickerKey((key) => key + 1);
    setManualEstimate("");
    setStatus("registrado");
    setDepositedOn("");
    setNote("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current || fileError !== null) return;
    const problems = missing();
    if (Object.keys(problems).length > 0) {
      showErrors(FIELDS_TEXT, problems);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const result = await createTransaction({
        id,
        companyId,
        channelId: channelId === "" ? null : channelId,
        gatewayId,
        extraIds,
        schemeId: schemeId === "" ? null : schemeId,
        occurredAt: localInputToInstant(occurredLocal),
        currency,
        grossOriginal: amount,
        reference,
        note,
        status,
        depositedOn: status === "depositado" ? depositedOn : null,
        bankAccountId: bankAccountId === "" ? null : bankAccountId,
        estimatedDepositOn: manualEstimate === "" ? null : manualEstimate,
      });
      if (!result.ok) {
        const errors = Object.fromEntries(
          Object.entries(result.fieldErrors ?? {}).map(([name, messages]) => [name, messages[0]]),
        );
        showErrors(result.error, errors);
        return;
      }
      const transactionId = result.data.id;
      if (file !== null) {
        const upload = await uploadReceipt(file, transactionId);
        if (!upload.ok) {
          const pending: PendingReceipt = {
            file,
            transactionId,
            error: upload.error,
            gross: parseMoney(amount),
            currency,
            reference: reference.trim(),
            retrying: false,
          };
          setPendingReceipts((list) => [...list.filter((item) => item.transactionId !== transactionId), pending]);
          setLastFailedId(transactionId);
        }
      }
      notifyAction("Cobro guardado.", {
        label: "Ver cobro",
        onClick: () => router.push(`/pasarelas/cobros/${transactionId}`),
      });
      resetForNext();
    } catch {
      showErrors(OFFLINE_TEXT, {});
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  /** Cambia solo el pendiente de ese cobro; los demás quedan como estaban. */
  function updatePending(transactionId: string, change: Partial<PendingReceipt>) {
    setPendingReceipts((list) =>
      list.map((item) => (item.transactionId === transactionId ? { ...item, ...change } : item)),
    );
  }

  /** Vuelve a intentar solo la subida del comprobante, al mismo cobro. */
  async function retryReceipt(pending: PendingReceipt) {
    if (pending.retrying) return;
    updatePending(pending.transactionId, { retrying: true });
    const upload = await uploadReceipt(pending.file, pending.transactionId);
    if (upload.ok) {
      setPendingReceipts((list) => list.filter((item) => item.transactionId !== pending.transactionId));
      notify.success("Comprobante agregado.");
    } else {
      updatePending(pending.transactionId, { retrying: false, error: upload.error });
    }
  }

  return (
    <>
      <PageHeader
        title="Registrar cobro"
        description="Antes de guardar ves cuánto se llevan las comisiones, cuánto le toca a cada uno y cuándo cae al banco."
        actions={
          canRepeat ? (
            <Button onClick={repeatLast}>
              <RotateCcw aria-hidden className="size-5" />
              Repetir el último
            </Button>
          ) : null
        }
      />

      <form
        noValidate
        onSubmit={(event) => void save(event)}
        className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] xl:items-start"
      >
        <div className="flex min-w-0 flex-col gap-4">
          <Field label="Empresa" error={fieldErrors.companyId}>
            <Select value={companyId} onChange={(event) => chooseCompany(event.currentTarget.value)}>
              <option value="" disabled>
                Elige la empresa
              </option>
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
              <option value="" disabled>
                Elige la pasarela
              </option>
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

          <div className="grid grid-cols-[minmax(0,1fr)_6rem] items-start gap-3">
            <Field label="Monto" error={fieldErrors.grossOriginal}>
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

          <Field label="Fecha y hora" hint="Hora de Nueva York." error={fieldErrors.occurredAt}>
            <Input
              type="datetime-local"
              value={occurredLocal}
              onChange={(event) => setOccurredLocal(event.currentTarget.value)}
            />
          </Field>

          <Field
            label="Referencia"
            optional
            hint="La que le da la pasarela al cobro."
            error={fieldErrors.reference}
          >
            <Input
              value={reference}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setReference(event.currentTarget.value)}
            />
          </Field>

          <ReceiptPicker key={pickerKey} onPick={pickReceipt} error={fileError} />

          <details
            open={moreOpen}
            onToggle={(event) => setMoreOpen(event.currentTarget.open)}
            className="group rounded-card border border-rule bg-surface"
          >
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-card px-4 py-2 font-semibold [&::-webkit-details-marker]:hidden">
              Más opciones
              <ChevronDown aria-hidden className="size-5 text-ink-soft transition-transform group-open:rotate-180" />
            </summary>
            <div className="flex flex-col gap-4 border-t border-rule p-4">
              <Field label="Esquema de reparto" hint="Por defecto, el de la empresa." error={fieldErrors.schemeId}>
                <Select value={schemeId} onChange={(event) => setSchemeId(event.currentTarget.value)}>
                  <option value="">Sin reparto</option>
                  {schemes.map((scheme) => (
                    <option key={scheme.id} value={scheme.id}>
                      {scheme.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Cuenta destino" error={fieldErrors.bankAccountId}>
                <Select value={bankAccountId} onChange={(event) => setBankAccountId(event.currentTarget.value)}>
                  <option value="">La de la pasarela en esa empresa</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.last4 === null ? account.alias : `${account.alias} ··${account.last4}`}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Fecha estimada a mano"
                optional
                hint="Vacía, la calcula la app."
                error={fieldErrors.estimatedDepositOn}
              >
                <Input type="date" value={manualEstimate} onChange={(event) => setManualEstimate(event.currentTarget.value)} />
              </Field>

              <Field label="Estado inicial" error={fieldErrors.status}>
                <Select
                  value={status}
                  onChange={(event) => setStatus(event.currentTarget.value as InitialStatus)}
                >
                  {INITIAL_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {LIFECYCLE_LABEL[value]}
                    </option>
                  ))}
                </Select>
              </Field>

              {status === "depositado" ? (
                <Field label="Depositado el" error={fieldErrors.depositedOn}>
                  <Input type="date" value={depositedOn} onChange={(event) => setDepositedOn(event.currentTarget.value)} />
                </Field>
              ) : null}

              <Field label="Nota" optional hint={`Hasta ${NOTE_MAX} caracteres.`} error={fieldErrors.note}>
                <Textarea value={note} maxLength={NOTE_MAX} onChange={(event) => setNote(event.currentTarget.value)} />
              </Field>
            </div>
          </details>
        </div>

        <div className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-8">
          <LivePreview
            cfg={cfg}
            input={{
              companyId,
              channelId: channelId === "" ? null : channelId,
              gatewayId,
              extraIds,
              schemeId: schemeId === "" ? null : schemeId,
              occurredLocal,
              currency,
              amount,
              manualEstimate,
            }}
          />
          {/* Junto a «Guardar»: en el celular es lo que está a la vista al terminar de guardar. */}
          {pendingReceipts.length > 0 ? (
            <div ref={pendingRef} className="flex flex-col gap-3">
              {pendingReceipts.map((pending) => (
                <div key={pending.transactionId} data-transaction-id={pending.transactionId} className="scroll-mb-4">
                  <Alert tone="danger" announce title="El cobro quedó guardado, pero el comprobante no se subió.">
                    <div className="flex flex-col items-start gap-2">
                      <p>
                        Cobro
                        {pending.gross === null ? null : (
                          <>
                            {" de "}
                            <Money value={pending.gross} currency={pending.currency} />
                          </>
                        )}
                        {pending.reference === "" ? null : (
                          <>
                            {", referencia "}
                            <span className="break-all">{pending.reference}</span>
                          </>
                        )}
                        {". Archivo: "}
                        <span className="break-all">{pending.file.name}</span>
                      </p>
                      <p>{pending.error}</p>
                      <Button
                        disabled={pending.retrying}
                        aria-busy={pending.retrying || undefined}
                        onClick={() => void retryReceipt(pending)}
                      >
                        {pending.retrying ? <LoaderCircle aria-hidden className="size-5 animate-spin" /> : null}
                        Reintentar comprobante
                      </Button>
                    </div>
                  </Alert>
                </div>
              ))}
            </div>
          ) : null}
          {error !== null ? (
            <Alert tone="danger" announce>
              {error}
            </Alert>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            disabled={saving || fileError !== null}
            aria-busy={saving || undefined}
          >
            {saving ? (
              <>
                <LoaderCircle aria-hidden className="size-5 animate-spin" />
                Guardando…
              </>
            ) : (
              "Guardar"
            )}
          </Button>
        </div>
      </form>
    </>
  );
}
