import { describe, expect, it } from "vitest";
import type { PayoutStatus } from "@/lib/pasarelas";
import { coveredTxName, isDiscount, payoutMarkText, undoPayoutText } from "./payoutText";

const part = (state: "pagado" | "falta" | "de_mas") => ({
  beneficiaryId: "x",
  allocated: "0.00",
  retained: "0.00",
  paid: "0.00",
  owed: "0.00",
  state,
});
const status = (...states: ("pagado" | "falta" | "de_mas")[]): PayoutStatus => ({
  parts: states.map(part),
  paidCount: states.filter((state) => state === "pagado").length,
  pending: states.some((state) => state !== "pagado"),
});

describe("payoutMarkText: la marca de cada cobro en la lista", () => {
  it("todo pagado, o cuántas de cuántas", () => {
    expect(payoutMarkText(status("pagado", "pagado"))).toBe("Reparto pagado");
    expect(payoutMarkText(status("falta", "falta", "falta", "falta"))).toBe("Reparto: 0 de 4 pagados");
    expect(payoutMarkText(status("pagado", "falta", "de_mas", "pagado"))).toBe("Reparto: 2 de 4 pagados");
    expect(payoutMarkText(status("falta"))).toBe("Reparto: 0 de 1 pagado");
  });
});

describe("coveredTxName: cómo se nombra otro cobro que paga la misma liquidación", () => {
  it("por su referencia, o por su fecha y lo cobrado", () => {
    const tx = { occurredOn: "2026-11-10", grossOriginal: "1000.00", currency: "USD", reference: "E10-b" };
    expect(coveredTxName(tx)).toBe("el cobro E10-b");
    expect(coveredTxName({ ...tx, reference: null })).toBe("el cobro del mar 10 nov 2026 por $1.000,00");
  });
});

describe("undoPayoutText: qué desmarca «Deshacer»", () => {
  const payment = {
    beneficiaryName: "Grupo B",
    paidOn: "2026-11-14",
    currency: "USD",
    amount: "580.54",
    here: "290.27",
    others: [
      { transactionId: "t2", amount: "290.27", occurredOn: "2026-11-10", grossOriginal: "1000.00", currency: "USD", reference: "E10-b" },
    ],
  };

  it("solo de este cobro: se borra el pago y vuelve a faltar", () => {
    expect(undoPayoutText({ ...payment, amount: "290.27", others: [] })).toBe(
      "Se borra el pago a Grupo B de $290,27 del sáb 14 nov 2026, y en este cobro vuelve a faltarle eso. No se puede " +
        "deshacer.",
    );
  });

  it("P5: si cubre varios cobros, dice cuáles se desmarcan y cuánto", () => {
    expect(undoPayoutText(payment)).toBe(
      "El pago a Grupo B de $580,54 del sáb 14 nov 2026 cubre 2 cobros, y se desmarcan los dos: este ($290,27) y el " +
        "cobro E10-b ($290,27). No se puede deshacer.",
    );
    const three = { ...payment, amount: "870.81", others: [...payment.others, { ...payment.others[0]!, reference: null }] };
    expect(undoPayoutText(three)).toBe(
      "El pago a Grupo B de $870,81 del sáb 14 nov 2026 cubre 3 cobros, y se desmarcan los tres: este ($290,27), el " +
        "cobro E10-b ($290,27) y el cobro del mar 10 nov 2026 por $1.000,00 ($290,27). No se puede deshacer.",
    );
  });

  it("una devolución lo dice como devolución", () => {
    expect(undoPayoutText({ ...payment, amount: "-25.00", here: "-25.00", others: [] })).toBe(
      "Se borra la devolución de Grupo B de $25,00 del sáb 14 nov 2026, y en este cobro vuelve a quedar como estaba. " +
        "No se puede deshacer.",
    );
  });

  describe("D1: un pago con descuento (lo pagado de más en un cobro se descontó del pago) sigue siendo un pago", () => {
    /** «Pagar…» a Socio Uno: 485,40 y 96,95 que le faltaban, menos 50,00 que se le pagaron de más en `ref-1`. */
    const covered = (reference: string, amount: string) => ({
      transactionId: reference,
      amount,
      occurredOn: "2026-11-10",
      grossOriginal: "100.00",
      currency: "USD",
      reference,
    });
    const discounted = {
      beneficiaryName: "Socio Uno",
      paidOn: "2026-11-17",
      currency: "USD",
      amount: "532.35",
      here: "-50.00",
      others: [covered("ref-2", "485.40"), covered("ref-3", "96.95")],
    };

    it("desde el cobro descontado: se deshace EL PAGO de $532,35, y ese cobro se dice como descuento", () => {
      expect(undoPayoutText(discounted)).toBe(
        "El pago a Socio Uno de $532,35 del mar 17 nov 2026 cubre 3 cobros, y se desmarcan los tres: este (descuento " +
          "de $50,00), el cobro ref-2 ($485,40) y el cobro ref-3 ($96,95). No se puede deshacer.",
      );
    });

    it("desde otro cobro del mismo pago: el descontado también se dice como descuento, no como «-$50,00»", () => {
      const fromSecond = { ...discounted, here: "485.40", others: [covered("ref-1", "-50.00"), covered("ref-3", "96.95")] };
      expect(undoPayoutText(fromSecond)).toBe(
        "El pago a Socio Uno de $532,35 del mar 17 nov 2026 cubre 3 cobros, y se desmarcan los tres: este ($485,40), " +
          "el cobro ref-1 (descuento de $50,00) y el cobro ref-3 ($96,95). No se puede deshacer.",
      );
    });

    it("D2: una devolución de verdad se dice como hoy; lo que se le debía en otro cobro, como descuento", () => {
      const refund = { ...discounted, amount: "-40.00", here: "-50.00", others: [covered("ref-2", "10.00")] };
      expect(undoPayoutText(refund)).toBe(
        "La devolución de Socio Uno de $40,00 del mar 17 nov 2026 cubre 2 cobros, y se desmarcan los dos: este " +
          "($50,00) y el cobro ref-2 (descuento de $10,00). No se puede deshacer.",
      );
    });
  });
});

describe("isDiscount: lo de un cobro que va en contra de su pago", () => {
  it("en un pago, lo negativo; en una devolución, lo positivo", () => {
    expect(isDiscount("532.35", "-50.00")).toBe(true);
    expect(isDiscount("532.35", "485.40")).toBe(false);
    expect(isDiscount("-40.00", "10.00")).toBe(true);
    expect(isDiscount("-40.00", "-50.00")).toBe(false);
  });
});
