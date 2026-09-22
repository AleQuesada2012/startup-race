import { expect, test } from '@playwright/test'

test('players can see the public Room entry points', async ({ page }) => {
  await page.goto('/')

  await expect(
    page.getByRole('heading', { level: 1, name: 'Startup Race' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Crear una sala' }),
  ).toBeEnabled()
  await expect(
    page.getByRole('button', { name: 'Unirme con un código' }),
  ).toBeEnabled()
})
