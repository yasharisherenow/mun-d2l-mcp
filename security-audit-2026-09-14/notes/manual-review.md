# Manual security review: authentication, network, parsers, and business logic

## Method and assessed threat model

This pass followed the call graph from the MCP registrations in `src/server.ts` through `withSession`, `SessionStore`, `BrightspaceClient`, `StudyService`, and document extraction. It applied the audit-context-building rule that every security assumption must be tied to an enforcement point, followed by the sharp-edges checks for unsafe defaults, zero/empty values, silent failure, and stringly typed security decisions. No live tenant was contacted and no production file was changed.

The local MCP client controls all schema-valid tool arguments and invocation concurrency. Brightspace controls authenticated API responses, redirects, pagination, and downloaded bytes. Course authors control titles, descriptions, announcements, calendar text, links, and documents. A process already running as the same Windows user is treated as inside the local account boundary because it can normally use the same Credential Manager entry and inspect or manipulate user processes. MUN, TLS/DNS, Playwright/Chromium, Node.js, the MCP host, and dependencies are trusted components.

## Architecture and trust boundaries

1. `src/server.ts:10-55` exposes twelve read-only stdio tools. Zod bounds caller-controlled IDs, strings, arrays, dates, windows, file counts, offsets, and output slices. The common wrapper serializes results and rejects output above 2 MiB (`src/server.ts:13-25`).
2. `src/auth/login.ts:79-98` loads an encrypted browser session, proactively renews it based on a validated interval, verifies identity, retries renewal only for authentication/permission classifications, disposes the API context, and preserves the saved session on network failure.
3. `src/auth/store.ts:22-35,45-89` validates saved state, retains cookies only for exact MUN hostnames, strips origin/local-storage state, encrypts with AES-256-GCM using a random 96-bit IV and `BASE_URL` AAD, and fails closed on keyring/decryption errors. The key is stored through the OS keyring binding, separate from the ciphertext file.
4. `src/api/client.ts:34-64` normalizes every request URL and permits only the exact configured HTTPS origin, a `/d2l/` path, and no URL credentials. Playwright follows zero redirects (`src/api/client.ts:11-25`). Response, JSON, page, retry, and item ceilings are explicit (`src/api/client.ts:8-10,39-64,67-75,94-132`). Pagination preserves origin, path, and every original non-bookmark query value (`src/api/client.ts:109-130`).
5. `src/tools/service.ts:57-65` scopes course operations to current enrollments with `CanAccess`. Material reads additionally require a visible, unlocked ToC topic or an attachment listed by a visible assignment (`src/tools/service.ts:206-225`). Locked state is inherited through parent modules and locked descriptions are suppressed (`src/tools/service.ts:133-153`).
6. Untrusted PDF/HTML parsing runs in a worker with memory limits and a 15-second deadline (`src/tools/extract.ts:22-43`); document pages and text are bounded (`src/tools/document-worker.ts:5-6,17-46`). Returned material is labeled untrusted model input (`src/tools/service.ts:229`).

## Security invariants and enforcement

| Invariant | Enforcement | Result |
| --- | --- | --- |
| Password/MFA input stays in the visible MUN browser | `login()` only observes requests and browser state; it never requests credentials (`src/auth/login.ts:101-153`) | Enforced in application code |
| Authenticated HTTP cannot leave MUN | exact `origin`, credentials, and `/d2l/` checks plus `maxRedirects: 0` (`src/api/client.ts:11-25,34-38,56-59`) | Enforced |
| Callers cannot select arbitrary course objects | enrollment lookup and `CanAccess` (`src/tools/service.ts:57-65`) | Enforced |
| Callers cannot fetch arbitrary URLs/files | API paths are constructed from validated numeric IDs; topic/attachment membership is checked (`src/tools/service.ts:206-225`) | Enforced for authenticated fetching |
| Hidden/locked course content is not returned | visibility filters and inherited lock handling (`src/tools/service.ts:71-82,96-107,124-153,206-221`) | Enforced for explicit flags; availability-window semantics remain an open question below |
| Saved credentials fail closed and are confidential at rest | strict schema, AES-GCM authentication, keyring-only key, no plaintext fallback (`src/auth/store.ts:22-35,45-95`) | Enforced under the documented same-user boundary |
| Remote work and output are bounded | response/JSON/page/item/output limits and parser worker limits | Enforced per call; aggregate concurrent calls remain a hardening concern |
| Operations are read-only | only GET transport exists (`src/api/client.ts:11-12`); no mutation endpoints are registered | Enforced |

## Confirmed findings

No new confirmed vulnerability was established in this manual pass. This means only that the reviewed paths did not provide enough evidence for a realistic exploit under the stated deployment assumptions; it is not a claim that the codebase is secure.

The earlier locked-content and resource-exhaustion root causes are visibly addressed in this revision: locked descriptions/search are suppressed, and byte/item/depth/time/parser/output limits now exist. Exact-origin enforcement, redirect blocking, course membership checks, attachment membership checks, authenticated encryption, strict session parsing, and generic unexpected-error handling defeated the reviewed SSRF, path traversal, IDOR, ciphertext-tampering, and sensitive-error candidates.

## Unresolved candidates

### MR-UC-01: future assignment metadata may be exposed before its availability window

**Evidence.** The assignment schema records `Availability.StartDate` and `EndDate` (`src/tools/service.ts:16-21`), but `folders()` filters only `IsHidden` (`src/tools/service.ts:71-74`). `listAssignments()` returns instructions and attachment identifiers for every remaining entry (`src/tools/service.ts:75-82`), and `readMaterial()` authorizes an attachment solely by membership in that list (`src/tools/service.ts:216-220`).

