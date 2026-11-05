/**
 * Comprobación de la página publicada: `npm run test:live` (usa BASE_URL con el link de GitHub Pages).
 * Abre el link a 390 px, entra como Propietario, Limpieza y Huésped, y guarda capturas en test-results/.
 */
import { expect, test } from '@playwright/test';

test.skip(!process.env.BASE_URL, 'Solo con BASE_URL (página publicada).');

test('la página publicada abre y cada rol entra a su app', async ({ page }, info) => {
  test.skip(info.project.name !== 'movil-390', 'Basta con el teléfono.');
  const res = await page.goto('./');
  expect(res?.status()).toBe(200);
  await expect(page.getByText('Entrar como…')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('entrada.png'), fullPage: true });

  await page.getByTestId('entrar-u-owner').click();
  await expect(page.getByTestId('panel-propietario')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('propietario.png'), fullPage: true });

  await page.getByTestId('cambiar-rol').click();
  await page.getByTestId('entrar-u-clean-1').click();
  await expect(page.getByTestId('app-limpieza')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('limpieza.png'), fullPage: true });

  await page.getByTestId('cambiar-rol').click();
  await page.getByTestId('entrar-u-guest').click();
  await expect(page.getByTestId('app-huesped')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('huesped.png'), fullPage: true });
});
