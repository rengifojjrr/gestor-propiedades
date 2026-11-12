import { describe, expect, it } from "vitest";
import type { CompanyTotal } from "@/server/pasarelas/queries/companies";
import { companyTxHref } from "./txHref";

const ID = "11111111-1111-4111-8111-111111111111";
const TODAY = "2026-11-10";

const total = (currency: string, firstOn: string, lastOn: string): CompanyTotal => ({
  currency,
  count: 1,
  gross: "100.00",
  sale: "100.00",
  fees: "9.70",
  buyerFees: "0.00",
  net: "90.30",
  firstOn,
  lastOn,
});

describe("companyTxHref («Ver sus cobros»)", () => {
  it("abre todo su historial: desde su primer cobro hasta hoy", () => {
    expect(companyTxHref(ID, [total("USD", "2025-01-15", "2026-11-02")], TODAY)).toBe(
      `/pasarelas/cobros?empresa=${ID}&periodo=personalizado&desde=2025-01-15&hasta=2026-11-10`,
    );
  });

  it("con varias monedas, desde el primero de todos; con un cobro a futuro, hasta ese día", () => {
    const totals = [total("EUR", "2026-03-01", "2026-12-20"), total("USD", "2024-07-04", "2026-10-01")];
    expect(companyTxHref(ID, totals, TODAY)).toBe(
      `/pasarelas/cobros?empresa=${ID}&periodo=personalizado&desde=2024-07-04&hasta=2026-12-20`,
    );
  });

  it("sin cobros, la lista de la empresa sin período", () => {
    expect(companyTxHref(ID, [], TODAY)).toBe(`/pasarelas/cobros?empresa=${ID}`);
  });
});
