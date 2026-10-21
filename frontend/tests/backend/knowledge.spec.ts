import { test, expect } from '@playwright/test';
import { workspace } from './fixtures';

test('real FAQ timestamps render after save publish reload and draft edit', async ({ page }) => {
  const { path, headers } = await workspace(page);
  const category = await page.request.post('api/v1/' + path + '/categories', {
    headers,
    data: { name: 'Travel', expectedRevision: 1 },
  });
  expect(category.ok()).toBe(true);
  await page.goto(path + '/knowledge');
  await page.getByRole('button', { name: 'เพิ่มคำถาม', exact: true }).click();
  await page.getByLabel('Question', { exact: true }).fill('Where is the venue?');
  await page.getByLabel('Answer', { exact: true }).fill('Main hall');
  await page.getByRole('button', { name: 'บันทึก draft', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Where is the venue?', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Publish knowledge', exact: true }).click();
  await page.getByRole('tab', { name: 'Agent published preview', exact: true }).click();
  await expect(page.locator('.faq-item')).toContainText('Main hall');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Where is the venue?', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'แก้ไข Where is the venue?', exact: true }).click();
  await page.getByLabel('Answer', { exact: true }).fill('Second hall');
  await page.getByRole('button', { name: 'บันทึก draft', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.faq-item')).toContainText('Second hall');
  await page.getByRole('tab', { name: 'Agent published preview', exact: true }).click();
  await expect(page.locator('.faq-item')).toContainText('Main hall');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
