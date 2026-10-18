// Logs in to the Umbraco backoffice in a headless browser and calls the Management API as that user,
// exactly as the backoffice UI does. Umbraco 17 keeps the access token in an HttpOnly cookie and the
// backoffice sends a placeholder "Bearer [redacted]" header that the server swaps for the cookie's token.
import { chromium } from 'playwright';

export const baseUrl = process.env.BASE_URL ?? 'https://localhost:44398';

export async function loginToBackoffice({ email, password }) {
  const browser = await chromium.launch();
  // The local site uses the ASP.NET Core development certificate, which isn't trusted on every machine.
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/umbraco`);
  await page.locator('input[name="username"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: /login/i }).click();
  await page.waitForURL(/\/umbraco\/section\//, { timeout: 60_000 });

  /** Calls the Management API; resolves to { status, body, location }. */
  async function api(method, path, body) {
    return page.evaluate(async ({ method, path, body }) => {
      const response = await fetch(`/umbraco/management/api/v1${path}`, {
        method,
        headers: { Authorization: 'Bearer [redacted]', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let parsed = text;
      try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
      return { status: response.status, body: parsed, location: response.headers.get('Location') };
    }, { method, path, body });
  }

  return { page, api, close: () => browser.close() };
}
