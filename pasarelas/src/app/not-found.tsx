import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui";

export const metadata: Metadata = { title: "No encontrada" };

/** Se muestra con `notFound()` y con cualquier dirección que no exista. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-start justify-center gap-4 p-6">
      <h1 className="titulo text-2xl leading-tight">Esta página no existe</h1>
      <p className="text-ink-soft">
        Puede que la dirección esté mal escrita o que lo que buscabas se haya borrado.
      </p>
      <ButtonLink href="/pasarelas" variant="primary">
        Ir al Resumen
      </ButtonLink>
    </main>
  );
}
