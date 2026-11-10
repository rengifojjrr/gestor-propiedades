"use client";

import { FileText, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, Button, ConfirmDialog, Dialog, notify } from "@/components/ui";
import { deleteSettlement, settlementReceiptUrl } from "@/server/pasarelas/actions/settlements";
import { callAction } from "../callAction";
import { OPEN_FAILED_TEXT, openSignedPdf } from "../receipts/openPdf";
import { refreshQuietly } from "../receipts/refresh";

const DELETE_UNSURE_TEXT =
  "No se pudo confirmar si la liquidación se borró por un fallo de conexión. Mira cómo quedó antes de repetirlo.";

/**
 * Ver el comprobante de una liquidación y borrar la liquidación, que se lleva su comprobante. La URL firmada (vale
 * 60 segundos) se pide al tocar «Ver comprobante»: una imagen se ve en un visor y un PDF se abre en otra pestaña.
 * Si la llamada no vuelve, el aviso sale aquí mismo; si era el borrado, con «Ver cómo quedó».
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
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pdf = receiptMime === "application/pdf";

  const signedUrl = () => callAction(() => settlementReceiptUrl({ id }), OPEN_FAILED_TEXT);

  function view() {
    setError(null);
    startTransition(async () => {
      const result = await signedUrl();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setUrl(result.data.url);
    });
  }

  /** Un PDF se abre en otra pestaña con una URL firmada pedida en ese momento (ver `openSignedPdf`). */
  function openPdf() {
    setError(null);
    startTransition(() => openSignedPdf(signedUrl, setError));
  }

  function remove() {
    startTransition(async () => {
      const result = await callAction(() => deleteSettlement({ id }), DELETE_UNSURE_TEXT);
      setConfirming(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      notify.success("Liquidación borrada");
    });
  }

  function seeHowItWent() {
    setError(null);
    refreshQuietly(() => router.refresh());
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {receiptMime ? (
          <Button onClick={pdf ? openPdf : view} disabled={pending}>
            <FileText aria-hidden className="size-5" />
            Ver comprobante
            {pdf ? <span className="sr-only"> (se abre en otra pestaña)</span> : null}
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
      {error === DELETE_UNSURE_TEXT ? (
        <Button variant="secondary" className="self-start" onClick={seeHowItWent}>
          Ver cómo quedó
        </Button>
      ) : null}
      <Dialog open={url !== null} onClose={() => setUrl(null)} title="Comprobante">
        {url === null ? null : (
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
