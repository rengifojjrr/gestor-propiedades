/**
 * Recorrido guiado de 8 pasos, de punta a punta, a 390×844 y a 1280×800 (Chrome del sistema).
 */
import { expect, test, type Page } from '@playwright/test';

async function next(page: Page, step: number) {
  await page.getByTestId('tour-siguiente').click();
  await expect(page.getByTestId('tour-paso')).toContainText(`paso ${step} de 8`);
}

async function doIt(page: Page) {
  await page.getByTestId('tour-hazlo').click();
  await expect(page.getByTestId('tour-siguiente')).toBeEnabled({ timeout: 30_000 });
}

test('recorrido guiado: de la salida de la huésped al gasto en finanzas', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByText('Entrar como…')).toBeVisible();
  await page.getByTestId('iniciar-recorrido').click();

  // 1 · Panel del propietario
  await expect(page.getByTestId('tour-paso')).toContainText('paso 1 de 8');
  await expect(page.getByTestId('panel-propietario')).toBeVisible();
  await expect(page.getByTestId('ganancia-neta').first()).toBeVisible();

  // 2 · Ficha de la propiedad
  await next(page, 2);
  await expect(page).toHaveURL(/#\/propiedades\/p-miami$/);
  await expect(page.getByTestId('ficha-propiedad')).toBeVisible();

  // 3 · La reserva que termina hoy: se registra la salida a mano, en la pantalla
  await next(page, 3);
  await expect(page.getByTestId('detalle-reserva')).toBeVisible();
  await page.getByRole('button', { name: 'Minimizar el recorrido' }).click();
  await page.getByTestId('registrar-salida').click();
  const confirmButton = page.getByRole('dialog').getByRole('button', { name: /confirmar|registrar/i });
  if (await confirmButton.isVisible().catch(() => false)) await confirmButton.click();
  await page.getByTestId('tour-abrir').click();
  await expect(page.getByTestId('tour-siguiente')).toBeEnabled({ timeout: 20_000 });

  // 4 · La limpieza de salida se creó sola
  await next(page, 4);
  await expect(page.getByTestId('detalle-limpieza')).toBeVisible();

  // 5 · Rosa: checklist con fotos y un daño (con «Hazlo por mí»)
  await next(page, 5);
  await expect(page).toHaveURL(/#\/limpieza\/tarea\//);
  await doIt(page);
  await expect(page.getByTestId('tour-texto')).toContainText('orden urgente');

  // 6 · El daño ya es una orden urgente
  await next(page, 6);
  await expect(page.getByTestId('detalle-orden')).toBeVisible();
  await expect(page.getByTestId('detalle-orden')).toContainText(/urgente/i);

  // 7 · Tomás la resuelve con foto y costo
  await next(page, 7);
  await expect(page).toHaveURL(/#\/tecnico\/orden\//);
  await doIt(page);

  // 8 · El gasto aparece y la ganancia baja
  await next(page, 8);
  await expect(page.getByTestId('tour-texto')).toContainText('pasó de');
  await expect(page.getByTestId('tour-texto')).toContainText('$240');
  await expect(page.getByTestId('panel-propietario')).toBeVisible();
  await page.getByTestId('tour-terminar').click();
  await expect(page.getByTestId('tour-panel')).toHaveCount(0);

  // El gasto está en Finanzas → movimientos
  await page.goto('./#/finanzas/movimientos');
  await expect(page.getByText(/Fuga debajo del lavamanos/).first()).toBeVisible();
});

test('cada rol entra a su app y no llega a lo prohibido', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('entrar-u-clean-1').click();
  await expect(page.getByTestId('app-limpieza')).toBeVisible();
  await page.goto('./#/finanzas');
  await expect(page).toHaveURL(/#\/limpieza$/);

  await page.getByTestId('cambiar-rol').click();
  await page.getByTestId('entrar-u-guest').click();
  await expect(page.getByTestId('app-huesped')).toBeVisible();
  await expect(page.getByTestId('codigos')).toContainText('7316');
  await page.goto('./#/reservas');
  await expect(page).toHaveURL(/#\/huesped$/);

  await page.getByTestId('cambiar-rol').click();
  await page.getByTestId('entrar-u-tenant').click();
  await expect(page.getByTestId('app-inquilino')).toBeVisible();

  await page.getByTestId('cambiar-rol').click();
  await page.getByTestId('entrar-u-support').click();
  await page.goto('./#/finanzas');
  await expect(page).toHaveURL(/#\/panel$/);
});
