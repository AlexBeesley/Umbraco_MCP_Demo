// End-to-end test of the hosted (remote) MCP server, as a member of the public would use it:
// an MCP client connects, signs in through OAuth as the shared demo editor in a real browser,
// then checks the account can read and create draft pages but cannot publish or delete.
//
//   MCP_URL=https://<worker>/mcp DEMO_EMAIL=... DEMO_PASSWORD=... npm run test:hosted-mcp
//
// Defaults suit a local run: the site in public-demo mode plus `npm run dev` in mcp-hosted/.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { chromium } from 'playwright';

const mcpUrl = new URL(process.env.MCP_URL ?? 'http://127.0.0.1:8787/mcp');
const email = process.env.DEMO_EMAIL ?? 'demo-editor@example.com';
const password = process.env.DEMO_PASSWORD;
if (!password) throw new Error('Set DEMO_PASSWORD (the password shown on the site home page).');

// The client's own redirect URI. Nothing listens there: the browser step below reads the code from it.
const redirectUrl = 'http://localhost:9999/oauth/callback';

/** Minimal in-memory OAuth client state, as an MCP host app would keep it. */
const state = {};
const authProvider = {
  get redirectUrl() { return redirectUrl; },
  get clientMetadata() {
    return { client_name: 'GOV.UK Umbraco prototype test', redirect_uris: [redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' };
  },
  clientInformation: () => state.client,
  saveClientInformation: info => { state.client = info; },
  tokens: () => state.tokens,
  saveTokens: tokens => { state.tokens = tokens; },
  saveCodeVerifier: verifier => { state.verifier = verifier; },
  codeVerifier: () => state.verifier,
  redirectToAuthorization: url => { state.authorizationUrl = url; },
};

/** Plays the person: approves the consent screen, signs in to Umbraco, and returns the authorization code. */
async function signInInBrowser(authorizationUrl) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  let code;
  // Playwright can't route a request reached by redirect, so read the code from the request itself;
  // the browser then fails to load the (unserved) redirect URI, which doesn't matter.
  page.on('request', request => {
    if (request.url().startsWith(redirectUrl)) code = new URL(request.url()).searchParams.get('code');
  });
  if (process.env.DEBUG_SIGNIN) {
    page.on('framenavigated', f => f === page.mainFrame() && console.log('  ->', f.url().slice(0, 140)));
    page.on('requestfailed', r => !r.url().startsWith(redirectUrl) && console.log('  request failed:', r.url().slice(0, 160), r.failure()?.errorText));
  }
  try {
    await page.goto(authorizationUrl.toString());
    for (let step = 0; step < 8 && !code; step++) {
      await page.waitForLoadState('networkidle').catch(() => {});
      if (code) break;
      const username = page.locator('input[name="username"]');
      if (await username.isVisible().catch(() => false)) {
        await username.fill(email);
        await page.locator('input[name="password"]').fill(password);
        await page.getByRole('button', { name: /log ?in|sign ?in/i }).click({ noWaitAfter: true });
        // Umbraco signs in with a script, then redirects on to the worker's callback.
        await page.waitForURL(url => !url.pathname.endsWith('/umbraco/login'), { timeout: 30_000 }).catch(() => {});
        continue;
      }
      const approve = page.getByRole('button', { name: /approve|allow|authori[sz]e|continue|connect/i }).first();
      if (await approve.isVisible().catch(() => false)) {
        await approve.click({ noWaitAfter: true });
        await page.waitForURL(url => url.pathname !== '/authorize', { timeout: 30_000 }).catch(() => {});
        continue;
      }
      await page.waitForTimeout(1500);
    }
    if (!code) {
      await page.screenshot({ path: 'tests/e2e/screenshots/hosted-mcp-signin-failure.png', fullPage: true }).catch(() => {});
      throw new Error(`Sign-in did not finish; stuck at ${page.url()}`);
    }
    return code;
  } finally {
    await browser.close();
  }
}

async function connect() {
  const client = new Client({ name: 'hosted-mcp-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(mcpUrl, { authProvider }));
  return client;
}

let client;
let failures = 0;
const check = (ok, message) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${message}`); if (!ok) failures++; };

try {
  try {
    client = await connect();
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) throw err;
    console.log(`Signing in at ${new URL(state.authorizationUrl).origin} as ${email}…`);
    const code = await signInInBrowser(state.authorizationUrl);
    const transport = new StreamableHTTPClientTransport(mcpUrl, { authProvider });
    await transport.finishAuth(code);
    client = await connect();
  }
  check(true, `connected to ${client.getServerVersion()?.name} at ${mcpUrl}`);

  const { tools } = await client.listTools();
  const names = new Set(tools.map(t => t.name));
  console.log(`  ${tools.length} tools available to ${email}`);
  check(names.has('get-all-document-types') || names.has('get-document-type-by-id'), 'can look up document types');
  check(names.has('create-document'), 'can create pages');
  check(!names.has('publish-document'), 'has no publish tool');
  check(!names.has('delete-document') && !names.has('move-document-to-recycle-bin'), 'has no delete tools');

  const call = async (name, args) => {
    const r = await client.request({ method: 'tools/call', params: { name, arguments: args } }, CallToolResultSchema);
    const text = r.content?.map(c => c.text ?? '').join('\n') ?? '';
    return { isError: r.isError, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
  };

  const root = await call('get-document-root', {});
  const home = (root.json?.items ?? []).find(d => d.variants?.some(v => v.name === 'Home'));
  check(!!home, 'can read the content tree (start node: Home)');

  const contentPageType = home ? (await call('get-document-children', { parentId: home.id, take: 100 })).json?.items
    ?.find(d => d.variants?.some(v => v.name === 'About this prototype'))?.documentType?.id : undefined;
  check(!!contentPageType, 'found the Content page document type');

  const name = `Hosted MCP test ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
  const created = await call('create-document', {
    documentTypeId: contentPageType, parentId: home?.id, name,
    values: [{ alias: 'pageHeading', editorAlias: 'Umbraco.TextBox', culture: null, segment: null, value: name }],
  });
  check(!created.isError, `created a draft page "${name}"${created.isError ? `: ${created.text.slice(0, 200)}` : ''}`);

  const children = (await call('get-document-children', { parentId: home?.id, take: 100 })).json?.items ?? [];
  const draft = children.find(d => d.variants?.some(v => v.name === name));
  check(draft?.variants?.[0]?.state === 'Draft', `the new page is a draft (state: ${draft?.variants?.[0]?.state})`);

  // The tool is hidden, but prove the server-side permission too by calling it anyway.
  const publish = await call('publish-document', { id: draft?.id, data: { publishSchedules: [{ culture: null }] } });
  check(publish.isError, `publishing is refused (${publish.text.slice(0, 120).replace(/\s+/g, ' ')})`);
} catch (err) {
  console.error('FAILED:', err.message);
  failures++;
} finally {
  await client?.close();
}
console.log(failures === 0 ? '\nHosted MCP test passed.' : `\n${failures} check(s) failed.`);
process.exitCode = failures === 0 ? 0 : 1;
