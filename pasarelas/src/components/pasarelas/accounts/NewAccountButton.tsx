"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui";
import { AccountFormDialog } from "./AccountFormDialog";

/** «Agregar cuenta»: abre el formulario de una cuenta nueva. */
export function NewAccountButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus aria-hidden className="size-5" />
        Agregar cuenta
      </Button>
      <AccountFormDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
