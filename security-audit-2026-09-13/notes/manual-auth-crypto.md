# Manual Authentication, Crypto, API-Boundary, and Resource-Safety Review

## Scope and method

Reviewed `src/auth/store.ts`, `src/auth/login.ts`, `src/api/client.ts`, `src/config.ts`, `src/errors.ts`, `src/server.ts`, `src/tools/format.ts`, relevant portions of `src/tools/service.ts`, and their tests. Applied the installed `audit-context-building`, `sharp-edges`, `fp-check`, and `variant-analysis` guidance manually because their referenced agent/workflow runners are not callable in this subtask. The installed `zeroize-audit` workflow is restricted to C/C++/Rust with a compile database or Cargo manifest, so its compiler-level procedure is inapplicable to this TypeScript project; secret lifetime was reviewed manually.

No live service was contacted and production files were not changed. Evidence is source inspection and existing local unit tests unless stated otherwise.

## Context and threat model

The process is a single-user local stdio MCP server. The MCP client supplies tool arguments; Brightspace supplies API JSON, cookies, redirects, downloadable content, calendar URLs, and pagination metadata. A course instructor/content author can influence course titles, rich text, file bytes, and possibly collection sizes, but cannot normally control the `online.mun.ca` origin or Brightspace response mechanics. A compromised Brightspace origin is assumed able to return arbitrary response bytes. A local attacker in the same Windows account can generally invoke Credential Manager in that user's context and is outside the strongest confidentiality boundary; disk-only or different-account attackers are relevant.

Key trust boundaries and invariants:

- Authentication state crosses from Playwright into encrypted local storage (`src/auth/login.ts:129-139`, `src/auth/store.ts:44-64`). Passwords are never read by application code.
- The AES-256-GCM key is random and stored in Windows Credential Manager; ciphertext is saved outside the OneDrive workspace (`src/auth/store.ts:41-64`, `src/config.ts:18-23`).
- Every authenticated API request must remain on exact origin `https://online.mun.ca`, have no URL credentials, and begin `/d2l/` (`src/api/client.ts:20-24`). Redirect following is disabled at the transport and application layers (`src/api/client.ts:8-11,41-45`).
- Course-scoped operations first require the requested positive numeric course ID to appear in the authenticated user's enrollments with `CanAccess` (`src/server.ts:12,27-53`; `src/tools/service.ts:59-67`). Brightspace remains the final authorization authority.
- Retrieved material is attacker-influenced data. The server declares this in MCP instructions and material notes (`src/server.ts:11`; `src/tools/service.ts:245`).

## Confirmed finding

### MAC-01 — Authenticated content is fully buffered and expensive document processing has no execution budget

**Severity:** Medium  
**Confidence:** High  
**Class:** Local denial of service / resource exhaustion

**Affected locations:**

- `src/api/client.ts:8-11` — `response.body()` materializes the entire response before callers can inspect its size.
- `src/api/client.ts:52-59` — JSON bodies have no byte limit before decoding/parsing.
- `src/api/client.ts:78-108` — pagination is capped at 100 pages but accumulated item count/size is unbounded.
- `src/tools/service.ts:217-245` — the 20 MiB check happens only after the response is already buffered; HTML conversion and PDF extraction have no wall-clock or memory budget.
- `src/tools/service.ts:223-236` — PDF extraction accepts up to 300 pages but page count does not bound compressed-object expansion or parser complexity.
- `src/tools/service.ts:248-267` — search may repeat full retrieval/parsing serially for as many as 30 files, amplifying expensive inputs.

**Root cause:** Limits are applied after allocation or only to superficial dimensions (page/file count). The transport interface returns a complete `Buffer`, so `readMaterial` cannot reject oversized bodies before memory is committed. PDF and HTML transformations do not have a timeout, cancellation mechanism, worker/process isolation, or complexity budget. `paged` limits requests but not aggregate objects or bytes.

**Attacker prerequisites:** An authenticated course content author must be able to place a very large or parser-adversarial accessible document in a course and induce the user/model to call `read_course_material` or `search_course_materials`. Alternatively, the trusted Brightspace origin must be compromised or severely misconfigured. MCP tool callers can also deliberately request repeated processing of existing expensive content. This is not an unauthenticated remote attack.

**Exploit path:** Attacker-controlled document -> Brightspace topic/attachment -> authenticated `client.get()` -> Playwright `response.body()` buffers all bytes -> late 20 MiB rejection or CPU/memory-heavy `unpdf` / `html-to-text` processing -> local MCP process stalls or terminates. For searches, the path repeats across multiple topics. Large API collections similarly accumulate in `paged`.

