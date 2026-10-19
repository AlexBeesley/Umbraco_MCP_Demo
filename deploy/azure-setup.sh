#!/usr/bin/env bash
# Creates (or updates) the Azure Web App for the public demo site. Run it in Azure Cloud Shell (Bash),
# which works in a phone browser too:
#
#   curl -fsSLO https://raw.githubusercontent.com/AlexBeesley/Umbraco_MCP_Demo/claude/umbraco-govuk-mcp-poc-v99cvr/deploy/azure-setup.sh
#   bash azure-setup.sh <app-name> <worker-url> [admin-email]
#
#   app-name    globally unique, e.g. umbraco-mcp-demo-ab12 (becomes https://<app-name>.azurewebsites.net)
#   worker-url  the hosted MCP server's origin, e.g. https://umbraco-govuk-mcp.<your-subdomain>.workers.dev
#   admin-email the backoffice admin's sign-in email (default admin@example.com)
#
# Re-running it is safe: existing passwords and keys are kept. Generated values are printed once at the end
# and live only in the Web App's settings, never in the repo.
set -euo pipefail

APP_NAME="${1:?Usage: azure-setup.sh <app-name> <worker-url> [admin-email]}"
WORKER_URL="${2:?Usage: azure-setup.sh <app-name> <worker-url> [admin-email]}"
WORKER_URL="${WORKER_URL%/}"
ADMIN_EMAIL="${3:-admin@example.com}"
RESOURCE_GROUP="${RESOURCE_GROUP:-umbraco-mcp-demo}"
LOCATION="${LOCATION:-uksouth}"
PLAN="${PLAN:-umbraco-mcp-demo-plan}"
TEMPLATE_URL="${TEMPLATE_URL:-https://raw.githubusercontent.com/AlexBeesley/Umbraco_MCP_Demo/claude/umbraco-govuk-mcp-poc-v99cvr/deploy/azure-app-settings.json}"

case "$WORKER_URL" in https://*) ;; *) echo "worker-url must start with https://" >&2; exit 1 ;; esac

echo "==> Resource group $RESOURCE_GROUP ($LOCATION)"
az group create -n "$RESOURCE_GROUP" -l "$LOCATION" -o none

echo "==> App Service plan $PLAN (Linux B1)"
az appservice plan show -g "$RESOURCE_GROUP" -n "$PLAN" -o none 2>/dev/null \
  || az appservice plan create -g "$RESOURCE_GROUP" -n "$PLAN" --is-linux --sku B1 -o none

echo "==> Web App $APP_NAME (.NET 10)"
az webapp show -g "$RESOURCE_GROUP" -n "$APP_NAME" -o none 2>/dev/null \
  || az webapp create -g "$RESOURCE_GROUP" -p "$PLAN" -n "$APP_NAME" --runtime "DOTNETCORE:10.0" -o none

SITE_URL="https://$(az webapp show -g "$RESOURCE_GROUP" -n "$APP_NAME" --query defaultHostName -o tsv)"

echo "==> Always on, HTTPS only, startup command"
az webapp config set -g "$RESOURCE_GROUP" -n "$APP_NAME" --always-on true \
  --startup-file "dotnet GovUkUmbraco.Web.dll" -o none
az webapp update -g "$RESOURCE_GROUP" -n "$APP_NAME" --https-only true -o none

# The GitHub workflow deploys with the publish profile, which needs basic auth publishing credentials.
echo "==> Allow publish-profile deployments"
az resource update -g "$RESOURCE_GROUP" --namespace Microsoft.Web --resource-type basicPublishingCredentialsPolicies \
  --parent "sites/$APP_NAME" --name scm --set properties.allow=true -o none

existing() {
  az webapp config appsettings list -g "$RESOURCE_GROUP" -n "$APP_NAME" --query "[?name=='$1'].value | [0]" -o tsv 2>/dev/null || true
}
ADMIN_PASSWORD="$(existing Umbraco__CMS__Unattended__UnattendedUserPassword)"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(openssl rand -hex 12)}"
HMAC_KEY="$(existing Umbraco__CMS__Imaging__HMACSecretKey)"
HMAC_KEY="${HMAC_KEY:-$(openssl rand -hex 64)}"
# The demo password is shown on the public home page, so it only needs to be hard to guess before launch.
DEMO_PASSWORD="$(existing DemoAccess__EditorPassword)"
DEMO_PASSWORD="${DEMO_PASSWORD:-try-the-ai-demo-$(openssl rand -hex 3)}"

echo "==> App settings"
SETTINGS_FILE="$(mktemp --suffix=.json)"
trap 'rm -f "$SETTINGS_FILE"' EXIT
curl -fsSL "$TEMPLATE_URL" \
  | sed -e "s|{{ADMIN_EMAIL}}|$ADMIN_EMAIL|g" -e "s|{{ADMIN_PASSWORD}}|$ADMIN_PASSWORD|g" \
        -e "s|{{HMAC_KEY}}|$HMAC_KEY|g" -e "s|{{SITE_URL}}|$SITE_URL|g" \
        -e "s|{{DEMO_PASSWORD}}|$DEMO_PASSWORD|g" -e "s|{{WORKER_URL}}|$WORKER_URL|g" > "$SETTINGS_FILE"
if grep -q '{{' "$SETTINGS_FILE"; then echo "Unfilled placeholder in app settings" >&2; exit 1; fi
az webapp config appsettings set -g "$RESOURCE_GROUP" -n "$APP_NAME" --settings "@$SETTINGS_FILE" -o none

cat <<EOF

Done. Next, in GitHub (Settings > Secrets and variables > Actions):

  Variables:
    AZURE_WEBAPP_NAME = $APP_NAME
    SITE_URL          = $SITE_URL

  Secret AZURE_WEBAPP_PUBLISH_PROFILE = everything between the lines below.
------------------------------------------------------------------------
$(az webapp deployment list-publishing-profiles -g "$RESOURCE_GROUP" -n "$APP_NAME" --xml)
------------------------------------------------------------------------

Backoffice: $SITE_URL/umbraco
  Admin email:    $ADMIN_EMAIL
  Admin password: $ADMIN_PASSWORD   (keep this to yourself; it's also in the Web App's settings)
Public demo editor password: $DEMO_PASSWORD   (shown on the home page)
EOF
