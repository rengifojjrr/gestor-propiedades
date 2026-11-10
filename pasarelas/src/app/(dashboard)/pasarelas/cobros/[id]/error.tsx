"use client";

import { Alert, Button, PageHeader } from "@/components/ui";

/** Si el cobro no se pudo leer: lo dice y deja volver a intentarlo. */
export default function CobroError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <>
      <PageHeader title="Cobro" back={{ href: "/pasarelas/cobros", label: "Cobros" }} />
      <div className="flex flex-col items-start gap-3">
        <Alert tone="danger">No se pudo cargar el cobro. Revisa la conexión y vuelve a intentarlo.</Alert>
        <Button variant="primary" onClick={retry}>
          Reintentar
        </Button>
      </div>
    </>
  );
}
