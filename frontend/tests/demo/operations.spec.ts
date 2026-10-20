import { test, expect, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
const { Workbook } = ExcelJS;
async function enter(page: Page) {
  await page.goto('');
  await page.getByRole('button', { name: 'เข้าสู่ workspace ตัวอย่าง' }).click();
  await expect(page.locator('.event-name').first()).toBeVisible();
}
test('dashboard charts, searchable navigation, theme and team policy settings', async ({ page }) => {
  await enter(page);
  await page.getByLabel('Search organization events').fill('DESIGN26');
  await page.getByRole('navigation', { name: 'Organization events', exact: true }).getByRole('link').click();
  await expect(page.getByRole('img', { name: 'Outbound call attempts', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Tickets by assignee', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Weekly', exact: true }).click();
  await expect(page.getByText('8 สัปดาห์ล่าสุด เริ่มวันจันทร์', { exact: false })).toBeVisible();
  await page.screenshot({ path: 'test-results/operations-dashboard.png', fullPage: true });
  const nav = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  await expect(nav.getByRole('link', { name: 'Organization', exact: true })).toHaveCount(0);
  await nav.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'test-results/settings-dark.png', fullPage: true });
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await page.getByRole('link', { name: /^Team management/ }).click();
  const member = page.getByRole('row').filter({ hasText: 'operations@example.test' });
  await member.getByRole('button', { name: 'Edit role' }).click();
  await page.getByLabel('Role', { exact: true }).selectOption('event_admin');
  await page.getByRole('button', { name: 'Save policy' }).click();
  await expect(member).toContainText('Event admin');
  await page.getByRole('combobox', { name: 'Organization', exact: true }).fill('nothing-matches');
  await expect(page.getByRole('listbox')).toContainText('ไม่พบรายการ');
  await page.getByRole('combobox', { name: 'Organization', exact: true }).press('Escape');
});
test('four-column board drag/drop, multiple assignees and table share state', async ({ page }) => {
  await enter(page);
  await page.getByRole('link', { name: 'Follow-up board', exact: true }).click();
  const title = 'สอบถามเมนูสำหรับผู้แพ้อาหาร';
  await expect(page.locator('.board .column')).toHaveCount(4);
  await page
    .locator('.ticket-card')
    .filter({ hasText: title })
    .dragTo(page.getByRole('region', { name: 'Waiting', exact: true }));
  await expect(
    page.getByRole('region', { name: 'Waiting', exact: true }).getByRole('button', { name: title }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: title })).toBeEnabled();
  await page.getByRole('button', { name: title }).click();
  await page.getByRole('checkbox', { name: 'operations@example.test' }).check();
  await page.getByRole('checkbox', { name: 'support@example.test' }).check();
  await page.getByRole('button', { name: 'บันทึกการติดตาม' }).click();
  await page.getByRole('button', { name: 'Table view' }).click();
  const row = page
    .getByRole('table', { name: 'Follow-up tickets' })
    .getByRole('row')
    .filter({ hasText: title });
  await expect(row).toContainText('operations@example.test, support@example.test');
  await row.getByRole('combobox').selectOption('resolved');
  await page.getByRole('button', { name: 'Board view' }).click();
  await expect(
    page.getByRole('region', { name: 'Done', exact: true }).getByRole('button', { name: title }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('knowledge category tab and latest-template import remain event-scoped drafts', async ({
  page,
}, info) => {
  await enter(page);
  await page.getByRole('link', { name: 'Knowledge & FAQ', exact: true }).click();
  await page.getByRole('tab', { name: 'หมวดหมู่', exact: true }).click();
  await page.getByRole('button', { name: 'เพิ่มหมวดหมู่', exact: true }).click();
  await page.getByLabel('ชื่อหมวดหมู่', { exact: true }).fill('Accessibility');
  await page.getByRole('button', { name: 'บันทึกหมวดหมู่' }).click();
  await page
    .getByRole('row')
    .filter({ hasText: 'Accessibility' })
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await page.getByLabel('ชื่อหมวดหมู่', { exact: true }).fill('Access');
  await page.getByRole('button', { name: 'บันทึกหมวดหมู่' }).click();
  await page.getByRole('tab', { name: 'Template / Import' }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download knowledge template' }).click();
  const file = info.outputPath('template.xlsx');
  await (await downloaded).saveAs(file);
  const book = new Workbook();
  await book.xlsx.readFile(file);
  expect(book.getWorksheet('Categories')!.getColumn(1).values).toContain('Access');
  const faq = book.getWorksheet('FAQ')!;
  faq.getRow(2).values = ['WRONG', 'Access', 'Accessible entrance?', 'Ground floor.'];
  const upload = async () =>
    page.getByLabel('Upload knowledge template', { exact: true }).setInputFiles({
      name: 'knowledge.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(await book.xlsx.writeBuffer()),
    });
  await upload();
  await expect(page.getByRole('alert')).toContainText('event_code');
  faq.getRow(2).values = ['DESIGN26', 'Access', 'Accessible entrance?', 'Ground floor.'];
  await upload();
  await page.getByRole('button', { name: 'ยืนยันนำเข้า 1 FAQ' }).click();
  await page.getByRole('tab', { name: 'Draft workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Accessible entrance?' })).toBeVisible();
  await page.getByRole('tab', { name: 'Agent published preview' }).click();
  await expect(page.getByRole('heading', { name: 'Accessible entrance?' })).toHaveCount(0);
});
test('retry limit stops exhausted mock rows and swagger renders local JSON', async ({ page }) => {
  await enter(page);
  await page.getByRole('link', { name: 'Call queues', exact: true }).click();
  await page.getByRole('button', { name: 'ปรับสัดส่วน' }).click();
  await page.getByLabel('Maximum retries', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'ยืนยันเปลี่ยนสัดส่วน' }).click();
  await page.getByRole('tab', { name: 'Fail / retry queue' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'นนท์' })).toContainText('stopped');
  await page.goto('swagger-ui/');
  await expect(page.locator('.swagger-ui .info .title')).toContainText('Event Confirm API');
  await expect(page.locator('.opblock').first()).toBeVisible();
  const spec = await page.request.get('swagger-ui/openapi.json');
  expect(spec.ok()).toBe(true);
  const document = await spec.json();
  expect(document.paths).toHaveProperty('/orgs/{org}/events/{event}/knowledge-import');
  expect(document.paths['/auth/login'].post.requestBody).toBeDefined();
  expect(JSON.stringify(document)).not.toContain('\"$ref\"');
});
