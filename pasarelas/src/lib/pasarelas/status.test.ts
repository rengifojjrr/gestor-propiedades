import { describe, expect, test } from "vitest";
import { displayStatus, isOverdue, isPartialRefund, isPending, LIFECYCLE_LABEL, STATUS_LABEL } from "./status";
import type { LeanTx } from "./types";

type StatusTx = Pick<LeanTx, "status" | "disputeState" | "refunded" | "grossOriginal">;
type OverdueTx = Pick<LeanTx, "status" | "estimatedDepositOn" | "gross">;

const tx = (patch: Partial<StatusTx> = {}): StatusTx => ({
  status: "registrado",
  disputeState: null,
  refunded: "0.00",
  grossOriginal: "100.00",
  ...patch,
});

const HOY = "2026-11-09";
const pendiente = (patch: Partial<OverdueTx> = {}): OverdueTx => ({
  status: "en_transito",
  estimatedDepositOn: "2026-11-06",
  gross: "100.00",
  ...patch,
});

describe("displayStatus: el orden del spec §4.1", () => {
  test("sin reembolso ni disputa, se ve el ciclo del dinero", () => {
    expect(displayStatus(tx({ status: "registrado" }))).toBe("registrado");
    expect(displayStatus(tx({ status: "en_transito" }))).toBe("en_transito");
    expect(displayStatus(tx({ status: "depositado" }))).toBe("depositado");
  });

  test("fallido gana a todo", () => {
    expect(displayStatus(tx({ status: "fallido" }))).toBe("fallido");
    expect(displayStatus(tx({ status: "fallido", disputeState: "abierta", refunded: "100.00" }))).toBe("fallido");
  });

  test("una disputa abierta gana al reembolso total y al depósito", () => {
    expect(displayStatus(tx({ status: "depositado", disputeState: "abierta" }))).toBe("en_disputa");
    expect(displayStatus(tx({ status: "depositado", disputeState: "abierta", refunded: "100.00" }))).toBe("en_disputa");
  });

  test("una disputa cerrada ya no se ve como «en disputa»", () => {
    expect(displayStatus(tx({ status: "depositado", disputeState: "ganada" }))).toBe("depositado");
    expect(displayStatus(tx({ status: "depositado", disputeState: "perdida", refunded: "100.00" }))).toBe("reembolsado");
  });

  test("el reembolso total gana al depósito, al tránsito y al registro", () => {
    expect(displayStatus(tx({ status: "depositado", refunded: "100.00" }))).toBe("reembolsado");
    expect(displayStatus(tx({ status: "en_transito", refunded: "100.00" }))).toBe("reembolsado");
    expect(displayStatus(tx({ status: "registrado", refunded: "100.00" }))).toBe("reembolsado");
  });

  test("un reembolso parcial no cambia el estado visible", () => {
    expect(displayStatus(tx({ status: "depositado", refunded: "99.99" }))).toBe("depositado");
    expect(displayStatus(tx({ status: "en_transito", refunded: "40.00" }))).toBe("en_transito");
  });

  test("los montos se comparan como decimales, no como texto", () => {
    // Como texto, "9.00" > "100.00" y "100" < "100.00".
    expect(displayStatus(tx({ refunded: "9.00", grossOriginal: "100.00" }))).toBe("registrado");
    expect(displayStatus(tx({ refunded: "100", grossOriginal: "100.00" }))).toBe("reembolsado");
    expect(displayStatus(tx({ refunded: "1000.00", grossOriginal: "1000.00" }))).toBe("reembolsado");
  });
});

describe("isPartialRefund", () => {
  test("sí cuando lo reembolsado está entre cero y el bruto original", () => {
    expect(isPartialRefund(tx({ refunded: "40.00" }))).toBe(true);
    expect(isPartialRefund(tx({ refunded: "0.01" }))).toBe(true);
    expect(isPartialRefund(tx({ refunded: "99.99", status: "depositado" }))).toBe(true);
    expect(isPartialRefund(tx({ refunded: "9.00", grossOriginal: "100.00" }))).toBe(true);
  });

  test("no sin reembolso, con reembolso total ni en un cobro fallido", () => {
    expect(isPartialRefund(tx({ refunded: "0.00" }))).toBe(false);
    expect(isPartialRefund(tx({ refunded: "100.00" }))).toBe(false);
    expect(isPartialRefund(tx({ refunded: "40.00", status: "fallido" }))).toBe(false);
  });
});

describe("isPending", () => {
  test("registrado y en tránsito están por caer; depositado y fallido, no", () => {
    expect(isPending({ status: "registrado" })).toBe(true);
    expect(isPending({ status: "en_transito" })).toBe(true);
    expect(isPending({ status: "depositado" })).toBe(false);
    expect(isPending({ status: "fallido" })).toBe(false);
  });
});

describe("isOverdue", () => {
  test("atrasado: por caer, con fecha estimada ya pasada y bruto vigente mayor que cero", () => {
    expect(isOverdue(pendiente(), HOY)).toBe(true);
    expect(isOverdue(pendiente({ status: "registrado", estimatedDepositOn: "2026-11-08" }), HOY)).toBe(true);
    expect(isOverdue(pendiente({ gross: "0.01" }), HOY)).toBe(true);
  });

  test("si la fecha estimada es hoy o futura, todavía no", () => {
    expect(isOverdue(pendiente({ estimatedDepositOn: HOY }), HOY)).toBe(false);
    expect(isOverdue(pendiente({ estimatedDepositOn: "2026-11-10" }), HOY)).toBe(false);
  });

  test("falso con bruto 0.00", () => {
    expect(isOverdue(pendiente({ gross: "0.00" }), HOY)).toBe(false);
  });

  test("falso con fallido", () => {
    expect(isOverdue(pendiente({ status: "fallido" }), HOY)).toBe(false);
  });

  test("falso con depositado", () => {
    expect(isOverdue(pendiente({ status: "depositado" }), HOY)).toBe(false);
  });

  test("falso sin fecha estimada", () => {
    expect(isOverdue(pendiente({ estimatedDepositOn: null }), HOY)).toBe(false);
  });
});

describe("etiquetas", () => {
  test("los seis estados visibles", () => {
    expect(STATUS_LABEL).toEqual({
      registrado: "Registrado",
      en_transito: "En tránsito",
      depositado: "Depositado",
      reembolsado: "Reembolsado",
      en_disputa: "En disputa",
      fallido: "Fallido",
    });
  });

  test("los cuatro estados del ciclo del dinero", () => {
    expect(LIFECYCLE_LABEL).toEqual({
      registrado: "Registrado",
      en_transito: "En tránsito",
      depositado: "Depositado",
      fallido: "Fallido",
    });
  });
});
