import { APIRequestContext, Page, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface TestUser {
  email: string;
  password: string;
  name: string;
}

/** A fresh account per test run (deleted again in afterAll). */
export function newUser(tag: string): TestUser {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    email: `e2e-${tag}-${id}@example.ch`,
    password: 'e2e-password-12345',
    name: `E2E ${tag}`,
  };
}

export async function register(page: Page, user: TestUser): Promise<void> {
  await page.goto('/register');
  await page.locator('input[formcontrolname="displayName"]').fill(user.name);
  await page.locator('input[formcontrolname="email"]').fill(user.email);
  await page.locator('input[formcontrolname="password"]').fill(user.password);
  await page.locator('input[formcontrolname="confirmPassword"]').fill(user.password);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByTestId('user-name')).toHaveText(user.name);
}

export async function login(page: Page, user: TestUser): Promise<void> {
  await page.goto('/login');
  await page.locator('input[formcontrolname="email"]').fill(user.email);
  await page.locator('input[formcontrolname="password"]').fill(user.password);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/home$/);
}

/** Deletes the account through the API (cascades to rides, records, explored roads). */
export async function deleteAccount(request: APIRequestContext, user: TestUser): Promise<void> {
  const res = await request.post('/api/auth/login', {
    data: { email: user.email, password: user.password },
  });
  if (!res.ok()) return;
  const { accessToken } = (await res.json()) as { accessToken: string };
  await request.delete('/api/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { password: user.password },
  });
}

/** With SCREENSHOTS=1, saves a README screenshot to docs/screenshots/<name>.png. */
export async function readmeShot(page: Page, name: string): Promise<void> {
  if (!process.env['SCREENSHOTS']) return;
  const dir = join(__dirname, '..', '..', '..', 'docs', 'screenshots');
  mkdirSync(dir, { recursive: true });
  // Let map tiles and charts finish loading and drawing.
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(dir, `${name}.png`) });
}
