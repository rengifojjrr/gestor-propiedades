import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

/**
 * Dos proyectos:
 *  - unit: pruebas puras, junto al código (src/**\/*.test.ts). Rápidas, sin red ni base. `npm test`.
 *  - integration: contra el Supabase LOCAL (tests/integration). En serie. `npm run test:int`.
 *
 * La cobertura se mide sobre el motor (src/lib/pasarelas) y exige el 100 %.
 */
export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
          setupFiles: ["vitest.setup.ts"],
          env: { TZ: "UTC" },
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["vitest.setup.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 120_000,
          env: { TZ: "UTC" },
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/lib/pasarelas/**/*.ts"],
      exclude: ["src/lib/pasarelas/**/*.test.ts", "src/lib/pasarelas/types.ts", "src/lib/pasarelas/index.ts"],
      reporter: ["text", "html"],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
});
