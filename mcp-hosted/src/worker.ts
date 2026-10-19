/**
 * Public hosted Umbraco MCP server for the GOV.UK Umbraco prototype.
 *
 * Adapted from the Umbraco Developer MCP's own Cloudflare Worker (umbraco/Umbraco-CMS-MCP-Dev v17.6.11,
 * src/worker.ts) for a single self-hosted site instead of Umbraco Cloud routing. People sign in as their
 * own backoffice user through OAuth, so Umbraco's normal permissions decide what each person can do.
 *
 * Secrets (wrangler secret put / .dev.vars): UMBRACO_BASE_URL, UMBRACO_OAUTH_CLIENT_ID, COOKIE_ENCRYPTION_KEY.
 */

// Wrangler virtual modules
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import OAuthProvider from "@cloudflare/workers-oauth-provider";

// Hosted MCP building blocks
import {
  createDefaultHandler,
  createWorkerExport,
  createPerRequestServer,
  getServerOptions,
  type HostedMcpEnv,
  type HostedMcpServerOptions,
  type AuthProps,
} from "@umbraco-cms/mcp-hosted";

// The Developer MCP's tool collections, as published for in-process use.
import {
  collections as allCollections,
  allModes,
  allModeNames,
  allSliceNames,
  UmbracoManagementClient,
} from "@umbraco-cms/mcp-dev/collections";

// Content editing only: pages, and the document types needed to create them. Each signed-in user's
// Umbraco permissions narrow this further (the public demo account cannot publish or delete).
const ENABLED_COLLECTIONS = new Set(["document", "document-type"]);
const collections = allCollections.filter((c) => ENABLED_COLLECTIONS.has(c.metadata.name));

const options: HostedMcpServerOptions = {
  name: "umbraco-govuk-prototype-mcp",
  version: "1.0.0",
  expectedUmbracoMajor: "17",
  collections,
  modeRegistry: allModes,
  allModeNames,
  allSliceNames,
  enableConsentToolSelection: false,
  authOptions: { showReauthButton: true },
  clientFactory: () => UmbracoManagementClient.getClient(),
};

const serverOptions = getServerOptions(options);

export class UmbracoMcpAgent extends McpAgent<HostedMcpEnv, unknown, AuthProps> {
  server!: McpServer;

  async init() {
    let sessionId: string | undefined;
    try {
      sessionId = this.getSessionId?.();
    } catch {
      sessionId = undefined;
    }
    this.server = await createPerRequestServer(serverOptions, this.env, this.props!, sessionId);
  }
}

const provider = new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: UmbracoMcpAgent.serve("/mcp", { binding: "MCP_AGENT" }),
  defaultHandler: createDefaultHandler(options) as any,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});

export default createWorkerExport(provider, options);
