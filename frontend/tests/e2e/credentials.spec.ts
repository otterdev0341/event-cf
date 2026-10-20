import { test, expect, type Page } from '@playwright/test';
async function login(page: Page) {
  await page.goto('login');
  await page.getByLabel('Email', { exact: true }).fill('admin@otterheaven.com');
  await page.getByLabel('Password', { exact: true }).fill('passwordpassword');
  await page.getByRole('button', { name: 'เข้าสู่ workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Good moments start here.' })).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('link', { name: /^Agent access/ }).click();
}
test('create paired credentials, reveal once, mismatch and cascade revoke', async ({ page }) => {
  await login(page);
  const create = async (name: string, kind: 'org' | 'event') => {
    await page.getByRole('button', { name: 'Create credential', exact: true }).click();
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel('Credential type').selectOption(kind);
    if (kind === 'event') await page.getByLabel('Parent org credential').selectOption({ label: 'Org A' });
    await page.getByLabel('Expiry date').fill(kind === 'org' ? '2027-12-31' : '2027-06-30');
    await page.getByRole('button', { name: 'สร้าง key', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Copy your key once' })).toBeVisible();
    await expect(page.locator('dialog pre')).toContainText('demo_only_not_a_real_key_');
    await page.getByRole('button', { name: 'เก็บ key แล้ว' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('demo_only_not_a_real_key_');
  };
  await create('Org A', 'org');
  await create('Org B', 'org');
  await create('Event A', 'event');
  await page.getByLabel('Org credential', { exact: true }).selectOption({ label: 'Org A' });
  await page.getByLabel('Event credential', { exact: true }).selectOption({ label: 'Event A' });
  await page.getByRole('button', { name: 'Validate pair' }).click();
  await expect(page.getByRole('status')).toContainText('Credential pair ตรงกัน');
  await page.getByLabel('Org credential', { exact: true }).selectOption({ label: 'Org B' });
  await page.getByRole('button', { name: 'Validate pair' }).click();
  await expect(page.getByRole('alert')).toContainText('Credential pair ไม่ตรง');
  page.once('dialog', (d) => d.accept());
  await page
    .getByRole('row')
    .filter({ has: page.getByRole('heading', { name: 'Org A', exact: true }) })
    .getByRole('button', { name: 'Revoke' })
    .click();
  await expect(
    page.getByRole('row').filter({ has: page.getByRole('heading', { name: 'Event A', exact: true }) }),
  ).toContainText('revoked');
});
test('reset and invitation explicitly do not claim real delivery', async ({ page }) => {
  await page.goto('login');
  await page.getByRole('button', { name: 'ลืมรหัสผ่าน?' }).click();
  await page.getByLabel('Email', { exact: true }).fill('admin@otterheaven.com');
  await page.getByRole('button', { name: 'ขอลิงก์ตั้งรหัสผ่าน' }).click();
  await expect(page.getByRole('status')).toContainText('ไม่มีการส่งอีเมลจริง');
  await login(page);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('link', { name: /^Team management/ }).click();
  await page.getByRole('button', { name: 'Invite member' }).click();
  await page.getByLabel('Email', { exact: true }).fill('editor@example.test');
  await page.getByRole('button', { name: 'ส่งคำเชิญ' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'editor@example.test' })).toContainText('invited');
});
