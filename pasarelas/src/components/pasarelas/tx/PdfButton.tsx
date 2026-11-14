"use client";

import { FileDown, LoaderCircle } from "lucide-react";
import { useRef, useState } from "react";
import { Alert, Button, type AlertTone } from "@/components/ui";

const FAILED_TEXT = "No se pudo armar el PDF. Revisa la conexión y vuelve a intentarlo.";

/** El nombre del archivo que dice la respuesta (`Content-Disposition`), o `cobros.pdf`. */
function fileNameOf(response: Response): string {
  return /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? "cobros.pdf";
}

/** Guarda el archivo con un enlace de descarga a su copia en memoria: así funciona también en el celular. */
function save(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Safari del iPhone lee el archivo después del clic: soltarlo enseguida rompería la descarga.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export type PdfButtonProps = {
  /** La ruta del PDF con lo que abarca (`PDF_PATH` de `./pdf` y sus parámetros). */
  href: string;
  /** Lo que dice el botón («PDF», «PDF de hoy»). */
  label: string;
  /** Lo que completa el nombre para el lector de pantalla («de los cobros elegidos»); no se ve. */
  hint?: string;
};

/**
 * Descarga el PDF de cobros que arma el servidor. Mientras lo arma, dice «Armando el PDF…» y no se puede pulsar otra
 * vez. Si son más cobros de los que admite, enseña el mensaje del servidor (y no hay descarga); si algo falla, lo
 * dice. Los dos avisos se anuncian (`role="alert"`).
 */
export function PdfButton({ href, label, hint }: PdfButtonProps) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: AlertTone; text: string } | null>(null);
  // El estado tarda un pintado en desactivar el botón: esto corta un segundo toque inmediato.
  const running = useRef(false);

  async function download() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(href, { cache: "no-store" });
      const type = response.headers.get("Content-Type") ?? "";
      if (response.ok && type.startsWith("application/pdf")) save(await response.blob(), fileNameOf(response));
      else if (response.status === 422) setNotice({ tone: "warning", text: await response.text() });
      else setNotice({ tone: "danger", text: FAILED_TEXT });
    } catch {
      setNotice({ tone: "danger", text: FAILED_TEXT });
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  // Sin envoltura: el botón va en la fila de botones de quien lo usa (el encabezado de Cobros, la barra de
  // seleccionados) y el aviso, en su propia línea debajo de todos ellos.
  return (
    <>
      <Button onClick={download} disabled={busy} aria-busy={busy || undefined}>
        {busy ? (
          <>
            <LoaderCircle aria-hidden className="size-5 animate-spin" />
            Armando el PDF…
          </>
        ) : (
          <>
            <FileDown aria-hidden className="size-5" />
            {label}
            {hint === undefined ? null : <span className="sr-only"> {hint}</span>}
          </>
        )}
      </Button>
      {notice === null ? null : (
        <Alert tone={notice.tone} announce className="order-last basis-full">
          {notice.text}
        </Alert>
      )}
    </>
  );
}
