"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui";
import { BeneficiaryFormDialog } from "./BeneficiaryFormDialog";

/** «Agregar beneficiario»: abre el diálogo vacío. */
export function NewBeneficiaryButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden className="size-5" />
        Agregar beneficiario
      </Button>
      <BeneficiaryFormDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
