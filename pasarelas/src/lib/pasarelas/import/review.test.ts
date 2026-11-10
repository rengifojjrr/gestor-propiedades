import { describe, expect, test } from "vitest";
import type { ImportRow } from "./mapping";
import { classifyRepeats, depositedOnImport, type ManualTx } from "./review";

/** Una fila ya convertida: 100,00 USD el 13/11/2026. */
const fila = (line: number, reference: string, extra: Partial<ImportRow> = {}): ImportRow => ({
  line,
  reference,
  occurredAt: "2026-11-13T15:30:00.000Z",
  occurredOn: "2026-11-13",
  grossOriginal: "100.00",
  currency: "USD",
  reportedFee: null,
  note: null,
  ...extra,
});

/** Un cobro registrado a mano: 100,00 USD el 13/11/2026, sin referencia. */
const aMano = (id: string, extra: Partial<ManualTx> = {}): ManualTx => ({
  id,
  reference: null,
  currency: "USD",
  grossOriginal: "100.00",
  occurredOn: "2026-11-13",
  ...extra,
});

describe("classifyRepeats", () => {
  test("sin nada guardado, todo es nuevo y en el orden del archivo", () => {
    const rows = [fila(2, "ch_1"), fila(3, "ch_2")];
    expect(classifyRepeats(rows, [], [])).toEqual({ fresh: rows, repeated: [], trashed: [], possible: [] });
  });

  test("la misma referencia en un cobro activo es repetido; en uno de la papelera, va aparte", () => {
    const rows = [fila(2, "ch_1"), fila(3, "ch_2"), fila(4, "ch_3")];
    const existing = [
      { reference: "ch_1", trashed: false },
      { reference: "ch_3", trashed: true },
    ];
    expect(classifyRepeats(rows, existing, [])).toEqual({
      fresh: [rows[1]],
      repeated: [rows[0]],
      trashed: [rows[2]],
      possible: [],
    });
  });

  test("posible repetido: un cobro a mano de la misma moneda y el mismo bruto, a un día como mucho", () => {
    const rows = [
      fila(2, "txn_1"),
      fila(3, "txn_2", { occurredOn: "2026-11-14" }),
      fila(4, "txn_3", { occurredOn: "2026-11-15" }),
      fila(5, "txn_4", { grossOriginal: "100.01" }),
      fila(6, "txn_5", { currency: "EUR" }),
    ];
    const manual = [
      aMano("a"),
      aMano("b", { occurredOn: "2026-11-15", reference: "ch_mano" }),
      aMano("c", { occurredOn: "2026-11-12" }),
    ];
    const r = classifyRepeats(rows, [], manual);
    // txn_1 con «a» (mismo día); txn_2 con «b» (a un día; la referencia del cobro a mano es otra);
    // txn_3 ya no tiene con quién: «b» está tomado y «a»/«c» quedan a más de un día.
    expect(r.possible).toEqual([
      { row: rows[0], match: manual[0] },
      { row: rows[1], match: manual[1] },
    ]);
    expect(r.fresh).toEqual([rows[2], rows[3], rows[4]]);
  });

  test("cada cobro a mano explica una sola fila, y se elige el más cercano en fecha", () => {
    const rows = [fila(2, "txn_1"), fila(3, "txn_2")];
    const manual = [aMano("lejos", { occurredOn: "2026-11-12" }), aMano("cerca")];
    const r = classifyRepeats(rows, [], manual);
    expect(r.possible).toEqual([
      { row: rows[0], match: manual[1] },
      { row: rows[1], match: manual[0] },
    ]);
    expect(r.fresh).toEqual([]);

    // En empate de distancia, el primero de la lista.
    const empate = [aMano("antes", { occurredOn: "2026-11-12" }), aMano("despues", { occurredOn: "2026-11-14" })];
    expect(classifyRepeats([rows[0]!], [], empate).possible).toEqual([{ row: rows[0], match: empate[0] }]);
  });

  test("un cobro con una referencia que trae el archivo no es «posible»: ese es el repetido de su fila", () => {
    const rows = [fila(2, "ch_1"), fila(3, "ch_2")];
    const manual = [aMano("x", { reference: "ch_1" })];
    const r = classifyRepeats(rows, [{ reference: "ch_1", trashed: false }], manual);
    expect(r).toEqual({ fresh: [rows[1]], repeated: [rows[0]], trashed: [], possible: [] });
  });

  test("lo repetido por referencia no se compara con lo hecho a mano", () => {
    const rows = [fila(2, "ch_1")];
    const r = classifyRepeats(rows, [{ reference: "ch_1", trashed: true }], [aMano("a")]);
    expect(r).toEqual({ fresh: [], repeated: [], trashed: [rows[0]], possible: [] });
  });
});

describe("depositedOnImport: con «estos cobros ya se depositaron»", () => {
  test("si la fecha estimada ya llegó (hasta hoy), entra depositado en esa fecha", () => {
    expect(depositedOnImport("2026-11-09", "2026-11-10", true)).toBe("2026-11-09");
    expect(depositedOnImport("2026-11-10", "2026-11-10", true)).toBe("2026-11-10");
  });

  test("si todavía no llega, o sin la opción, queda por caer", () => {
    expect(depositedOnImport("2026-11-11", "2026-11-10", true)).toBeNull();
    expect(depositedOnImport("2026-11-09", "2026-11-10", false)).toBeNull();
  });
});
