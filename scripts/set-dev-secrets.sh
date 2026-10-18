#!/usr/bin/env bash
# Stores local-only secrets in .NET user-secrets so they never land in a committed appsettings file:
#   - the admin user created by Umbraco's unattended install
#   - the imaging HMAC key (Umbraco 17 otherwise generates one on install and writes it into appsettings.json)
#
# Usage:
#   scripts/set-dev-secrets.sh                      # keeps existing values, generates any that are missing
#   UMBRACO_ADMIN_EMAIL=me@example.com UMBRACO_ADMIN_PASSWORD='...' scripts/set-dev-secrets.sh
#
# The admin user is only created on the *first* boot (when the SQLite database does not exist yet),
# so changing the password here afterwards does not change it in Umbraco.
set -euo pipefail

PROJECT="$(cd "$(dirname "$0")/../src/GovUkUmbraco.Web" && pwd)"
EXISTING="$(dotnet user-secrets --project "$PROJECT" list 2>/dev/null || true)"

current() { sed -n "s/^$1 = //p" <<<"$EXISTING"; }

# set_secret KEY OVERRIDE DEFAULT: an explicit override wins, then any existing value, then the default.
set_secret() {
  local key="$1" value="$2"
  [[ -z "$value" ]] && value="$(current "$key")"
  [[ -z "$value" ]] && value="$3"
  dotnet user-secrets --project "$PROJECT" set "$key" "$value" >/dev/null
  printf '%s' "$value"
}

set_secret "Umbraco:CMS:Unattended:UnattendedUserName" "${UMBRACO_ADMIN_NAME:-}" "Local Admin" >/dev/null
EMAIL="$(set_secret "Umbraco:CMS:Unattended:UnattendedUserEmail" "${UMBRACO_ADMIN_EMAIL:-}" "admin@example.com")"
GENERATED_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-20)"
PASSWORD="$(set_secret "Umbraco:CMS:Unattended:UnattendedUserPassword" "${UMBRACO_ADMIN_PASSWORD:-}" "$GENERATED_PASSWORD")"
set_secret "Umbraco:CMS:Imaging:HMACSecretKey" "" "$(openssl rand -base64 64 | tr -d '\n')" >/dev/null

echo "Secrets stored in user-secrets for $PROJECT"
echo "  Admin email:    $EMAIL"
if [[ "$PASSWORD" == "$GENERATED_PASSWORD" ]]; then
  echo "  Admin password: $PASSWORD   (generated - note it down)"
fi
echo "View them with: dotnet user-secrets list --project src/GovUkUmbraco.Web"
