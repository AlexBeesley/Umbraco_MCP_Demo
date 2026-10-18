// Logs in to the Umbraco backoffice as the unattended admin user and checks the UI renders.
//
//   UMBRACO_ADMIN_EMAIL=... UMBRACO_ADMIN_PASSWORD=... npm run smoke
//
// BASE_URL defaults to https://localhost:44398 (the "Umbraco.Web.UI" launch profile).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const baseUrl = process.env.BASE_URL ?? 'https://localhost:44398';
const email = process.env.UMBRACO_ADMIN_EMAIL;
const password = process.env.UMBRACO_ADMIN_PASSWORD;
if (!email || !password) {
  console.error('Set UMBRACO_ADMIN_EMAIL and UMBRACO_ADMIN_PASSWORD (see scripts/set-dev-secrets.sh).');
  process.exit(2);
}

mkdirSync('screenshots', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 900 } });

try {
  await page.goto(`${baseUrl}/umbraco`);
  await page.locator('input[name="username"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: /login/i }).click();

  // The backoffice shell renders the section links (Content, Media, Settings...) once logged in.
  await page.getByRole('tab', { name: 'Content' }).or(page.getByRole('link', { name: 'Content' })).first()
    .waitFor({ timeout: 60_000 });
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/backoffice.png' });
  console.log(`OK: logged in to ${baseUrl}/umbraco as ${email}; screenshot at screenshots/backoffice.png`);
} catch (err) {
  await page.screenshot({ path: 'screenshots/backoffice-failure.png' });
  console.error('FAILED:', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
