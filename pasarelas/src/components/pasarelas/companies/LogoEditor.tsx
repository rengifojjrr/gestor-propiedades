"use client";

import { ImageUp, LoaderCircle } from "lucide-react";
import { useId, useState, type ChangeEvent } from "react";
import { ReceiptFileError, checkReceiptFile } from "@/components/pasarelas/receipts/check";
import { downscaleImage } from "@/components/pasarelas/receipts/downscale";
import { uploadToFolder } from "@/components/pasarelas/receipts/upload";
import { Button, cn, notify } from "@/components/ui";
import { buttonClass } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { setCompanyLogo } from "@/server/pasarelas/actions/companies";
import { CompanyLogo } from "./CompanyLogo";

/** El bucket privado donde viven los comprobantes y los logos (cada empresa en su carpeta). */
const BUCKET = "comprobantes";
/** Un logo se ve pequeño: con 512 px por lado sobra. */
const LOGO_SIDE = 512;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const TYPE_TEXT = "El logo tiene que ser una imagen JPG, PNG o WebP.";
const UPLOAD_TEXT = "No se pudo subir el logo. Inténtalo de nuevo.";

/** Borra un archivo subido que no se pudo guardar como logo. Si no se puede, se irá al borrar la empresa. */
async function discard(path: string): Promise<void> {
  try {
    await createClient().storage.from(BUCKET).remove([path]);
  } catch {
    // La persona ya tiene un error en pantalla: no se le enseña otro.
  }
}

/**
 * El logo de la empresa: verlo, subir otro o quitarlo. La imagen se achica y se recodifica en el navegador (lo que
 * además le quita los metadatos), se sube directo a la carpeta de la empresa y después `setCompanyLogo` guarda su
 * ruta, que borra la anterior.
 */
export function LogoEditor({ companyId, name, url }: { companyId: string; name: string; url: string | null }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(path: string | null): Promise<boolean> {
    try {
      const result = await setCompanyLogo({ companyId, path });
      if (result.ok) return true;
      setError(result.error);
    } catch {
      setError(UPLOAD_TEXT);
    }
    return false;
  }

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;
    // Vaciar el control deja volver a elegir el mismo archivo.
    event.currentTarget.value = "";
    if (file === null) return;
    const problem = IMAGE_TYPES.has(file.type) ? checkReceiptFile(file) : TYPE_TEXT;
    setError(problem);
    if (problem !== null) return;
    setBusy(true);
    let path: string | null = null;
    try {
      path = (await uploadToFolder(await downscaleImage(file, LOGO_SIDE), companyId)).path;
    } catch (failure) {
      setError(failure instanceof ReceiptFileError ? failure.message : UPLOAD_TEXT);
    }
    if (path !== null) {
      if (await save(path)) notify.success("Logo guardado");
      else await discard(path);
    }
    setBusy(false);
  }

  async function remove() {
    setError(null);
    setBusy(true);
    if (await save(null)) notify.success("Logo quitado");
    setBusy(false);
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <CompanyLogo name={name} url={url} size="lg" />
        <label
          className={cn(
            buttonClass("secondary"),
            "cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
            busy && "pointer-events-none opacity-55",
          )}
        >
          {busy ? (
            <LoaderCircle aria-hidden className="size-5 animate-spin" />
          ) : (
            <ImageUp aria-hidden className="size-5" />
          )}
          {url === null ? "Subir logo" : "Cambiar logo"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            className="sr-only"
            disabled={busy}
            aria-describedby={error ? `${id}-ayuda ${id}-error` : `${id}-ayuda`}
            aria-invalid={error ? true : undefined}
            onChange={(event) => void pick(event)}
          />
        </label>
        {url !== null ? (
          <Button variant="ghost" disabled={busy} onClick={() => void remove()}>
            Quitar logo
          </Button>
        ) : null}
      </div>
      <p id={`${id}-ayuda`} className="text-sm text-ink-soft">
        Opcional. JPG, PNG o WebP; se achica antes de subir.
      </p>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
