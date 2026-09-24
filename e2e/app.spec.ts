import { expect, test } from '@playwright/test';

test('Compose app serves the API docs and seeded restaurant', async ({ page }) => {
  await page.goto('/docs');
  await expect(page).toHaveTitle(/Swagger UI/i);

  await page.goto('/api/restaurants/demo-restaurant');
  await expect(page.locator('body')).toContainText('Demo Restaurant');
});
