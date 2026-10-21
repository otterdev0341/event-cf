import { test, expect } from '@playwright/test';
import { workspace } from './fixtures';
test('schedule consent, Bangkok time, persistence and cancellation use real API', async ({ page }) => {
  const { path, headers } = await workspace(page);
  const preview = await page.request.post('api/v1/' + path + '/imports', {
    headers,
    data: {
      rows: [
        {
          phone: '+66812220001',
          first_name: 'Schedule',
          last_name: 'Person',
          nickname: '',
          lang_code: 'th',
          event_code: 'REAL',
          event_date: '2027-01-01',
        },
      ],
    },
  });
  const id = (await preview.json()).id;
  expect(
    (
      await page.request.post('api/v1/' + path + '/imports/' + id + '/commit', {
        headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
      })
    ).ok(),
  ).toBe(true);
  await page.goto(path + '/schedules');
  await page.getByRole('button', { name: 'สร้างตารางโทร', exact: true }).click();
  await page.getByLabel('วันที่เริ่ม', { exact: true }).fill('2099-01-01');
  await page.getByLabel('เวลา Bangkok', { exact: true }).fill('09:30');
  await page.getByLabel('ความถี่', { exact: true }).selectOption('weekly');
  await page.getByLabel('จันทร์', { exact: true }).check();
  await page.getByLabel('Schedule Person · +66812220001', { exact: true }).check();
  await page.getByRole('button', { name: 'บันทึกตารางโทร', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page
    .getByLabel('ฉันยืนยันให้เริ่มคิวอัตโนมัติตามวัน เวลา และรายชื่อที่เลือก', { exact: true })
    .check();
  await page.getByRole('button', { name: 'บันทึกตารางโทร', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: 'ทุกสัปดาห์' })).toContainText('จันทร์');
  const schedules = await (await page.request.get('api/v1/' + path + '/schedules')).json();
  expect(schedules).toHaveLength(1);
  expect(schedules[0].nextAt).toContain('02:30:00');
  expect((await (await page.request.get('api/v1/' + path + '/participants')).json())[0].attempts).toEqual([]);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'ยกเลิกตาราง', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'ทุกสัปดาห์' })).toContainText('ยกเลิกแล้ว');
  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: 'ทุกสัปดาห์' })).toContainText('ยกเลิกแล้ว');
});
