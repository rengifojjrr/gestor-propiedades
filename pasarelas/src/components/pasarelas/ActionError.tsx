"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Alert, Button, cn } from "@/components/ui";
import type { ActionFailure } from "./callAction";

export type ActionErrorProps = {
  /** El error de la última acción (`failureOf`), o `null` si no hay. */
  failure: ActionFailure | null;
  /** De qué lado va «Ver cómo quedó»: al principio (por defecto) o al final, junto a botones alineados a la derecha. */
  align?: "start" | "end";
  className?: string;
};

/**
 * El error de una acción, en un aviso que se anuncia. Si no se sabe si se guardó (un corte: `unsure`), ofrece
 * «Ver cómo quedó», que vuelve a pintar la pantalla con lo que hay en el servidor. No se refresca sola: con mala
 * señal el refresco recargaría la página entera y se perdería lo escrito; así, la persona ya leyó el aviso.
 */
export function ActionError({ failure, align = "start", className }: ActionErrorProps) {
  const router = useRouter();
  if (failure === null) return null;
  return (
    <div className={cn("flex flex-col gap-2", align === "start" ? "items-start" : "items-end", className)}>
      <Alert tone="danger" announce className="self-stretch">
        {failure.text}
      </Alert>
      {failure.unsure ? <Button onClick={() => router.refresh()}>Ver cómo quedó</Button> : null}
    </div>
  );
}

/**
 * Para el contenido de un diálogo (que solo existe mientras está abierto): si se cierra con la duda de un corte
 * en pantalla, vuelve a pintar la pantalla de detrás, para que enseñe si el cambio se guardó.
 */
export function useRefreshOnClose(failure: ActionFailure | null): void {
  const router = useRouter();
  const unsure = useRef(false);
  useEffect(() => {
    unsure.current = failure?.unsure === true;
  }, [failure]);
  useEffect(
    () => () => {
      if (unsure.current) router.refresh();
    },
    [router],
  );
}
