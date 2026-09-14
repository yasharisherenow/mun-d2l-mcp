# MUN D2L MCP

Your own local, read-only Brightspace MCP server for Memorial University.
Written independently in TypeScript; not a fork of another Brightspace MCP project.
The project is private and is not published to npm.

## Setup on Windows

Requires Node.js 22 or newer and Windows Credential Manager.

```powershell
npm ci
npx playwright install chromium
npm run build
npm run login
```

The login command opens a visible browser at `https://online.mun.ca/d2l/home`.
Click **MUN Login** and complete sign-in and any MFA yourself. Leave the browser
open until the program verifies your identity and retrieves your enrollments.
It closes automatically after successful verification. Login times out after ten
minutes. Closing the browser cancels login without replacing an existing session.

Your password is never read or saved by this application. Brightspace session
cookies and any captured Brightspace bearer token are encrypted with AES-256-GCM.
The encryption key is stored under service `mun-d2l-mcp` in Windows Credential
Manager. The encrypted file is `%LOCALAPPDATA%\mun-d2l-mcp\session.encrypted.json`,
outside the OneDrive project. Encrypted Brightspace and MUN Login cookies are retained
so the server can renew an expired Brightspace session through silent SSO.
The application requires your Windows account to access the keyring; there is no
plaintext fallback. Programs running as your Windows user can have the same access.
Browser local storage is never persisted. Only cookies for `online.mun.ca` and
`login.mun.ca` are retained. See [SECURITY.md](SECURITY.md) for the threat model,
reporting guidance, and release checklist.

## Connect to Codex

From this project directory, after building:

```powershell
$munNode = (Get-Command node).Source
$munEntry = Join-Path (Get-Location) 'dist/cli.js'
codex mcp add mun-d2l-mcp --env "LOCALAPPDATA=$env:LOCALAPPDATA" -- $munNode $munEntry serve
codex mcp get mun-d2l-mcp
```

This adds a separate MCP entry and preserves other servers. Restart Codex or reload
MCP connections if the tools do not appear in an existing session. Rebuild after
source changes and restart the MCP connection. There is no automatic updater.

The server proactively renews its session every four hours by default. To choose a
different interval, set `MUN_D2L_SESSION_HOURS` on the MCP entry. It accepts decimal
hours from `0.25` to `168`; use `0` to disable scheduled renewal and refresh only
after Brightspace rejects the session. For example, eight hours:

```powershell
codex mcp remove mun-d2l-mcp
$munNode = (Get-Command node).Source
$munEntry = Join-Path (Get-Location) 'dist/cli.js'
codex mcp add mun-d2l-mcp --env "LOCALAPPDATA=$env:LOCALAPPDATA" --env "MUN_D2L_SESSION_HOURS=8" -- $munNode $munEntry serve
```

This interval controls when the server attempts silent renewal; it cannot extend
MUN's own login or MFA lifetime. Restart the MCP connection after changing it.

Try:

- “Use mun-d2l-mcp to list my courses.”
- “What assignments and quizzes are due in the next seven days?”
- “Find my course syllabus and summarize the assessment instructions.”
- “Show my available grades for this course, keeping category summaries separate.”

## Commands

| Command | Purpose |
| --- | --- |
| `npm run login` | Sign in interactively and replace the session after verification |
| `npm start` | Start the MCP stdio server; normally launched by Codex |
| `npm run status` | Check authentication and show session age and the next silent-renewal check |
| `npm run renew` | Attempt silent renewal, opening interactive MUN login only when required |
| `npm run doctor` | Check Chromium, authentication, API versions, and the origin guard |
| `npm run test-course -- <course-id>` | Check assignment, quiz, grade, and content permissions for one course |
| `npm run logout` | Delete this app's local session and encryption key |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm test` | Run offline tests using synthetic data |
| `npm run security:audit` | Audit production dependencies for known vulnerabilities |
| `npm run smoke` | Verify an actual stdio handshake and the tool definitions |
| `npm run smoke -- --live` | Also read your courses and upcoming deadlines |
| `npm run verify:ui` | Compare a sample of API data with the live Brightspace UI |

Logout does not sign out other browsers or revoke the university session remotely.
Each tool call reloads local authentication, so subsequent calls respect logout.
Requests already in flight may complete.

## Tool interface

| Tool | Inputs | Result |
| --- | --- | --- |
| `list_courses` | Optional `search` | Enrollment IDs, names, codes and access status |
| `list_assignments` | `course_id` | Instructions, due/open/close dates, attachment IDs |
| `list_quizzes` | `course_id` | Quiz availability, attempts allowed, and time limits without starting an attempt |
| `get_upcoming_deadlines` | Optional `course_ids`, `days` (1–90, default 7), `from` (ISO timestamp with offset) | Sorted assignment/quiz dates and source coverage |
| `get_my_grades` | `course_id` | Your API grade values, feedback, and separate category summaries |
| `get_grade_insights` | `course_id`, optional hypothetical point items | Available numeric-point summary and clearly labeled local calculations without inferring release status |
| `get_weekly_schedule` | Optional course IDs, days, and start | Calendar events with a deadline fallback |
| `export_calendar_ics` | Optional course IDs, days, and start | Locally generated iCalendar text |
| `list_announcements` | `course_id` | Published, visible announcement text |
| `list_course_content` | `course_id` | Modules and topic IDs, including locked status |
| `read_course_material` | `course_id`, plus `topic_id` OR `assignment_id` and `attachment_id`; optional `offset` and `max_characters` | Extracted text, PDF page offsets, and a source link |
| `search_course_materials` | `course_id`, query, optional `max_files` | Bounded local search with module paths, PDF pages or text offsets, snippets, and source links |

