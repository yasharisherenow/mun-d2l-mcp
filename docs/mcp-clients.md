# Connect other agents to MUN D2L MCP

The server uses the MCP SDK's standard stdio transport. Its twelve tools return
both JSON text and structured content, so clients can read results even if they
do not display structured content. No Codex-specific API is required.

## Prepare once

Complete the [Windows setup](../README.md#setup-on-windows), including build and
interactive login. Run the client and server under the same Windows account.
The existing encrypted session can be used by each client; no password, cookie,
API key, or bearer token belongs in MCP configuration.

From the repository directory, get the actual paths:

```powershell
$munNode = (Get-Command node).Source
$munEntry = Join-Path (Get-Location) 'dist/cli.js'
$munNode
$munEntry
$env:LOCALAPPDATA
```

Each client launches its own server process using the Node executable, with
the absolute entry-point path and `serve` as two separate arguments. This works
when the agent's working directory is a different project. Do not use `npx
mun-d2l-mcp`: this private project is not published to npm.

This version requires **native Windows** and Windows Credential Manager. WSL,
containers, SSH hosts, and cloud agents cannot use this local configuration as-is.
There is no HTTP/SSE endpoint. A client supporting only remote MCP URLs cannot
connect directly. Course data is returned to whichever agent you connect.

## Claude Code

In PowerShell, from the repository directory:

```powershell
$munNode = (Get-Command node).Source
$munEntry = Join-Path (Get-Location) 'dist/cli.js'
claude mcp add --env "LOCALAPPDATA=$env:LOCALAPPDATA" --transport stdio --scope user mun-d2l-mcp -- $munNode $munEntry serve
claude mcp get mun-d2l-mcp
claude mcp list
```

User scope makes the entry available across projects. Use `--scope local` instead
to restrict it to the current project. In Claude Code, use `/mcp` to inspect the
connection and available tools. The command launches Node directly, so it does
not need a `cmd /c` wrapper for an npm command.

Source: [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp).

## Cursor

Merge this entry into `mcpServers` in `%USERPROFILE%\.cursor\mcp.json` for all
projects, or `.cursor/mcp.json` in the project you use with Cursor. Preserve any
existing servers. Replace all three example paths with the values above;
forward slashes are valid in Windows Node paths and avoid JSON backslash escaping.

```json
{
  "mcpServers": {
    "mun-d2l-mcp": {
      "command": "C:/Program Files/nodejs/node.exe",
      "args": ["C:/path/to/mun-d2l-mcp/dist/cli.js", "serve"],
      "env": { "LOCALAPPDATA": "C:/Users/YOUR_USER/AppData/Local" }
    }
  }
}
```

Open Cursor's MCP settings, enable the entry, and check that tools are discovered.
Source: [Cursor MCP documentation](https://cursor.com/docs/mcp).

## VS Code / GitHub Copilot

Run **MCP: Open User Configuration** in the Command Palette to configure the
local Windows host across workspaces. Alternatively use `.vscode/mcp.json` in a
local Windows workspace. VS Code uses `servers`, rather than `mcpServers`.
Merge this entry into the existing configuration and replace the example paths:

```json
{
  "servers": {
    "mun-d2l-mcp": {
      "type": "stdio",
      "command": "C:/Program Files/nodejs/node.exe",
      "args": ["C:/path/to/mun-d2l-mcp/dist/cli.js", "serve"],
      "env": { "LOCALAPPDATA": "C:/Users/YOUR_USER/AppData/Local" }
    }
  }
}
```

Use **MCP: List Servers** to start the server and inspect its output. In Copilot
chat, select an agent with tool access and enable the server's tools in the tool
picker. Keep the server on the local Windows host when using a remote workspace.
Source: [VS Code MCP documentation](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

## Gemini CLI

Merge the Cursor section's `mcpServers` JSON into
`%USERPROFILE%\.gemini\settings.json` for user-wide access, or
`.gemini/settings.json` for project-only access. Preserve existing settings and
replace the example paths. Gemini uses the same `command`, `args`, and `env`
fields for stdio. Do not add `trust: true` unless you deliberately want to bypass
tool confirmations.

Run `gemini mcp list`, then use `/mcp` inside Gemini CLI to inspect tools. A
workspace that Gemini considers untrusted can prevent a stdio server from starting.
Source: [Gemini CLI MCP documentation](https://geminicli.com/docs/tools/mcp-server/).

## Codex and other local clients

The [Codex setup](../README.md#connect-to-codex) remains available in the README.
For another local MCP client, use its documented stdio configuration with:

| Setting | Value |
| --- | --- |
| Server name | `mun-d2l-mcp` |
| Transport | `stdio` |
| Command | Absolute path to your Windows `node.exe` |
| Arguments | Absolute path to `dist/cli.js`, then `serve` |
| Environment | `LOCALAPPDATA` set to your Windows local app-data directory |
| Optional environment | `MUN_D2L_SESSION_HOURS`, e.g. `8` |

Configuration wrappers and variable interpolation differ between clients; do not
assume every client accepts the JSON wrapper shown above. Use literal paths or
the client's documented variable syntax. No special working directory is needed.

## Verify and troubleshoot

From this repository:

```powershell
npm run build
npm run smoke
```

The offline smoke check starts the real server and verifies an MCP handshake and
twelve tool definitions without reading course data. In the connected agent, ask:
“Use mun-d2l-mcp to list my courses.” With an existing login, `npm run smoke --
--live` also checks course and deadline retrieval through the protocol.

These recipes were checked against the official documentation on 2026-09-15.
Protocol-level checks are not a claim that every client application has been
tested end to end. Verify discovery and a course read in each client you use.

- **Cannot launch:** verify the executable and built entry-point paths. Keep
  `serve` separate from the path in `args`; preserve spaces inside path strings.
- **No tools:** check the client's configuration location, trust settings, and
  tool selection; reload or restart its MCP connection after edits or rebuilding.
- **Platform/keyring error:** run native Windows Node under the account used for
  login, with `LOCALAPPDATA` explicitly passed to the child process.
- **Authentication required:** run `npm run login` in this repository, then retry.
  The MCP server itself does not open an interactive login prompt.
- **Large result or timeout:** narrow course/date filters or request smaller
  material chunks using `max_characters` and `next_offset`. Client output limits
  and timeouts may be lower than the server's limits.

Session renewal settings and [error guidance](../README.md#troubleshooting) apply
to every client. Restart each connection after changing its environment settings.
