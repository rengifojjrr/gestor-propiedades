"use client";

import { useId, useState } from "react";
import { ReceiptPicker } from "@/components/pasarelas/receipts/ReceiptPicker";
import { ReceiptFileError, checkReceiptFile } from "@/components/pasarelas/receipts/check";
import { downscaleImage } from "@/components/pasarelas/receipts/downscale";
import { uploadToFolder } from "@/components/pasarelas/receipts/upload";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  Input,
  MoneyInput,
  notify,
  Select,
  SubmitButton,
  Textarea,
} from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import type { Currency, ISODate } from "@/lib/pasarelas/types";
import { saveSettlement } from "@/server/pasarelas/actions/settlements";

/** El bucket privado de los comprobantes (el mismo que usa la subida). */
const RECEIPTS_BUCKET = "comprobantes";
const UPLOAD_TEXT = "No se pudo subir el comprobante. Inténtalo de nuevo.";

type Direction = "pago" | "devolucion";
type FieldErrors = Record<string, string[] | undefined> | undefined;

/** Borra un comprobante que se subió pero cuya liquidación no se guardó. Si no se puede, queda en su carpeta. */
async function discard(path: string): Promise<void> {
  try {
    await createClient().storage.from(RECEIPTS_BUCKET).remove([path]);
  } catch {
    // Ya se enseña el error de la liquidación: no se le enseña a la persona un segundo error.
  }
}

/**
 * «Registrar liquidación»: un pago al beneficiario o una devolución suya a la empresa, con su fecha, monto, moneda,
 * medio, comprobante (foto o PDF) y nota. El id de la liquidación se genera antes de subir el comprobante: el
 * archivo va a su carpeta. Si la liquidación no se guarda, el archivo subido se borra.
 */
export function SettlementForm({
  beneficiaryId,
  defaultCurrency,
  today,
}: {
  beneficiaryId: string;
  defaultCurrency: Currency;
  today: ISODate;
}) {
  const titleId = useId();
  // Un id por liquidación: el mismo mientras no se guarde, uno nuevo después.
  const [settlementId, setSettlementId] = useState(() => crypto.randomUUID());
  const [paidOn, setPaidOn] = useState(today);
  const [direction, setDirection] = useState<Direction>("pago");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [method, setMethod] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>(undefined);

  function pick(picked: File | null) {
    setFile(picked);
    setFileError(picked === null ? null : checkReceiptFile(picked));
  }

  async function submit() {
    if (fileError !== null) return;
    let receipt: { path: string; mime: string; sizeBytes: number } | null = null;
    if (file !== null) {
      try {
        const uploaded = await uploadToFolder(await downscaleImage(file), settlementId);
        receipt = { path: uploaded.path, mime: uploaded.mime, sizeBytes: uploaded.sizeBytes };
      } catch (problem) {
        setError(problem instanceof ReceiptFileError ? problem.message : UPLOAD_TEXT);
        return;
      }
    }
    const result = await saveSettlement({
      id: settlementId,
      beneficiaryId,
      paidOn,
      currency,
      amount,
      direction,
      method,
      note,
      receipt,
    });
    if (!result.ok) {
      if (receipt !== null) await discard(receipt.path);
      setError(result.error);
      setErrors(result.fieldErrors);
      return;
    }
    notify.success("Liquidación registrada");
    setSettlementId(crypto.randomUUID());
    setAmount("");
    setMethod("");
    setNote("");
    setFile(null);
    setError(null);
    setErrors(undefined);
  }

  return (
    <Card>
      <section aria-labelledby={titleId}>
        <CardHeader>
          <CardTitle id={titleId}>Registrar liquidación</CardTitle>
        </CardHeader>
        <CardBody>
          <form action={submit} className="flex flex-col gap-4" noValidate>
            <Field label="Tipo" error={errors?.direction?.[0]}>
              <Select value={direction} onChange={(event) => setDirection(event.currentTarget.value as Direction)}>
                <option value="pago">Pago al beneficiario</option>
                <option value="devolucion">Devolución a la empresa</option>
              </Select>
            </Field>
            <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
              <Field label="Monto" error={errors?.amount?.[0]}>
                <MoneyInput value={amount} onChange={(event) => setAmount(event.currentTarget.value)} required />
              </Field>
              <Field label="Moneda" error={errors?.currency?.[0]}>
                <Input
                  value={currency}
                  onChange={(event) => setCurrency(event.currentTarget.value)}
                  maxLength={3}
                  autoComplete="off"
                  autoCapitalize="characters"
                  className="uppercase"
                  required
                />
              </Field>
            </div>
            <Field label="Fecha" error={errors?.paidOn?.[0]}>
              <Input type="date" value={paidOn} onChange={(event) => setPaidOn(event.currentTarget.value)} required />
            </Field>
            <Field label="Medio" optional hint="Transferencia, efectivo, Zelle…" error={errors?.method?.[0]}>
              <Input value={method} onChange={(event) => setMethod(event.currentTarget.value)} maxLength={60} />
            </Field>
            {/* Otra clave tras guardar: el selector vuelve a empezar sin el archivo anterior. */}
            <ReceiptPicker key={settlementId} onPick={pick} error={fileError} />
            <Field label="Nota" optional error={errors?.note?.[0]}>
              <Textarea value={note} onChange={(event) => setNote(event.currentTarget.value)} maxLength={500} />
            </Field>
            {error ? (
              <Alert tone="danger" announce>
                {error}
              </Alert>
            ) : null}
            <SubmitButton className="self-start" disabled={fileError !== null} pendingLabel="Registrando…">
              Registrar liquidación
            </SubmitButton>
          </form>
        </CardBody>
      </section>
    </Card>
  );
}
