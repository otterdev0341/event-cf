import { test, expect } from '@playwright/test';

test('real login and event settings persist through reload without mock fallback', async ({ page }) => {
  const email = process.env.TEST_ADMIN_EMAIL;
  const password = process.env.TEST_ADMIN_PASSWORD;
  if (!email || !password) throw new Error('Explicit test account required');
  const headers = { 'X-Requested-With': 'EventConfirm' };
  const login = await page.request.post('api/v1/auth/login', { headers, data: { email, password } });
  expect(login.ok()).toBe(true);
  const name = 'Browser ' + Date.now();
  const created = await page.request.post('api/v1/organizations', { headers, data: { name } });
  expect(created.ok()).toBe(true);
  const profile = await created.json();
  const org = profile.organizations.find((item: { name: string }) => item.name === name).id;
  const eventResponse = await page.request.post('api/v1/orgs/' + org + '/events', {
    headers,
    data: { name: 'Browser event', code: 'BROWSER', date: '2027-01-01', location: 'Test', description: '' },
  });
  expect(eventResponse.ok()).toBe(true);
  const event = (await eventResponse.json()).id;
  await page.context().clearCookies();
  await page.goto('orgs/' + org + '/events/' + event);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ workspace', exact: true }).click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('สายใหม่ต่อรอบ', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: /^Calling policy/ }).click();
  await page.getByLabel('สายใหม่ต่อรอบ', { exact: true }).fill('3');
  await page.getByLabel('สายโทรซ้ำต่อรอบ', { exact: true }).fill('2');
  await page.getByLabel('Maximum retries', { exact: true }).fill('0');
  const saved = page.waitForResponse((r) => r.url().endsWith('/queue-policy') && r.status() === 200);
  await page.getByRole('button', { name: 'ยืนยันเปลี่ยนสัดส่วน' }).click();
  await saved;
  await page.reload();
  await expect(page.getByLabel('สายใหม่ต่อรอบ', { exact: true })).toHaveValue('3');
  await expect(page.getByLabel('สายโทรซ้ำต่อรอบ', { exact: true })).toHaveValue('2');
  await expect(page.getByLabel('Maximum retries', { exact: true })).toHaveValue('0');
  await expect(page.getByText('UI DEMO', { exact: false })).toHaveCount(0);
  await page.getByRole('link', { name: 'Knowledge & FAQ', exact: true }).click();
  await page.getByRole('tab', { name: 'หมวดหมู่', exact: true }).click();
  await page.getByRole('button', { name: 'เพิ่มหมวดหมู่', exact: true }).click();
  await page.getByLabel('ชื่อหมวดหมู่', { exact: true }).fill('ข้อมูล/สถานที่');
  await page.getByRole('button', { name: 'บันทึกหมวดหมู่' }).click();
  const row = page.getByRole('row').filter({ hasText: 'ข้อมูล/สถานที่' });
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('ชื่อหมวดหมู่', { exact: true }).fill('เดินทาง');
  await page.getByRole('button', { name: 'บันทึกหมวดหมู่' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'เดินทาง' })).toBeVisible();
});
