import { test, expect } from '@playwright/test';
test('built public demo opens sample workspace without credentials or backend', async ({ page }) => {
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/')) apiRequests.push(request.url());
  });
  await page.goto('');
  await page.getByRole('button', { name: 'เข้าสู่ workspace ตัวอย่าง' }).click();
  await expect(page).toHaveURL(/\/events$/);
  await expect(page.locator('.preview-bar')).toContainText('UI DEMO');
  await expect(page.locator('.event-name').filter({ hasText: 'Designing what comes next' })).toBeVisible();
  expect(apiRequests).toEqual([]);
  await page.reload();
  await expect(page.getByRole('button', { name: 'เข้าสู่ workspace ตัวอย่าง' })).toBeVisible();
});
