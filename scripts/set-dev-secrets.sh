#!/usr/bin/env bash
# Stores the local admin credentials used by Umbraco's unattended install in
# .NET user-secrets, so they never land in a committed appsettings file.
#
# Usage:
#   scripts/set-dev-secrets.sh                      # generates a random password
#   UMBRACO_ADMIN_EMAIL=me@example.com UMBRACO_ADMIN_PASSWORD='...' scripts/set-dev-secrets.sh
#
# Only takes effect on the *first* boot (when the SQLite database does not exist yet).
set -euo pipefail

PROJECT="$(cd "$(dirname "$0")/../src/GovUkUmbraco.Web" && pwd)"

NAME="${UMBRACO_ADMIN_NAME:-Local Admin}"
EMAIL="${UMBRACO_ADMIN_EMAIL:-admin@example.com}"
PASSWORD="${UMBRACO_ADMIN_PASSWORD:-$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-20)}"

dotnet user-secrets --project "$PROJECT" set "Umbraco:CMS:Unattended:UnattendedUserName" "$NAME" >/dev/null
dotnet user-secrets --project "$PROJECT" set "Umbraco:CMS:Unattended:UnattendedUserEmail" "$EMAIL" >/dev/null
dotnet user-secrets --project "$PROJECT" set "Umbraco:CMS:Unattended:UnattendedUserPassword" "$PASSWORD" >/dev/null

# Umbraco 17 generates an imaging HMAC key on install and writes it into appsettings.json
# unless one is already configured. Supplying it here keeps it out of source control.
if ! dotnet user-secrets --project "$PROJECT" list | grep -q '^Umbraco:CMS:Imaging:HMACSecretKey = '; then
  dotnet user-secrets --project "$PROJECT" set "Umbraco:CMS:Imaging:HMACSecretKey" "$(openssl rand -base64 64 | tr -d '\n')" >/dev/null
fi

echo "Unattended admin user stored in user-secrets:"
echo "  Email:    $EMAIL"
if [[ -z "${UMBRACO_ADMIN_PASSWORD:-}" ]]; then
  echo "  Password: $PASSWORD   (generated - note it down)"
fi
echo "View later with: dotnet user-secrets list --project src/GovUkUmbraco.Web"
