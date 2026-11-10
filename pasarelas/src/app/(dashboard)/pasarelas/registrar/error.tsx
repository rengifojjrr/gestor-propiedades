"use client"; // los límites de error son componentes de cliente

import { useEffect } from "react";
import { Alert, Button, PageHeader } from "@/components/ui";

/** Si «Registrar cobro» no pudo cargar: lo dice y deja reintentar. Nada se guardó a medias. */
export default function RegistrarError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <>
      <PageHeader title="Registrar cobro" />
      <div className="flex flex-col items-start gap-4">
        <Alert tone="danger" title="No se pudo cargar el formulario.">
          Tus datos están guardados. Vuelve a intentarlo en un momento.
        </Alert>
        <Button variant="primary" onClick={() => retry()}>
          Reintentar
        </Button>
      </div>
    </>
  );
}
