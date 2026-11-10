"use client";

import { useEffect } from "react";
import { Alert, Button, PageHeader } from "@/components/ui";

export default function AjustesError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <>
      <PageHeader title="Ajustes" />
      <div className="flex flex-col items-start gap-4">
        <Alert tone="danger" title="No se pudieron cargar los ajustes">
          Tus datos están guardados: vuelve a intentarlo en un momento.
        </Alert>
        <Button variant="primary" onClick={() => retry()}>
          Reintentar
        </Button>
      </div>
    </>
  );
}
