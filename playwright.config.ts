import { defineConfig } from '@playwright/test';

/**
 * Pruebas de punta a punta con el Chrome del sistema (channel: 'chrome'), sin descargar navegadores.
 * Por defecto corren contra `vite preview`. Con BASE_URL=<link publicado> corren contra la página en vivo.
 */
const LOCAL_URL = 'http://localhost:4173/gestor-propiedades/';
const BASE_URL = process.env.BASE_URL ?? LOCAL_URL;
const isLocal = BASE_URL === LOCAL_URL;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    channel: 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'es-ES',
  },
  projects: [
    { name: 'movil-390', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'escritorio-1280', use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: isLocal
    ? { command: 'npm run preview', url: LOCAL_URL, reuseExistingServer: true, timeout: 120_000 }
    : undefined,
});
