"use client"; // los límites de error son componentes de cliente

import { useEffect } from "react";
import { Alert, Button, PageHeader } from "@/components/ui";

/** Si la lista o la ficha de una pasarela no se pudo cargar. Tus datos no se tocaron. */
export default function PasarelasError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <>
      <PageHeader title="Pasarelas" />
      <div className="flex flex-col items-start gap-4">
        <Alert tone="danger" title="No se pudieron cargar las pasarelas">
          Tus datos están guardados. Vuelve a intentarlo en un momento.
        </Alert>
        <Button variant="primary" onClick={() => retry()}>
          Reintentar
        </Button>
      </div>
    </>
  );
}
