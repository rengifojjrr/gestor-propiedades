"use client"; // los límites de error son componentes de cliente

import { useEffect } from "react";
import { Alert, Button, PageHeader } from "@/components/ui";

/** Si «Importar CSV» no se pudo cargar. No se importó nada. */
export default function ImportarError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <>
      <PageHeader title="Importar CSV" />
      <div className="flex flex-col items-start gap-4">
        <Alert tone="danger" title="No se pudo cargar la pantalla de importar">
          Tus datos están guardados. Vuelve a intentarlo en un momento.
        </Alert>
        <Button variant="primary" onClick={() => retry()}>
          Reintentar
        </Button>
      </div>
    </>
  );
}
