import { describe, expect, test } from "vitest";
import { MAX_PAYOUT_ITEMS, MAX_PAYOUTS, payoutChunks } from "./payoutChunks";

describe("payoutChunks: lo de cada cobro, en pagos de hasta 500 cobros", () => {
  const items = (count: number) => Array.from({ length: count }, (_, i) => ({ transactionId: `t${i}`, amount: "1.00" }));

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
});
