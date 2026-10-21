import { expect, type Page } from '@playwright/test';
export async function workspace(page: Page) {
  const headers = { 'X-Requested-With': 'EventConfirm' };
  const login = await page.request.post('api/v1/auth/login', {
    headers,
    data: { email: process.env.TEST_ADMIN_EMAIL, password: process.env.TEST_ADMIN_PASSWORD },
  });
  expect(login.ok()).toBe(true);
  const name = 'Integration ' + crypto.randomUUID();
  const organization = await page.request.post('api/v1/organizations', { headers, data: { name } });
  expect(organization.ok()).toBe(true);
  const profile = await organization.json();
  const org = profile.organizations.find((o: { name: string }) => o.name === name).id as string;
  const response = await page.request.post(`api/v1/orgs/${org}/events`, {
    headers,
    data: { name: 'Integration event', code: 'REAL', date: '2027-01-01', location: 'Test', description: '' },
  });
  expect(response.ok()).toBe(true);
  const event = (await response.json()).id as string;
  const path = `orgs/${org}/events/${event}`;
  return { org, event, path, headers };
}
