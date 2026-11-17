import { describe, expect, test } from "vitest";
import { MAX_PAYOUT_ITEMS, MAX_PAYOUTS, payoutChunks } from "./payoutChunks";

describe("payoutChunks: lo de cada cobro, en pagos de hasta 500 cobros", () => {
  const items = (count: number, amount = "1.00", prefix = "t") =>
    Array.from({ length: count }, (_, i) => ({ transactionId: `${prefix}${i}`, amount }));

  test("los límites de hoy: 500 cobros por pago y 200 pagos por llamada", () => {
    expect(MAX_PAYOUT_ITEMS).toBe(500);
    expect(MAX_PAYOUTS).toBe(200);
  });

  test("hasta 500 cobros, un solo pago; con más, varios de 500 y el último con lo que queda, en su orden", () => {
    expect(payoutChunks([])).toEqual([]);
    expect(payoutChunks(items(1))).toEqual([items(1)]);
    expect(payoutChunks(items(500)).map((chunk) => chunk.length)).toEqual([500]);
    expect(payoutChunks(items(501)).map((chunk) => chunk.length)).toEqual([500, 1]);
    const many = items(1200);
    const chunks = payoutChunks(many);
    expect(chunks.map((chunk) => chunk.length)).toEqual([500, 500, 200]);
    expect(chunks.flat()).toEqual(many);
  });

  test("hasta 500 cobros, lo pagado de más va en el mismo pago y se descuenta (como «Pagar repartos…»)", () => {
    const mixed = [...items(3, "10.00"), ...items(2, "-4.00", "m")];
    expect(payoutChunks(mixed)).toEqual([mixed]);
  });

  test("con más de 500, lo que se paga y lo que se descuenta van en pagos aparte: ninguno suma cero", () => {
    // 501 de 1,00 y uno de −1,00: en tramos seguidos, el segundo (1,00 − 1,00) sumaría 0,00, y la base no lo deja.
    const owed = items(501);
    const over = items(1, "-1.00", "m");
    expect(payoutChunks([...owed, ...over])).toEqual([owed.slice(0, 500), owed.slice(500), over]);
    // Lo pagado de más, esté donde esté, va al final.
    expect(payoutChunks([...over, ...owed])).toEqual([owed.slice(0, 500), owed.slice(500), over]);

    const big = [...items(1001, "2.00"), ...items(3, "-1.50", "m")];
    expect(payoutChunks(big).map((chunk) => [chunk.length, chunk[0]?.amount])).toEqual([
      [500, "2.00"],
      [500, "2.00"],
      [1, "2.00"],
      [3, "-1.50"],
    ]);
  });
});
