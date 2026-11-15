import { expect, test } from '@playwright/test';
import { deleteAccount, login, newUser, register } from './support';

const user = newUser('auth');

test.afterAll(async ({ request }) => deleteAccount(request, user));

test('register, log out, log back in; wrong password is refused', async ({ page }) => {
  await register(page, user);
  await expect(page.getByRole('heading', { name: 'Benvenuto su Zwiftfree' })).toBeVisible();
  await expect(page.getByTestId('home-overview')).toContainText('Nessuna uscita ancora');

  await page.getByTestId('user-menu').click();
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/login/);

  // Protected pages send you back to the login.
  await page.goto('/stats');
  await expect(page).toHaveURL(/\/login/);

  await page.locator('input[formcontrolname="email"]').fill(user.email);
  await page.locator('input[formcontrolname="password"]').fill('not-the-password');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByTestId('login-error')).toBeVisible();

  await login(page, user);
  await expect(page.getByTestId('user-name')).toHaveText(user.name);
});

test('registration validates the form in Italian', async ({ page }) => {
  await page.goto('/register');
  await page.locator('input[formcontrolname="displayName"]').fill('X');
  await page.locator('input[formcontrolname="email"]').fill('non-una-email');
  await page.locator('input[formcontrolname="password"]').fill('corta');
  await page.locator('input[formcontrolname="confirmPassword"]').fill('diversa');
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('mat-error').first()).toBeVisible();
  await expect(page).toHaveURL(/\/register/);
});
