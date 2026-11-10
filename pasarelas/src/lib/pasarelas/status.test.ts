import { describe, expect, test } from "vitest";
import { displayStatus, isOverdue, isPartialRefund, isPending, LIFECYCLE_LABEL, STATUS_LABEL } from "./status";
import type { LeanTx } from "./types";

type StatusTx = Pick<LeanTx, "status" | "disputeState" | "refunded" | "grossOriginal">;
type OverdueTx = StatusTx & Pick<LeanTx, "estimatedDepositOn">;

const tx = (patch: Partial<StatusTx> = {}): StatusTx => ({
  status: "registrado",
  disputeState: null,
  refunded: "0.00",
  grossOriginal: "100.00",
  ...patch,
});

const HOY = "2026-11-09";

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

/**
 * Cobros sin depositar (`registrado` salvo que el caso diga otra cosa) de 100,00, y si están por caer. La regla es
 * una sola: está por caer lo que se ve como registrado o en tránsito.
 */
const CASOS: readonly { caso: string; patch: Partial<StatusTx>; porCaer: boolean }[] = [
  { caso: "registrado", patch: {}, porCaer: true },
  { caso: "en tránsito", patch: { status: "en_transito" }, porCaer: true },
  { caso: "con reembolso parcial", patch: { refunded: "40.00" }, porCaer: true },
  { caso: "en tránsito con reembolso parcial", patch: { status: "en_transito", refunded: "99.99" }, porCaer: true },
  { caso: "con reembolso total", patch: { refunded: "100.00" }, porCaer: false },
  { caso: "en tránsito con reembolso total", patch: { status: "en_transito", refunded: "100.00" }, porCaer: false },
  { caso: "con disputa abierta", patch: { disputeState: "abierta" }, porCaer: false },
  { caso: "en tránsito y en disputa", patch: { status: "en_transito", disputeState: "abierta" }, porCaer: false },
  { caso: "con disputa ganada", patch: { disputeState: "ganada" }, porCaer: true },
  // Perder la disputa implica el reembolso total.
  { caso: "con disputa perdida", patch: { disputeState: "perdida", refunded: "100.00" }, porCaer: false },
  { caso: "depositado", patch: { status: "depositado" }, porCaer: false },
  { caso: "fallido", patch: { status: "fallido" }, porCaer: false },
];

describe("isPending: por caer es lo que se ve como registrado o en tránsito", () => {
  test.each(CASOS)("$caso → $porCaer", ({ patch, porCaer }) => {
    expect(isPending(tx(patch))).toBe(porCaer);
  });

  test("coincide con el estado visible en todas las combinaciones de ciclo, disputa y reembolso", () => {
    for (const status of ["registrado", "en_transito", "depositado", "fallido"] as const) {
      for (const disputeState of [null, "abierta", "ganada", "perdida"] as const) {
        for (const refunded of ["0.00", "40.00", "100.00"]) {
          const cobro = tx({ status, disputeState, refunded });
          const visible = displayStatus(cobro);
          expect(isPending(cobro), JSON.stringify(cobro)).toBe(visible === "registrado" || visible === "en_transito");
        }
      }
    }
  });
});

describe("isOverdue: por caer y con la fecha estimada ya pasada", () => {
  const conFecha = (patch: Partial<StatusTx>, estimatedDepositOn: string | null): OverdueTx => ({
    ...tx(patch),
    estimatedDepositOn,
  });

  test.each(CASOS)("$caso, con la fecha estimada ya pasada → $porCaer", ({ patch, porCaer }) => {
    expect(isOverdue(conFecha(patch, "2026-11-08"), HOY)).toBe(porCaer);
    expect(isOverdue(conFecha(patch, "2025-01-15"), HOY)).toBe(porCaer);
  });

  test.each(CASOS)("$caso, con la fecha estimada hoy, futura o sin fecha → nunca", ({ patch }) => {
    expect(isOverdue(conFecha(patch, HOY), HOY)).toBe(false);
    expect(isOverdue(conFecha(patch, "2026-11-10"), HOY)).toBe(false);
    expect(isOverdue(conFecha(patch, null), HOY)).toBe(false);
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
