import { BrowserContext, Page, expect, test } from '@playwright/test';
import { deleteAccount, newUser, readmeShot, register } from './support';

type View = 'THIRD_PERSON' | 'FIRST_PERSON';

// The headless renderer is a functional check, not a real-GPU performance benchmark.
test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader'] } });

const labels = {
  MAP_2D: '2D (mappa)',
  THIRD_PERSON: '3D — terza persona',
  FIRST_PERSON: '3D — prima persona',
} as const;

/**
 * Exercise the real Cesium renderer without downloading geographic datasets. Every geo.admin.ch
 * request is fulfilled locally: a flat heightmap, a solid pixel and an empty buildings hierarchy.
 * The terrain fixture follows CesiumTerrainProvider's documented heightmap-1.0 encoding.
 */
async function syntheticGeography(context: BrowserContext, invalidTerrain = false) {
  const counts = { terrain: 0, imagery: 0, buildings: 0 };
  const unexpected: string[] = [];
  const ion: string[] = [];
  const flatTerrain = Buffer.alloc(65 * 65 * 2 + 2);
  for (let i = 0; i < 65 * 65; i++) flatTerrain.writeUInt16LE(5000, i * 2);
  // All four children are available; availability in layer.json bounds the final level.
  flatTerrain[65 * 65 * 2] = 15;
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOIygv4DwAEVgIY53z7KAAAAABJRU5ErkJggg==',
    'base64',
  );
  const headers = { 'Access-Control-Allow-Origin': '*' };

  // Permit software WebGL for this test's capability probe; production still rejects major caveats.
  await context.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind: string, ...args: unknown[]) {
      const options = args[0] as WebGLContextAttributes | undefined;
      if (kind === 'webgl2' && options?.failIfMajorPerformanceCaveat) {
        args[0] = { ...options, failIfMajorPerformanceCaveat: false };
      }
      return Reflect.apply(getContext, this, [kind, ...args]);
    } as typeof getContext;
  });

  await context.route(/^https:\/\/[^/]*cesium\.com\//, async (route) => {
    ion.push(route.request().url());
    await route.abort();
  });
  // Font availability must not decide whether the renderer emitted JavaScript errors.
  await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, async (route) => {
    await route.fulfill({ contentType: 'text/css', body: '/* System fonts in E2E. */' });
  });
  await context.route(/^https:\/\/[^/]*\.geo\.admin\.ch\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('ch.swisstopo.terrain.3d') && url.pathname.endsWith('/layer.json')) {
      await route.fulfill({
        headers,
        json: {
          tilejson: '2.1.0',
          format: invalidTerrain ? 'invalid-test-format' : 'heightmap-1.0',
          version: 'synthetic-e2e',
          scheme: 'tms',
          projection: 'EPSG:4326',
          minzoom: 0,
          maxzoom: 12,
          tiles: ['{z}/{x}/{y}.terrain'],
          available: Array.from({ length: 13 }, (_, z) => [
            { startX: 0, startY: 0, endX: 2 ** (z + 1) - 1, endY: 2 ** z - 1 },
          ]),
        },
      });
    } else if (
      url.pathname.includes('ch.swisstopo.terrain.3d') &&
      url.pathname.endsWith('.terrain')
    ) {
      counts.terrain++;
      await route.fulfill({ headers, contentType: 'application/octet-stream', body: flatTerrain });
    } else if (url.hostname === 'wmts.geo.admin.ch') {
      counts.imagery++;
      await route.fulfill({ headers, contentType: 'image/png', body: pixel });
    } else if (
      url.pathname.includes('ch.swisstopo.swissbuildings3d.3d') &&
      url.pathname.endsWith('/tileset.json')
    ) {
      counts.buildings++;
      await route.fulfill({
        headers,
        json: {
          asset: { version: '1.0' },
          geometricError: 0,
          root: {
            boundingVolume: { region: [-Math.PI, -Math.PI / 2, Math.PI, Math.PI / 2, 0, 1] },
            geometricError: 0,
            refine: 'ADD',
            children: [],
          },
        },
      });
    } else {
      unexpected.push(url.href);
      await route.fulfill({ headers, status: 404, body: 'Unmocked geographic resource' });
    }
  });
  return { counts, unexpected, ion };
}

async function saveView(page: Page, view: View): Promise<void> {
  await page.goto('/settings');
  await page.getByRole('radio', { name: labels[view], exact: true }).check();
  await expect(page.getByRole('radio', { name: 'Media', exact: true })).toBeChecked();
  await expect(page.getByTestId('head-bob-toggle').getByRole('switch')).not.toBeChecked();
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/me/settings') && response.request().method() === 'PUT',
  );
  await page.getByTestId('save-settings').click();
  expect((await saved).ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole('radio', { name: labels[view], exact: true })).toBeChecked();
}

async function prepareRoute(page: Page): Promise<void> {
  await page.goto('/ride');
  await page.getByTestId('choose-route').filter({ hasText: 'Cadenazzo – Monte Ceneri' }).click();
  await expect(page.getByTestId('preride')).toContainText('Cadenazzo – Monte Ceneri');
}

async function expectScene(page: Page, view: View): Promise<void> {
  await expect(page.getByTestId('cycle-view')).toContainText(labels[view]);
  await expect(page.getByTestId('ride-scene-3d')).toHaveAttribute('data-ready', 'true', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('ride-scene-3d')).toHaveAttribute('data-view', view);
  await expect(page.getByTestId('ride-scene-3d').locator('canvas')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId('view-fallback')).toHaveCount(0);
}

