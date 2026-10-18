// Reads and writes the site's .NET user-secrets, so local credentials never live in the repo.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../../src/GovUkUmbraco.Web', import.meta.url));
let cache;

function dotnet(...args) {
  return execFileSync('dotnet', ['user-secrets', '--project', project, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1' },
  });
}

export function getUserSecret(key) {
  cache ??= Object.fromEntries(dotnet('list').split('\n')
    .map(line => line.match(/^(.+?) = (.*)$/))
    .filter(Boolean)
    .map(([, k, v]) => [k, v]));
  return cache[key];
}

export function setUserSecret(key, value) {
  dotnet('set', key, value);
  if (cache) cache[key] = value;
}

/** Admin credentials for the unattended-install user: environment variables win, then user-secrets. */
export function adminCredentials() {
  const email = process.env.UMBRACO_ADMIN_EMAIL ?? getUserSecret('Umbraco:CMS:Unattended:UnattendedUserEmail');
  const password = process.env.UMBRACO_ADMIN_PASSWORD ?? getUserSecret('Umbraco:CMS:Unattended:UnattendedUserPassword');
  if (!email || !password) {
    throw new Error('No admin credentials: run scripts/set-dev-secrets.sh or set UMBRACO_ADMIN_EMAIL/UMBRACO_ADMIN_PASSWORD.');
  }
  return { email, password };
}
