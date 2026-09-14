# Error Codes Reference

This document lists common error codes, their meanings, typical causes, and recovery steps.

## Authentication and session errors

### AUTH_REQUIRED

**Message**: `AUTH_REQUIRED`

**Cause**: No valid Brightspace session exists or your session has expired.

**Recovery**:
1. Run `npm run login` to authenticate
2. Complete the browser sign-in flow (click **MUN Login** → sign in → MFA if prompted)
3. Wait for the browser to close automatically
4. Retry your tool call

**Prevention**: Keep automatic session renewal enabled (default: every 4 hours). See `MUN_D2L_SESSION_HOURS` in README.

---

### SESSION_UNREADABLE

**Message**: `SESSION_UNREADABLE`

**Cause**: Your encrypted session file is corrupted, your encryption key was deleted from Credential Manager, or your Windows account security context changed.

**Recovery**:
1. Run `npm run logout` (deletes corrupted session and encryption key)
2. Run `npm run login` (creates a fresh session)
3. Retry your tool call

**Why this happens**:
- Session file was manually deleted or corrupted
- Windows Credential Manager entry was removed
- Rare: Windows account security context changed (domain join/leave)

---

### SESSION_BUSY

**Message**: `SESSION_BUSY`

**Cause**: Another login, renewal, or logout operation is already in progress. The server is using an exclusive cross-process lock to prevent concurrent auth operations.

**Recovery**:
1. Wait 10–30 seconds for the current operation to complete
2. Retry your tool call

**Why this happens**:
- You ran `npm run login` while automatic renewal was running
- Two tool calls reached the auth step at the same time
- A previous operation is still cleaning up

**Prevention**: Avoid running `npm run login` while other tools are actively using the MCP connection.

---

### KEYRING_UNAVAILABLE

**Message**: `KEYRING_UNAVAILABLE`

**Cause**: Windows Credential Manager is not accessible. This typically means you're not running as your normal Windows user.

**Recovery**:
1. Verify you're running as your normal Windows user account (not Administrator, not a different user)
2. Check that Windows Credential Manager is enabled:
   - Press `Win + R`, type `gpedit.msc`
   - Navigate to **Computer Configuration** → **Administrative Templates** → **Windows Components** → **Credential Manager**
   - Ensure the policy is not set to "Disabled"
3. If on a managed/domain computer, contact your IT department

**Why this happens**:
- Running as Administrator (even if your user)
- Running under a different user account
- Windows Credential Manager is disabled by Group Policy
- Domain policies prevent credential storage

---

## Brightspace API errors

### PERMISSION_DENIED

**Message**: `PERMISSION_DENIED`

**Cause**: Your account doesn't have permission to access the requested resource in Brightspace.

**Recovery**:
1. Verify the resource exists and is visible in your Brightspace account:
   - Log in to Brightspace at `https://online.mun.ca/d2l/home`
   - Navigate to the course/assignment/quiz
   - Confirm it's visible to you
2. If not visible, contact your instructor to request enrollment or access
3. Retry the tool call

**Prevention**: Use `list_courses` first to confirm the course is in your enrollments.

---

### NOT_FOUND

**Message**: `NOT_FOUND`

**Cause**: The course, assignment, quiz, or content no longer exists, or you referenced an invalid ID.

**Recovery**:
1. Re-fetch the list of available resources:
   - `list_courses` - get current course list
   - `list_assignments <course_id>` - get current assignments
   - `list_quizzes <course_id>` - get current quizzes
2. Verify the ID you're using
3. Retry with the correct ID

**Why this happens**:
- Instructor archived/deleted the course
- Assignment was deleted or moved
- Quiz became unavailable
- You copied the wrong ID

---

### RATE_LIMITED

**Message**: `RATE_LIMITED`

**Cause**: Too many requests were sent to Brightspace in a short time. Brightspace is enforcing rate limits.

**Recovery**:
1. Wait 5–10 minutes before retrying
2. Your stored session is preserved—no need to log in again
3. Retry the same tool call

**Prevention**:
- Avoid running multiple tools concurrently (the MCP server queues calls)
- If you need bulk data, use broader queries (e.g., one `get_upcoming_deadlines` instead of multiple `list_assignments`)

---

### SERVICE_UNAVAILABLE

**Message**: `SERVICE_UNAVAILABLE`

**Cause**: Brightspace servers are temporarily unreachable or undergoing maintenance.

**Recovery**:
1. Wait 5–15 minutes
2. Verify Brightspace is accessible:
   - Open `https://online.mun.ca/d2l/home` in your browser
   - Check MUN's status page for maintenance notices
3. Retry your tool call

**Prevention**: Your session is preserved during outages. No need to re-authenticate.

---

## Network and connection errors

### NETWORK_ERROR

**Message**: `NETWORK_ERROR`

**Cause**: Network connectivity problem—your computer can't reach Brightspace or there's an issue with the connection.

**Recovery**:
1. Check your internet connection:
   - Try `ping 8.8.8.8` in PowerShell
   - Visit `https://online.mun.ca` in your browser
2. If the browser works but tools don't, the issue is likely with the MCP server process
3. Retry the tool call after a few seconds

**Why this happens**:
- WiFi temporarily dropped
- Corporate firewall blocked the request
- DNS resolution failed
- Rare: Node.js process lost network access

---

### RESPONSE_SIZE_UNKNOWN

**Message**: `RESPONSE_SIZE_UNKNOWN`

**Cause**: Brightspace didn't report the response size in the `Content-Length` header, or sent compressed data.

**Recovery**:
1. Retry the same tool call
2. If it persists, try a narrower request (e.g., fewer courses, fewer days)