async function expectSceneAboveProfile(page: Page): Promise<void> {
  await expect(page.locator('app-elevation-profile.profile')).toBeVisible();
  await expect
    .poll(async () => {
      const canvas = await page.getByTestId('ride-scene-3d').locator('canvas').boundingBox();
      const profile = await page.locator('app-elevation-profile.profile').boundingBox();
      if (!canvas || !profile || canvas.height <= 0) return Number.POSITIVE_INFINITY;
      return canvas.y + canvas.height - profile.y;
    })
    .toBeLessThanOrEqual(1);
}

for (const initialView of ['THIRD_PERSON', 'FIRST_PERSON'] as const) {
  test(`persist ${initialView}, render simulator HUD and cycle views without changing settings`, async ({
    page,
    context,
    request,
  }) => {
    const user = newUser(`3d-${initialView.toLowerCase()}`);
    const geography = await syntheticGeography(context);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    try {
      await register(page, user);
      await saveView(page, initialView);
      await prepareRoute(page);
      await expectScene(page, initialView);

      // V is already available before starting, and a full cycle restores the initial view.
      const cycle =
        initialView === 'THIRD_PERSON'
          ? (['FIRST_PERSON', 'MAP_2D', 'THIRD_PERSON'] as const)
          : (['MAP_2D', 'THIRD_PERSON', 'FIRST_PERSON'] as const);
      for (const next of cycle) {
        await page.keyboard.press('v');
        await expect(page.getByTestId('cycle-view')).toContainText(labels[next]);
        if (next === 'MAP_2D') await expect(page.getByTestId('ride-map')).toBeVisible();
        else await expectScene(page, next);
      }

      await page.getByTestId('start-ride').click();
      await page.getByRole('button', { name: '300', exact: true }).click();
      await expect(page.getByTestId('hud-power')).toContainText('300');
      await expect(page.getByTestId('rider-state')).toContainText('Pedala');
      await expectScene(page, initialView);
      await expectSceneAboveProfile(page);
      await expect.poll(() => geography.counts.terrain).toBeGreaterThan(0);
      await expect.poll(() => geography.counts.imagery).toBeGreaterThan(0);
      await expect.poll(() => geography.counts.buildings).toBeGreaterThan(0);
      await page.screenshot({ path: `e2e-results/ride-3d-${initialView.toLowerCase()}-qa.png` });
      // These optional captures are explicitly synthetic, not real Ticino screenshots.
      await readmeShot(page, `ride-${initialView.toLowerCase()}-synthetic`);

      // Switching views also works while pedalling; HUD and pause remain functional.
      await page.keyboard.press('v');
      await expect(page.getByTestId('cycle-view')).toContainText(labels[cycle[0]]);
      await expect(page.getByTestId('hud-power')).toContainText('300');
      await page.getByTestId('pause').click();
      await expect(page.getByTestId('pause')).toContainText('Riprendi');
      await page.getByTestId('cycle-view').click();
      await expect(page.getByTestId('cycle-view')).toContainText(labels[cycle[1]]);
      await page.getByTestId('end-ride').click();
      await page.getByTestId('end-ride').click();
      await expect(page).toHaveURL(/\/(home|history\/.+)$/);
      await page.goto('/settings');
      await expect(
        page.getByRole('radio', { name: labels[initialView], exact: true }),
      ).toBeChecked();
      expect(geography.unexpected).toEqual([]);
      expect(geography.ion).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await deleteAccount(request, user);
    }
  });
}

test('a terrain initialization error falls back to the map and preserves simulator controls', async ({
  page,
  context,
  request,
}) => {
  const user = newUser('3d-init-failure');
  const geography = await syntheticGeography(context, true);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await register(page, user);
    await saveView(page, 'THIRD_PERSON');
    await prepareRoute(page);
    await expect(page.getByTestId('view-fallback')).toContainText('torno alla mappa 2D');
    await expect(page.getByTestId('ride-map')).toBeVisible();
    await expect(page.getByTestId('ride-scene-3d')).toHaveCount(0);
    await page.getByTestId('start-ride').click();
    await page.getByRole('button', { name: '250', exact: true }).click();
    await expect(page.getByTestId('hud-power')).toContainText('250');
    expect(geography.ion).toEqual([]);
    expect(geography.unexpected).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await deleteAccount(request, user);
  }
});

test('without WebGL2 the ride selects 2D and warns before loading geographic data', async ({
  page,
  context,
  request,
}) => {
  const user = newUser('3d-no-webgl2');
  const geography = await syntheticGeography(context);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind: string, ...args: unknown[]) {
      if (kind === 'webgl2') return null;
      return Reflect.apply(getContext, this, [kind, ...args]);
    } as typeof getContext;
  });
  try {
    await register(page, user);
    await saveView(page, 'FIRST_PERSON');
    await prepareRoute(page);
    await expect(page.getByTestId('view-fallback')).toContainText('torno alla mappa 2D');
    await expect(page.getByTestId('cycle-view')).toContainText(labels.MAP_2D);
    await expect(page.getByTestId('ride-scene-3d')).toHaveCount(0);
    await expect(page.getByTestId('ride-map-raster')).toBeVisible();
    await expect
      .poll(() =>
        page
          .getByTestId('ride-map-raster')
          .locator('img')
          .evaluateAll(
            (images) =>
              images.length > 0 &&
              images.every(
                (image) =>
                  (image as HTMLImageElement).complete &&
                  (image as HTMLImageElement).naturalWidth > 0,
              ),
          ),
      )
      .toBe(true);
    expect(geography.counts.terrain).toBe(0);
    expect(geography.counts.buildings).toBe(0);
    expect(geography.ion).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await deleteAccount(request, user);
  }
});