**Impact:** Availability loss for the local MCP server and potentially elevated memory/CPU pressure on the user's Codex host. Confidentiality and integrity impact were not demonstrated.

**Evidence / reproduction:** Reasoning-backed from the complete source-to-sink trace above. No document-bomb PoC was executed because safely demonstrating worst-case PDF parser exhaustion is unreliable in-process and unnecessary to establish that the byte check is post-buffer. Existing tests do not cover oversized transport bodies, parser deadlines, aggregate pagination size, or search work budgets (`tests/client.test.ts:5-61`; service tests contain no resource-limit campaign).

**Recommended fix:** Stream response bodies and abort once a conservative per-type byte limit is exceeded; reject based on a trustworthy `Content-Length` early but still enforce on streamed bytes. Add a maximum response size for JSON, aggregate page/item/byte limits, and output-size limits. Parse PDFs/HTML in a worker or child process with wall-clock, memory, and cancellation limits. Add one global work budget for `search_course_materials` (bytes, pages, files, and elapsed time), not merely per-file limits. Preserve explicit partial-result reporting when the budget is exhausted.

**Regression guidance:** Use local fake transports/HTTP fixtures only. Verify an over-limit body is aborted before full buffering; a 100-page response cannot exceed aggregate item/byte caps; PDF/HTML processing is cancelled on deadline; and search stops at a global budget while reporting `complete: false`. Measure peak RSS or streamed byte count rather than merely asserting `FILE_TOO_LARGE` after allocation.

## Variant search for MAC-01

Exact seed: complete-body material retrieval at `src/tools/service.ts:217-218`. Generalized searches covered `response.body()`, `Buffer`, collection `push`, recursive traversal, file/page/character limits, and loops over remote data. Confirmed variants were JSON response buffering (`src/api/client.ts:52-59`), aggregate pagination (`src/api/client.ts:78-108`), recursive ToC parsing/walking (`src/tools/service.ts:33,139-149`), and repeated search parsing (`src/tools/service.ts:248-267`). The recursive ToC case remains a hardening opportunity rather than a separately confirmed vulnerability because practical Brightspace nesting constraints were not established. These manifestations are deduplicated under one resource-governance root cause.

## Unresolved candidates

### UC-01 — Server-controlled pagination `Next` can change query parameters

`paged` requires the next URL to keep the original origin and pathname but allows arbitrary replacement/removal of query parameters (`src/api/client.ts:85-95`). A malicious API response could therefore broaden or alter a same-endpoint query. The next request is still subjected to the exact-origin `/d2l/` guard, and Brightspace is already trusted to supply the endpoint data. No caller was found where altered query parameters grant data that Brightspace authorization would otherwise deny. **Verdict: unresolved defense-in-depth candidate, not a confirmed exploit.** Consider preserving invariant query keys and allowing only documented pagination keys.

### UC-02 — Cross-process first-save/update synchronization is not explicit

Session file replacement is atomic via a random temporary file and `rename` (`src/auth/store.ts:59-64`), and in-process refresh is coalesced (`src/auth/login.ts:74-76`). There is no file lock or compare-and-swap across processes. Concurrent login/refresh/logout processes can produce last-writer-wins state, and concurrent logout/save can leave either a missing key or stale state. AES-GCM prevents silent corruption; failures become `SESSION_UNREADABLE`, so the demonstrated effect is recoverable local availability loss. **Verdict: unresolved/low hardening candidate.** Add a named cross-process mutex or lock file and define logout-vs-refresh ordering.

## False-positive challenges

- **SSRF via returned course/calendar links:** rejected. `publicLink` only returns a string and no code fetches it; `read_course_material` constructs fixed Brightspace API routes and does not fetch topic `Url` or arbitrary link attachments (`src/tools/format.ts:28-43`; `src/tools/service.ts:201-217`). Literal private-host filtering is therefore output hygiene, not the authenticated request boundary.
- **Credential leakage through redirects:** rejected. Playwright uses `maxRedirects: 0`, and all 3xx responses are rejected before another request (`src/api/client.ts:8-11,41-45`).
- **IDOR by supplying another course ID:** rejected for assessed tools. MCP inputs require positive integers and every course operation reaches `requireCourse`, which checks current authenticated enrollments and `CanAccess` before forming the resource request (`src/server.ts:12,27-53`; `src/tools/service.ts:59-75,86-100,126-133,201-217`). The upstream platform also enforces authorization.
- **Ciphertext tampering / algorithm downgrade:** rejected. AES-256-GCM is hardcoded, IVs are fresh 96-bit random values, AAD binds the fixed origin, tag/IV/key lengths are checked, and malformed/tampered envelopes fail closed (`src/auth/store.ts:22-34,44-64,67-88`; `tests/store.test.ts:18-42`).
- **Secret-bearing error logs:** rejected in inspected paths. Transport exceptions are replaced by fixed `AppError` messages and unknown MCP/CLI errors are reduced to `INTERNAL_ERROR` (`src/api/client.ts:27-30`; `src/errors.ts:8-11`; `src/server.ts:17-24`). Login logs counts/status only (`src/auth/login.ts:115,140,144`).
- **Session expiration bypass via `MUN_D2L_SESSION_HOURS=0`:** rejected as an auth bypass. Zero disables proactive renewal by documented design, but every action still verifies identity and retries refresh on authentication/permission failure (`src/config.ts:8-16`; `src/auth/login.ts:79-98`). The upstream session remains authoritative.

