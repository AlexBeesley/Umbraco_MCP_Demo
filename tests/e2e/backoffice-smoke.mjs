// Logs in to the Umbraco backoffice as the unattended admin user and checks the UI renders.
//
//   npm run test:smoke
//
// Credentials come from UMBRACO_ADMIN_EMAIL/UMBRACO_ADMIN_PASSWORD or, failing that, the site's user-secrets.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { adminCredentials } from '../../scripts/lib/local-secrets.mjs';
import { baseUrl, loginToBackoffice } from '../../scripts/lib/backoffice.mjs';

const screenshots = fileURLToPath(new URL('./screenshots/', import.meta.url));
mkdirSync(screenshots, { recursive: true });

const credentials = adminCredentials();
let session;
try {
  session = await loginToBackoffice(credentials);
  const { page } = session;
  // The backoffice shell renders the section links (Content, Media, Settings...) once logged in.
  await page.getByRole('tab', { name: 'Content' }).or(page.getByRole('link', { name: 'Content' })).first()
    .waitFor({ timeout: 60_000 });
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${screenshots}backoffice.png` });
  console.log(`OK: logged in to ${baseUrl}/umbraco as ${credentials.email}; screenshot at tests/e2e/screenshots/backoffice.png`);
} catch (err) {
  await session?.page.screenshot({ path: `${screenshots}backoffice-failure.png` });
  console.error('FAILED:', err.message);
  process.exitCode = 1;
} finally {
  await session?.close();
}
