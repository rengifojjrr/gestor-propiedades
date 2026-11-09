import { existsSync, readFileSync } from "node:fs";
import { defineConfig } from "@playwright/test";

/**
 * Pruebas de punta a punta contra el Supabase LOCAL.
 *
 * Por defecto compila y arranca la app en el puerto 3100 (`next build && next start`).
 * Con E2E_BASE_URL=http://127.0.0.1:<puerto> usa un servidor que ya esté corriendo (p. ej. `next dev -p 3110`).
 */
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && match[1] && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2] ?? "";
    }
  }
}

const PORT = Number(process.env.E2E_PORT ?? 3100);
const LOCAL_URL = `http://127.0.0.1:${PORT}`;
const BASE_URL = process.env.E2E_BASE_URL ?? LOCAL_URL;

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    locale: "es-ES",
    timezoneId: "America/New_York",
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "movil", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "escritorio", use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm run build && npm run start -- -p ${PORT}`,
        url: `${LOCAL_URL}/login`,
        reuseExistingServer: true,
        timeout: 300_000,
      },
});
