import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { deleteAccount, newUser, readmeShot, register } from './support';

const user = newUser('ride');
const freeRider = newUser('free');

test.afterAll(async ({ request }) => {
  await deleteAccount(request, user);
  await deleteAccount(request, freeRider);
});

/**
 * The main journey: pick an official route, ride it in simulator mode while a second screen follows live, end the
 * ride, check the summary and the exports, then find it in history and statistics.
 */
test('ride an official route with the simulator and a live second screen', async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  await register(page, user);
  await readmeShot(page, 'home');

  // Second screen: same account, another tab.
  const phone = await context.newPage();
  await phone.goto('/live');
  await expect(phone.getByTestId('live-waiting')).toBeVisible();
  await expect(phone.getByTestId('live-status')).toContainText('nessuna pedalata');

  // Routes → saved routes → Cadenazzo – Monte Ceneri.
  await page.goto('/routes');
  await page.getByRole('tab', { name: 'Percorsi salvati' }).click();
  await page.getByText('Cadenazzo – Monte Ceneri', { exact: true }).click();
  await expect(page.getByText('Segmenti cronometrati')).toBeVisible();
  await readmeShot(page, 'routes');
  await page.getByTestId('ride-route').click();

  // Pre-ride: simulator mode, then start.
  await expect(page.getByTestId('preride')).toContainText('Cadenazzo – Monte Ceneri');
  await expect(page.getByTestId('preride')).toContainText('simulatore');
  await page.getByTestId('start-ride').click();
  await page.getByRole('button', { name: '300', exact: true }).click();

  await expect(page.getByTestId('hud-power')).toContainText('300', { timeout: 20_000 });
  await expect(page.getByTestId('rider-state')).toContainText('Pedala');
  await expect(phone.getByTestId('live-power')).toContainText(/\d+/, { timeout: 20_000 });
  await expect(phone.getByTestId('live-status')).toContainText('In diretta');
  await expect(phone.getByTestId('live-where')).toContainText('Cadenazzo – Monte Ceneri');

  // Ride a little (the screen sends a sample block every 30 s).
  await page.waitForTimeout(35_000);
  await readmeShot(page, 'ride');
  await readmeShot(phone, 'second-screen');

  // End (two clicks: confirm).
  await page.getByTestId('end-ride').click();
  await page.getByTestId('end-ride').click();
  await expect(page).toHaveURL(/\/history\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(phone.getByTestId('live-where')).toContainText('Conclusa');

  // Summary.
  const stats = page.getByTestId('ride-stats');
  await expect(stats).toContainText('Potenza media');
  await expect(stats).toContainText(/\d+ W/);
  await expect(page.getByText('Zone di potenza')).toBeVisible();
  await readmeShot(page, 'summary');

  // Exports.
  const [gpx] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-gpx').click(),
  ]);
  expect(gpx.suggestedFilename()).toMatch(
    /^zwiftfree-\d{4}-\d{2}-\d{2}-cadenazzo-monte-ceneri\.gpx$/,
  );
  const gpxText = readFileSync((await gpx.path())!, 'utf8');
  expect(gpxText).toContain('<gpx version="1.1"');
  expect((gpxText.match(/<trkpt /g) ?? []).length).toBeGreaterThan(30);
  expect(gpxText).toContain('<power>300</power>');

  const [fit] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-fit').click(),
  ]);
  expect(fit.suggestedFilename()).toMatch(/\.fit$/);
  const fitBytes = readFileSync((await fit.path())!);
  // FIT header: size 14, then ".FIT" at bytes 8–11.
  expect(fitBytes[0]).toBe(14);
  expect(fitBytes.subarray(8, 12).toString('ascii')).toBe('.FIT');

  // History and statistics know about it.
  await page.goto('/history');
  await expect(page.getByText('Cadenazzo – Monte Ceneri').first()).toBeVisible();
  await page.goto('/stats');
  await expect(page.getByTestId('totals')).toContainText('Uscite');
  await expect(page.getByTestId('totals').locator('.value').first()).toHaveText('1');
  await expect(page.getByTestId('records')).toContainText('Miglior 5 s');
  await expect(page.getByTestId('records')).toContainText('300 W');
  await readmeShot(page, 'stats');
  await page.goto('/home');
  await expect(page.getByTestId('last-ride')).toContainText('Cadenazzo – Monte Ceneri');
});

test('free ride from a place, with turn choices at junctions', async ({ page }) => {
  test.setTimeout(120_000);
  await register(page, freeRider);

  await page.goto('/ride');
  await expect(page.getByTestId('ride-chooser')).toBeVisible();
  await page.getByTestId('place-search').fill('Bellinzona');
  await page
    .getByRole('option', { name: /Bellinzona/ })
    .first()
    .click();
  await expect(page.getByTestId('preride')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('start-ride').click();
  await page.getByRole('button', { name: '250', exact: true }).click();
  await expect(page.getByTestId('hud-power')).toContainText('250', { timeout: 20_000 });
  await expect(page.getByTestId('where')).not.toBeEmpty();
  // Approaching a junction, the turn arrows appear; pick one with the keyboard.
  await expect(page.getByTestId('turn-arrows')).toBeVisible({ timeout: 60_000 });
  const arrows = page.getByTestId('turn-arrows').getByRole('radio');
  expect(await arrows.count()).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId('turn-arrows').getByRole('radio', { checked: true })).toHaveCount(
    1,
  );
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('turn-arrows').getByRole('radio', { checked: true })).toHaveCount(
    1,
  );

  // End the ride (a ride shorter than 10 s would be discarded instead).
  await page.getByTestId('end-ride').click();
  await page.getByTestId('end-ride').click();
  await expect(page).toHaveURL(/\/(home|history\/.+)$/, { timeout: 20_000 });
});
