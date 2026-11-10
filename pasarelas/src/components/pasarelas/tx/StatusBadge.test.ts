import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusBadge, type StatusBadgeProps } from "./StatusBadge";

type Tx = StatusBadgeProps["tx"];

const TODAY = "2026-11-20";
const registrado: Tx = {
  status: "registrado",
  disputeState: null,
  refunded: "0.00",
  grossOriginal: "100.00",
  estimatedDepositOn: "2026-11-25",
};

const html = (tx: Tx) => renderToStaticMarkup(createElement(StatusBadge, { tx, today: TODAY }));
/** Los sellos que ve la persona, en orden. */
const stamps = (tx: Tx) => [...html(tx).matchAll(/<span[^>]*data-stamp[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);

describe("StatusBadge", () => {
  it("dice el estado visible del motor con su texto", () => {
    expect(stamps(registrado)).toEqual(["Registrado"]);
    expect(stamps({ ...registrado, status: "en_transito" })).toEqual(["En tránsito"]);
    expect(stamps({ ...registrado, status: "depositado" })).toEqual(["Depositado"]);
    expect(stamps({ ...registrado, status: "fallido" })).toEqual(["Fallido"]);
    expect(stamps({ ...registrado, disputeState: "abierta" })).toEqual(["En disputa"]);
    expect(stamps({ ...registrado, refunded: "100.00" })).toEqual(["Reembolsado"]);
  });

  it("cada estado con su tono (el color acompaña; lo que dice el estado es el texto)", () => {
    expect(html({ ...registrado, status: "depositado" })).toContain("text-brand");
    expect(html({ ...registrado, status: "en_transito" })).toContain("text-info");
    expect(html({ ...registrado, disputeState: "abierta" })).toContain("text-warning");
    expect(html({ ...registrado, status: "fallido" })).toContain("text-danger");
  });

  it("un reembolso parcial es una etiqueta aparte: no cambia el estado", () => {
    expect(stamps({ ...registrado, status: "depositado", refunded: "40.00" })).toEqual([
      "Depositado",
      "Reembolso parcial",
    ]);
  });

  it("atrasado: por caer y con la fecha estimada ya pasada", () => {
    expect(stamps({ ...registrado, estimatedDepositOn: "2026-11-19" })).toEqual(["Registrado", "Atrasado"]);
    expect(stamps({ ...registrado, estimatedDepositOn: TODAY })).toEqual(["Registrado"]);
    // Depositado, o con la disputa abierta, ya no está por caer: no está atrasado.
    expect(stamps({ ...registrado, status: "depositado", estimatedDepositOn: "2026-11-19" })).toEqual(["Depositado"]);
    expect(stamps({ ...registrado, disputeState: "abierta", estimatedDepositOn: "2026-11-19" })).toEqual([
      "En disputa",
    ]);
  });
});
