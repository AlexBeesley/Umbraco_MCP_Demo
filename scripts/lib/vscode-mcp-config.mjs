// Loads a server definition from .vscode/mcp.json and resolves its variables the way VS Code does,
// so scripts exercise exactly the configuration that VS Code and GitHub Copilot agent mode use.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const workspaceFolder = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]$/, '');

/** Removes // and /* *\/ comments outside strings (mcp.json is JSON with comments). */
function stripJsonComments(text) {
  let out = '';
  for (let i = 0, inString = false; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') out += text[++i];
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1;
    } else {
      out += c;
    }
  }
  return out;
}

/**
 * @param {string} name server name in mcp.json
 * @param {Record<string, string>} inputs values for ${input:<id>} (VS Code would prompt for these)
 */
export function loadMcpServer(name, inputs) {
  const config = JSON.parse(stripJsonComments(readFileSync(`${workspaceFolder}/.vscode/mcp.json`, 'utf8')));
  const server = config.servers?.[name];
  if (!server) throw new Error(`No "${name}" server in .vscode/mcp.json`);

  const resolve = value => value
    .replaceAll('${workspaceFolder}', workspaceFolder)
    .replace(/\$\{input:([^}]+)\}/g, (_, id) => {
      if (inputs[id] === undefined) throw new Error(`No value supplied for \${input:${id}}`);
      return inputs[id];
    });

  return {
    command: server.command,
    args: (server.args ?? []).map(resolve),
    env: Object.fromEntries(Object.entries(server.env ?? {}).map(([k, v]) => [k, resolve(v)])),
  };
}