IDs must come from your enrolled courses. There is no arbitrary URL-fetch tool and
no submission, posting, grade-editing, or roster tool. Authenticated requests stay
on `https://online.mun.ca`; redirects are not followed. Pagination is restricted to
the original resource and has a 20 MiB cumulative raw-response budget. API versions
are discovered from the tenant. At most four MCP tool calls run concurrently, with
sixteen queued calls; document parsing is limited to two workers and four queued jobs.

Results contain structured JSON and source URLs. API timestamps are preserved and
also displayed in `America/St_Johns`, including daylight-saving changes. The
deadline window is inclusive at the start and exclusive at the end, and `days`
means elapsed 24-hour periods. Specify `from` for a particular starting instant.

## Coverage and limitations

- Deadline aggregation checks accessible, active enrollments unless course IDs are
  specified. It covers assignment and quiz due dates, using a clearly labeled
  closing date when no due date exists. It does **not** cover dates mentioned only
  in a syllabus, announcements, calendar events, or discussions. Personal extensions
  may require checking the Brightspace UI. It does not infer submission status.
- `complete` describes success fetching the stated assignment and quiz sources,
  not completeness of every possible university deadline. `unavailable` identifies
  individual sources that could not be fetched.
- No overall grade is calculated. Missing grades remain unknown, not zero. The API
  can return category totals that do not appear as scores in the UI; these are kept
  in `category_summaries` and must not be treated as earned grades. Individual API
  values include release status, which is unknown without a release date. Check
  the source grade page when interpreting marks. Private comments are not returned.
- Material reading supports PDF, HTML, plain text, Markdown and CSV. External-link
  topics, video, Word, PowerPoint, and image OCR are not supported. Readable text
  may omit diagrams, formatting, and table structure. Open the source for these.
- Text output defaults to 20,000 characters; use `next_offset` to continue.
  The maximum chunk is 50,000 characters. Files over 20 MiB and PDFs over 300 pages
  are rejected for extraction. JSON responses are limited to 5 MiB, general
  responses to 20 MiB, pagination to 10,000 items, and MCP results to 2 MiB.
  Network responses must provide an uncompressed `Content-Length`; unknown-length or
  compressed responses fail closed before Playwright buffers their bodies.
  PDF and HTML extraction runs in a memory-limited worker with a 15-second deadline;
  extracted text is capped at 2,000,000 characters and reports `truncated`.
- Locked topics retain their navigation metadata and `locked: true`, but descriptions
  are suppressed and locked topics are excluded from material search.
- Assignments, quizzes, announcements, modules, and topics are returned only when
  Brightspace explicitly marks them visible (and published/active where applicable).
  Assignment instructions and attachments remain unavailable before the assignment's
  opening time. Missing visibility metadata fails closed as unavailable.
- Authentication uses your browser session rather than a registered university
  OAuth application. When Brightspace authentication expires, the server opens a
  hidden browser once and tries MUN silent SSO with the encrypted saved state. It
  never enters your password and does not intentionally initiate MFA. If MUN's own
  SSO session has expired or policy requires MFA, run `npm run login` again. The
  `renew` command performs this fallback automatically after silent renewal fails.
- The saved-session age and local renewal interval are available through `npm run
  status`. MUN does not expose a reliable SSO expiry timestamp, so the tool does not
  claim an exact expiry time.
- `export_calendar_ics` returns standards-compatible `.ics` text to the MCP client.
  Saving or importing that text is an explicit local action; the server never writes
  into an external calendar account.
- All MCP protocol traffic uses stdout; diagnostics use stderr. Unexpected errors
  are redacted. Course data goes to the MCP client you connect; no course data is
  written to the project by the normal server workflow.

## Troubleshooting

| Error | Action |
| --- | --- |
| `AUTH_REQUIRED` | Run `npm run login`, then retry the tool |
| `PERMISSION_DENIED` | Check that the resource is available to your account in Brightspace |
| `KEYRING_UNAVAILABLE` | Run under your normal Windows account with Credential Manager available |
| `SESSION_UNREADABLE` | Run `npm run logout`, then `npm run login` |
| `SESSION_BUSY` | Wait for the current login, renewal, or logout to finish, then retry |
| `NETWORK_ERROR`, `SERVICE_UNAVAILABLE`, `RATE_LIMITED` | Retry later; the stored session is preserved |
| `NOT_FOUND` | Re-list courses/content and verify the selected IDs |
| `REDIRECT_BLOCKED`, `UNSUPPORTED_FILE` | Open the source material directly in Brightspace |
| `RESPONSE_TOO_LARGE`, `RESPONSE_SIZE_UNKNOWN`, `RESPONSE_ENCODING_BLOCKED`, `OUTPUT_LIMIT`, `EXTRACTION_LIMIT`, `CONTENT_LIMIT` | Narrow the request or open the source directly in Brightspace |
| `PAGINATION_LIMIT`, `RESOURCE_LIMIT` | Narrow the request or retry after current work finishes |
| Browser executable missing | Run `npx playwright install chromium` |

## Development

`src/auth` handles interactive login and encrypted persistence; `src/api` handles
read requests, version discovery, retries and pagination; `src/tools` contains the
study data transformations; `src/server.ts` registers the twelve MCP tools.
Tests use synthetic data and do not require a MUN account. Live smoke tests require
an existing login and print counts rather than course content or credentials.

References used to design the integration:

- [Brightspace developer documentation](https://docs.valence.desire2learn.com/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Codex MCP configuration](https://developers.openai.com/codex/mcp)
- [Brightspace MCP reference project](https://github.com/RohanMuppa/brightspace-mcp-server) — inspiration only; no implementation copied.