## Hardening opportunities

1. **Reduce in-memory secret lifetime.** The derived key `Buffer` is zeroed in `finally` (`src/auth/store.ts:53-64,79-87`), but the base64 key returned from Credential Manager, serialized plaintext session string, cookie values, and bearer token are immutable JavaScript strings that cannot be reliably wiped (`src/auth/store.ts:45-58,75-86`; `src/auth/login.ts:35-40,105-110`). This is a runtime/language limitation, not a demonstrated cross-boundary leak. Keep the process single-purpose, avoid heap dumps/crash dumps where possible, and consider DPAPI-protected opaque blobs or native bindings if a stronger same-user memory threat model is required.
2. **Validate cookie security attributes before persistence.** Domain filtering is exact and storage origins are removed (`src/auth/store.ts:23-34`; `src/auth/login.ts:55-61,129-137`), but cookies are retained even if `secure` or `httpOnly` is false. Because authenticated API requests remain HTTPS and cookie properties originate from the browser, exploitability was not shown. Persist only cookies expected for these domains and require `secure`; document any necessary non-HttpOnly SSO cookies.
3. **Bound recursive ToC depth and node counts.** Recursive Zod parsing and `walk` have no explicit maximum (`src/tools/service.ts:31-33,131-149`). Add iterative traversal with depth/module/topic caps and partial coverage reporting.
4. **Avoid treating generic 403 as a refresh trigger.** `verifiedClient` and login flows classify `PERMISSION_DENIED` with authentication errors (`src/auth/login.ts:7,15-20,63-65,91-95,142-145`). For identity this likely reflects tenant behavior, but it can cause unnecessary hidden refresh work on persistent authorization denial. Restrict refresh to `AUTH_REQUIRED` unless a verified MUN-specific response requires otherwise.
5. **Bind encrypted envelope metadata.** AAD currently binds only `BASE_URL` (`src/auth/store.ts:56-58,83-85`). Version is parsed but not authenticated. Tampering version currently fails schema validation, so there is no bypass; include version/application identifier in AAD for clearer cryptographic domain separation during future migrations.
6. **Tighten saved timestamp semantics.** Schema validation accepts any ISO timestamp including far-future dates (`src/auth/store.ts:27-34`), which can postpone proactive refresh after clock rollback or internally created bad state. Identity is still verified per action, so this is not an auth bypass. Reject timestamps beyond a small clock-skew allowance.

## Positive controls observed

- Password and MFA entry remain entirely in the visible MUN browser; application code captures only authenticated cookies/bearer headers for the fixed origin.
- Session storage uses a random 256-bit key from Windows Credential Manager, AES-256-GCM with random IV, strict envelope/session schemas, domain allowlisting, no localStorage persistence, atomic ciphertext replacement, and fail-closed loading.
- Network failures preserve saved authentication; logout removes ciphertext before attempting key removal and accurately reports keyring failure.
- Authenticated API traffic is exact-origin/path constrained; URL credentials and redirects are blocked; retries are bounded and respect short `Retry-After` values.
- Authorization checks are centralized for course-scoped tools and output errors distinguish authentication, authorization, not-found, rate-limit, and service failures without embedding remote bodies.

## Coverage limits

No live service, browser login, hostile PDF, external network endpoint, Windows Credential Manager internals, OS ACLs, or multi-process race was exercised. The review did not establish MUN's real cookie names/attributes, upstream course-tree depth limits, maximum API page sizes, or Playwright's memory profile for adversarial bodies. TypeScript does not offer reliable zeroization of immutable strings, and the installed zeroization workflow cannot analyze this ecosystem at compiler/assembly level.
