"use client"; // los límites de error son componentes de cliente

import { useEffect } from "react";
import { Alert, Button, ButtonLink, PageHeader } from "@/components/ui";

/**
 * Si «Registrar cobro» falló al mostrarse: lo dice, deja reintentar y, como pudo fallar justo al guardar, dice dónde
 * mirar si el cobro llegó a guardarse (Cobros), para no registrarlo dos veces.
 */
export default function RegistrarError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <>
      <PageHeader title="Registrar cobro" />
      <div className="flex flex-col items-start gap-4">
        <Alert tone="danger" title="No se pudo mostrar el formulario.">
          Vuelve a intentarlo en un momento. Si estabas guardando un cobro y llegó a guardarse, aparecerá en Cobros:
          míralo ahí antes de registrarlo otra vez.
        </Alert>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => retry()}>
            Reintentar
          </Button>
          <ButtonLink href="/pasarelas/cobros">Ver Cobros</ButtonLink>
        </div>
      </div>
    </>
  );
}
