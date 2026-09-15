# Troubleshooting mun-d2l-mcp

This guide covers common issues, their causes, and recovery steps.

## Windows Credential Manager

### Verifying Credential Manager is working

1. Press `Win + R` and open `mmc.exe` (Microsoft Management Console)
2. Click **File** → **Add/Remove Snap-in...**
3. Select **Credential Manager** from the list and click **Add**
4. Click **OK**
5. In the left sidebar, expand **Credential Manager** and click **Windows Credentials**
6. Look for an entry named `mun-d2l-mcp` with type "Generic credential"

If you see the `mun-d2l-mcp` entry:
- Your credentials are securely stored
- You have access to Windows Credential Manager
- The application can retrieve your encrypted session

If you don't see the entry:
- You haven't logged in yet (run `npm run login`)
- Or your session was deleted by `npm run logout`

### Granting Credential Manager access

If you get `KEYRING_UNAVAILABLE` errors:

1. Verify you're running as your normal Windows user account (not as Administrator or a different user)
2. Check that Windows Credential Manager is not disabled in Group Policy:
   - Press `Win + R`, type `gpedit.msc`
   - Navigate to **Computer Configuration** → **Administrative Templates** → **Windows Components** → **Credential Manager**
   - Ensure "Allow credentials to be stored for network authentication" is not disabled
3. If you're on a managed/domain-joined computer, contact your IT department

### Different user accounts

If you run mun-d2l-mcp under a different Windows user account (including running as Administrator), it cannot access credentials stored under your main account. Always run it as your normal user.

## Session authentication and renewal

### Understanding session renewal

- **Default renewal interval**: Every 4 hours
- **How it works**: The server uses your saved MUN Login cookies (encrypted) to silently renew your Brightspace session
- **When it runs**: At the start of a tool request when the saved session reaches the age configured by `MUN_D2L_SESSION_HOURS`
- **What happens on success**: You continue using the same session with no interruption
- **What happens on failure**: The tool returns a classified error; run `npm run renew` or `npm run login` locally

### Authentication timeout or busy session

MCP authentication has a 40-second budget. Waiting for another login, renewal, or
logout is limited to five seconds. `AUTH_TIMEOUT` means the overall authentication
budget expired; run `npm run renew` locally, then retry. `SESSION_BUSY` means another
session lifecycle command still holds the cross-process lock; wait for that command
to finish and retry.

These limits cover authentication only. Course retrieval and document extraction
start after authentication and retain their existing per-request and parser limits.

### Classified live verification

Build first, then run `npm run verify:live`. Use `-- --json` for machine-readable
output. Authentication expiry, timeout/busy, upstream availability, incomplete
coverage, response-contract, and local-setup failures are reported separately.

The first successful run warns that no API-version baseline exists. Run
`npm run verify:live -- --accept-baseline` to save one only after every required
check passes with complete deadline coverage. Version drift is a warning until a
successful run explicitly accepts the new baseline. The baseline is stored at
`%LOCALAPPDATA%\mun-d2l-mcp\verification-baseline.json` and contains only selected
LP/LE versions, the application version, and a verification timestamp.

### Session renewal FAQ

**Q: How do I know if my session is about to expire?**

Run:
```powershell
npm run status
```

This shows:
- Your current session age
- Whether authentication is available
- How long remains until the next request will attempt age-based renewal

**Q: What happens if I ignore renewal warnings?**

Nothing immediately happens. MUN controls the actual session lifetime and does not
expose a reliable expiry time. When the session expires:
1. The next tool call attempts silent renewal once and otherwise returns `AUTH_REQUIRED`
2. You'll need to run `npm run login` to re-authenticate

**Q: Can I disable age-based renewal?**

Yes, set `MUN_D2L_SESSION_HOURS=0` when adding the MCP entry to Codex. The server will only refresh when Brightspace rejects the session.

**Q: Does renewal happen while I'm sleeping?**

No. Renewal is checked only when a tool request or an explicit `npm run renew`
command runs.

**Q: What's the fastest renewal interval I can use?**

