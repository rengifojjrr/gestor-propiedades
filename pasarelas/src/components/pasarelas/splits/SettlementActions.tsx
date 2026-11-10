"use client";

import { FileText, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, Button, ConfirmDialog, Dialog, notify } from "@/components/ui";
import { deleteSettlement, settlementReceiptUrl } from "@/server/pasarelas/actions/settlements";
import { callAction } from "../callAction";

const OPEN_FAILED_TEXT = "No se pudo abrir el comprobante. Revisa la conexión y vuelve a intentarlo.";
const DELETE_UNSURE_TEXT =
  "No se pudo confirmar si la liquidación se borró por un fallo de conexión. Mira cómo quedó antes de repetirlo.";

/**
 * Sin refresco automático tras un fallo de red: con mala señal, refrescar recargaría la página entera y se perdería
 * el aviso. «Ver cómo quedó» refresca cuando la persona lo pide.
 */
const noRefresh = () => undefined;

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

  const signedUrl = () => callAction(() => settlementReceiptUrl({ id }), noRefresh, OPEN_FAILED_TEXT);

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

  /**
   * Un PDF se abre en otra pestaña con una URL firmada pedida en ese momento. La pestaña se abre en el mismo toque,
   * porque abierta tras esperar al servidor el navegador la bloquearía, y después se lleva al PDF. Si el navegador
   * no la dejó abrir, el PDF se abre en esta.
   */
  function openPdf() {
    setError(null);
    const tab = window.open("", "_blank");
    if (tab !== null) tab.opener = null;
    startTransition(async () => {
      const result = await signedUrl();
      if (!result.ok) {
        tab?.close();
        setError(result.error);
        return;
      }
      if (tab !== null) tab.location.href = result.data.url;
      else window.location.assign(result.data.url);
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await callAction(() => deleteSettlement({ id }), noRefresh, DELETE_UNSURE_TEXT);
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
    try {
      router.refresh();
    } catch {
      // Si tampoco llega, la persona puede volver a intentarlo.
    }
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
