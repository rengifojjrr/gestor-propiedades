import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
  globalIgnores([
    // Los que eslint-config-next ignora por defecto:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Propios de este proyecto:
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "supabase/.temp/**",
    "src/lib/supabase/database.types.ts",
  ]),
]);

export default eslintConfig;
