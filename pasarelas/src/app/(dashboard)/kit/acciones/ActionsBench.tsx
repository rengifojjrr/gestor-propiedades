"use client";

import { useId, useState } from "react";
import { ReceiptPicker } from "@/components/pasarelas/receipts/ReceiptPicker";
import { checkReceiptFile } from "@/components/pasarelas/receipts/check";
import { uploadReceipt } from "@/components/pasarelas/receipts/upload";
import { Alert, Button, Card, CardBody, CardHeader, CardTitle, Field, Input } from "@/components/ui";
import { receiptUrlAction } from "@/server/pasarelas/actions/receipts";
import { createTransaction } from "@/server/pasarelas/actions/transactions";

/* Las piezas del banco de pruebas que llaman a las acciones desde el navegador. */

type Notice = { tone: "success" | "danger"; text: string } | null;

/** El aviso que deja la última acción: el éxito se anuncia sin interrumpir; un error, de inmediato. */
function NoticeAlert({ notice }: { notice: Notice }) {
  if (notice === null) return null;
  return notice.tone === "success" ? (
    <Alert tone="success">{notice.text}</Alert>
  ) : (
    <Alert tone="danger" announce>
      {notice.text}
    </Alert>
  );
}

/** Lo que el cobro E1 del spec toma de la configuración del usuario. */
export type E1Selection = {
  companyId: string;
  channelId: string | null;
  gatewayId: string;
  extraIds: string[];
  schemeId: string | null;
};

/** Registra el cobro E1 del spec: 100,00 USD el viernes 13/11/2026 a las 10:30 de Nueva York. */
export function RegisterE1({ selection }: { selection: E1Selection }) {
  // El id lo pone el cliente, una sola vez: cada pulsación manda el mismo y la base registra un solo cobro.
  const [id] = useState(() => crypto.randomUUID());
  const [notice, setNotice] = useState<Notice>(null);

  async function register() {
    const result = await createTransaction({
      id,
      ...selection,
      occurredAt: "2026-11-13T15:30:00Z",
      currency: "USD",
      grossOriginal: "100,00",
      reference: null,
      note: null,
    });
    setNotice(result.ok ? { tone: "success", text: "Cobro registrado." } : { tone: "danger", text: result.error });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-ink-soft">
        Llama a <code className="font-mono">createTransaction</code> con un id fijo: pulsar dos veces no lo duplica.
      </p>
      <Button variant="primary" className="self-start" onClick={() => void register()}>
        Registrar cobro E1
      </Button>
      <NoticeAlert notice={notice} />
    </div>
  );
}

/**
 * Comprobantes: subir uno a un cobro (por defecto, el último), verlos por su URL firmada y pedir la de cualquier id.
 * Un solo aviso para toda la tarjeta: lo deja la última acción.
 */
export function ReceiptBench({
  transactionId,
  receipts,
}: {
  transactionId: string | null;
  receipts: { id: string; label: string }[];
}) {
  const titleId = useId();
  const [target, setTarget] = useState(transactionId ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [lookup, setLookup] = useState("");
  const [url, setUrl] = useState<string | null>(null);

  function pick(picked: File | null) {
    setFile(picked);
    setFileError(picked === null ? null : checkReceiptFile(picked));
    setNotice(null);
  }

  async function upload() {
    if (file === null) return;
    setBusy(true);
    const result = await uploadReceipt(file, target.trim());
    setBusy(false);
    setNotice(result.ok ? { tone: "success", text: "Comprobante agregado." } : { tone: "danger", text: result.error });
  }

  async function open(id: string) {
    setUrl(null);
    const result = await receiptUrlAction({ id });
    if (result.ok) {
      setUrl(result.data.url);
      setNotice(null);
    } else {
      setNotice({ tone: "danger", text: result.error });
    }
  }

  return (
    <Card>
      <section aria-labelledby={titleId}>
        <CardHeader>
          <CardTitle id={titleId}>Comprobantes</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-5">
          <div className="flex flex-col gap-3">
            <Field label="Cobro" hint="El id del cobro al que se sube el comprobante.">
              <Input value={target} onChange={(event) => setTarget(event.currentTarget.value)} autoComplete="off" />
            </Field>
            <ReceiptPicker onPick={pick} error={fileError} />
            <Button
              variant="primary"
              className="self-start"
              disabled={file === null || fileError !== null || busy}
              onClick={() => void upload()}
            >
              Subir comprobante
            </Button>
          </div>

          {receipts.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {receipts.map((receipt) => (
                <li key={receipt.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{receipt.label}</span>
                  <Button onClick={() => void open(receipt.id)}>Ver comprobante</Button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-col gap-3">
            <Field label="Id del comprobante">
              <Input value={lookup} onChange={(event) => setLookup(event.currentTarget.value)} autoComplete="off" />
            </Field>
            <Button className="self-start" onClick={() => void open(lookup.trim())}>
              Abrir comprobante
            </Button>
          </div>

          <NoticeAlert notice={notice} />
          {url ? (
            // Una URL firmada de Storage: `<img>` normal, nunca next/image optimizado.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="Comprobante" className="h-auto max-w-full rounded-control border border-rule" />
          ) : null}
        </CardBody>
      </section>
    </Card>
  );
}
