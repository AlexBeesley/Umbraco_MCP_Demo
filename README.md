# Umbraco 17 + GOV.UK Frontend + Umbraco Developer MCP

A local proof of concept that combines:

| Piece | Version |
| --- | --- |
| Umbraco CMS (LTS) on .NET 10, SQLite | 17.7.1 |
| [govuk-frontend-aspnetcore-extensions](https://github.com/thepensionsregulator/govuk-frontend-aspnetcore-extensions) (`ThePensionsRegulator.GovUk.Frontend.Umbraco`) | 10.1.7 |
| [GovUk.Frontend.AspNetCore](https://github.com/x-govuk/govuk-frontend-aspnetcore) (transitive) / GOV.UK Frontend | 4.1.0 / 6.1.0 |
| uSync | 17.4.3 |
| [Umbraco Developer MCP](https://docs.umbraco.com/umbraco-cms/reference/developer-mcp) (`@umbraco-cms/mcp-dev`) | 17.6.11 |

It runs locally by default, and can also be deployed as a [public demo](#public-demo-hosted-mcp) that anyone can edit from Claude, ChatGPT or Microsoft 365 Copilot. Secrets live in .NET user-secrets or the host's settings, never in the repo.

## Setup

Prerequisites: .NET 10 SDK, Node.js 22.3+, and the ASP.NET Core dev certificate (`dotnet dev-certs https --trust` on Windows/macOS; on Linux your browser will warn about it).

```bash
# 1. Local secrets: admin user for the unattended install + imaging HMAC key (prints a generated password)
scripts/set-dev-secrets.sh

# 2. Run the site (first boot installs Umbraco into SQLite and uSync imports all types and content)
dotnet run --project src/GovUkUmbraco.Web --launch-profile Umbraco.Web.UI
```

- Site: <https://localhost:44398> &nbsp;·&nbsp; Backoffice: <https://localhost:44398/umbraco> (sign in with the email/password from step 1)
- Forgot the password? `dotnet user-secrets list --project src/GovUkUmbraco.Web`

<details>
<summary>Windows (PowerShell) equivalent of step 1</summary>

```powershell
$p = "src/GovUkUmbraco.Web"
dotnet user-secrets --project $p set "Umbraco:CMS:Unattended:UnattendedUserName" "Local Admin"
dotnet user-secrets --project $p set "Umbraco:CMS:Unattended:UnattendedUserEmail" "admin@example.com"
dotnet user-secrets --project $p set "Umbraco:CMS:Unattended:UnattendedUserPassword" "<a password of 10+ characters>"
dotnet user-secrets --project $p set "Umbraco:CMS:Imaging:HMACSecretKey" ([Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(64)))
```
</details>

To start again from scratch, stop the site and delete `src/GovUkUmbraco.Web/umbraco/Data/Umbraco.sqlite.db*`. The next boot reinstalls and re-imports; then re-run `npm run mcp:create-api-user`.

## What's in the site

```
src/GovUkUmbraco.Web/
  Program.cs                 AddTprGovUkFrontendUmbraco() + UseTprGovUkFrontendUmbraco() around the Umbraco pipeline
  Views/Shared/_Layout.cshtml GOV.UK master layout (skip link, header, service navigation, phase banner, breadcrumbs, footer)
  Views/Home.cshtml, ContentPage.cshtml   new page types rendered directly with GOV.UK tag helpers
  Views/*.cshtml, Controllers/, Models/   ten pages recreated from the extensions repo's Umbraco example app
  Models/ModelsBuilder/      generated models (SourceCodeManual), committed
  uSync/v17/                 document types, templates, languages, dictionary and sample content
  Demo/                      public demo mode: the shared drafts-only editor account
scripts/                     secrets, MCP API user provisioning, MCP demo
tests/e2e/                   backoffice smoke test, accessibility checks, hosted MCP end-to-end test
.vscode/mcp.json             MCP server config for VS Code / GitHub Copilot
mcp-hosted/                  public (remote) MCP server: a Cloudflare Worker
deploy/                      Azure setup script and app settings for the public demo
.github/workflows/           deploys the site to Azure and the MCP server to Cloudflare
```

- **Component example pages** (Typography, Inset text, Details, Warning text, Notification banner, Summary list, and the Text input / Radios / Checkboxes forms with client- and server-side validation) come from the [example app](https://github.com/thepensionsregulator/govuk-frontend-aspnetcore-extensions/tree/main/GovUk.Frontend.Umbraco.ExampleApp). Editors build them from GOV.UK blocks in the block list / block grid editors. The example's Home, Accordion and Grid pages were left out because they depend on TPR-branded (not GOV.UK) types.
- **Home** and **Content page** are new: ordinary properties rendered with `<govuk-inset-text>`, `<govuk-summary-list>` and GOV.UK typography.
- The package's 42 GOV.UK data types and 123 block element types are copied into `uSync/ThePensionsRegulator.GovUk.Frontend.Umbraco/` on each build (gitignored) and imported alongside `uSync/v17/`.
- After changing document types: Settings › Models Builder › Generate models, then rebuild. (The first boot leaves a gitignored `Models/ModelsBuilder/ood.flag` and a build warning saying models are out of date; the committed models already match, so it can be ignored.)

## Accessibility (WCAG 2.2 AA)

```bash
npm install
npm run test:a11y    # axe-core with WCAG 2.0/2.1/2.2 A and AA rules, every page + each form after a failed submit
npm run test:smoke   # signs in to the backoffice
```

The check also fails on JavaScript errors and on wrong page titles (`Error:` prefix only when errors are shown). Every page state currently passes. Also checked by hand: skip link is the first tab stop and moves focus to `<main>`; error summary receives focus; the mobile menu works and the layout reflows at 360px with no horizontal scrolling; forms validate server-side with JavaScript off. Automated tools only catch part of WCAG, so this is not a substitute for an audit with assistive technology.

One **known upstream issue** is reported but not failed: GOV.UK Frontend's own radios script sets `aria-expanded` on a radio that reveals a conditional question, which axe flags (`aria-allowed-attr`). This is Design System behaviour and identical on GOV.UK.

## Umbraco Developer MCP

### 1. API user (least privilege)

With the site running:

```bash
npm install
npm run mcp:create-api-user      # idempotent; --rotate issues a new secret
```

This exports the dev certificate's public part to `.certs/localhost-dev-cert.pem` (gitignored) for the MCP server to trust, and creates, through the same Management API calls the backoffice makes:

| | Setting | Why |
| --- | --- | --- |
| User | **Umbraco Developer MCP**, kind *API user* | Can't sign in to the backoffice; client credentials only |
| Client | `umbraco-back-office-mcp`, secret in user-secrets (`Mcp:UmbracoClientSecret`) | Never written to the repo |
| Group | **MCP Content Agent** | |
| Sections | Content, Settings | Settings is required to *list* document types (Umbraco authorises that by section; there's no read-only Settings). Use `--content-only` if you don't need that. |
| Content | Start node *Home*; Read, Create, Update, Publish | No Delete, Move, Unpublish, Sort, Rollback, Public access, Culture & hostnames or Permissions |
| Media / languages | None / en-GB only | |

Verified against the API with the MCP user's token: creating outside Home, deleting, unpublishing, writing media, and reading users or members all return 403.

To do it by hand instead: Users › Create › **API User** (name, email, group) › Save, then **Client Credentials › Add** on the user. Create the group first under Users › User Groups with the settings above.

### 2. VS Code / GitHub Copilot agent mode

[`.vscode/mcp.json`](.vscode/mcp.json) defines the `umbraco` server. Open the folder in VS Code, start the server (the **Start** code lens in `mcp.json`, or *MCP: List Servers*), and paste the client secret when prompted (VS Code stores it in its secret storage). Then in Copilot Chat choose **Agent** mode and enable the `umbraco` tools.

The config:
- runs `npx -y @umbraco-cms/mcp-dev@17.6.11` against `https://localhost:44398`;
- limits tools to the `document` and `document-type` collections (56 tools). GitHub Copilot caps the number of tools per request, and the full server has 500+;
- hides document-type write tools (`UMBRACO_EXCLUDE_TOOLS`). This is advisory only; the user group is the real security boundary;
- keeps TLS verification on (`NODE_ENV=production` + `NODE_EXTRA_CA_CERTS`). See gotchas.

For Copilot you also need VS Code with MCP support (1.102+), and for Copilot Business/Enterprise the organisation policy **"MCP servers in Copilot"** must be enabled. Copilot's *cloud* coding agent can't reach `localhost`; this is for local agent mode.

### 3. Demo

```bash
npm run mcp:demo
```

This starts the server from `.vscode/mcp.json` with the official MCP client SDK, then:

```
Connected to Umbraco CMS Developer MCP Server 17.6.11 at https://localhost:44398: 56 tools available to this API user
> get-all-document-types
  135 document types (12 page types, 123 element types). Page types:
   - Checkboxes  - Content page  - Details  - Home  - Inset text  - Notification banner
   - Panel  - Radios  - Summary list  - Text input  - Typography  - Warning text
> create-document  {"documentTypeId":"…","parentId":"<Home>","name":"Created by MCP",…}
> publish-document {"id":"…","data":{"publishSchedules":[{"culture":null}]}}
> get-document-urls → /created-by-mcp/
GET /created-by-mcp/ -> HTTP 200, <h1>: "Created by the Umbraco MCP server"
```

Re-running updates the page instead of creating another one. In Copilot you can ask the same thing in plain English, e.g. *"List the document types, then create and publish a Content page under Home called 'Test page'"*.

## Public demo (hosted MCP)

The local setup above needs Node, a terminal and a client secret. The public demo removes all of that: the site runs on Azure, a **remote MCP server** runs on Cloudflare, and anyone can add its URL to an AI app on their own device and sign in through the browser.

```
AI app (Claude, ChatGPT, M365 Copilot, VS Code)
   │  https://umbraco-govuk-mcp.<you>.workers.dev/mcp   (MCP over Streamable HTTP + OAuth)
   ▼
Cloudflare Worker  (mcp-hosted/, @umbraco-cms/mcp-hosted)
   │  OAuth sign-in as an Umbraco backoffice user, then Management API calls as that user
   ▼
Umbraco site on Azure App Service  (Umbraco.Mcp.HostedAuth registers the worker as an OAuth client)
```

**What the public can do.** The home page shows a shared account, *Demo editor*. Its user group, *AI demo editors*, can read, create and edit pages under Home. It can't publish, delete, move or change document types, so nothing anyone writes goes live. The site keeps that account in place: it resets the password if someone changes it, and deletes the account's never-published pages after 24 hours. The worker also hides publish, delete and settings tools so the AI doesn't try them. Umbraco's permissions are the real boundary (a direct publish call gets 403).

**Branding.** The public site turns `Site:GovUkBranding` off, which gives it a neutral header and footer, no crown or GDS Transport font, and a phase banner saying it isn't a government service. Locally, branding stays on.

**Resets.** The database lives in the container's `/tmp`, so a restart or redeploy reinstalls the site from `uSync/` (about a minute). Drafts and edits made in the backoffice don't survive that. This is deliberate for a public sandbox; for anything real, use a persistent database.

### Deploy it (about 20 minutes, works from a phone browser)

1. **Cloudflare** (free plan): sign up at <https://dash.cloudflare.com>, open **Workers & Pages** once so your `*.workers.dev` subdomain is created, and note it. Your MCP server will be `https://umbraco-govuk-mcp.<subdomain>.workers.dev`.
   Then create an API token: **My Profile › API Tokens › Create Token › "Edit Cloudflare Workers"** template. Note the token and your **Account ID** (shown on the Workers & Pages overview).
2. **Azure**: sign in at <https://portal.azure.com> and open **Cloud Shell** (Bash). Run:
   ```bash
   curl -fsSLO https://raw.githubusercontent.com/AlexBeesley/Umbraco_MCP_Demo/claude/umbraco-govuk-mcp-poc-v99cvr/deploy/azure-setup.sh
   bash azure-setup.sh <unique-app-name> https://umbraco-govuk-mcp.<subdomain>.workers.dev you@example.com
   ```
   This creates a Linux B1 Web App (about £10/month; delete the `umbraco-mcp-demo` resource group to stop paying). It turns on Always On, HTTPS only and publish-profile deployments, and fills in [`deploy/azure-app-settings.json`](deploy/azure-app-settings.json) with a generated admin password, imaging key and demo password. At the end it prints those, the site URL and the publish profile. Re-running it keeps the existing passwords.
3. **GitHub**: in the repo, open **Settings › Secrets and variables › Actions**. Add these values from the steps above:

   | Kind | Name | Value |
   | --- | --- | --- |
   | Secret | `AZURE_WEBAPP_PUBLISH_PROFILE` | the XML printed by the script |
   | Secret | `CLOUDFLARE_API_TOKEN` | the token from step 1 |
   | Secret | `CLOUDFLARE_ACCOUNT_ID` | your account ID |
   | Variable | `AZURE_WEBAPP_NAME` | the app name |
   | Variable | `SITE_URL` | the site URL the script printed |

4. **Deploy**: go to **Actions** and run **Deploy site (Azure)** and **Deploy MCP server (Cloudflare)** (*Run workflow*). After that, both run on every push that changes their part of the repo. Until the secrets exist they skip without failing. The MCP workflow creates the KV namespace and the worker's secrets for you.
5. **Check it**: open the site; after about a minute the home page shows *Try editing this site with AI* with the MCP URL, email and password. From a computer you can run the end-to-end test against the live servers:
   ```bash
   MCP_URL=https://umbraco-govuk-mcp.<subdomain>.workers.dev/mcp DEMO_PASSWORD=<shown on the home page> npm run test:hosted-mcp
   ```

The admin account (from step 2) signs in at `<site>/umbraco`, where you can review drafts and publish them.

### Connect an AI app

Every app below adds the server by URL, opens the site's sign-in page in a browser, then works with the signed-in user's permissions.

| App | Where |
| --- | --- |
| **Claude** (web, desktop, mobile) | Settings › Connectors › *Add custom connector*, paste the MCP URL. Connectors added on the web also appear in the mobile app. |
| **ChatGPT** | Settings › Apps & Connectors › Advanced › *Developer mode*, then *Create* a connector with the MCP URL (paid plans). |
| **Microsoft 365 Copilot** | Through **Copilot Studio**: create an agent, then *Tools › Add a tool › Model Context Protocol*. Paste the MCP URL and choose OAuth 2.0 with dynamic discovery. Publish the agent to the *Teams and Microsoft 365 Copilot* channel; it then appears in the Copilot agent list in the browser. Your tenant admin has to allow custom agents and MCP connectors. |
| **VS Code / GitHub Copilot** | *MCP: Add Server › HTTP*, paste the MCP URL. |

Then ask, for example, *"Create a page under Home called 'Opening times' with a short intro"*. The page appears as a draft in the backoffice for an admin to review and publish.

### Run the hosted MCP server locally

```bash
# Terminal 1: the site in public-demo mode (registers the worker at http://127.0.0.1:8787 as an OAuth client)
Site__GovUkBranding=false DemoAccess__Enabled=true DemoAccess__EditorPassword=<pick one> \
DemoAccess__McpUrl=http://127.0.0.1:8787/mcp dotnet run --project src/GovUkUmbraco.Web --launch-profile Umbraco.Web.UI

# Terminal 2: the worker (copy .dev.vars.example to .dev.vars first and set COOKIE_ENCRYPTION_KEY)
cd mcp-hosted && npm install && npm run dev

# Terminal 3
DEMO_PASSWORD=<the same one> npm run test:hosted-mcp
```

The test connects like an AI app: it registers with the worker, signs in as the demo editor in a real browser, lists the tools (32, with no publish or delete), creates a draft, and checks that publishing is refused.

## Gotchas

**Umbraco / .NET**
1. **Umbraco 17 writes an imaging `HMACSecretKey` into `appsettings.json` on install** (unless one is already configured). `set-dev-secrets.sh` pre-seeds it in user-secrets so it never gets committed.
2. The template's `RazorCompileOnBuild=false` is only meant for `InMemoryAuto` models; it's removed here because this site uses `SourceCodeManual` models.
3. `@page` is a Razor directive: a loop variable named `page` (`@page.Url()`) breaks compilation. Use another name.
4. The layout must be `UmbracoViewPage<object>`: the form pages pass view models, not `IPublishedContent`.
5. Umbraco's fallback for documents without a template looks for a view named after the alias (`contentPage`), which misses `ContentPage.cshtml` on case-sensitive file systems.
6. The example content uses en-GB and Welsh; the install's en-US language remains as a non-default language.
7. `dotnet restore` warns about vulnerable transitive packages from Umbraco (e.g. SixLabors.ImageSharp 3.1.12). Umbraco 17 can't move to ImageSharp 4.

**GOV.UK packages**

8. The package's generated `uSync/…/.gitignore` is empty on Linux/macOS (its `*` line is treated as an MSBuild glob), so this repo ignores that folder itself.
9. Two `<title>` tag helpers both add `Error:`. GovUk.Frontend.AspNetCore's fires whenever an error summary is rendered, and the TPR form views always render a hidden one, so every form page was titled "Error:". The layout removes that one with `@removeTagHelper` and keeps the TPR one, which checks `ModelState`.
10. GovUk.Frontend.AspNetCore 4.1.0 doesn't apply GOV.UK Frontend's defaults for the service navigation's `id`/menu text, which breaks the mobile menu's JavaScript. They're set explicitly in the layout.
11. The phase banner tag helper renders its own `govuk-width-container`, so it sits outside the page's container.
12. Rich text in a confirmation panel gets `govuk-body` (near-black text on green), which fails contrast. Fixed in `wwwroot/css/site.css`.
13. The GOV.UK crown, logotype and GDS Transport font are only for services on GOV.UK. Set `Site:GovUkBranding` to `false` for anything else (the public demo does).

**MCP**

14. **The MCP SDK sets `NODE_TLS_REJECT_UNAUTHORIZED=0` for its whole process unless `NODE_ENV=production`.** The config sets `NODE_ENV=production` and trusts the exported dev cert instead. Without the cert the server exits immediately and clients just report *"Connection closed"*.
15. The token endpoint only accepts HTTPS, so the HTTP port can't be used to avoid certificates.
16. A Content-only API user can't list document types: the MCP server hides those tools and the API returns 403. Listing needs Settings, which also allows changing document types, data types and templates.
17. `get-document-urls` fails in clients that validate tool output (the MCP SDK does): Umbraco 17.7 added `isExternal` to URL info, but MCP 17.6.11 declares that object with `additionalProperties: false`. The demo calls it without output validation.
18. `update-document` is a full replace, so leaving out `template` removes the page's template (the page then 404s). Use `update-document-properties` to change values.
19. uSync exports every change, including ones made through MCP, to `uSync/v17/`. Review before committing. The demo's own page is gitignored.

**Public demo / hosted MCP**

20. `Umbraco.Mcp.HostedAuth` silently skips an MCP client with no `Origins`. It logs *"No MCP clients to register"* and the worker's sign-in fails with `invalid_client`. Its redirect URIs are `{origin}/callback`, so the origin must be the worker's exact URL.
21. The hosted MCP server doesn't hide tools by the user's permissions (the local one does), so `wrangler.toml` excludes them with `UMBRACO_EXCLUDE_SLICES`/`UMBRACO_EXCLUDE_TOOLS`.
22. `expectedUmbracoMajor` must be a string (`"17"`). A number crashes the worker with *"expectedUmbracoMajor?.trim is not a function"*.
23. Outside Development, Umbraco's OpenIddict only accepts HTTPS. Behind Azure's proxy that needs `ASPNETCORE_FORWARDEDHEADERS_ENABLED=true`. Locally the site disables the check in Development only, so the worker can exchange tokens over HTTP.
24. The GOV.UK Frontend Umbraco package copies its uSync files and CSS into the project *during* the build. A single `dotnet publish` from a clean checkout leaves them out (the site then installs without the GOV.UK data and block types), so CI builds first and checks the folder is there.
25. Saving a user revokes their sessions, which signs out every connected AI app. The demo account service only resets the password when it no longer matches.
26. On a fresh install the content arrives through uSync after startup, so the demo account is created about 30 to 60 seconds after boot.

**Build environment** (only relevant if NuGet search or `dot.net` is blocked, as in the sandbox this was built in): `dotnet new install` needs the NuGet *search* endpoint, so the template was installed from a downloaded `.nupkg`; the .NET 10 SDK came from the Ubuntu feed (`apt install dotnet-sdk-10.0`).
