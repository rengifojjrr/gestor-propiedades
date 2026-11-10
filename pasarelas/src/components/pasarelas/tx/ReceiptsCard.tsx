"use client";

import { LoaderCircle } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { ReceiptPicker } from "@/components/pasarelas/receipts/ReceiptPicker";
import { checkReceiptFile } from "@/components/pasarelas/receipts/check";
import { receiptFormat, receiptLabel, receiptSize } from "@/components/pasarelas/receipts/label";
import { uploadReceipt } from "@/components/pasarelas/receipts/upload";
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

const OPEN_FAILED_TEXT = "No se pudo abrir el comprobante. Revisa la conexión y vuelve a intentarlo.";

/**
 * Cómo se nombra un comprobante para el lector de pantalla y en el visor: su lugar en la lista, su tipo y su fecha.
 * Nunca su nombre original (puede traer datos de otra persona).
 */
const nameOf = (receipt: TxReceipt, index: number): string => `Comprobante ${index + 1}: ${receiptLabel(receipt)}`;

/** Una URL firmada recién pedida, o el mensaje si no se pudo (también si la llamada no volvió). Nunca lanza. */
async function signedUrl(id: string): Promise<ActionResult<{ url: string }>> {
  try {
    return await receiptUrlAction({ id });
  } catch {
    return { ok: false, error: OPEN_FAILED_TEXT };
  }
}

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
 */
export function ReceiptsCard({ transactionId, receipts, editable }: ReceiptsCardProps) {
  const titleId = useId();
  const [viewing, setViewing] = useState<{ receipt: TxReceipt; name: string } | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [removing, setRemoving] = useState<TxReceipt | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  /**
   * Un PDF se abre en otra pestaña con una URL firmada pedida en ese momento (una pedida antes ya podría haber
   * caducado). La pestaña se abre en el mismo toque, porque abierta tras esperar al servidor el navegador la
   * bloquearía, y después se lleva al PDF. Si el navegador no la dejó abrir, el PDF se abre en esta.
   */
  function openPdf(receipt: TxReceipt) {
    setError(null);
    const tab = window.open("", "_blank");
    if (tab !== null) tab.opener = null;
    startTransition(async () => {
      const result = await signedUrl(receipt.id);
      if (!result.ok) {
        tab?.close();
        setError(result.error);
        return;
      }
      if (tab !== null) tab.location.href = result.data.url;
      else window.location.assign(result.data.url);
    });
  }

  async function add(file: File | null) {
    setError(null);
    const problem = file === null ? null : checkReceiptFile(file);
    setFileError(problem);
    if (file === null || problem !== null) return;
    setUploading(true);
    const result = await uploadReceipt(file, transactionId);
    setUploading(false);
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
      const result = await removeReceiptAction({ id });
      setRemoving(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      notify.success("Comprobante quitado.");
    });
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

        {editable ? (
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
