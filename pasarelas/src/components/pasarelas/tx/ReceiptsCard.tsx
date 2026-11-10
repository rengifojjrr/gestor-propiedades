"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { ReceiptPicker } from "@/components/pasarelas/receipts/ReceiptPicker";
import { checkReceiptFile } from "@/components/pasarelas/receipts/check";
import { receiptFormat, receiptLabel, receiptSize } from "@/components/pasarelas/receipts/label";
import { OPEN_FAILED_TEXT, openSignedPdf } from "@/components/pasarelas/receipts/openPdf";
import { noRefresh, refreshQuietly } from "@/components/pasarelas/receipts/refresh";
import { RECEIPT_UNSURE_TEXT, uploadReceipt } from "@/components/pasarelas/receipts/upload";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Dialog,
  notify,
} from "@/components/ui";
import { receiptUrlAction, removeReceiptAction } from "@/server/pasarelas/actions/receipts";
import type { TxReceipt } from "@/server/pasarelas/dto";
import type { ActionResult } from "@/server/pasarelas/result";
import { callAction } from "../callAction";

const REMOVE_UNSURE_TEXT =
  "No se pudo confirmar si el comprobante se quitó por un fallo de conexión. Mira cómo quedó antes de repetirlo.";

/**
 * Cómo se nombra un comprobante para el lector de pantalla y en el visor: su lugar en la lista, su tipo y su fecha.
 * Nunca su nombre original (puede traer datos de otra persona).
 */
const nameOf = (receipt: TxReceipt, index: number): string => `Comprobante ${index + 1}: ${receiptLabel(receipt)}`;

/** Una URL firmada recién pedida, o el mensaje si no se pudo (también si la llamada no volvió). Nunca lanza. */
const signedUrl = (id: string): Promise<ActionResult<{ url: string }>> =>
  callAction(() => receiptUrlAction({ id }), noRefresh, OPEN_FAILED_TEXT);

export type ReceiptsCardProps = {
  transactionId: string;
  receipts: TxReceipt[];
  /** En la papelera los comprobantes solo se ven: no se agregan ni se quitan. */
  editable: boolean;
};

/**
 * Los comprobantes del cobro: verlos (con una URL firmada de 60 segundos, pedida al tocar «Ver»: una imagen en un
 * visor, un PDF en otra pestaña), agregar otro (se comprueba, se achica, se sube directo a Storage y se registra,
 * como en «Registrar cobro») y quitarlos (se borran el archivo y su fila). Cada uno se reconoce por su tipo, su
 * fecha y su tamaño.
 *
 * Si no se sabe cómo terminó agregar o quitar uno (la respuesta no volvió), el aviso sale en la tarjeta con «Ver cómo
 * quedó», que refresca la pantalla. Mientras tanto no se puede subir otro: el mismo archivo quedaría dos veces.
 */
