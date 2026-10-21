import { test, expect } from '@playwright/test';
import { workspace } from './fixtures';
test('completed call recording plays and downloads only through authenticated API', async ({ page }) => {
  const { org, event, path, headers } = await workspace(page);
  const api = 'api/v1/' + path;
  const post = async (url: string, data: unknown, extra: Record<string, string> = {}) => {
    const response = await page.request.post(url, {
      data,
      headers: { ...headers, 'Idempotency-Key': crypto.randomUUID(), ...extra },
    });
    expect(response.status()).toBe(200);
    return response.json();
  };
  const preview = await post(api + '/imports', {
    rows: [
      {
        phone: '+66812220002',
        first_name: 'Audio',
        last_name: 'Test',
        nickname: '',
        lang_code: 'th',
        event_code: 'REAL',
        event_date: '2027-01-01',
      },
    ],
  });
  await post(api + '/imports/' + preview.id + '/commit', {});
  const parent = await post(`api/v1/orgs/${org}/credentials`, {
    name: 'Audio org',
    kind: 'org',
    eventId: null,
    parentId: null,
    scopes: ['calls:result'],
    expiresAt: '2027-12-31',
  });
  const child = await post(`api/v1/orgs/${org}/credentials`, {
    name: 'Audio event',
    kind: 'event',
    eventId: event,
    parentId: parent.credential.id,
    scopes: ['calls:result'],
    expiresAt: '2027-12-31',
  });
  await post(api + '/runs', { action: 'start' });
  let attempt = '';
  await expect
    .poll(
      async () => {
        const people = await (await page.request.get(api + '/participants')).json();
        attempt = people[0].attempts[0]?.id ?? '';
        return people[0].attempts[0]?.transport;
      },
      { timeout: 15000 },
    )
    .toBe('accepted');
  await post(
    `api/v1/agent/orgs/${org}/events/${event}/calls/${attempt}/result`,
    { result: 'confirm', reason: null },
    { 'X-Org-Credential': parent.secret, 'X-Event-Credential': child.secret },
  );
  await post(api + '/runs', { action: 'pause' });
  await page.goto(path + '/calls');
  await page.getByRole('button', { name: 'Audio · Completed · stopped', exact: true }).click();
  await page.getByRole('button', { name: 'ตรวจไฟล์เสียง', exact: true }).click();
  await expect(
    page.getByText('เสียงสังเคราะห์สำหรับทดสอบ ไม่ใช่เสียงสนทนาจริง', { exact: true }),
  ).toBeVisible();
  const audio = page.locator('audio');
  await audio.evaluate(async (element: HTMLAudioElement) => {
    await element.play();
  });
  await expect
    .poll(() => audio.evaluate((element: HTMLAudioElement) => element.readyState))
    .toBeGreaterThanOrEqual(2);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'ดาวน์โหลดไฟล์เสียง', exact: true }).click();
  expect(await (await downloadPromise).failure()).toBeNull();
  await page.context().clearCookies();
  expect((await page.request.get(api + '/calls/' + attempt + '/recording/audio')).status()).toBe(401);
});
