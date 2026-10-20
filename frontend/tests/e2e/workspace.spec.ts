import { test, expect, type Page } from '@playwright/test';
async function login(page: Page) {
  await page.goto('login');
  await page.getByLabel('Email', { exact: true }).fill('admin@otterheaven.com');
  await page.getByLabel('Password', { exact: true }).fill('passwordpassword');
  await page.getByRole('button', { name: 'เข้าสู่ workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Good moments start here.' })).toBeVisible();
}
test('events, FAQ publish snapshot, tenant switch and read-only role', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Create event' }).click();
  await page.getByLabel('Event name').fill('Research gathering');
  await page.getByLabel('Event code').fill('RESEARCH26');
  await page.getByLabel('Event date').fill('2026-12-15');
  await page.getByLabel('Location', { exact: true }).fill('Bangkok');
  await page.getByRole('button', { name: 'บันทึก Event' }).click();
  await expect(page.getByText('Research gathering', { exact: true }).last()).toBeVisible();
  await page.getByRole('link', { name: 'Knowledge & FAQ' }).click();
  await page.getByRole('button', { name: 'เพิ่มคำถาม', exact: true }).click();
  await page.getByLabel('Question', { exact: true }).fill('Where is registration?');
  await page.getByLabel('Answer', { exact: true }).fill('At the main entrance.');
  await page.getByRole('button', { name: 'บันทึก draft' }).click();
  await page.getByRole('tab', { name: 'Agent published preview' }).click();
  await expect(page.getByRole('heading', { name: 'Where is registration?' })).toHaveCount(0);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Publish knowledge' }).click();
  await expect(page.getByRole('heading', { name: 'Where is registration?' })).toBeVisible();
  await page.getByLabel('Organization', { exact: true }).selectOption('community');
  await expect(page.getByRole('heading', { name: 'Where is registration?' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'เพิ่มคำถาม', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Agent access' }).click();
  await expect(page.getByRole('heading', { name: 'เฉพาะ Owner และ Admin' })).toBeVisible();
});
test('CSV import does not call; explicit start, pause and 5:1 policy', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Participants', exact: true }).click();
  await page.getByRole('button', { name: 'Upload participants' }).click();
  await page.getByLabel('ไฟล์ CSV / XLSX').setInputFiles({
    name: 'participants.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'phone,first_name,last_name,nickname,event_code,event_date\n0812345678,Tester,Example,Test,DESIGN26,2026-12-12',
    ),
  });
  await page.getByRole('button', { name: 'ยืนยันนำเข้า 1 รายชื่อ' }).click();
  await expect(page.getByText('Tester Example')).toBeVisible();
  await page.getByRole('link', { name: 'Call queues' }).click();
  await expect(page.getByText('idle', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'เริ่มคิวโทร', exact: true }).click();
  await page.getByRole('button', { name: 'ยืนยันเริ่มโทร' }).click();
  await page.getByRole('button', { name: 'Pause queue' }).click();
  await page.getByRole('button', { name: 'ปรับสัดส่วน' }).click();
  await page.getByRole('spinbutton').fill('5');
  await page.getByRole('button', { name: 'ยืนยันเปลี่ยนสัดส่วน' }).click();
  await expect(page.getByRole('heading', { name: '5 new calls : 1 retry' })).toBeVisible();
  await page.getByRole('tab', { name: 'Fail / retry queue' }).click();
  await expect(page.getByText('ไม่รับสาย (1 ครั้ง)')).toBeVisible();
});
test('ticket create, keyboard move, comment and assignment', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Follow-up board' }).click();
  await page.getByRole('button', { name: 'Create ticket' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Please call me tomorrow');
  await page.getByLabel('Type', { exact: true }).selectOption('callback');
  await page.getByLabel('Description').fill('Needs accessibility information');
  await page.getByRole('button', { name: 'สร้าง ticket' }).click();
  await page.getByLabel('Move Please call me tomorrow').selectOption('in_progress');
  await expect(
    page.getByRole('region', { name: 'In progress', exact: true }).getByText('Please call me tomorrow'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Please call me tomorrow' }).click();
  await page.getByLabel('Assignee').fill('Operations');
  await page.getByLabel('Comment', { exact: true }).fill('Following up tomorrow morning.');
  await page.getByRole('button', { name: 'บันทึกการติดตาม' }).click();
  await expect(page.getByText('Operations', { exact: true })).toBeVisible();
});
test('mobile login, navigation and deep link render without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole('button', { name: 'เปิดเมนู' }).click();
  await page.getByRole('link', { name: 'Follow-up board' }).click();
  await expect(page.getByRole('heading', { name: 'Some things need a person.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'สอบถามเมนูสำหรับผู้แพ้อาหาร' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-board.png', fullPage: true });
});
