"use client";

import { useEffect } from "react";
import { Alert, Button } from "@/components/ui";

/**
 * Lo que ven las pantallas de Empresas si algo falla al cargarlas (su `error.tsx`): qué pasó, que nada se perdió y
 * un botón para volver a intentarlo. En producción el error llega sin detalle, con una referencia para los registros.
 */
export function ScreenError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = error instanceof Error && "digest" in error ? String(error.digest) : null;

  return (
    <div className="flex max-w-xl flex-col items-start gap-4">
      <h1 className="titulo text-2xl leading-tight">No se pudo cargar</h1>
      <Alert tone="danger" title="Algo falló al leer tus empresas.">
        Tus datos están guardados: vuelve a intentarlo en un momento.
        {digest ? <span className="block">Referencia: {digest}</span> : null}
      </Alert>
      <Button variant="primary" onClick={() => retry()}>
        Reintentar
      </Button>
    </div>
  );
}
