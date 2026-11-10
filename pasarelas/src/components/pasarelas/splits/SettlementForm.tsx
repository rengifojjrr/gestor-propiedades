"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { ReceiptPicker } from "@/components/pasarelas/receipts/ReceiptPicker";
import { ReceiptFileError, checkReceiptFile } from "@/components/pasarelas/receipts/check";
import { downscaleImage } from "@/components/pasarelas/receipts/downscale";
import { saveUploaded, uploadToFolder } from "@/components/pasarelas/receipts/upload";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  Input,
  MoneyInput,
  notify,
  Select,
  Textarea,
} from "@/components/ui";
import type { Currency, ISODate } from "@/lib/pasarelas/types";
import { saveSettlement } from "@/server/pasarelas/actions/settlements";
import { SETTLEMENT_ALREADY_SAVED_TEXT } from "./settlementText";

const UPLOAD_TEXT = "No se pudo subir el comprobante. Inténtalo de nuevo.";
const UNSURE_TEXT =
  "No se pudo confirmar si la liquidación quedó registrada. Revisa la lista de liquidaciones antes de volver a registrarla.";

type Direction = "pago" | "devolucion";
type FieldErrors = Record<string, string[] | undefined> | undefined;
type Receipt = { path: string; mime: string; sizeBytes: number };

/**
 * «Registrar liquidación»: un pago al beneficiario o una devolución suya a la empresa, con su fecha, monto, moneda,
 * medio, comprobante (foto o PDF) y nota. El id de la liquidación se genera antes de subir el comprobante: el
 * archivo va a su carpeta.
 *
 * - Si el servidor la rechaza, el comprobante subido se borra.
 * - Si la respuesta no llega (se cortó la conexión), no se sabe si quedó: se conservan el id y el comprobante, y se
 *   pide revisar la lista. Reintentar manda el mismo id con el mismo archivo ya subido: no la duplica.
 * - Si ese reintento llega con otros datos (otro monto, tipo, moneda, fecha, o con o sin comprobante), el servidor no
 *   lo da por bueno: dice que quedó la del primer intento, la lista se refresca para enseñarla y el formulario pasa a
 *   una liquidación nueva (otro id), con lo escrito y sin el archivo, por si de verdad era otra.
 * - Lo que se ve es lo que se guarda: el formulario no usa `<form action>`, que React vacía al terminar (el «Tipo»
 *   volvería a «Pago» en pantalla y la liquidación siguiente se guardaría con el tipo anterior).
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
  const router = useRouter();
  const titleId = useId();
  const [pending, startTransition] = useTransition();
  // Un id por liquidación: el mismo mientras no se sepa que se guardó, uno nuevo después.
  const [settlementId, setSettlementId] = useState(() => crypto.randomUUID());
  const [paidOn, setPaidOn] = useState(today);
  const [direction, setDirection] = useState<Direction>("pago");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [method, setMethod] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  // El archivo ya subido en un intento que no se sabe cómo terminó: se reusa, no se sube otra vez.
  const [uploaded, setUploaded] = useState<{ file: File; receipt: Receipt } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>(undefined);

  function pick(picked: File | null) {
    setFile(picked);
    setFileError(picked === null ? null : checkReceiptFile(picked));
  }

  async function submit() {
    if (fileError !== null) return;
    let receipt: Receipt | null = null;
    // Un archivo subido en ESTE intento: si el servidor lo rechaza, se borra. Uno de un intento anterior no, porque
    // puede ser de una liquidación que sí quedó.
    let fresh: string | null = null;
    if (file !== null) {
      if (uploaded?.file === file) {
        receipt = uploaded.receipt;
      } else {
        try {
          const { path, mime, sizeBytes } = await uploadToFolder(await downscaleImage(file), settlementId);
          receipt = { path, mime, sizeBytes };
          fresh = path;
        } catch (problem) {
          setError(problem instanceof ReceiptFileError ? problem.message : UPLOAD_TEXT);
          return;
        }
      }
    }
    let result: Awaited<ReturnType<typeof saveSettlement>>;
    try {
      result = await saveUploaded(fresh, () =>
        saveSettlement({ id: settlementId, beneficiaryId, paidOn, currency, amount, direction, method, note, receipt }),
      );
    } catch {
      setUploaded(file !== null && receipt !== null ? { file, receipt } : null);
      setError(UNSURE_TEXT);
      setErrors(undefined);
      return;
    }
    if (!result.ok) {
      if (fresh !== null) setUploaded(null);
      setError(result.error);
      setErrors(result.fieldErrors);
      if (result.error === SETTLEMENT_ALREADY_SAVED_TEXT) {
        // La que quedó es la del primer intento, con su archivo: lo que siga es otra liquidación.
        setSettlementId(crypto.randomUUID());
        setUploaded(null);
        setFile(null);
        try {
          router.refresh();
        } catch {
          // El aviso ya dice que la revise en la lista.
        }
      }
      return;
    }
    notify.success("Liquidación registrada");
    setSettlementId(crypto.randomUUID());
    setAmount("");
    setMethod("");
    setNote("");
    setFile(null);
    setUploaded(null);
    setError(null);
    setErrors(undefined);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(submit);
  }

  return (
    <Card>
      <section aria-labelledby={titleId}>
        <CardHeader>
          <CardTitle id={titleId}>Registrar liquidación</CardTitle>
        </CardHeader>
        <CardBody>
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
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
            <Button
              type="submit"
              variant="primary"
              className="self-start"
              disabled={pending || fileError !== null}
              aria-busy={pending || undefined}
            >
              {pending ? (
                <>
                  <LoaderCircle aria-hidden className="size-5 animate-spin" />
                  Registrando…
                </>
              ) : (
                "Registrar liquidación"
              )}
            </Button>
          </form>
        </CardBody>
      </section>
    </Card>
  );
}
