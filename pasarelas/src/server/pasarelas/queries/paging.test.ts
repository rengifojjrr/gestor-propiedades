import { describe, expect, test } from "vitest";
import { PAGE_SIZE, readAll } from "./paging";

/** Una lectura falsa de `total` filas (los números 0, 1, 2…) que anota los tramos que se le piden. */
function fakeRead(total: number, count: number | null = total) {
  const asked: [number, number][] = [];
  const page = async (from: number, to: number) => {
    asked.push([from, to]);
    const data = Array.from({ length: Math.max(0, Math.min(to, total - 1) - from + 1) }, (_, i) => from + i);
    return { data, count };
  };
  return { asked, page };
}

describe("readAll", () => {
  test("con menos de un tramo de filas hace una sola petición", async () => {
    const { asked, page } = fakeRead(3);
    expect(await readAll(page, "de prueba")).toEqual([0, 1, 2]);
    expect(asked).toEqual([[0, PAGE_SIZE - 1]]);
  });

  test("pide por tramos hasta tener las que dice el total", async () => {
    const { asked, page } = fakeRead(PAGE_SIZE + 5);
    const rows = await readAll(page, "de prueba");
    expect(rows).toHaveLength(PAGE_SIZE + 5);
    expect(rows.at(-1)).toBe(PAGE_SIZE + 4);
    expect(asked).toEqual([
      [0, PAGE_SIZE - 1],
      [PAGE_SIZE, 2 * PAGE_SIZE - 1],
    ]);
  });

  test("un tramo vacío termina la lectura aunque el total diga más", async () => {
    const { asked, page } = fakeRead(2, 10);
    expect(await readAll(page, "de prueba")).toEqual([0, 1]);
    expect(asked).toHaveLength(2);
  });

  test("un tramo sin el total de filas lanza, con el nombre de la lectura", async () => {
    const { page } = fakeRead(3, null);
    await expect(readAll(page, "de prueba")).rejects.toThrow(
      "Una lectura de prueba llegó sin el total de filas (count): no se sabe si están todas.",
    );
  });
});
