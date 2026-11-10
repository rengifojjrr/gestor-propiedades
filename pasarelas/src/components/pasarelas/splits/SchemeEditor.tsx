"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useId, useState } from "react";
import {
  Alert,
  Button,
  DateText,
  Field,
  IconButton,
  Input,
  notify,
  Percent,
  PctInput,
  Select,
  SubmitButton,
} from "@/components/ui";
import { dec, normPct } from "@/lib/pasarelas/decimal";
import { parsePct } from "@/lib/pasarelas/money";
import { SCHEME_ISSUE_TEXT, schemeTotal, validateScheme } from "@/lib/pasarelas/schemes";
import type { AllocBase, ISODate, Pct } from "@/lib/pasarelas/types";
import { correctScheme, renameScheme, saveScheme } from "@/server/pasarelas/actions/splits";
import { ActionError } from "../ActionError";
import { callAction, failureOf, type ActionFailure } from "../callAction";
import { BASE_LABEL, SINCE_START } from "./labels";

/** Lo que el editor parte sabiendo: el esquema vacío, o la última versión de uno que ya existe. */
export type SchemeDraft = {
  name: string;
  base: AllocBase;
  remainderBeneficiaryId: string | null;
  lines: { beneficiaryId: string; pct: Pct }[];
  effectiveFrom: ISODate;
};

type LineDraft = { key: string; beneficiaryId: string; pct: string };
type FieldErrors = Record<string, string[] | undefined> | undefined;
type Choice = { id: string; name: string };

/**
 * Lo que dice el editor cuando la llamada no llegó o no volvió (sin conexión). La petición pudo llegar y perderse
 * solo la respuesta: por eso no invita a repetir a ciegas.
 */
const NETWORK_TEXT =
  "Se perdió la conexión y no se sabe si se guardó. Revísalo antes de repetirlo: lo escrito sigue aquí.";

/** "33.3333" → "33,3333": como lo escribiría una persona. */
const pctDraft = (pct: Pct): string => pct.replace(".", ",");

const schemeHref = (schemeId: string) => `/pasarelas/repartos/esquemas/${schemeId}`;

/**
 * El editor de un esquema de reparto: el nombre, sobre qué se reparte, cada beneficiario con su porcentaje (la suma
 * se ve mientras se escribe), quién recibe el «Resto» y desde cuándo rige. Mientras el esquema no valga (el mismo
 * `validateScheme` que usa el servidor) el botón no guarda y se dice por qué.
 *
 * Sin `schemeId` crea el esquema. Con `schemeId` le agrega una versión nueva (las anteriores no se tocan), que no
 * puede regir desde la misma fecha que una de sus `versions`: la base la reemplazaría, y eso es corregir. Con
 * `correcting`, corrige la versión de `initial`: su «vigente desde» no se cambia (se lee) y se manda la misma.
 */
