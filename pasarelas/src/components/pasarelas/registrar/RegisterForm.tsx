"use client";

import { ChevronDown, LoaderCircle, Paperclip, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  activeInternational,
  isOption,
  originOf,
  withOrigin,
  type Origin,
} from "@/components/pasarelas/gateways/international";
import { InternationalChoice } from "@/components/pasarelas/gateways/InternationalChoice";
import { ReceiptPicker } from "@/components/pasarelas/receipts/ReceiptPicker";
import {
  RECEIPT_ACCEPT,
  ReceiptFileError,
  checkReceiptContent,
  checkReceiptFile,
} from "@/components/pasarelas/receipts/check";
import { downscaleImage } from "@/components/pasarelas/receipts/downscale";
import { uploadReceipt } from "@/components/pasarelas/receipts/upload";
import { BUYER_AMOUNT_HINT, FeesPaidByChoice } from "@/components/pasarelas/tx/FeesPaidByChoice";
import { Alert, Button, Field, Input, Money, MoneyInput, PageHeader, Select, Textarea, notify } from "@/components/ui";
import { notifyAction } from "@/components/ui/notify";
import { instantToLocalInput, localInputToInstant } from "@/lib/pasarelas/dates";
import { parseMoney } from "@/lib/pasarelas/money";
import { defaultExtraIds } from "@/lib/pasarelas/rules";
import { LIFECYCLE_LABEL } from "@/lib/pasarelas/status";
import { PAY_STATE_TEXT } from "@/lib/pasarelas/write";
import type { Currency, FeesPaidBy, Money as MoneyText, PayConfig } from "@/lib/pasarelas/types";
import { createTransaction } from "@/server/pasarelas/actions/transactions";
import { ExtrasToggles } from "./ExtrasToggles";
import { LivePreview } from "./LivePreview";

/** Lo que se elige al registrar un cobro y se repite en el siguiente. */
export type RegisterSelection = {
  companyId: string;
  channelId: string | null;
  gatewayId: string;
  /** Las que aplicó: las opciones y, si fue internacional, el recargo internacional de la pasarela. */
  extraIds: string[];
  schemeId: string | null;
  currency: string;
  /** Quién pagó la comisión: «Repetir el último» lo repite. */
  feesPaidBy: FeesPaidBy;
};

