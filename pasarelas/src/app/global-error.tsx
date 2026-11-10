"use client"; // los límites de error son componentes de cliente

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import "./globals.css";

/**
 * Último recurso: un error en el layout raíz. Reemplaza al layout, así que trae su propio <html> y <body>
 * y vuelve a cargar la hoja de estilos. (Los errores de una pantalla los atrapa su `error.tsx`.)
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  // En producción, un error del servidor llega sin detalle y con una referencia para buscarlo en los registros.
  const digest = error instanceof Error && "digest" in error ? String(error.digest) : null;

  return (
    <html lang="es">
      <body>
        <title>Algo salió mal · Pasarelas</title>
        <main className="mx-auto flex min-h-dvh max-w-md flex-col items-start justify-center gap-4 p-6">
          <h1 className="titulo text-2xl leading-tight">Algo salió mal</h1>
          <p className="text-ink-soft">
            La app no pudo cargar. Tus datos están guardados: vuelve a intentarlo en un momento.
          </p>
          {digest ? <p className="text-sm text-ink-soft">Referencia: {digest}</p> : null}
          <Button variant="primary" onClick={() => retry()}>
            Reintentar
          </Button>
        </main>
      </body>
    </html>
  );
}
