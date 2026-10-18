# Umbraco 17 + GOV.UK Frontend + Umbraco Developer MCP

A local proof of concept that combines:

| Piece | Version |
| --- | --- |
| Umbraco CMS (LTS) on .NET 10, SQLite | 17.7.1 |
| [govuk-frontend-aspnetcore-extensions](https://github.com/thepensionsregulator/govuk-frontend-aspnetcore-extensions) (`ThePensionsRegulator.GovUk.Frontend.Umbraco`) | 10.1.7 |
| [GovUk.Frontend.AspNetCore](https://github.com/x-govuk/govuk-frontend-aspnetcore) (transitive) / GOV.UK Frontend | 4.1.0 / 6.1.0 |
| uSync | 17.4.3 |
| [Umbraco Developer MCP](https://docs.umbraco.com/umbraco-cms/reference/developer-mcp) (`@umbraco-cms/mcp-dev`) | 17.6.11 |

Everything runs locally. Secrets live in .NET user-secrets, never in the repo.

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
scripts/                     secrets, MCP API user provisioning, MCP demo
tests/e2e/                   backoffice smoke test, accessibility checks
.vscode/mcp.json             MCP server config for VS Code / GitHub Copilot
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
13. The GOV.UK crown and logotype are only for services on GOV.UK. Fine for a prototype; change the header for anything else.

**MCP**

14. **The MCP SDK sets `NODE_TLS_REJECT_UNAUTHORIZED=0` for its whole process unless `NODE_ENV=production`.** The config sets `NODE_ENV=production` and trusts the exported dev cert instead. Without the cert the server exits immediately and clients just report *"Connection closed"*.
15. The token endpoint only accepts HTTPS, so the HTTP port can't be used to avoid certificates.
16. A Content-only API user can't list document types: the MCP server hides those tools and the API returns 403. Listing needs Settings, which also allows changing document types, data types and templates.
17. `get-document-urls` fails in clients that validate tool output (the MCP SDK does): Umbraco 17.7 added `isExternal` to URL info, but MCP 17.6.11 declares that object with `additionalProperties: false`. The demo calls it without output validation.
18. `update-document` is a full replace, so leaving out `template` removes the page's template (the page then 404s). Use `update-document-properties` to change values.
19. uSync exports every change, including ones made through MCP, to `uSync/v17/`. Review before committing. The demo's own page is gitignored.

**Build environment** (only relevant if NuGet search or `dot.net` is blocked, as in the sandbox this was built in): `dotnet new install` needs the NuGet *search* endpoint, so the template was installed from a downloaded `.nupkg`; the .NET 10 SDK came from the Ubuntu feed (`apt install dotnet-sdk-10.0`).