export function SchemeEditor({
  schemeId,
  initial,
  beneficiaries,
  defaultDate,
  correcting = false,
  versions = [],
}: {
  schemeId: string | null;
  initial: SchemeDraft;
  /** Los que se pueden elegir: los activos y los que ya están en `initial`. */
  beneficiaries: readonly Choice[];
  /** La fecha que se propone si no rige «desde el inicio». */
  defaultDate: ISODate;
  /** Con `schemeId`: corrige la versión de `initial` en vez de agregar una. */
  correcting?: boolean;
  /** Las versiones que ya tiene el esquema, para no agregar otra desde la misma fecha. */
  versions?: readonly { version: number; effectiveFrom: ISODate }[];
}) {
  const router = useRouter();
  const issuesId = useId();
  const clashId = useId();
  const [name, setName] = useState(initial.name);
  const [base, setBase] = useState<AllocBase>(initial.base);
  const [remainder, setRemainder] = useState(initial.remainderBeneficiaryId ?? "");
  const [lines, setLines] = useState<LineDraft[]>(() =>
    initial.lines.map((line, index) => ({ key: `inicial-${index}`, beneficiaryId: line.beneficiaryId, pct: pctDraft(line.pct) })),
  );
  const [sinceStart, setSinceStart] = useState(initial.effectiveFrom === SINCE_START);
  const [date, setDate] = useState(initial.effectiveFrom === SINCE_START ? defaultDate : initial.effectiveFrom);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>(undefined);

  const nameOf = (id: string) => beneficiaries.find((b) => b.id === id)?.name ?? "";
  // Lo que se valida: cada porcentaje ya leído; uno que no se puede leer va vacío y no pasa.
  const parsed = lines.map((line) => ({ beneficiaryId: line.beneficiaryId, pct: parsePct(line.pct) ?? "" }));
  const issues = validateScheme(parsed, remainder || null);
  const total = schemeTotal(parsed.filter((line) => line.pct !== ""));
  const missing = normPct(dec("100").minus(dec(total)));
  const next = beneficiaries.find((b) => !lines.some((line) => line.beneficiaryId === b.id) && b.id !== remainder);
  const effectiveFrom = correcting ? initial.effectiveFrom : sinceStart ? SINCE_START : date;
  const clash = correcting ? undefined : versions.find((version) => version.effectiveFrom === effectiveFrom);
  const blockedBy = [issues.length > 0 ? issuesId : null, clash ? clashId : null].filter(Boolean).join(" ");

  const updateLine = (key: string, patch: Partial<LineDraft>) =>
    setLines((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  async function submit() {
    const scheme = {
      schemeId,
      name,
      base,
      remainderBeneficiaryId: remainder || null,
      effectiveFrom,
      lines: lines.map((line) => ({ beneficiaryId: line.beneficiaryId, pct: line.pct })),
    };
    let result;
    try {
      result = await (correcting ? correctScheme(scheme) : saveScheme(scheme));
    } catch {
      // Sin conexión: se dice aquí, sin perder lo escrito (si no, la pantalla entera pasaría a su error).
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
    if (correcting) {
      notify.success("Esquema corregido");
      router.push(schemeHref(result.data.schemeId));
    } else if (schemeId === null) {
      notify.success("Esquema guardado");
      router.push(schemeHref(result.data.schemeId));
    } else {
      notify.success("Versión nueva guardada");
    }
  }

  return (
    <form action={submit} className="flex flex-col gap-5" noValidate>
      <Field label="Nombre del esquema" error={errors?.name?.[0]}>
        <Input value={name} onChange={(event) => setName(event.currentTarget.value)} maxLength={80} required />
      </Field>
      <Field
        label="Se reparte"
        hint="El neto es lo que queda después de las comisiones; el bruto, lo cobrado."
        error={errors?.base?.[0]}
      >
        <Select value={base} onChange={(event) => setBase(event.currentTarget.value as AllocBase)}>
          <option value="neto">{BASE_LABEL.neto}</option>
          <option value="bruto">{BASE_LABEL.bruto}</option>
        </Select>
      </Field>

      <div className="flex flex-col gap-3">
        <h3 className="titulo text-base">Beneficiarios</h3>
        {lines.map((line, index) => (
          <fieldset key={line.key} className="flex min-w-0 flex-col gap-2 rounded-card border border-rule p-3">
            <legend className="px-1 text-sm font-semibold">Línea {index + 1}</legend>
            {/* En el celular el beneficiario va solo en su renglón: su nombre entero se lee. */}
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:grid-cols-[minmax(0,1fr)_6.5rem_auto]">
              <Field label="Beneficiario" className="col-span-2 sm:col-span-1">
                <Select
                  value={line.beneficiaryId}
                  onChange={(event) => updateLine(line.key, { beneficiaryId: event.currentTarget.value })}
                >
                  {beneficiaries.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Porcentaje">
                <PctInput value={line.pct} onChange={(event) => updateLine(line.key, { pct: event.currentTarget.value })} />
              </Field>
              <IconButton
                label={`Quitar la línea ${index + 1}`}
                onClick={() => setLines((rows) => rows.filter((row) => row.key !== line.key))}
              >
                <Trash2 aria-hidden className="size-5" />
              </IconButton>
            </div>
          </fieldset>
        ))}
        <Button
          className="self-start"
          disabled={next === undefined}
          onClick={() => {
            if (next) setLines((rows) => [...rows, { key: crypto.randomUUID(), beneficiaryId: next.id, pct: "" }]);
          }}
        >
          <Plus aria-hidden className="size-5" />
          Agregar línea
        </Button>
        <p data-testid="suma-esquema" aria-live="polite" className="text-lg font-semibold">
          Suman <Percent value={total} />
        </p>
      </div>

      <Field label="Resto" hint="Quien recibe lo que falte para llegar a 100 %." error={errors?.remainderBeneficiaryId?.[0]}>
        <Select value={remainder} onChange={(event) => setRemainder(event.currentTarget.value)}>
          <option value="">Nadie</option>
          {beneficiaries.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </Field>

      {issues.length > 0 ? (
        <div id={issuesId}>
          <Alert tone="warning" title="Todavía no se puede guardar">
            <ul className="flex flex-col gap-1">
              {issues.map((issue) => (
                <li key={issue}>{SCHEME_ISSUE_TEXT[issue]}</li>
              ))}
            </ul>
          </Alert>
        </div>
      ) : remainder && dec(missing).gt(0) ? (
        <Alert tone="info">
          El resto, <Percent value={missing} />, va a {nameOf(remainder)}.
        </Alert>
      ) : null}

      {correcting ? (
        <p>
          {initial.effectiveFrom === SINCE_START ? (
            "Rige desde el inicio"
          ) : (
            <>
              Rige desde el <DateText value={initial.effectiveFrom} />
            </>
          )}
          <span className="text-ink-soft">: al corregirla, la fecha no cambia.</span>
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <Field
            label="Vigente desde"
            hint={
              schemeId === null
                ? "«Desde el inicio» vale para todos los cobros, también los de fechas pasadas."
                : "Por defecto, mañana. Los cobros ya registrados conservan el reparto con el que se registraron."
            }
          >
            <Select
              value={sinceStart ? "inicio" : "fecha"}
              onChange={(event) => setSinceStart(event.currentTarget.value === "inicio")}
            >
              <option value="inicio">Desde el inicio</option>
              <option value="fecha">Desde una fecha</option>
            </Select>
          </Field>
          {sinceStart ? null : (
            <Field label="Fecha" error={errors?.effectiveFrom?.[0]}>
              <Input type="date" value={date} onChange={(event) => setDate(event.currentTarget.value)} required />
            </Field>
          )}
          {clash ? (
            <div id={clashId}>
              <Alert tone="warning">
                Ya hay una versión desde {sinceStart ? "el inicio" : "esa fecha"}, la {clash.version}: una versión
                nueva necesita otra fecha.
              </Alert>
            </div>
          ) : null}
        </div>
      )}

      {errors?.lines?.[0] ? (
        <Alert tone="danger" announce>
          Revisa los beneficiarios: {errors.lines[0]}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" announce>
          {error}
        </Alert>
      ) : null}
      <SubmitButton
        className="self-start"
        disabled={blockedBy !== ""}
        aria-describedby={blockedBy === "" ? undefined : blockedBy}
      >
        {correcting ? "Guardar cambios" : schemeId === null ? "Guardar esquema" : "Guardar versión nueva"}
      </SubmitButton>
    </form>
  );
}

type NameState = {
  /** Lo último que se envió: React vacía el campo al terminar la acción y vuelve con esto. */
  name: string;
  /** Si se cortó la red (`unsure`), no se sabe si se guardó: el aviso ofrece «Ver cómo quedó». */
  error: ActionFailure | null;
  fieldError: string | undefined;
};

/**
 * Cambiar solo el nombre de un esquema, sin versión nueva: el nombre no cambia ningún reparto, así que vale aunque
 * sus versiones ya tengan cobros. Al guardar vuelve a la ficha del esquema.
 */
export function SchemeNameForm({ schemeId, name }: { schemeId: string; name: string }) {
  const router = useRouter();
  const [state, formAction] = useActionState(
    async (_previous: NameState, data: FormData): Promise<NameState> => {
      const value = data.get("name");
      const typed = typeof value === "string" ? value : "";
      // Con `callAction`, un corte no sube a `error.tsx`: el formulario sigue con lo escrito y la duda.
      const result = await callAction(() => renameScheme({ id: schemeId, name: typed }));
      if (result.ok) {
        notify.success("Nombre cambiado");
        router.push(schemeHref(schemeId));
        return { name: typed, error: null, fieldError: undefined };
      }
      return { name: typed, error: failureOf(result), fieldError: result.fieldErrors?.name?.[0] };
    },
    { name, error: null, fieldError: undefined },
  );

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <Field label="Nombre del esquema" error={state.fieldError}>
        <Input name="name" defaultValue={state.name} maxLength={80} autoComplete="off" required />
      </Field>
      <ActionError failure={state.error} />
      <SubmitButton className="self-start">Guardar nombre</SubmitButton>
    </form>
  );
}
