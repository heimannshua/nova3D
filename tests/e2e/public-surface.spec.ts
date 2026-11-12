import {expect, test} from '@playwright/test';

// The shell has no sign-in stand-in yet (the local Google OIDC provider arrives with Story 1.3),
// so these flows cover what an unauthenticated browser can reach.

test('an unauthenticated visit is sent to the login page', async ({page}) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login\?error=not_signed_in$/);
  await expect(page.getByRole('heading', {name: 'Sign in to nova3D'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Continue with Google'})).toBeVisible();
  await expect(page.getByRole('alert').filter({hasText: 'Sign in with an invited Google account'})).toBeVisible();
});

test('the login page offers Google only and fits the viewport', async ({page}) => {
  await page.goto('/login');
  await expect(page.getByRole('button')).toHaveCount(1);
  await expect(page.getByLabel(/password/i)).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('a callback without a code returns to the login page', async ({page}) => {
  await page.goto('/auth/callback');
  await expect(page).toHaveURL(/\/login\?error=auth_unavailable$/);
});

test('the health endpoint reports a synthetic shell with no provider calls', async ({request}) => {
  const response = await request.get('/api/health');
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ok: true, appMode: 'synthetic-shell', providerCall: false, syntheticData: true});
});

test('public PWA manifests and icons are available for both locales', async ({page, request}) => {
  await page.goto('/login');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.en.webmanifest');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/pwa/apple-touch-icon.png');

  await page.context().addCookies([{name: 'nova3d-locale', value: 'he', url: page.url()}]);
  await page.reload();
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.he.webmanifest');

  for (const locale of ['en', 'he']) {
    const response = await request.get(`/manifest.${locale}.webmanifest`);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toMatch(/json/i);
    const manifest = await response.json();
    expect(manifest).toMatchObject({lang: locale, display: 'standalone', start_url: '/', scope: '/'});

    for (const icon of manifest.icons) {
      const iconResponse = await request.get(icon.src);
      expect(iconResponse.ok()).toBe(true);
      expect(iconResponse.headers()['content-type']).toContain('image/png');
    }
  }

  const appleIcon = await request.get('/pwa/apple-touch-icon.png');
  expect(appleIcon.ok()).toBe(true);
  expect(appleIcon.headers()['content-type']).toContain('image/png');
});
