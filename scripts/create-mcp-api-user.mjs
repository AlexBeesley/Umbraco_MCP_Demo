// Creates (or updates) the least-privilege API user that the Umbraco Developer MCP server signs in as,
// using the same Management API calls the backoffice UI makes (Users > Create > API user).
//
//   npm run mcp:create-api-user                 # keeps an existing client secret
//   npm run mcp:create-api-user -- --rotate     # issues a new client secret
//   npm run mcp:create-api-user -- --content-only   # no Settings section (see below)
//
// The client secret is stored in the site's .NET user-secrets (Mcp:UmbracoClientSecret), never in the repo.
// It also exports the ASP.NET Core development certificate (public part only) to .certs/, which the
// MCP server is told to trust in .vscode/mcp.json.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { adminCredentials, getUserSecret, setUserSecret } from './lib/local-secrets.mjs';
import { baseUrl, loginToBackoffice } from './lib/backoffice.mjs';

const GROUP_ALIAS = 'mcpContentAgent';
const API_USER_EMAIL = 'mcp-agent@example.com';
const CLIENT_ID = 'umbraco-back-office-mcp';
const rotate = process.argv.includes('--rotate');
const contentOnly = process.argv.includes('--content-only');

// Least privilege for "list document types, then create and publish content under Home":
// - Content section, plus Settings because Umbraco authorises the document type tree by section (a Content-only
//   user gets 403 and the MCP server hides its document type tools). There is no read-only Settings permission,
//   so the API user *could* change document types, data types and templates; .vscode/mcp.json hides those tools
//   as a second layer. Pass --content-only for a group without Settings if you don't need document type listing.
// - No Media, Members, Users, Packages or Translation sections.
// - Start node Home, so it cannot touch anything outside the site tree.
// - Read/Create/Update/Publish only: no Delete, Move, Unpublish, Sort, Rollback, Public access,
//   Culture and hostnames, or Permissions.
// - en-GB only.
const groupPermissions = {
  name: 'MCP Content Agent',
  alias: GROUP_ALIAS,
  description: 'Used by the Umbraco Developer MCP server. Can read, create, update and publish pages under Home.',
  icon: 'icon-wand',
  sections: contentOnly ? ['Umb.Section.Content'] : ['Umb.Section.Content', 'Umb.Section.Settings'],
  languages: ['en-GB'],
  hasAccessToAllLanguages: false,
  documentRootAccess: false,
  mediaStartNode: null,
  mediaRootAccess: false,
  fallbackPermissions: [
    'Umb.Document.Read',
    'Umb.Document.Create',
    'Umb.Document.Update',
    'Umb.Document.Publish',
    'Umb.Document.PropertyValue.Read',
    'Umb.Document.PropertyValue.Write',
  ],
  permissions: [],
};

function check(response, what) {
  if (response.status >= 300) {
    throw new Error(`${what} failed (HTTP ${response.status}): ${JSON.stringify(response.body)}`);
  }
  return response;
}

const idFromLocation = location => location.split('/').pop();

const session = await loginToBackoffice(adminCredentials());
try {
  const { api } = session;

  // 1. Find the Home page to use as the group's content start node.
  const root = check(await api('GET', '/tree/document/root?take=100'), 'Reading content root');
  const home = root.body.items.find(item => item.variants.some(v => v.name === 'Home'));
  if (!home) throw new Error('No root content node called "Home" was found. Has uSync imported the site content?');

  // 2. Create or update the user group.
  const groups = check(await api('GET', '/user-group?take=100'), 'Listing user groups').body.items;
  let group = groups.find(g => g.alias === GROUP_ALIAS);
  const groupBody = { ...groupPermissions, documentStartNode: { id: home.id } };
  if (group) {
    check(await api('PUT', `/user-group/${group.id}`, groupBody), 'Updating user group');
    console.log(`Updated user group "${groupBody.name}"`);
  } else {
    const created = check(await api('POST', '/user-group', groupBody), 'Creating user group');
    group = { id: idFromLocation(created.location) };
    console.log(`Created user group "${groupBody.name}"`);
  }

  // 3. Create the API user (UserKind "Api": cannot log in to the backoffice, only use client credentials).
  const users = check(await api('GET', `/filter/user?take=100&filter=${encodeURIComponent(API_USER_EMAIL)}`), 'Finding users').body.items;
  let user = users.find(u => u.email === API_USER_EMAIL);
  if (!user) {
    const created = check(await api('POST', '/user', {
      email: API_USER_EMAIL,
      userName: API_USER_EMAIL,
      name: 'Umbraco Developer MCP',
      userGroupIds: [{ id: group.id }],
      kind: 'Api',
    }), 'Creating API user');
    user = { id: idFromLocation(created.location) };
    console.log('Created API user "Umbraco Developer MCP"');
  } else {
    console.log('API user "Umbraco Developer MCP" already exists');
  }

  // 4. Client credentials. Secrets can't be read back from Umbraco, so keep the stored one unless rotating.
  const existing = check(await api('GET', `/user/${user.id}/client-credentials`), 'Listing client credentials').body;
  const hasClient = existing.includes(CLIENT_ID);
  const storedSecret = getUserSecret('Mcp:UmbracoClientSecret');
  if (hasClient && storedSecret && !rotate) {
    console.log(`Client "${CLIENT_ID}" already exists; keeping the secret in user-secrets (use --rotate for a new one)`);
  } else {
    if (hasClient) check(await api('DELETE', `/user/${user.id}/client-credentials/${CLIENT_ID}`), 'Removing old client credentials');
    const secret = randomBytes(32).toString('base64url');
    check(await api('POST', `/user/${user.id}/client-credentials`, { clientId: CLIENT_ID, clientSecret: secret }), 'Creating client credentials');
    setUserSecret('Mcp:UmbracoClientId', CLIENT_ID);
    setUserSecret('Mcp:UmbracoClientSecret', secret);
    console.log(`Created client "${CLIENT_ID}" and stored its secret in user-secrets (Mcp:UmbracoClientSecret)`);
  }

  // Without --no-password, a PEM export contains only the certificate, not the private key.
  // dev-certs won't create the target directory itself.
  const certDir = fileURLToPath(new URL('../.certs/', import.meta.url));
  mkdirSync(certDir, { recursive: true });
  execFileSync('dotnet', ['dev-certs', 'https', '--export-path', `${certDir}localhost-dev-cert.pem`, '--format', 'Pem'], { stdio: 'ignore' });
  console.log('Exported the development certificate to .certs/localhost-dev-cert.pem');

  console.log(`\nMCP settings for ${baseUrl}:`);
  console.log(`  UMBRACO_CLIENT_ID=${CLIENT_ID}`);
  console.log('  UMBRACO_CLIENT_SECRET=<dotnet user-secrets list --project src/GovUkUmbraco.Web | grep Mcp:UmbracoClientSecret>');
} finally {
  await session.close();
}
