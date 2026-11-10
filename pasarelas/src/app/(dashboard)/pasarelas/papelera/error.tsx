"use client";

import { Alert, Button, PageHeader } from "@/components/ui";

/** Si la papelera no se pudo leer: lo dice y deja volver a intentarlo. */
export default function PapeleraError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <>
      <PageHeader title="Papelera" />
      <div className="flex flex-col items-start gap-3">
        <Alert tone="danger">No se pudo cargar la papelera. Revisa la conexión y vuelve a intentarlo.</Alert>
        <Button variant="primary" onClick={retry}>
          Reintentar
        </Button>
      </div>
    </>
  );
}