`MUN_D2L_SESSION_HOURS=0.25` (15 minutes). However, more frequent renewal increases the risk of timing conflicts and provides minimal practical benefit.

**Q: What's the maximum renewal interval?**

`MUN_D2L_SESSION_HOURS=168` (one week). Use this only if you trust your Brightspace session will remain valid for that long.

## Session expired or invalid

### Error: "Session expired"

**Cause**: Your Brightspace or MUN Login session has expired.

**Quick fix**:
```powershell
npm run login
```

Then retry your tool call.

**Why this happens**:
- Your Brightspace session cookie expired according to MUN's server-side policy
- Your MUN SSO session expired (may happen sooner than Brightspace)
- Silent renewal failed repeatedly and the server couldn't refresh
- Your session was invalidated by a password change, security event, or device logout

**Prevention**:
- Keep age-based renewal enabled with the default `MUN_D2L_SESSION_HOURS=4` or lower
- Run `npm run status` periodically to check session age
- If you change your MUN password, run `npm run login` to update your session

### Error: "AUTH_REQUIRED"

**Cause**: Your Brightspace authentication is missing or invalid.

**Quick fix**:
```powershell
npm run login
```

**Why this happens**:
- You haven't logged in yet
- Your session was deleted by `npm run logout`
- Your Brightspace cookie was corrupted or deleted

### Error: "SESSION_UNREADABLE"

**Cause**: Your saved session file is corrupted or your encryption key is missing.

**Fix**:
```powershell
npm run logout
npm run login
```

This deletes the corrupted session and creates a fresh one.

**Why this happens**:
- The encrypted session file was modified or corrupted
- Your Windows Credential Manager entry for `mun-d2l-mcp` was deleted
- Your Windows account security context changed (rare on non-domain computers)

### Error: "SESSION_BUSY"

**Cause**: Another login, renewal, or logout operation is already in progress.

**Fix**: Wait for the other lifecycle command to finish, then retry. An MCP tool
waits at most five seconds before returning `SESSION_BUSY`.

**Why this happens**:
- You ran `npm run login` while a renewal was happening
- You ran two tool calls at exactly the same time
- A previous login or renewal is still cleaning up

## Common error codes and recovery

| Error Code | Meaning | Quick Fix |
| --- | --- | --- |
| `AUTH_REQUIRED` | No valid Brightspace session | `npm run login` |
| `AUTH_TIMEOUT` | MCP authentication exceeded its 40-second budget | `npm run renew`, then retry |
| `SESSION_UNREADABLE` | Encrypted session corrupted or key missing | `npm run logout` then `npm run login` |
| `SESSION_BUSY` | Another auth operation is running | Wait 10–30 sec and retry |
| `KEYRING_UNAVAILABLE` | Credential Manager not accessible | Run as your normal user account, not Administrator |
| `PERMISSION_DENIED` | You don't have access to this resource in Brightspace | Check the resource is visible in your Brightspace account |
| `NETWORK_ERROR` | Network connectivity problem | Check your internet connection and retry |
| `SERVICE_UNAVAILABLE` | Brightspace servers are down or unreachable | Retry later; your session is preserved |
| `RATE_LIMITED` | Too many requests to Brightspace | Wait a few minutes and retry |
| `NOT_FOUND` | The course, assignment, or quiz no longer exists | Re-list courses and verify IDs |
| `REDIRECT_BLOCKED` | Tool tried to follow an external link | Open the resource directly in Brightspace |
| `UNSUPPORTED_FILE` | File format is not supported (e.g., video, image, Word) | Open in Brightspace and read manually |
| `RESPONSE_TOO_LARGE` | Response exceeded size limits (20 MiB raw, 2 MiB processed) | Narrow your query or open the resource in Brightspace |
| `RESPONSE_SIZE_UNKNOWN` | Brightspace didn't report the response size | Check your network and retry |
| `OUTPUT_LIMIT` | Result exceeded 2 MiB MCP output limit | Narrow your query |
| `EXTRACTION_LIMIT` | Document text exceeded 2 million characters after extraction | Open the resource in Brightspace and read sections manually |
| `CONTENT_LIMIT` | Too many items in a paginated response | Narrow your request (e.g., fewer courses, fewer days) |
| `PAGINATION_LIMIT` | Pagination exceeded 10,000 items | Narrow your request |
| `RESOURCE_LIMIT` | Document processing limits exceeded (file size, PDF pages) | Open directly in Brightspace |

