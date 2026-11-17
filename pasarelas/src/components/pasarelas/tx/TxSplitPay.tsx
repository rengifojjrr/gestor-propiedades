"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import type { Currency, ISODate } from "@/lib/pasarelas/types";
import { PayoutsDialog } from "./PayoutsDialog";

export type TxSplitPayProps = {
  /** La URL de la lista (sus parámetros): el filtro de los cobros. */
  query: string;
  beneficiaryId: string;
  name: string;
  currency: Currency;
  /** Hoy en Nueva York: la fecha que viene puesta. */
  today: ISODate;
  /**
   * Lo que recibe el foco tras pagar: si ya no le falta nada, el botón se va con la lista nueva y el foco caería en
   * <body>. Es el título de su moneda en el «Reparto del filtro» (con `tabIndex={-1}`), que se queda.
   */
  focusAfterId: string;
};

/** «Pagar…» a una parte desde el «Reparto del filtro»: el diálogo de «Pagar repartos…» con esa parte y esa moneda. */
export function TxSplitPay({ query, beneficiaryId, name, currency, today, focusAfterId }: TxSplitPayProps) {
  const [open, setOpen] = useState(false);
  const paid = useRef(false);

  // Después de que el diálogo se cierra (y devuelve el foco al botón), el foco pasa al título de la moneda.
  useEffect(() => {
    if (open || !paid.current) return;
    paid.current = false;
    document.getElementById(focusAfterId)?.focus();
  }, [open, focusAfterId]);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        Pagar…
        <span className="sr-only">
          {" "}
          a {name} en {currency}
        </span>
      </Button>
      <PayoutsDialog
        fromFilter={{ query, beneficiaryId, currency, name }}
        open={open}
        onClose={() => setOpen(false)}
        onDone={() => {
          paid.current = true;
          setOpen(false);
        }}
        today={today}
      />
    </>
  );
}
