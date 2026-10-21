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

test('organization stays in topbar while its events navigate from the sidebar', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: 'เข้าสู่ workspace ตัวอย่าง' }).click();
  const org = page.locator('.topbar').getByRole('combobox', { name: 'Organization', exact: true });
  const events = page.getByRole('navigation', { name: 'Organization events', exact: true });
  await expect(page.locator('.topbar').getByRole('combobox')).toHaveCount(1);
  await expect(events.getByLabel('Search organization events')).toHaveCount(0);
  await events.getByRole('button', { name: 'เลือก Event', exact: true }).click();
  await events.getByLabel('Search organization events').fill('DESIGN26');
  await events.getByRole('link', { name: 'Designing what comes next' }).click();
  await expect(page).toHaveURL(/\/orgs\/studio\/events\/design-2026$/);
  await org.fill('Community');
  await page.getByRole('option', { name: 'Community Lab' }).click();
  await expect(events.getByRole('link', { name: 'Designing what comes next' })).toHaveCount(0);
  await events.getByRole('button', { name: 'เลือก Event', exact: true }).click();
  await events.getByRole('link', { name: 'Community open day' }).click();
  await expect(page).toHaveURL(/\/orgs\/community\/events\/community-day$/);
  await expect(events.getByRole('button', { name: 'เลือก Event', exact: true })).toContainText(
    'Community open day',
  );
  await expect(events.getByRole('button', { name: 'เลือก Event', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'เปิดเมนู', exact: true }).click();
  await events.getByRole('button', { name: 'เลือก Event', exact: true }).click();
  await events.getByRole('link', { name: 'Community open day' }).click();
  await expect(events).not.toBeVisible();
});