## Renewal timeout

### Error: `AUTH_TIMEOUT`

**Symptoms**:
- A tool returns `AUTH_TIMEOUT` after authentication or silent renewal stalls
- `npm run renew` reports the same code after its separate 120-second budget

**What happened**: Authentication did not complete within its bounded deadline.
Owned browser and request resources are closed, and a late operation cannot replace
the saved session. The previous encrypted file is preserved, but it might already be
expired at MUN.

**Fix**: Run `npm run renew` locally. If MUN requests sign-in or MFA, complete the
visible login fallback. Then retry the tool.

**If this keeps happening**:
1. Check your internet connection
2. Verify Brightspace is accessible: browse to `https://online.mun.ca/d2l/home` in a browser
3. Try running renewal manually:
   ```powershell
   npm run renew
   ```
4. If `npm run renew` also times out, verify MUN service availability and try again later.

### Disabling timeout-prone renewal

If renewal keeps timing out and you prefer rejection-triggered renewal, disable the
session-age trigger:

```powershell
codex mcp remove mun-d2l-mcp
$munNode = (Get-Command node).Source
$munEntry = Join-Path (Get-Location) 'dist/cli.js'
codex mcp add mun-d2l-mcp --env "LOCALAPPDATA=$env:LOCALAPPDATA" --env "MUN_D2L_SESSION_HOURS=0" -- $munNode $munEntry serve
```

Now the server will only refresh when Brightspace explicitly rejects your session, reducing timeout issues.

## Browser and Chromium

### Error: "Browser executable missing"

**Cause**: Chromium is not installed or was not found.

**Fix**:
```powershell
npx playwright install chromium
```

**Why this happens**:
- You skipped the initial setup (`npx playwright install chromium`)
- The Chromium installation was corrupted or deleted
- Node modules were reinstalled without rebuilding Playwright

### Login window doesn't open

**Cause**: Browser launch failed or display is unavailable.

**Fixes** (try in order):
1. Reinstall Chromium:
   ```powershell
   npx playwright install chromium --clean-install-if-not-cached
   ```
2. Verify you're on a physical desktop or RDP session with display output
3. Check Task Manager: if `chrome.exe` or `msedge.exe` is running, end all instances and retry

### Login hangs at browser (timer reaches 0)

**Cause**: Browser automation didn't detect sign-in completion within 10 minutes.

**What to do**:
1. Close the browser window manually
2. Wait a few seconds
3. Run `npm run login` again

**Why this happens**:
- You're AFK and didn't complete the sign-in
- MFA was triggered and you're waiting for a code
- Brightspace experienced an error during sign-in
- The automated browser detector got out of sync

## Verifying your setup

Run the diagnostic command to check your system:

```powershell
npm run doctor
```

This verifies:
- Chromium is installed and accessible
- Windows Credential Manager is available
- Your current session status (if logged in)
- Brightspace API versions are reachable
- The origin guard is working (no cross-origin requests)

All checks should show "✓ OK" or "ℹ Not configured (expected)".

## Getting help

If troubleshooting doesn't resolve your issue:

1. Check [SECURITY.md](SECURITY.md) for the threat model and security guidance
2. Run `npm run doctor` and share the output (no credentials will be shown)
3. Run `npm run status` and note the session age
4. Check if the issue affects a single course or all courses
5. Verify your Brightspace account works normally in a browser

## Still stuck?

Before reporting an issue, collect this information:

- Your Windows version (`winver`)
- Node version: `node --version`
- `npm run doctor` output
- `npm run status` output
- The exact error message and which tool/command triggered it
- Steps to reproduce

Do **not** include:
- Your course names, assignment content, or grades
- Full Brightspace URLs (course IDs are OK)
- Encryption keys or credential information

All authentication data is automatically redacted in error messages and logs.
