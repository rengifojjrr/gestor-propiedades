"use client";

import { FileText, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Alert, Button, ConfirmDialog, Dialog, notify } from "@/components/ui";
import { deleteSettlement, settlementReceiptUrl } from "@/server/pasarelas/actions/settlements";

/**
 * Ver el comprobante de una liquidación (con una URL firmada de 60 segundos que se pide al abrirlo) y borrar la
 * liquidación, que se lleva su comprobante.
 */
export function SettlementActions({
  id,
  receiptMime,
  description,
}: {
  id: string;
  /** El tipo del comprobante, o `null` si no tiene. */
  receiptMime: string | null;
  /** Qué se borra, dicho en claro: «el pago de $45,15 del vie 13 nov 2026». */
  description: string;
}) {
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open() {
    startTransition(async () => {
      const result = await settlementReceiptUrl({ id });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      setUrl(result.data.url);
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteSettlement({ id });
      setConfirming(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      notify.success("Liquidación borrada");
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {receiptMime ? (
          <Button onClick={open} disabled={pending}>
            <FileText aria-hidden className="size-5" />
            Ver comprobante
          </Button>
        ) : null}
        <Button
          variant="ghost"
          aria-label={`Borrar ${description}`}
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
          disabled={pending}
        >
          <Trash2 aria-hidden className="size-5" />
          Borrar
        </Button>
      </div>
      {error ? (
        <Alert tone="danger" announce>
          {error}
        </Alert>
      ) : null}
      <Dialog open={url !== null} onClose={() => setUrl(null)} title="Comprobante">
        {url === null ? null : receiptMime === "application/pdf" ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center font-semibold text-brand underline"
          >
            Abrir el PDF (el enlace vale un minuto)
          </a>
        ) : (
          // Una URL firmada de Storage: `<img>` normal, nunca next/image optimizado.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt="Comprobante de la liquidación"
            className="h-auto max-w-full rounded-control border border-rule"
          />
        )}
      </Dialog>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={remove}
        pending={pending}
        title="¿Borrar esta liquidación?"
        description={`Se borra ${description}${receiptMime ? " y su comprobante" : ""}, y el saldo vuelve a como estaba antes. No se puede deshacer.`}
        confirmLabel="Borrar liquidación"
        variant="danger"
      />
    </div>
  );
}
