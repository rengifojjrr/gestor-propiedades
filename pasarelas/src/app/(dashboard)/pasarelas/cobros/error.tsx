"use client";

import { Alert, Button, PageHeader } from "@/components/ui";

/** Si la lista no se pudo leer: lo dice y deja volver a intentarlo. */
export default function CobrosError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <>
      <PageHeader title="Cobros" />
      <div className="flex flex-col items-start gap-3">
        <Alert tone="danger">No se pudieron cargar los cobros. Revisa la conexión y vuelve a intentarlo.</Alert>
        <Button variant="primary" onClick={retry}>
          Reintentar
        </Button>
      </div>
    </>
  );
}
