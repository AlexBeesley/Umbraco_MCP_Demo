// End-to-end demo of the Umbraco Developer MCP server, driven by a real MCP client over stdio
// (the same protocol VS Code / GitHub Copilot agent mode use):
//   1. list the document types
//   2. create a "Content page" under Home
//   3. publish it, and fetch the live page to prove it renders
//
//   npm run mcp:demo
//
// The server is started from the "umbraco" entry in .vscode/mcp.json, so this exercises the exact
// configuration VS Code uses. The client secret VS Code would prompt for comes from the site's
// user-secrets (written by `npm run mcp:create-api-user`).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'node:fs';
import { get } from 'node:https';
import { rootCertificates } from 'node:tls';
import { getUserSecret } from './lib/local-secrets.mjs';
import { loadMcpServer } from './lib/vscode-mcp-config.mjs';

const PAGE_NAME = 'Created by MCP';

const clientSecret = process.env.UMBRACO_CLIENT_SECRET ?? getUserSecret('Mcp:UmbracoClientSecret');
if (!clientSecret) throw new Error('No MCP client secret: run `npm run mcp:create-api-user` first.');

const server = loadMcpServer('umbraco', { 'umbraco-client-secret': clientSecret });
const baseUrl = server.env.UMBRACO_BASE_URL;
const devCert = server.env.NODE_EXTRA_CA_CERTS;
if (!existsSync(devCert)) throw new Error(`Missing ${devCert}: run "npm run mcp:create-api-user" to export it.`);

const transport = new StdioClientTransport({
  command: server.command,
  args: server.args,
  env: { PATH: process.env.PATH, ...server.env },
  stderr: 'pipe',
});
let serverLog = '';
transport.stderr?.on('data', chunk => { serverLog += chunk; });

const client = new Client({ name: 'umbraco-mcp-demo', version: '1.0.0' });

/** GETs a page from the site, trusting the exported development certificate. */
function getPage(url) {
  const ca = [...rootCertificates, readFileSync(devCert, 'utf8')];
  return new Promise((resolve, reject) => {
    get(url, { ca }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

/**
 * Calls an MCP tool and returns its result, parsed as JSON when possible.
 * skipOutputValidation sends a raw tools/call, for tools whose declared output schema is out of date
 * (callTool() rejects results that don't match the schema).
 */
async function call(name, args = {}, { skipOutputValidation = false } = {}) {
  console.log(`\n> ${name} ${Object.keys(args).length ? JSON.stringify(args).slice(0, 160) : ''}`);
  const result = skipOutputValidation
    ? await client.request({ method: 'tools/call', params: { name, arguments: args } }, CallToolResultSchema)
    : await client.callTool({ name, arguments: args });
  const text = result.content?.map(c => c.text ?? '').join('\n') ?? '';
  if (result.isError) throw new Error(`${name} failed: ${text}`);
  try { return text ? JSON.parse(text) : result.structuredContent ?? null; } catch { return text; }
}

try {
  await client.connect(transport);
  const serverInfo = client.getServerVersion();
  const { tools } = await client.listTools();
  console.log(`Connected to ${serverInfo.name} ${serverInfo.version} at ${baseUrl}: ${tools.length} tools available to this API user`);

  // 1. List document types.
  const all = await call('get-all-document-types');
  const docTypes = (Array.isArray(all) ? all : all.items ?? all.documentTypes ?? []).filter(t => !t.isFolder);
  const pageTypes = docTypes.filter(t => !t.isElement);
  console.log(`  ${docTypes.length} document types (${pageTypes.length} page types, ${docTypes.length - pageTypes.length} element types). Page types:`);
  for (const t of pageTypes.sort((a, b) => a.name.localeCompare(b.name))) console.log(`   - ${t.name}`);
  const contentPageType = pageTypes.find(t => t.name === 'Content page');
  if (!contentPageType) throw new Error('No "Content page" document type found');

  // 2. Create (or, on a re-run, update) a content page under Home.
  const root = await call('get-document-root');
  const home = (root.items ?? root).find(d => d.variants?.some(v => v.name === 'Home'));
  const children = await call('get-document-children', { parentId: home.id, take: 100 });
  let page = (children.items ?? children).find(d => d.variants?.some(v => v.name === PAGE_NAME));

  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const values = [
    { alias: 'pageHeading', editorAlias: 'Umbraco.TextBox', culture: null, segment: null, value: 'Created by the Umbraco MCP server' },
    { alias: 'lede', editorAlias: 'Umbraco.TextArea', culture: null, segment: null,
      value: 'This page was created and published by an MCP client, using an Umbraco API user with limited permissions.' },
    { alias: 'insetText', editorAlias: 'Umbraco.TextArea', culture: null, segment: null, value: `Last written by the MCP demo at ${stamp}.` },
    { alias: 'bodyText', editorAlias: 'Umbraco.RichText', culture: null, segment: null, value: {
      markup: '<h2>What happened</h2><ol><li>The MCP client listed the document types.</li>'
        + '<li>It created this page under Home using the Content page type.</li>'
        + '<li>It published the page.</li></ol>'
        + '<p>Nothing here was edited in the backoffice.</p>',
      blocks: null } },
  ];

  if (!page) {
    await call('create-document', { documentTypeId: contentPageType.id, parentId: home.id, name: PAGE_NAME, values });
    const after = await call('get-document-children', { parentId: home.id, take: 100 });
    page = (after.items ?? after).find(d => d.variants?.some(v => v.name === PAGE_NAME));
    console.log(`  Created "${PAGE_NAME}" (${page.id})`);
  } else {
    // update-document is a full replace (it would clear the template); this only changes the given values.
    await call('update-document-properties', { id: page.id, properties: values.map(({ alias, value }) => ({ alias, value })) });
    console.log(`  "${PAGE_NAME}" already existed (${page.id}), so its properties were updated instead`);
  }

  // 3. Publish, then fetch the live page.
  await call('publish-document', { id: page.id, data: { publishSchedules: [{ culture: null }] } });
  // Umbraco 17.7 added "isExternal" to URL info, but MCP 17.6.11 declares that object with
  // additionalProperties: false, so schema-validating clients reject this tool's result.
  const urls = await call('get-document-urls', { id: [page.id] }, { skipOutputValidation: true });
  const path = (urls.items ?? urls)?.[0]?.urlInfos?.[0]?.url;
  if (!path) throw new Error(`No URL returned for the page: ${JSON.stringify(urls)}`);
  console.log(`  Published at ${path}`);

  const response = await getPage(new URL(path, baseUrl));
  const h1 = response.body.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1];
  console.log(`\nGET ${path} -> HTTP ${response.status}, <h1>: "${h1}"`);
  if (response.status !== 200 || !h1?.includes('Created by the Umbraco MCP server')) throw new Error('Published page did not render as expected');
  console.log('MCP demo completed successfully.');
} catch (err) {
  console.error('\nMCP demo failed:', err.message);
  if (serverLog) console.error('Server output:\n' + serverLog.slice(-2000));
  process.exitCode = 1;
} finally {
  await client.close();
}