export type RegisterFormProps = {
  /** La configuración del usuario: la misma con la que calcula el servidor. */
  cfg: PayConfig;
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
/**
 * Solo cuando falla la llamada que guarda el cobro: puede que el servidor lo haya guardado y se perdiera la
 * respuesta, así que no se afirma que no se guardó. Reenviarlo tal cual no lo duplica (va con el mismo id).
 */
const OFFLINE_TEXT = "No sabemos si se guardó: revisa Cobros antes de cambiar nada; si lo envías igual, no se duplica.";
const SAVED_TEXT = "Cobro guardado.";
/** El reenvío de un cobro que ya estaba guardado con lo mismo: no se creó nada nuevo. */
const ALREADY_SAVED_TEXT = "Este cobro ya estaba guardado: no se registró otra vez.";
const FUTURE_DEPOSIT_TEXT = "La fecha del depósito no puede ser futura.";
/** Con el comprobante fallido, el aviso de éxito lo dice y remite al aviso que deja arreglarlo. */
const SAVED_WITHOUT_RECEIPT_TEXT = {
  retry: "Cobro guardado, pero el comprobante no se subió: reinténtalo en el aviso junto a «Guardar».",
  replace: "Cobro guardado, pero el comprobante no se subió: elige otro archivo en el aviso junto a «Guardar».",
};
const UPLOAD_FAILED_TEXT = "No se pudo subir el comprobante. Inténtalo de nuevo.";
/** Algo falló después de guardar el cobro, fuera del comprobante (que tiene su propio aviso). */
const SAVED_UNFINISHED_TEXT =
  "El cobro quedó guardado, pero algo falló después: al avisarlo o al dejar el formulario listo para el siguiente. " +
  "No lo registres otra vez: revísalo en su detalle.";

type FieldErrors = Record<string, string | undefined>;

/**
 * Un comprobante que no se pudo subir a un cobro que sí quedó guardado. Lleva lo justo para que la persona sepa de
 * qué cobro es (monto y referencia), porque puede haber varios pendientes mientras sigue registrando.
 */
type PendingReceipt = {
  file: File;
  transactionId: string;
  error: string;
  /** El problema es el archivo (no vale, no se puede leer, no es lo que dice ser): con él fallaría otra vez. */
  unusableFile: boolean;
  gross: MoneyText | null;
  currency: Currency;
  reference: string;
  retrying: boolean;
};

/** Por qué no se pudo agregar un comprobante a un cobro ya guardado. */
type ReceiptFailure = Pick<PendingReceipt, "error" | "unusableFile">;

/**
 * Si el archivo mismo no sirve: repite los pasos de `uploadReceipt` que no tocan la red (comprobarlo, prepararlo y
 * mirar su contenido). Si pasan, lo que falló fue la subida o el registro, y reintentar con el mismo archivo vale.
 */
async function isUnusableFile(file: File): Promise<boolean> {
  if (checkReceiptFile(file) !== null) return true;
  try {
    return (await checkReceiptContent(await downscaleImage(file))) !== null;
  } catch (error) {
    return error instanceof ReceiptFileError;
  }
}

/** Sube el comprobante a un cobro que ya está guardado. `null` si quedó agregado; si no, qué falló. Nunca lanza. */
async function attachReceipt(file: File, transactionId: string): Promise<ReceiptFailure | null> {
  let error: string;
  try {
    const upload = await uploadReceipt(file, transactionId);
    if (upload.ok) return null;
    error = upload.error;
  } catch {
    error = UPLOAD_FAILED_TEXT;
  }
  return { error, unusableFile: await isUnusableFile(file) };
}

/**
 * «Registrar cobro» en un solo paso, en el orden del spec: empresa → canal → pasarela (con sus opciones) → quién
 * paga la comisión → monto y moneda → fecha y hora → referencia → comprobante, y lo demás en «Más opciones». Si la
 * comisión la paga el comprador, el monto es lo que pagó él y el reparto va sobre lo que queda. La vista previa se calcula al
 * momento con el mismo motor que el servidor; lo que se guarda lo vuelve a calcular el servidor.
 *
 * El id del cobro viaja con el envío: el mismo envío repetido no registra dos cobros. Nace en el navegador al montar
 * el formulario (no se pinta, así que no cambia lo que se hidrata) y cambia después de cada guardado correcto: un
 * formulario que vuelve a montarse, p. ej. al volver con «Atrás», nunca reusa el id de un cobro ya guardado.
 */
export function RegisterForm({ cfg, now, last }: RegisterFormProps) {
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
  const gatewayOf = (id: string) => gateways.find((candidate) => candidate.id === id);
  // Las que salen marcadas, sin el recargo internacional: un pago es «Nacional» hasta que se diga otra cosa.
  const extrasFor = (companyId: string, gatewayId: string) =>
    gatewayId === "" ? [] : originOf(gatewayOf(gatewayId), defaultExtraIds(cfg, companyId, gatewayId)).optionIds;

  // Con una sola empresa o una sola pasarela, ya sale elegida.
  const [companyId, setCompanyId] = useState(() => (companies.length === 1 ? (companies[0]?.id ?? "") : ""));
  const [channelId, setChannelId] = useState("");
  const [gatewayId, setGatewayId] = useState(() => (gateways.length === 1 ? (gateways[0]?.id ?? "") : ""));
  // Las opciones elegidas; el recargo internacional va aparte, según de dónde fue el pago (`origin`).
  const [extraIds, setExtraIds] = useState(() => extrasFor(companyId, gatewayId));
  const [origin, setOrigin] = useState<Origin>("nacional");
  const [feesPaidBy, setFeesPaidBy] = useState<FeesPaidBy>("nosotros");
  const [currency, setCurrency] = useState(() => companyDefaults(companyId).currency);
  const [amount, setAmount] = useState("");
  const [occurredLocal, setOccurredLocal] = useState(now);
  const today = now.slice(0, 10);
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

  const [id, setId] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  // El estado tarda un pintado en llegar al botón: esta marca frena en el acto un segundo envío.
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  // El cobro que quedó guardado aunque algo falló después: el error general enlaza a su detalle.
  const [unfinishedId, setUnfinishedId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  // Uno por cobro: guardar otro cobro no borra ni reemplaza el reintento de uno anterior.
  const [pendingReceipts, setPendingReceipts] = useState<PendingReceipt[]>([]);
  // El último cobro cuyo comprobante falló: su aviso se trae a la vista (en el celular «Guardar» queda al pie).
  const [lastFailedId, setLastFailedId] = useState<string | null>(null);
  const pendingRef = useRef<HTMLDivElement>(null);
  // «Elegir otro archivo»: un solo selector escondido, y el cobro para el que se abrió.
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replaceTargetRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastFailedId === null) return;
    pendingRef.current
      ?.querySelector(`[data-transaction-id="${lastFailedId}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [lastFailedId]);

  const channels = cfg.channels.filter((channel) => channel.active && channel.companyId === companyId);
  // El esquema por defecto de la empresa está desactivado: no se propone, y sin otro el cobro no se reparte.
  const defaultScheme = companies.find((company) => company.id === companyId)?.defaultSchemeId ?? null;
  const inactiveDefault =
    defaultScheme !== null && schemeId === "" && !schemes.some((scheme) => scheme.id === defaultScheme);
  const gateway = gatewayOf(gatewayId);
  const options = (gateway?.extras ?? [])
    .filter((option) => option.active && isOption(option))
    .sort((a, b) => a.sort - b.sort);
  // Si la pasarela cobra un recargo a los pagos internacionales, se pregunta; con «Internacional» se aplica.
  const international = activeInternational(gateway);
  const appliedExtraIds = withOrigin(extraIds, international, origin);

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
    setOrigin("nacional");
  }

  function repeatLast() {
    if (last === null) return;
    const lastGateway = gatewayOf(last.gatewayId);
    // Si fue internacional, se repite, siempre que la pasarela siga cobrando el recargo (el de hoy).
    const lastOrigin = originOf(lastGateway, last.extraIds).origin;
    const activeChannel = cfg.channels.some(
      (channel) => channel.id === last.channelId && channel.active && channel.companyId === last.companyId,
    );
    const activeScheme = schemes.some((scheme) => scheme.id === last.schemeId);
    setCompanyId(last.companyId);
    setChannelId(activeChannel && last.channelId !== null ? last.channelId : "");
    setGatewayId(last.gatewayId);
    setExtraIds(
      (lastGateway?.extras ?? [])
        .filter((option) => option.active && isOption(option) && last.extraIds.includes(option.id))
        .sort((a, b) => a.sort - b.sort)
        .map((option) => option.id),
    );
    setOrigin(activeInternational(lastGateway) === null ? "nacional" : lastOrigin);
    setFeesPaidBy(last.feesPaidBy);
    setCurrency(last.currency);
    setSchemeId(activeScheme && last.schemeId !== null ? last.schemeId : "");
  }

  function pickReceipt(picked: File | null) {
    setFile(picked);
    setFileError(picked === null ? null : checkReceiptFile(picked));
  }

  function showErrors(message: string, errors: FieldErrors) {
    setError(message);
    setUnfinishedId(null);
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
    else if (status === "depositado" && depositedOn > today) errors.depositedOn = FUTURE_DEPOSIT_TEXT;
    else if (status === "depositado" && depositedOn < occurredLocal.slice(0, 10)) {
      errors.depositedOn = PAY_STATE_TEXT.deposito_antes_del_cobro;
    }
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

  /**
   * Guarda el cobro y dice su id y si se creó ahora (`created`: falso si ya estaba guardado con lo mismo), o pinta
   * por qué no se guardó y devuelve `null`. Si ese id ya estaba guardado con OTROS datos (se corrigió algo tras un
   * fallo de red en el que el primer envío sí llegó), lo dice con el enlace al cobro guardado y deja el formulario
   * listo para el siguiente: lo corregido no se guardó y se corrige en el detalle. Lo que pasa después del guardado
   * (el comprobante, el aviso) ya es con el cobro guardado.
   */
  async function saveTransaction(): Promise<{ id: string; created: boolean } | null> {
    try {
      const result = await createTransaction({
        id,
        companyId,
        channelId: channelId === "" ? null : channelId,
        gatewayId,
        extraIds: appliedExtraIds,
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
        feesPaidBy,
      });
      if (!result.ok) {
        const errors = Object.fromEntries(
          Object.entries(result.fieldErrors ?? {}).map(([name, messages]) => [name, messages[0]]),
        );
        showErrors(result.error, errors);
        if (result.error === PAY_STATE_TEXT.ya_registrado) {
          setUnfinishedId(id);
          resetForNext();
        }
        return null;
      }
      return result.data;
    } catch {
      showErrors(OFFLINE_TEXT, {});
      return null;
    }
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
    setUnfinishedId(null);
    setFieldErrors({});
    try {
      const saved = await saveTransaction();
      if (saved === null) return;
      const transactionId = saved.id;
      try {
        const failure = file === null ? null : await attachReceipt(file, transactionId);
        if (file !== null && failure !== null) {
          const pending: PendingReceipt = {
            file,
            transactionId,
            ...failure,
            gross: parseMoney(amount),
            currency,
            reference: reference.trim(),
            retrying: false,
          };
          setPendingReceipts((list) => [...list.filter((item) => item.transactionId !== transactionId), pending]);
          setLastFailedId(transactionId);
        }
        const message =
          failure !== null
            ? SAVED_WITHOUT_RECEIPT_TEXT[failure.unusableFile ? "replace" : "retry"]
            : saved.created
              ? SAVED_TEXT
              : ALREADY_SAVED_TEXT;
        notifyAction(message, {
          label: "Ver cobro",
          onClick: () => router.push(`/pasarelas/cobros/${transactionId}`),
        });
        resetForNext();
      } catch {
        // El cobro ya está guardado: nunca «No se pudo guardar el cobro». Se dice qué pasó, se enlaza el cobro y el
        // formulario se vacía igual, para que el siguiente envío no reuse el id de este (ni sus datos).
        setError(SAVED_UNFINISHED_TEXT);
        setUnfinishedId(transactionId);
        try {
          resetForNext();
        } catch {
          // Si tampoco se puede vaciar, el aviso ya dice que el cobro quedó guardado y que no se registre otra vez.
        }
      }
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

  /** Vuelve a intentar agregar el comprobante a ese mismo cobro: con el mismo archivo o con otro. */
  async function retryReceipt(pending: PendingReceipt, nextFile: File = pending.file) {
    if (pending.retrying) return;
    updatePending(pending.transactionId, { file: nextFile, retrying: true });
    const failure = await attachReceipt(nextFile, pending.transactionId);
    if (failure === null) {
      setPendingReceipts((list) => list.filter((item) => item.transactionId !== pending.transactionId));
      notify.success("Comprobante agregado.");
    } else {
      updatePending(pending.transactionId, { retrying: false, ...failure });
    }
  }

  /** «Elegir otro archivo»: abre el selector para ese cobro. */
  function chooseAnotherFile(pending: PendingReceipt) {
    replaceTargetRef.current = pending.transactionId;
    replaceInputRef.current?.click();
  }

  function pickReplacement(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.currentTarget.files?.[0] ?? null;
    // Vaciar el control deja volver a elegir el mismo archivo.
    event.currentTarget.value = "";
    const pending = pendingReceipts.find((item) => item.transactionId === replaceTargetRef.current);
    replaceTargetRef.current = null;
    if (picked !== null && pending !== undefined) void retryReceipt(pending, picked);
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

          {inactiveDefault ? (
            <Alert tone="warning">
              <p>
                El esquema de reparto por defecto de esta empresa está desactivado: este cobro no se reparte. Puedes
                elegir otro en «Más opciones».{" "}
                <Link href={`/pasarelas/empresas/${companyId}`} className="font-semibold underline">
                  Ver la empresa
                </Link>
              </p>
            </Alert>
          ) : null}

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

          {gateway && international ? (
            <InternationalChoice
              gatewayName={gateway.name}
              international={international}
              currency={currency}
              value={origin}
              onChange={setOrigin}
            />
          ) : null}

          <FeesPaidByChoice value={feesPaidBy} onChange={setFeesPaidBy} />

          <div className="grid grid-cols-[minmax(0,1fr)_6rem] items-start gap-3">
            <Field
              label="Monto"
              hint={feesPaidBy === "comprador" ? BUYER_AMOUNT_HINT : undefined}
              error={fieldErrors.grossOriginal}
            >
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
                  <Input
                    type="date"
                    value={depositedOn}
                    min={occurredLocal.slice(0, 10)}
                    max={today}
                    onChange={(event) => setDepositedOn(event.currentTarget.value)}
                  />
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
              extraIds: appliedExtraIds,
              schemeId: schemeId === "" ? null : schemeId,
              occurredLocal,
              currency,
              amount,
              manualEstimate,
              feesPaidBy,
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
                        onClick={() =>
                          pending.unusableFile ? chooseAnotherFile(pending) : void retryReceipt(pending)
                        }
                      >
                        {pending.retrying ? (
                          <LoaderCircle aria-hidden className="size-5 animate-spin" />
                        ) : pending.unusableFile ? (
                          <Paperclip aria-hidden className="size-5" />
                        ) : null}
                        {pending.unusableFile ? "Elegir otro archivo" : "Reintentar comprobante"}
                      </Button>
                      <p>
                        {"También puedes agregarlo después desde "}
                        <Link href={`/pasarelas/cobros/${pending.transactionId}`} className="font-semibold underline">
                          el detalle del cobro
                        </Link>
                        : si sales de esta pantalla, el cobro sigue guardado; solo se pierde este aviso.
                      </p>
                    </div>
                  </Alert>
                </div>
              ))}
              <input
                ref={replaceInputRef}
                type="file"
                accept={RECEIPT_ACCEPT}
                hidden
                onChange={pickReplacement}
              />
            </div>
          ) : null}
          {error !== null ? (
            <Alert tone="danger" announce>
              {unfinishedId === null ? (
                error
              ) : (
                <div className="flex flex-col items-start gap-2">
                  <p>{error}</p>
                  <Link href={`/pasarelas/cobros/${unfinishedId}`} className="font-semibold underline">
                    Ver el cobro guardado
                  </Link>
                </div>
              )}
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
