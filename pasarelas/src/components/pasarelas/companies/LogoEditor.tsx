"use client";

import { ImageUp, LoaderCircle } from "lucide-react";
import { useId, useState, useSyncExternalStore, type ChangeEvent } from "react";
import { ReceiptFileError, checkReceiptFile } from "@/components/pasarelas/receipts/check";
import { downscaleImage } from "@/components/pasarelas/receipts/downscale";
import { saveUploaded, uploadToFolder } from "@/components/pasarelas/receipts/upload";
import { Button, cn, notify } from "@/components/ui";
import { buttonClass } from "@/components/ui/Button";
import { setCompanyLogo } from "@/server/pasarelas/actions/companies";
import { CompanyLogo } from "./CompanyLogo";

/** Un logo se ve pequeño: con 512 px por lado sobra. */
const LOGO_SIDE = 512;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const TYPE_TEXT = "El logo tiene que ser una imagen JPG, PNG o WebP.";
const UPLOAD_TEXT = "No se pudo subir el logo. Inténtalo de nuevo.";
const UNSURE_TEXT = "No se pudo confirmar si se guardó el cambio del logo. Recarga la página para ver cómo quedó.";

/** `useSyncExternalStore` sin nada que escuchar: solo distingue el HTML del servidor de la página ya hidratada. */
const noSubscription = () => () => {};

/**
 * El logo de la empresa: verlo, subir otro o quitarlo. La imagen se achica y se recodifica en el navegador (lo que
 * además le quita los metadatos), se sube directo a la carpeta de la empresa y después `setCompanyLogo` guarda su
 * ruta, que borra la anterior. Si el servidor rechaza el logo, el archivo subido se borra; si la respuesta no llega,
 * no (no se sabe si quedó guardado).
 */
export function LogoEditor({ companyId, name, url }: { companyId: string; name: string; url: string | null }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // En el HTML del servidor el selector va apagado: un archivo elegido antes de que la página se hidrate no
  // llegaría a ningún manejador y se perdería sin aviso.
  const hydrated = useSyncExternalStore(noSubscription, () => true, () => false);
  const locked = busy || !hydrated;

  /** Guarda el logo subido en `path` (o lo quita con `null`). Un rechazo del servidor borra el archivo subido. */
  async function save(path: string | null): Promise<boolean> {
    try {
      const result = await saveUploaded(path, () => setCompanyLogo({ companyId, path }));
      if (result.ok) return true;
      setError(result.error);
    } catch {
      setError(UNSURE_TEXT);
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
    if (path !== null && (await save(path))) notify.success("Logo guardado");
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
            locked && "pointer-events-none opacity-55",
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
            disabled={locked}
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