export function ReceiptsCard({ transactionId, receipts, editable }: ReceiptsCardProps) {
  const router = useRouter();
  const titleId = useId();
  const [viewing, setViewing] = useState<{ receipt: TxReceipt; name: string } | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [removing, setRemoving] = useState<TxReceipt | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Agregar o quitar uno terminó sin respuesta: hasta ver cómo quedó, el aviso y «Ver cómo quedó» en lugar del selector.
  const [unsure, setUnsure] = useState<string | null>(null);
  // Cambiarla vuelve a montar el selector: así olvida el archivo ya subido.
  const [pickerKey, setPickerKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();

  function view(receipt: TxReceipt, name: string) {
    setError(null);
    setUrl(null);
    setViewing({ receipt, name });
    startTransition(async () => {
      const result = await signedUrl(receipt.id);
      if (result.ok) {
        setUrl(result.data.url);
        return;
      }
      setViewing(null);
      setError(result.error);
    });
  }

  /** Un PDF se abre en otra pestaña con una URL firmada pedida en ese momento (ver `openSignedPdf`). */
  function openPdf(receipt: TxReceipt) {
    setError(null);
    startTransition(() => openSignedPdf(() => signedUrl(receipt.id), setError));
  }

  async function add(file: File | null) {
    setError(null);
    const problem = file === null ? null : checkReceiptFile(file);
    setFileError(problem);
    if (file === null || problem !== null) return;
    setUploading(true);
    const result = await uploadReceipt(file, transactionId);
    setUploading(false);
    if (!result.ok && result.error === RECEIPT_UNSURE_TEXT) {
      setFileError(null);
      setUnsure(result.error);
      return;
    }
    if (!result.ok) {
      setFileError(result.error);
      return;
    }
    setPickerKey((key) => key + 1);
    notify.success("Comprobante agregado.");
  }

  function remove() {
    if (removing === null) return;
    const { id } = removing;
    startTransition(async () => {
      const result = await callAction(() => removeReceiptAction({ id }), noRefresh, REMOVE_UNSURE_TEXT);
      setRemoving(null);
      if (!result.ok && result.error === REMOVE_UNSURE_TEXT) {
        setUnsure(result.error);
        return;
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      notify.success("Comprobante quitado.");
    });
  }

  /** Refresca la pantalla para enseñar cómo quedó, y vuelve a dejar subir uno nuevo (con el selector vacío). */
  function seeHowItWent() {
    setUnsure(null);
    setPickerKey((key) => key + 1);
    refreshQuietly(() => router.refresh());
  }

  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId}>Comprobantes</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        {receipts.length === 0 ? (
          <p className="text-ink-soft">Sin comprobantes.</p>
        ) : (
          <ul aria-label="Comprobantes" className="flex flex-col gap-2">
            {receipts.map((receipt, index) => {
              const name = nameOf(receipt, index);
              const pdf = receipt.mime === "application/pdf";
              return (
                <li key={receipt.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex min-w-0 flex-col">
                    <span>{receiptLabel(receipt)}</span>
                    <span className="text-sm text-ink-soft">
                      {receiptFormat(receipt.mime)} · {receiptSize(receipt.sizeBytes)}
                    </span>
                  </span>
                  <span className="flex gap-2">
                    <Button onClick={() => (pdf ? openPdf(receipt) : view(receipt, name))} disabled={pending}>
                      Ver
                      <span className="sr-only">
                        {" "}
                        {name}
                        {pdf ? " (se abre en otra pestaña)" : ""}
                      </span>
                    </Button>
                    {editable ? (
                      <Button variant="ghost" onClick={() => setRemoving(receipt)} disabled={pending}>
                        Quitar<span className="sr-only"> {name}</span>
                      </Button>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {editable && unsure === null ? (
          <div className="flex flex-col gap-2 border-t border-rule pt-4">
            <ReceiptPicker key={pickerKey} onPick={(file) => void add(file)} error={fileError} />
            {uploading ? (
              <p role="status" className="flex items-center gap-2 text-sm">
                <LoaderCircle aria-hidden className="size-4 animate-spin" />
                Subiendo el comprobante…
              </p>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <Alert tone="danger" announce>
            {error}
          </Alert>
        ) : null}

        {unsure ? (
          <div className="flex flex-col items-start gap-2 border-t border-rule pt-4">
            <Alert tone="danger" announce>
              {unsure}
            </Alert>
            <Button onClick={seeHowItWent}>Ver cómo quedó</Button>
          </div>
        ) : null}
      </CardBody>

      <Dialog open={viewing !== null} onClose={() => setViewing(null)} title={viewing?.name ?? "Comprobante"}>
        {viewing === null ? null : url === null ? (
          <p role="status" className="flex items-center gap-2">
            <LoaderCircle aria-hidden className="size-5 animate-spin" />
            Abriendo el comprobante…
          </p>
        ) : (
          // La URL firmada dura 60 segundos: una imagen normal, sin la optimización de next/image (AGENTS.md).
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={viewing.name} className="max-h-[70dvh] w-full rounded-control object-contain" />
        )}
      </Dialog>

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        title="¿Quitar este comprobante?"
        description="Se borra el archivo y deja de verse en el cobro. No se puede deshacer."
        confirmLabel="Quitar comprobante"
        variant="danger"
        pending={pending}
      />
    </Card>
  );
}
