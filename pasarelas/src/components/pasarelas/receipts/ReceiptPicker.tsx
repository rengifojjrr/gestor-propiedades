"use client";

import { Camera, CircleAlert, Paperclip, X } from "lucide-react";
import { useId, useState, type ChangeEvent } from "react";
import { IconButton, cn } from "@/components/ui";
import { buttonClass } from "@/components/ui/Button";
import { RECEIPT_ACCEPT } from "./check";

export type ReceiptPickerProps = {
  /** El archivo elegido, o `null` si se quitó. Quien lo recibe decide si vale (`checkReceiptFile`) y cuándo subirlo. */
  onPick: (file: File | null) => void;
  /** Por qué no vale el archivo elegido; se lee junto a los dos botones. */
  error?: string | null;
};

/** Cada botón es la etiqueta de un `<input type="file">` escondido; el anillo de foco va en la etiqueta. */
const PICK_CLASS = cn(
  buttonClass("secondary"),
  "cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
);

/**
 * Elegir el comprobante de un cobro: sacar una foto con la cámara del celular o elegir un archivo (foto o PDF).
 * Solo elige: no comprueba ni sube nada.
 */
export function ReceiptPicker({ onPick, error }: ReceiptPickerProps) {
  const id = useId();
  const [name, setName] = useState<string | null>(null);
  const hintId = `${id}-ayuda`;
  const errorId = `${id}-error`;
  const describedBy = error ? `${hintId} ${errorId}` : hintId;

  function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;
    // Vaciar el control deja volver a elegir el mismo archivo después de quitarlo.
    event.currentTarget.value = "";
    setName(file?.name ?? null);
    onPick(file);
  }

  function clear() {
    setName(null);
    onPick(null);
  }

  return (
    <div role="group" aria-labelledby={`${id}-titulo`} className="flex min-w-0 flex-col gap-2">
      <p id={`${id}-titulo`} className="text-sm font-semibold text-ink">
        Comprobante
      </p>
      <div className="flex flex-wrap gap-2">
        <label className={PICK_CLASS}>
          <Camera aria-hidden className="size-5" />
          Tomar foto
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            onChange={pick}
          />
        </label>
        <label className={PICK_CLASS}>
          <Paperclip aria-hidden className="size-5" />
          Elegir archivo
          <input
            type="file"
            accept={RECEIPT_ACCEPT}
            className="sr-only"
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            onChange={pick}
          />
        </label>
      </div>
      {name ? (
        <div className="flex min-w-0 items-center gap-2">
          <p className="min-w-0 truncate text-sm">{name}</p>
          <IconButton label="Quitar el archivo elegido" onClick={clear}>
            <X aria-hidden className="size-5" />
          </IconButton>
        </div>
      ) : null}
      <p id={hintId} className="text-sm text-ink-soft">
        Foto (JPG, PNG o WebP) o PDF, de hasta 10 MB. Las fotos se achican antes de subir.
      </p>
      {error ? (
        <p id={errorId} className="flex items-start gap-1.5 text-sm font-semibold text-danger">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
