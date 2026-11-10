"use client";

import { Alert, Button, PageHeader } from "@/components/ui";

/** Si el Resumen no se pudo armar: lo dice y deja volver a intentarlo. */
export default function ResumenError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <>
      <PageHeader title="Resumen" />
      <div className="flex flex-col items-start gap-3">
        <Alert tone="danger">No se pudo cargar el resumen. Revisa la conexión y vuelve a intentarlo.</Alert>
        <Button variant="primary" onClick={retry}>
          Reintentar
        </Button>
      </div>
    </>
  );
}
