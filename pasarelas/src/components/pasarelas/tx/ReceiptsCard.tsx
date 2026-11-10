"use client";

import { FileText, LoaderCircle } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { ReceiptPicker } from "@/components/pasarelas/receipts/ReceiptPicker";
import { checkReceiptFile } from "@/components/pasarelas/receipts/check";
import { uploadReceipt } from "@/components/pasarelas/receipts/upload";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  DateTimeText,
  Dialog,
  notify,
} from "@/components/ui";
import { receiptUrlAction, removeReceiptAction } from "@/server/pasarelas/actions/receipts";
import type { TxReceipt } from "@/server/pasarelas/dto";

const TYPE_LABEL: Record<string, string> = {
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WebP",
  "application/pdf": "PDF",
};

/** Cómo se nombra un comprobante: su nombre original o, si no lo trae, su lugar en la lista. */
const nameOf = (receipt: TxReceipt, index: number): string => receipt.originalName ?? `Comprobante ${index + 1}`;

export type ReceiptsCardProps = {
  transactionId: string;
  receipts: TxReceipt[];
  /** En la papelera los comprobantes solo se ven: no se agregan ni se quitan. */
  editable: boolean;
};

/**
 * Los comprobantes del cobro: verlos (con una URL firmada de 60 segundos, pedida al abrir cada uno), agregar otro
 * (se comprueba, se achica, se sube directo a Storage y se registra, como en «Registrar cobro») y quitarlos (se
 * borran el archivo y su fila).
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

  function open(receipt: TxReceipt, name: string) {
    setError(null);
    setUrl(null);
    setViewing({ receipt, name });
    startTransition(async () => {
      const result = await receiptUrlAction({ id: receipt.id });
      if (result.ok) {
        setUrl(result.data.url);
        return;
      }
      setViewing(null);
      setError(result.error);
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
              return (
                <li key={receipt.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex min-w-0 flex-col">
                    <span className="break-all">{name}</span>
                    <span className="text-sm text-ink-soft">
                      {TYPE_LABEL[receipt.mime] ?? receipt.mime} · <DateTimeText value={receipt.createdAt} />
                    </span>
                  </span>
                  <span className="flex gap-2">
                    <Button onClick={() => open(receipt, name)} disabled={pending}>
                      Ver
                    </Button>
                    {editable ? (
                      <Button variant="ghost" onClick={() => setRemoving(receipt)} disabled={pending}>
                        Quitar
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
        ) : viewing.receipt.mime === "application/pdf" ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-2 font-semibold text-brand hover:underline"
          >
            <FileText aria-hidden className="size-5" />
            Abrir el PDF
          </a>
        ) : (
          // La URL firmada dura 60 segundos: una imagen normal, sin la optimización de next/image (AGENTS.md).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={`Comprobante ${viewing.name}`}
            className="max-h-[70dvh] w-full rounded-control object-contain"
          />
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
