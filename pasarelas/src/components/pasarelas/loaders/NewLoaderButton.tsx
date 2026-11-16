"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui";
import { LoaderFormDialog } from "./LoaderFormDialog";

/** «Agregar cargador»: abre el formulario de un cargador nuevo. */
export function NewLoaderButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus aria-hidden className="size-5" />
        Agregar cargador
      </Button>
      <LoaderFormDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
