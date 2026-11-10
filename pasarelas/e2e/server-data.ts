import { createRequire } from "node:module";

/**
 * La capa de datos del servidor (`src/server/pasarelas`), para preparar datos desde una prueba de punta a punta con
 * el cliente del usuario de prueba (`signInAal1`): lo mismo que usan las acciones, con las mismas restricciones.
 *
 * Esos módulos importan `server-only`, que lanza fuera de un Server Component. Aquí no hay React, así que se deja
 * cargado vacío antes de traerlos (es lo que hace `vitest.setup.ts` en las pruebas de integración). Se cargan con
 * `require` y rutas relativas: el alias `@/` no se resuelve con `import()` dinámico dentro de Playwright.
 */

type TransactionsOps = typeof import("../src/server/pasarelas/ops/transactions");
type TransactionsQueries = typeof import("../src/server/pasarelas/queries/transactions");

export type ServerData = TransactionsOps & TransactionsQueries;

export function serverData(): ServerData {
  const load = createRequire(__filename);
  const serverOnly = load.resolve("server-only");
  load.cache[serverOnly] ??= { id: serverOnly, filename: serverOnly, loaded: true, exports: {} } as NodeJS.Module;
  return {
    ...(load("../src/server/pasarelas/ops/transactions") as TransactionsOps),
    ...(load("../src/server/pasarelas/queries/transactions") as TransactionsQueries),
  };
}

type DemoData = typeof import("../scripts/demo-data");

/** La semilla demo (`scripts/demo-data.ts`): también importa módulos `server-only`, así que se carga igual. */
export function demoData(): DemoData {
  const load = createRequire(__filename);
  const serverOnly = load.resolve("server-only");
  load.cache[serverOnly] ??= { id: serverOnly, filename: serverOnly, loaded: true, exports: {} } as NodeJS.Module;
  return load("../scripts/demo-data") as DemoData;
}
