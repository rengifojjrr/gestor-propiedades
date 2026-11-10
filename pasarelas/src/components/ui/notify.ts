"use client";

import { toast } from "sonner";

/**
 * Avisos pasajeros (aparecen arriba y se van solos). Se llaman desde componentes de cliente, después de
 * una acción: `notify.success("Cobro guardado")`, `notify.error("No se pudo guardar el cobro")`.
 * Un error que el usuario tiene que corregir va junto al campo o en un `Alert`, no aquí.
 */
export const notify = {
  success: (message: string) => {
    toast.success(message);
  },
  error: (message: string) => {
    toast.error(message);
  },
};