**Why this happens**:
- Brightspace misconfiguration
- Proxy/firewall stripped the header
- Response was compressed (tool requires uncompressed)

---

## Browser and Playwright errors

### Browser executable missing

**Message**: `Browser executable missing` (shown when `npx playwright install chromium` wasn't run)

**Cause**: Chromium is not installed or was deleted/corrupted.

**Recovery**:
1. Run:
   ```powershell
   npx playwright install chromium
   ```
2. Retry login or renewal

**Why this happens**:
- Initial setup was skipped
- Chromium installation was corrupted
- Node modules were reinstalled without Playwright

---

### Playwright timeout (browser automation)

**Message**: Login hangs and reaches the 10-minute timer

**Cause**: Browser automation didn't detect sign-in completion within 10 minutes. Usually means you're AFK or MFA is pending.

**Recovery**:
1. Close the browser window manually
2. Wait 5 seconds
3. Run `npm run login` again

**Why this happens**:
- You didn't complete sign-in
- You're waiting for MFA code and didn't enter it
- Brightspace experienced an error
- Browser automation got out of sync

---

## MCP protocol errors

### Unexpected errors / no error code

**Message**: Generic error without a specific code (might just say "Tool failed")

**Cause**: Unexpected exception inside the MCP server.

**Recovery**:
1. Check stderr for detailed error message:
   - If running through Codex, see the MCP connection logs
   - If running `npm run smoke`, check command output
2. Run `npm run doctor` to check system status
3. Retry the tool call
4. If it persists, file an issue with the output from `npm run doctor`

**Why this happens**:
- Bug in the MCP server code
- Rare: Memory or resource exhaustion
- Unexpected API response from Brightspace

---

## Document parsing and text extraction

### EXTRACTION_LIMIT

**Message**: `EXTRACTION_LIMIT`

**Cause**: A document's extracted text exceeded 2 million characters (after PDF/HTML parsing).

**Recovery**:
1. Request a smaller chunk:
   - Use `offset` and `max_characters` to read part of the document
   - Start with `max_characters=50000` and use `next_offset` to continue
2. Open the document in Brightspace directly for full access

**Prevention**: Large PDFs (300+ pages) or HTML dumps may hit this limit. Use targeted reading (specific sections) instead.

---

### RESPONSE_TOO_LARGE

**Message**: `RESPONSE_TOO_LARGE`

**Cause**: The raw Brightspace API response exceeded 20 MiB.

**Recovery**:
1. Narrow your request:
   - Request fewer courses
   - Request fewer days (for deadline queries)
   - Request fewer items
2. Open the full list in Brightspace directly

---

### UNSUPPORTED_FILE

**Message**: `UNSUPPORTED_FILE`

**Cause**: The file format is not supported for text extraction (e.g., video, image, Word, PowerPoint, executable).

**Recovery**:
- Open the resource in Brightspace and view/read it manually
- Supported formats: PDF, HTML, plain text, Markdown, CSV

---

## Pagination and resource limits

### PAGINATION_LIMIT

**Message**: `PAGINATION_LIMIT`

**Cause**: A paginated request tried to fetch more than 10,000 items.

**Recovery**:
1. Narrow your request (fewer courses, fewer days, specific course ID)
2. Use pagination `offset` to fetch in smaller batches if needed

**Why this happens**: Preventing accidental huge data transfers.

---

### CONTENT_LIMIT

**Message**: `CONTENT_LIMIT`

**Cause**: Too many items in a single resource (e.g., thousands of assignments in one course).

**Recovery**:
1. Request a specific course ID instead of all courses
2. Reduce the date range for deadline queries
3. Open the resource directly in Brightspace

---

## Redirect and external link errors

### REDIRECT_BLOCKED

**Message**: `REDIRECT_BLOCKED`

**Cause**: A tool tried to follow a redirect (HTTP 3xx response). Redirects are not followed to prevent leaking credentials to third-party sites.

**Recovery**:
- Open the material link directly in Brightspace
- Contact your instructor if the resource is broken

**Why this blocks**: External links must be explicitly whitelisted; automatic redirect following is a security risk.

---

## Recovery decision tree

**If you see an error, follow this flowchart:**

1. **Can't log in?** → `AUTH_REQUIRED` → Run `npm run login`
2. **Session corrupted?** → `SESSION_UNREADABLE` → Run `npm run logout` then `npm run login`
3. **Locked up?** → `SESSION_BUSY` → Wait 30 sec and retry
4. **Permission denied?** → `PERMISSION_DENIED` → Verify access in Brightspace UI
5. **Resource gone?** → `NOT_FOUND` → Re-list resources and verify ID
6. **Brightspace down?** → `SERVICE_UNAVAILABLE` or `RATE_LIMITED` → Wait and retry
7. **Network down?** → `NETWORK_ERROR` → Check internet, then retry
8. **Document too big?** → `RESPONSE_TOO_LARGE` or `EXTRACTION_LIMIT` → Use smaller requests
9. **Unsupported format?** → `UNSUPPORTED_FILE` → Open in Brightspace manually
10. **Unknown error?** → Run `npm run doctor` and check stderr output

## Reporting issues

If an error persists after following recovery steps:

1. Run `npm run doctor` and save output
2. Run `npm run status` and note the session age
3. Identify which tool/command triggered the error
4. Open a GitHub issue with:
   - The error code (if any)
   - Steps to reproduce
   - Output from `npm run doctor`
   - Your Node version (`node --version`)

**Do not include**: passwords, course names, grades, or full Brightspace URLs in your report. Use course IDs instead.
