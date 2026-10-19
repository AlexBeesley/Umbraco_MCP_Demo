# Deploy the public demo with a VS Code agent

Open this repo in VS Code on your own machine, start an agent (GitHub Copilot in **Agent** mode, or Claude Code), and paste the prompt below as one message. The agent deploys the site to Azure and the hosted MCP server to Cloudflare, following the [README's public demo section](../README.md#public-demo-hosted-mcp).

You still have to do three things yourself, and the agent stops and asks at each one:
- sign in to Azure, Cloudflare and GitHub when the browser opens;
- create one Cloudflare API token on the Cloudflare website;
- approve the paid Azure resource (a B1 plan, about £10 a month).

## The prompt

````text
Set up the public demo from https://github.com/AlexBeesley/Umbraco_MCP_Demo (branch claude/umbraco-govuk-mcp-poc-v99cvr, which is the default branch). It's an Umbraco 17 site on Azure App Service, plus a hosted Umbraco MCP server on Cloudflare Workers, deployed by GitHub Actions. Read README.md first, especially the "Public demo (hosted MCP)" section. Follow it rather than inventing your own approach.

Ground rules:
- Never write secrets into the repo, into a committed file, or into your chat replies. Admin passwords, API tokens and publish profiles go straight from command output into GitHub secrets with "gh secret set" (pipe them; don't echo them). The only exception is the demo editor password, which is meant to be public.
- Ask me before creating anything that costs money, and before deleting anything.
- Work step by step and check each step worked before moving on. If something fails, show me the actual error and fix the root cause.
- Don't change the app's code unless a step genuinely can't work without it. If it can't, explain why, then commit and push the fix to the same branch.
- Run shell scripts in bash. On Windows, use Git Bash or WSL.

Steps:

1. Prerequisites. Check for and, if they're missing, help me install: git, Azure CLI (az) and GitHub CLI (gh). Node.js 22+ is needed only for the end-to-end test in step 6. If a company policy (such as AppLocker) blocks a tool, don't try to get around it: tell me and use the browser alternative in docs/vscode-agent-setup-prompt.md. Clone the repo if it isn't open already, and update it to the latest commit. If git refuses because src/GovUkUmbraco.Web/appsettings.json has local changes, follow the "If git won't update" section of docs/vscode-agent-setup-prompt.md.

2. Cloudflare. This needs no local tools: the deploy workflow runs Wrangler on GitHub's runners, so don't run wrangler on this machine.
   - Ask me to sign in at https://dash.cloudflare.com in my browser and open Workers & Pages (this creates my workers.dev subdomain if I don't have one yet).
   - Ask me for the subdomain and the Account ID shown there (neither is a secret).
   - The MCP URL will be https://umbraco-govuk-mcp.<subdomain>.workers.dev
   - Ask me to create an API token at https://dash.cloudflare.com/profile/api-tokens using the "Edit Cloudflare Workers" template. Run "gh secret set CLOUDFLARE_API_TOKEN" so it prompts me and I paste the token there, not into chat.
   - Set CLOUDFLARE_ACCOUNT_ID with gh secret set.

3. Azure.
   - Run "az login".
   - Ask me for a globally unique app name (suggest one like umbraco-mcp-demo-<4 random chars>) and the admin email.
   - Confirm I'm OK with a B1 Linux plan in uksouth, about £10 a month.
   - Run: bash deploy/azure-setup.sh <app-name> https://umbraco-govuk-mcp.<subdomain>.workers.dev <admin-email>
   - The script prints the site URL, the admin and demo passwords, and the publish profile.
   - Don't repeat the admin password in chat; tell me to copy it from the terminal myself.
   - Put the publish profile into GitHub without it passing through chat:
     az webapp deployment list-publishing-profiles -g umbraco-mcp-demo -n <app-name> --xml | gh secret set AZURE_WEBAPP_PUBLISH_PROFILE
   - If the .NET 10 runtime or basic-auth publishing step fails, fix it with az commands and tell me what you changed.

4. GitHub.
   - Run "gh auth login" if needed.
   - Set the variables AZURE_WEBAPP_NAME and SITE_URL with "gh variable set" (SITE_URL is the https site URL the script printed).
   - Check that all three secrets and both variables exist with "gh secret list" and "gh variable list".

5. Deploy.
   - Run: gh workflow run deploy-site.yml, then gh workflow run deploy-mcp.yml
   - Watch them with "gh run watch".
   - If either fails, read the logs with "gh run view --log-failed", fix the problem, and re-run.
   - The MCP workflow's summary shows the worker URL. Check it matches the one passed to the Azure script. If it doesn't, re-run the Azure script with the right URL.

6. Verify.
   - Wait for the site to come up (the first boot takes about a minute).
   - Check the home page shows "Try editing this site with AI" with the MCP URL and demo login.
   - Check <site>/umbraco loads.
   - Run the end-to-end test from the repo root:
     npm ci && MCP_URL=<worker-url>/mcp DEMO_PASSWORD=<demo password from the home page> npm run test:hosted-mcp
   - It must print "Hosted MCP test passed."
   - Then sign in to the backoffice as admin and delete the test draft it created.

7. Finish by giving me a short summary:
   - the site URL, backoffice URL and MCP URL
   - how to add the MCP URL in Claude (Settings > Connectors > Add custom connector) and in ChatGPT (developer mode connectors)
   - how to tear it all down: az group delete -n umbraco-mcp-demo, and delete the umbraco-govuk-mcp worker in the Cloudflare dashboard
   - anything you had to change or work around
````

## If git won't update: `appsettings.json` has local changes

If you've run the site locally before, the agent may report that the checkout is behind and that git won't update it because of local changes to `src/GovUkUmbraco.Web/appsettings.json`. Umbraco causes this: on first run it writes a generated image-signing key (`HMACSecretKey`) into that file if one isn't already set, and sometimes a database connection string too (README gotcha 1). The key is a secret, so don't commit it. Paste this to the agent:

````text
The appsettings.json change is Umbraco writing settings on first run (README gotcha 1). Fix it like this:
1. Run git diff src/GovUkUmbraco.Web/appsettings.json, but show me only the names of the changed settings, never their values.
2. If it's only Umbraco:CMS:Imaging:HMACSecretKey and/or ConnectionStrings: copy the HMAC key into user-secrets without printing it:
   dotnet user-secrets set "Umbraco:CMS:Imaging:HMACSecretKey" "<value from the diff>" --project src/GovUkUmbraco.Web
   If it's anything else, stop and show me the setting names first.
3. Run git stash push src/GovUkUmbraco.Web/appsettings.json, then git pull.
4. Check that the mcp-hosted folder now exists, then carry on from step 2 of the setup (Cloudflare).
````

This keeps your local site's image links working, and the old file stays in the git stash rather than being deleted. To stop it happening on a new machine, run `scripts/set-dev-secrets.sh` (or the PowerShell version in the README) before the site's first run.

## If your machine blocks tools (AppLocker or similar)

Don't try to get around the block. None of the deploy steps need anything except `gh`:

- **Cloudflare:** no local tools needed (the workflow runs Wrangler on GitHub).
- **Azure:** if `az` is blocked, run `deploy/azure-setup.sh` in **Azure Cloud Shell** in the browser, as the README describes. Then add `AZURE_WEBAPP_PUBLISH_PROFILE` in GitHub's web UI (Settings › Secrets and variables › Actions).
- **GitHub:** if `gh` is blocked, add every secret and variable in that same web page, and start the workflows from the **Actions** tab.
- **Test:** if Node is blocked, skip `npm run test:hosted-mcp`. Check by hand instead: add the MCP URL to Claude or ChatGPT and ask it to create a draft page.

## Notes

- The site resets to the repo's content whenever it restarts or redeploys. This is deliberate for a public sandbox.
- Drafts made with the shared demo account are deleted after 24 hours unless an admin publishes them.
- Microsoft 365 Copilot (through Copilot Studio) needs your tenant admin to allow custom agents and MCP connectors, so it's left out of this prompt. See the README's "Connect an AI app" table.
