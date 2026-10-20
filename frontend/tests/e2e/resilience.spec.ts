import { test, expect, type Page } from '@playwright/test';
async function login(page: Page) {
  await page.goto('login');
  await page.getByLabel('Email', { exact: true }).fill('admin@otterheaven.com');
  await page.getByLabel('Password', { exact: true }).fill('passwordpassword');
  await page.getByRole('button', { name: 'เข้าสู่ workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Good moments start here.' })).toBeVisible();
}
test('invalid imports cannot commit and preserve row errors', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Participants', exact: true }).click();
  await page.getByRole('button', { name: 'Upload participants' }).click();
  await page.getByLabel('ไฟล์ CSV / XLSX').setInputFiles({
    name: 'invalid.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'phone,first_name,last_name,nickname,event_code,event_date,lang_code\n0812345678,Jane,Doe,,WRONG,2026-12-12,th',
    ),
  });
  await expect(page.getByRole('alert')).toContainText('รหัสหรือวันที่ไม่ตรง');
  await expect(page.getByRole('button', { name: 'ยืนยันนำเข้า 1 รายชื่อ' })).toBeDisabled();
});
test('stale Kanban move rolls back and reloads authoritative state', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Follow-up board' }).click();
  const title = 'สอบถามเมนูสำหรับผู้แพ้อาหาร';
  await expect(page.getByLabel(`Move ${title}`)).toBeVisible();
  await page.evaluate(async () => {
    const source = '/event-confirm/src/mocks/state.ts';
    const { state } = await import(source);
    state.tickets[0].version++;
  });
  await page.getByLabel(`Move ${title}`).selectOption('resolved');
  await expect(page.getByRole('alert')).toContainText('ข้อมูลเปลี่ยนแล้ว');
  await expect(page.getByLabel(`Move ${title}`)).toHaveValue('open');
});
test('dialog keyboard focus, discard confirmation and desktop layout', async ({ page }) => {
  await login(page);
  await page.screenshot({ path: 'test-results/desktop-events.png', fullPage: true });
  const trigger = page.getByRole('button', { name: 'Create event' });
  await trigger.click();
  await expect(page.getByLabel('Event name')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByLabel('Event name').fill('Unsaved event');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('direct route survives login', async ({ page }) => {
  await page.goto('tickets');
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill('admin@otterheaven.com');
  await page.getByLabel('Password', { exact: true }).fill('passwordpassword');
  await page.getByRole('button', { name: 'เข้าสู่ workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Some things need a person.' })).toBeVisible();
});
test('organization creation, invitation and scoped event links', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('link', { name: /^Organization/ }).click();
  await page.getByRole('button', { name: 'Create organization' }).click();
  await page.getByLabel('Organization name').fill('New team');
  await page.getByRole('button', { name: 'สร้างองค์กร' }).click();
  await expect(page.getByLabel('Organization', { exact: true })).toHaveValue('New team');
  await expect(page.getByRole('heading', { name: 'ยังไม่มีอีเวนท์ที่ตรงกับการค้นหา' })).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('link', { name: /^Organization/ }).click();
  await page.getByLabel('Invitation token').fill('expired');
  await page.getByRole('button', { name: 'รับคำเชิญ' }).click();
  await expect(page.getByRole('alert')).toContainText('คำเชิญหมดอายุ');
  await page.getByLabel('Invitation token').fill('preview-invite');
  await page.getByRole('button', { name: 'รับคำเชิญ' }).click();
  await expect(page.getByRole('heading', { name: 'Invited workspace' })).toBeVisible();
});
test('reset-token validation and a canonical event deep link', async ({ page }) => {
  await page.goto('reset-password?token=expired');
  await page.getByLabel('New password', { exact: true }).fill('NewPreview123!');
  await page.getByLabel('Confirm password').fill('NewPreview123!');
  await page.getByRole('button', { name: 'ตั้งรหัสผ่านใหม่' }).click();
  await expect(page.getByRole('alert')).toContainText('ลิงก์หมดอายุ');
  await page.goto('orgs/studio/events/design-2026/knowledge');
  await page.getByLabel('Email', { exact: true }).fill('admin@otterheaven.com');
  await page.getByLabel('Password', { exact: true }).fill('passwordpassword');
  await page.getByRole('button', { name: 'เข้าสู่ workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Answers, before they ask.' })).toBeVisible();
});
