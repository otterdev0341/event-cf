import { test, expect } from '@playwright/test';
import { workspace } from './fixtures';

test('CSV preview and commit persist without dispatch; tickets survive reload and stage updates', async ({
  page,
}) => {
  const { path } = await workspace(page);
  await page.goto(path + '/participants');
  await page.getByRole('button', { name: 'Upload participants', exact: true }).click();
  await page.getByLabel('ไฟล์ CSV / XLSX').setInputFiles({
    name: 'participants.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'phone,first_name,last_name,nickname,event_code,event_date,lang_code\n+66812345678,Integration,Person,,REAL,2027-01-01,en\n',
    ),
  });
  await expect(page.getByText('1 ROWS · 0 ERRORS')).toBeVisible();
  await page.getByRole('button', { name: 'ยืนยันนำเข้า 1 รายชื่อ' }).click();
  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: 'Integration Person' })).toContainText('ยังไม่โทร');
  const participants = await page.request.get('api/v1/' + path + '/participants');
  expect((await participants.json())[0].attempts).toEqual([]);
  await page.goto(path + '/tickets');
  await page.getByRole('button', { name: 'Create ticket', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Real persisted follow-up');
  await page.getByLabel('Description', { exact: true }).fill('Verify saved ticket via browser');
  await page.getByRole('button', { name: 'สร้าง ticket', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Real persisted follow-up', exact: true })).toBeVisible();
  await page.getByLabel('Move Real persisted follow-up').selectOption('waiting');
  await expect(page.getByLabel('Move Real persisted follow-up')).toHaveValue('waiting');
  await page.reload();
  await expect(page.getByLabel('Move Real persisted follow-up')).toHaveValue('waiting');
  await page.getByRole('button', { name: 'Real persisted follow-up', exact: true }).click();
  await page.getByLabel('Comment', { exact: true }).fill('Persisted comment');
  await page.getByRole('button', { name: 'บันทึกการติดตาม' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Real persisted follow-up', exact: true }).click();
  await expect(page.getByText('Persisted comment', { exact: true })).toBeVisible();
});

test('issued credential pair authorizes Agent API and revocation denies access', async ({ page }) => {
  const { path, org, event } = await workspace(page);
  await page.goto(path + '/settings/credentials');
  const create = async (name: string, kind: 'org' | 'event') => {
    await page.getByRole('button', { name: 'Create credential', exact: true }).click();
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel('Credential type').selectOption(kind);
    if (kind === 'event')
      await page.getByLabel('Parent org credential').selectOption({ label: 'Integration org key' });
    await page.getByLabel('Expiry date').fill('2027-12-31');
    await page.getByRole('button', { name: 'สร้าง key', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Copy your key once' })).toBeVisible();
    const secret = (await dialog.locator('pre').textContent())!;
    await page.getByRole('button', { name: 'เก็บ key แล้ว' }).click();
    return secret;
  };
  const orgKey = await create('Integration org key', 'org');
  const eventKey = await create('Integration event key', 'event');
  const endpoint = `api/v1/agent/orgs/${org}/events/${event}/knowledge`;
  const headers = { 'X-Org-Credential': orgKey, 'X-Event-Credential': eventKey };
  expect((await page.request.get(endpoint, { headers })).status()).toBe(200);
  await page.reload();
  await expect(page.locator('pre')).not.toContainText(orgKey);
  await expect(page.locator('pre')).toContainText('X-Org-Credential');
  page.once('dialog', (dialog) => dialog.accept());
  await page
    .getByRole('row')
    .filter({ has: page.getByRole('heading', { name: 'Integration org key', exact: true }) })
    .getByRole('button', { name: 'Revoke', exact: true })
    .click();
  await expect(
    page
      .getByRole('row')
      .filter({ has: page.getByRole('heading', { name: 'Integration org key', exact: true }) }),
  ).toContainText('revoked');
  expect((await page.request.get(endpoint, { headers })).status()).toBe(403);
});
