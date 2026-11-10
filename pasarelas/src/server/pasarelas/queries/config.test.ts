import { describe, expect, test } from "vitest";
import type { Db } from "../dto";
import { loadPayConfig } from "./config";

/** Un cliente falso mínimo: cualquier lectura, de la tabla que sea, responde `response`. */
function clientAnswering(response: object): Db {
  const query: object = new Proxy(
    {},
    {
      get: (_target, method) =>
        method === "then" ? (resolve: (response: unknown) => void) => resolve(response) : () => query,
    },
  );
  return { from: () => query } as unknown as Db;
}

describe("loadPayConfig", () => {
  test("una lectura que llega sin el total de filas (`count`) lanza: no se da por completa", async () => {
    await expect(loadPayConfig(clientAnswering({ data: [], count: null }))).rejects.toThrow(/sin el total de filas/);
  });

  test("con su total, una configuración vacía se lee sin más", async () => {
    const cfg = await loadPayConfig(clientAnswering({ data: [], count: 0 }));
    expect(cfg.companies).toEqual([]);
    expect(cfg.gateways).toEqual([]);
  });
});