**Why unresolved.** It was not established from local code or fixtures whether the MUN Brightspace student API includes a not-yet-open assignment's protected instructions/attachments, whether `StartDate` is informational rather than an authorization boundary, or whether the attachment endpoint independently denies access. If the API returns protected future data, the application's policy is inconsistent with its locked-topic policy and can disclose it through normal tools. This requires a synthetic policy decision and/or a separate authorized tenant behavior check; live testing was outside this review.

**Recommended resolution.** Define whether an assignment availability start is a local confidentiality boundary. If it is, omit instructions and attachment IDs before the start time and deny attachment reads, while preserving minimal name/date metadata. Add synthetic boundary tests for just-before, exactly-at, and just-after opening.

### MR-UC-02: concurrent MCP calls have no process-wide resource budget

**Evidence.** Each material extraction can create a worker with up to 128 MiB old generation plus 32 MiB young generation and a 15-second deadline (`src/tools/extract.ts:22-31`). Per-call input/output and search limits exist, but the server wrapper does not limit concurrent tool executions (`src/server.ts:13-27`). Each tool also creates and verifies a Playwright API context through `withSession` (`src/auth/login.ts:79-98`).

**Why unresolved.** The stdio deployment has one local MCP host, and no evidence shows that the official host dispatches unbounded simultaneous calls. A hostile same-user process can already terminate or starve this process. Course content cannot directly start calls without the host/model deciding to invoke tools. Therefore the missing global semaphore is a defense-in-depth availability concern unless an exposed MCP client or repeatable prompt-injection call fan-out is demonstrated.

**Recommended resolution.** Add a small process-wide semaphore for authenticated operations and a stricter one for parser workers, plus a queue ceiling that fails with a stable resource-limit error. Test maximum concurrent worker count with synthetic documents.

## Sharp edges and hardening opportunities

1. **Permission errors trigger authentication renewal.** `AUTH_ERRORS` includes `PERMISSION_DENIED` (`src/auth/login.ts:7`), so a 403 during identity verification can open a silent SSO flow and, on failure, instruct the user to log in (`src/auth/login.ts:11-25,88-96`). This fails closed but can turn a stable authorization denial into unnecessary authentication churn. Restrict refresh to `AUTH_REQUIRED` unless observed MUN behavior requires 403 handling; encode that exception narrowly.
2. **Cross-process session lifecycle is not serialized.** In-process refresh is coalesced by one module-global promise (`src/auth/login.ts:9,74-76`), while `save()` uses an atomic temporary rename and `clear()` independently removes the file/key (`src/auth/store.ts:45-65,92-95`). Concurrent `serve`, `renew`, `login`, and `logout` processes can create last-writer-wins state or a ciphertext/key mismatch. Under the same-user threat boundary this is principally reliability/availability, but a named mutex and defined logout precedence would make the security lifecycle less error-prone.
3. **JavaScript retains immutable secret strings.** The decoded key `Buffer` is zeroed (`src/auth/store.ts:54-65,80-88`), but the base64 key returned by the keyring, bearer token, cookie strings, and serialized session cannot be reliably zeroized in JavaScript. This is a platform limitation rather than a demonstrated vulnerability. Keep the process single-purpose, avoid diagnostic heap dumps, and document that same-user/process-memory compromise is outside the confidentiality boundary.
4. **Saved cookie security attributes are accepted as supplied.** The schema validates `secure`, `httpOnly`, and `sameSite` types but does not require safe values (`src/auth/store.ts:23-35`). These attributes originate from the trusted MUN browser session and ciphertext tampering fails authentication, so no attacker-controlled bypass was shown. An allowlist of expected cookie names/attributes, validated against real MUN behavior, would reduce future configuration drift.
5. **Malformed Brightspace deadline timestamps disappear silently.** `deadlines()` calls `Date.parse` and simply fails the range comparison for `NaN` (`src/tools/service.ts:165-169`). That can produce an apparently complete result despite invalid upstream data. Treat malformed nonempty dates as `INVALID_RESPONSE` or record the source as unavailable so absence is distinguished from corrupt data.
6. **Public links are output only, not fetched.** `publicLink()` allows arbitrary public HTTPS hosts after rejecting credentials, obvious local/private literals, and secret-like parameters (`src/tools/format.ts:29-45`). DNS resolution is not checked, but this is not SSRF because no application code fetches the link. Keep documentation and tool descriptions explicit that external links require a separate user/host action.

## Variant-search record

The review searched every use of `client.get`, `client.json`, `client.paged`, `route`, `publicLink`, `richText`, `extractDocument`, `IsHidden`, `IsLocked`, `CanAccess`, `Authorization`, `bearer`, `storageState`, keyring operations, filesystem writes, subprocess/worker creation, and console output. No command execution, dynamic code evaluation, template execution, archive extraction, writable HTTP method, raw filesystem path derived from MCP input, or authenticated off-origin fetch was found. The document worker is the only untrusted parser boundary. External course links are returned as data and never fetched by this process.

## Open questions for the primary report

- Does the MUN student assignments API omit or redact instructions and attachment IDs before `Availability.StartDate`?
- Can the MCP host issue tool calls concurrently, and what practical concurrency ceiling does it enforce for stdio servers?
- Does MUN ever use an HTTP 403 from `users/whoami` to signal session expiry, justifying the broad refresh classification?
- Which exact MUN cookie names and attributes must persist for silent SSO renewal? A narrow allowlist cannot be selected safely from source alone.
