"use client";

import { useEffect } from "react";
import { Alert, Button, PageHeader } from "@/components/ui";

export default function CuentasError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <>
      <PageHeader title="Cuentas destino" />
      <div className="flex flex-col items-start gap-4">
        <Alert tone="danger" title="No se pudieron cargar las cuentas">
          Tus datos están guardados: vuelve a intentarlo en un momento.
        </Alert>
        <Button variant="primary" onClick={() => retry()}>
          Reintentar
        </Button>
      </div>
    </>
  );
}
