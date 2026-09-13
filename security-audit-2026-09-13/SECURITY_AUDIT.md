# Security Audit — MUN D2L MCP Server

**Assessment date:** 2026-09-13  
**Revision:** No commit available; the target is not a Git checkout  
**Snapshot evidence:** [`raw/source-snapshot-sha256.json`](raw/source-snapshot-sha256.json)  
**Method:** Local source review, architecture/threat modeling, dependency and lockfile analysis, offline tests, bounded synthetic reproductions, and scanner preflight. No live service was tested and no private source was uploaded.

## Executive summary

The audit confirmed two security issues, both reachable through normal MCP tool calls:

| Priority | ID | Severity | Confidence | Finding |
| --- | --- | --- | --- | --- |
| 1 | D2L-001 | Medium | High | Locked topic descriptions are disclosed by content listing and search |
| 2 | D2L-002 | Medium | High | Fully buffered and unbudgeted remote content can exhaust local resources |

### Remediation status (post-audit)

Both confirmed findings were remediated after the original assessment. D2L-001 now suppresses locked descriptions, excludes locked topics from search, and handles inherited locks. D2L-002 now has early declared-length rejection, 20 MiB response and 5 MiB JSON ceilings, a 10,000-item pagination ceiling, iterative content traversal with depth/node limits, bounded rich text and extracted text, a 30-second search budget, a 2 MiB MCP-output ceiling, and PDF/HTML parsing in a memory-limited worker with a 15-second deadline. Regression tests cover locked metadata/search, deep trees, declared response length, JSON size, pagination count, and isolated worker operation.

The publication candidate UC-004 was also addressed with an explicit package `files` allowlist. A post-fix package dry run contains only `dist/`, `README.md`, `SECURITY.md`, and `package.json`; it excludes source, tests, audit output, environment files, and logs. The grade terminology and calendar response membership hardening items were also corrected. The original findings and reproductions remain below as historical evidence of the assessed state.

Detailed post-fix results are recorded in [`POST_FIX_VERIFICATION.md`](POST_FIX_VERIFICATION.md).

No Critical or High-severity finding was confirmed. That result is bounded by important static-analysis limitations: Semgrep and CodeQL could not execute on this host, and no Git history existed to scan. It must not be interpreted as proof that the codebase is secure.

The first remediation should enforce one consistent locked-content policy: retain only minimal identity/path/lock metadata for locked topics, set descriptions to `null`, and exclude locked topics from material search. The second should add byte, item, time, extraction, and output budgets before or during consumption, with streamed response enforcement and parser isolation.

Security-positive controls include exact-origin authenticated request restrictions, redirect blocking, enrollment and attachment allowlists, strict Zod input/session schemas, AES-256-GCM session encryption with a Credential Manager key, redacted unexpected errors, and a stdio-only deployment. These controls defeated the reviewed SSRF, redirect credential leakage, IDOR, ciphertext tampering, secret logging, and session-configuration bypass candidates.

## Scope and reviewed system

### Snapshot and working-tree state

The directory has no `.git` metadata at it or any parent checked during the audit. `git rev-parse HEAD`, `git status`, and history inspection therefore returned no revision. The exact assessed source set was hashed after review in [`raw/source-snapshot-sha256.json`](raw/source-snapshot-sha256.json); the initial inventory is [`inventory.json`](inventory.json). Existing source was preserved. Audit notes, outputs, and synthetic tests were written only under this audit directory.

The assessed application consists of TypeScript/JavaScript, JSON manifests, Markdown documentation, and two JavaScript support scripts. It runs on Node.js 22+ and uses the official MCP TypeScript SDK, Zod, Playwright, `unpdf`, `html-to-text`, and a native Windows Credential Manager binding. It compiles to ESM JavaScript and exposes twelve read-only study tools through MCP stdio. It has no network listener, database, server-side multi-user state, CI workflow, container definition, or infrastructure-as-code in this checkout.

Reviewed areas included:

- `src/`: CLI, MCP registration, authentication, session encryption/storage, Brightspace HTTP/API client, content transformations, URL formatting, and error handling.
- `tests/` and `scripts/`: unit tests, stdio smoke test, and optional UI verification script. The live/UI script was inspected but not executed.
- `package.json`, `package-lock.json`, and `tsconfig.json`: dependencies, scripts, resolved versions/integrity, compiler behavior, and release composition.
- `README.md` and `SECURITY.md`: claimed security invariants, deployment assumptions, limitations, and publication guidance.
- Presence/absence of CI/CD, containers, infrastructure, environment files, release configuration, and Git history.

### Architecture, entry points, and trust boundaries

The full system map is in [`notes/context-dossier.md`](notes/context-dossier.md).

MCP arguments enter through a common registration wrapper in `src/server.ts:13-24`, are parsed with Zod, and execute under `withSession`. The session layer loads AES-GCM-protected browser state, verifies identity, attempts bounded silent SSO renewal, and disposes request contexts (`src/auth/login.ts:29-98`). `StudyService` checks course IDs against current enrollments and `CanAccess`, and checks topic/attachment IDs against API listings before file retrieval (`src/tools/service.ts:63-75,201-219`). `BrightspaceClient` restricts authenticated requests to exact origin `https://online.mun.ca`, URL paths beginning `/d2l/`, no URL credentials, and zero redirects (`src/api/client.ts:8-11,20-47`). Results cross back to the model as JSON text and structured content.

Trust boundaries:

- The connected MCP client controls tool calls and schema-valid arguments.
- MUN/Brightspace controls API JSON, pagination, cookies, redirects, and downloaded bytes.
- Course authors can control meaningful subsets of titles, descriptions, rich text, calendar data, announcements, and documents.
- Course content is untrusted model input and can contain prompt injection.
- Windows Credential Manager, the logged-in Windows account, Node.js, Chromium/Playwright, dependencies, DNS, TLS, and the MUN identity provider form the trusted computing base.
- A process already running as the same Windows user is outside the claimed local confidentiality boundary, as documented by the project.

### Security invariants assessed

- Passwords and MFA secrets must remain inside the visible MUN browser.
- Session cookies and bearer tokens must remain encrypted at rest and fail closed on corruption.
- Authenticated network traffic must stay on the fixed MUN origin and must not follow redirects.
- Caller-supplied object IDs must be scoped to the authenticated enrollment and visible listings.
- Hidden and locked content must not be disclosed contrary to its availability state.
- Tools must remain read-only and must not begin quiz attempts or mutate D2L state.
- Remote data, parser work, result aggregation, and MCP output must be bounded.
- Logs and error results must not contain credentials or raw internal exceptions.

## Confirmed findings

### D2L-001 — Locked topic descriptions are disclosed through listing and search

**Severity:** Medium  
**Confidence:** High  
**CWE:** CWE-200, CWE-862  
**Locations:** `src/tools/service.ts:139-150`, especially line 145; `src/tools/service.ts:248-267`, especially lines 255-264; direct lock enforcement at line 208; registered entry points at `src/server.ts:36,48-50`.

**Root cause.** `content()` propagates a topic's effective locked state but still converts and returns `item.Description`. `searchMaterials()` searches the title and description before it checks whether a topic is locked. The direct material-reading path does enforce the lock and returns `PERMISSION_DENIED`, creating two inconsistent access policies for the same object.

**Attacker prerequisites.** The caller must be authenticated and enrolled in a course. A locked module or topic returned by the Brightspace ToC must contain description text intended to remain unavailable until release. The caller invokes `list_course_content` or searches for a term in that description.

**Exploit path.** Brightspace ToC → recursive module/topic transformation → locked topic description retained → MCP `list_course_content` output; or retained metadata → pre-lock metadata search → matching snippet returned. The locked topic file does not need to be fetched.

**Impact.** A student can receive future instructions, hints, assessment details, or other instructor text placed in a locked topic description. The demonstrated disclosure is limited to data already present in the authenticated ToC response; access to the locked file body was not bypassed.

**Executed evidence.** The isolated synthetic reproduction [`pocs/locked-topic-description.mjs`](pocs/locked-topic-description.mjs) returned the marker `SYNTHETIC_LOCKED_SECRET` from both content listing and search while direct material reading returned `PERMISSION_DENIED`. Its redacted output is [`pocs/locked-topic-description.out.txt`](pocs/locked-topic-description.out.txt).

**False-positive challenge.** This is a true positive. Zod constrains IDs and `requireCourse` proves enrollment, but neither removes locked metadata. The explicit direct-read denial establishes lock state as an application access boundary. Brightspace returning the field limits the data exposed but does not resolve the application's inconsistent enforcement.

**Recommended fix.** For every effectively locked topic, return only the minimal topic ID, title/path if needed for navigation, source link if appropriate, and `locked: true`; force `description: null`. Exclude locked topics and descendants of locked modules from metadata and file search. Consider suppressing titles as well if MUN's intended availability policy treats them as confidential.

**Regression guidance.** Build synthetic ToCs containing descriptions at directly locked topics and beneath locked parent modules. Assert that lock markers remain visible but secret description values do not occur anywhere in serialized `list_course_content` or `search_course_materials` output. Retain the direct-read denial test.

**Variant search.** The review generalized from `richText(item.Description)` to all `richText`/HTML conversion sinks and all visibility predicates. Quizzes check item visibility and `IsDisplayed`; announcements check hidden/published state; assignments check hidden state; grade values use the current-user endpoint; direct material reads check locks. No additional lock-state bypass was confirmed. Listing and search are deduplicated under this one root cause.

### D2L-002 — Remote content is fully buffered and processed without aggregate resource budgets

**Severity:** Medium  
**Confidence:** High  
**CWE:** CWE-400  
**Locations:** `src/api/client.ts:8-11,52-59,78-108`; `src/tools/service.ts:11-45,139-149,156-183,201-267`; `src/server.ts:20`.

**Root cause.** Playwright's `response.body()` materializes every response before a caller can inspect its size. The 20 MiB material limit therefore runs after allocation. JSON bodies have no byte limit, pagination accumulates up to 100 pages without an item or aggregate-byte limit, most remote strings are unbounded, PDF/HTML extraction has no CPU/memory/wall-clock isolation, recursive ToC processing has no depth/node cap, and MCP results are serialized without an output ceiling. Search can repeat file retrieval and parsing across 30 files, while multi-course aggregation can fan out across 100 courses.

**Attacker prerequisites.** A malicious or compromised course author can place an oversized or parser-adversarial accessible item in the course and induce its reading/search. A compromised or badly misconfigured Brightspace origin can return oversized API pages. A connected MCP client can deliberately repeat or maximize valid calls. This is not an unauthenticated remote attack.

**Exploit path.** Controlled response/document → complete body buffering → late limit or unbounded JSON decode/aggregation → full PDF/HTML processing or repeated search → unbounded JSON serialization → high memory/CPU, long stalls, or MCP process termination.

**Impact.** Availability loss for the local MCP server and resource pressure on the user's Codex host. No confidentiality or integrity impact was demonstrated. Medium severity reflects the ability of a course content authority to trigger processing in a credential-bearing local process; exploitation still requires authentication and user/model invocation.

**Executed evidence.** Two bounded synthetic reproductions were used:

- [`pocs/unbounded-announcement-output.mjs`](pocs/unbounded-announcement-output.mjs) demonstrated that a 2,097,152-character announcement is returned in full. Output: [`pocs/unbounded-announcement-output.out.txt`](pocs/unbounded-announcement-output.out.txt).
- [`poc-tests/resource-limits.test.ts`](poc-tests/resource-limits.test.ts) demonstrated that a complete body larger than 20 MiB reaches `StudyService` before `FILE_TOO_LARGE` is raised. The isolated Vitest result is [`raw/poc-resource-limits.json`](raw/poc-resource-limits.json).

No decompression bomb or stress campaign was run; the parser-complexity impact is reasoning-backed to avoid unsafe resource exhaustion during the audit.

**False-positive challenge.** This is a true positive. Existing MCP argument caps reduce fan-out but do not bound individual response bytes, aggregate page bytes/items, remote string lengths, extracted text, parser duration, or serialized output. The 20 MiB and 300-page checks mitigate ordinary documents but do not prevent pre-check allocation or decompressed/parser complexity.

**Recommended fix.** Replace complete-body retrieval with streaming and abort at conservative per-resource byte ceilings. Use `Content-Length` as an early rejection hint while still enforcing streamed bytes. Add JSON response, pagination item/byte, recursive depth/node, rich-text length, MCP output, and total operation budgets. Run PDF/HTML parsing in a worker or child process with wall-clock, memory, and cancellation limits. Give `search_course_materials` one shared budget for bytes, pages, files, requests, and elapsed time, and return explicit partial coverage when exhausted.

**Regression guidance.** Use only synthetic transports and local fixtures. Assert that oversized streams abort before full allocation, pagination stops at aggregate caps, recursive ToCs fail safely without stack exhaustion, transformations truncate with explicit markers, parsers are terminated on deadline, searches stop at a global budget, and MCP serialization remains below a configured maximum. Measure streamed bytes or peak RSS; a late `FILE_TOO_LARGE` exception is insufficient.

**Variant search.** The same missing resource-governance root cause occurs in announcement bodies, assignment and quiz instructions, grade feedback, calendar text, course/module/topic fields, pagination arrays, material extraction, recursive ToCs, deadlines fan-out, search fan-out, and final JSON serialization. These were deduplicated into D2L-002.

## Unresolved candidates

### UC-001 — Pagination cursors may replace non-pagination query parameters

`BrightspaceClient.paged` requires a server-supplied `Next` URL to retain the original origin and pathname but allows arbitrary query replacement (`src/api/client.ts:85-95`). A malicious API response could alter filters on the same endpoint. Brightspace remains responsible for object authorization, and no caller was found where changing the query yielded unauthorized data. Preserve invariant query keys and permit only documented pagination keys as defense in depth.

### UC-002 — Cross-process session updates have no explicit synchronization

Session replacement is atomic and in-process refreshes are coalesced (`src/auth/store.ts:59-64`; `src/auth/login.ts:74-76`), but separate login/renew/logout processes can race. Observed consequences are last-writer-wins state or recoverable `SESSION_UNREADABLE`, rather than credential disclosure. Add a named mutex/lock and define logout-versus-refresh ordering if concurrent CLI/server use is supported.

### UC-003 — Calendar response org-unit IDs are not revalidated

Requested calendar course IDs are checked against enrollment, but mapped events accept any positive `OrgUnitId` returned by Brightspace (`src/tools/service.ts:188-194`). No evidence established that MUN can return cross-scope events or that such data bypasses upstream authorization. Filter returned IDs against the requested accessible ID set and report unexpected records.

### UC-004 — Future npm publication payload is unconstrained

The project is currently `private: true`, but it has no package `files` allowlist or `.npmignore`. `npm publish --dry-run --json` selected source, tests, and audit artifacts. The current artifacts contained no credential, and publication is disabled by the project's deployment intent, so no present disclosure was confirmed. Before any publication, allowlist intended files and reject audit, diagnostics, tests, course fixtures, `.env`, session, log, and local-data paths in a release check. Evidence: [`notes/supply-config.md`](notes/supply-config.md) and [`raw/npm-publish-dry-run.json`](raw/npm-publish-dry-run.json).

### UC-005 — Prompt injection in retrieved course material

Course authors can place adversarial instructions in documents and rich text returned to a model. The server and material output explicitly label the data untrusted, but prose instructions cannot enforce technical data/code separation in an MCP host with other tools. No deterministic cross-tool exploit was established in this codebase. Keep every D2L tool read-only, preserve untrusted-content labels, minimize unnecessary content, and rely on host-level confirmation and tool isolation for consequential actions.

## Hardening opportunities

1. **Correct grade-release terminology.** `myGrades()` marks missing release dates as `unknown`, while `gradeInsights()` includes every numeric value under `released_grades` and `released_points_summary` (`src/tools/service.ts:92,95,111-123`). Rename this to `available_numeric_points_summary` unless a reliable release field proves release; keep unknown values separate.
2. **Reduce in-memory secret lifetime.** Key buffers are zeroed, but base64 keys, serialized sessions, cookies, and bearer tokens also exist as immutable JavaScript strings. TypeScript cannot reliably zero these. Keep the process single-purpose, avoid heap/crash dumps, and consider DPAPI/native opaque-blob operations for a stronger memory threat model.
3. **Validate persisted cookie attributes.** Exact domain filtering is present, but saved cookies are not required to be `secure`. Persist only expected cookie names/domains and require `secure`, subject to verified MUN compatibility.
4. **Authenticate envelope metadata.** AES-GCM AAD binds `BASE_URL`; bind the envelope/application version too for migration domain separation. Current schema validation already fails closed, so no downgrade was demonstrated.
5. **Validate saved timestamps.** Reject `savedAt` values beyond a small clock-skew allowance. A far-future value can defer proactive renewal, though identity is still verified on every use.
6. **Narrow 403 refresh behavior.** Authentication helpers treat `PERMISSION_DENIED` like expiration in identity verification. Refresh only on `AUTH_REQUIRED` unless MUN-specific evidence requires the broader case.
7. **Complete private-host output filtering.** `publicLink` rejects common private IPv4 literals and loopback but accepts private/link-local IPv6 literals. The server does not fetch these URLs, so authenticated SSRF was rejected; expanding filtering reduces risk in downstream clients.
8. **Improve iCalendar correctness.** Emit `VALUE=DATE` for all-day events, fold UTF-8 content lines, and count only emitted events. CR/LF text escaping prevented a confirmed property-injection finding.
9. **Make release controls executable.** Retain `private: true`; add a package allowlist, reproducible build, checksums/signing/provenance, secret scanning, lockfile review, and least-privilege protected release automation before publishing.
10. **Prefer lifecycle-script-free installation.** The isolated `npm ci --ignore-scripts` succeeded. Browser provisioning remains a separate downloaded-artifact trust boundary and should use the pinned Playwright CLI and a controlled cache/source.

## Rejected candidates after false-positive review

| Candidate | Verdict and evidence |
| --- | --- |
| Authenticated SSRF/arbitrary fetch | Rejected. Authenticated requests require exact origin and `/d2l/`; material routes are constructed from validated numeric IDs. External links are returned as strings and never fetched by the server. |
| Redirect credential leakage | Rejected. Playwright uses `maxRedirects: 0`, and all 3xx responses fail before another request. |
| Course/attachment IDOR | Rejected in assessed tools. Course IDs pass `requireCourse`; topic/attachment IDs must occur in visible listings; Brightspace remains the final authorization layer. |
| AES-GCM tampering/downgrade | Rejected. Algorithm is fixed, IVs are random 96-bit values, key/IV/tag lengths and schemas are checked, AAD binds the origin, and tampering fails closed. |
| Secret-bearing exception output | Rejected in inspected paths. Known errors use fixed messages; unexpected errors become a fixed `INTERNAL_ERROR`; login diagnostics contain status/counts only. |
| `MUN_D2L_SESSION_HOURS=0` bypasses authentication | Rejected. It disables scheduled renewal only. Identity remains verified and failed authentication still triggers renewal. |
| iCalendar CRLF property injection | Rejected for normal CRLF/LF payloads. Backslashes, line breaks, commas, and semicolons are escaped before output. Interoperability issues remain. |

## Static and dependency analysis

### Semgrep

The exact run-all plan was recorded before execution in [`SCAN_PLAN.md`](SCAN_PLAN.md) and machine-readable rulesets in [`rulesets.json`](rulesets.json). It selected official TypeScript/JavaScript/Node, security-audit, secrets, OWASP, CWE, insecure-transport, and gitleaks packs, plus applicable Trail of Bits, elttam, and Apiiro third-party repositories. Metrics were required off and private source was not to be uploaded.

Semgrep could not execute: the CLI was absent, and Python, `uv`, Bash, WSL, Docker, and Podman were unavailable, so the installed Trail of Bits `run-scans.sh` had no supported execution path on this host. No ruleset was silently treated as clean. Failure evidence is [`scans.json`](scans.json), [`raw/tool-preflight.txt`](raw/tool-preflight.txt), and [`raw/extended-tool-preflight.txt`](raw/extended-tool-preflight.txt). No Semgrep SARIF exists.

### CodeQL

The CodeQL CLI and `gh codeql` extension were absent. The planned JavaScript/TypeScript database, `security-and-quality`, and `security-experimental` suites could not run. No database extraction occurred, so extraction quality and source/sink model coverage could not be verified. Status: [`raw/codeql-status.json`](raw/codeql-status.json). No CodeQL SARIF exists.

### SARIF consolidation

The `sarif-parsing` workflow was applicable only if scanners produced SARIF. Neither Semgrep nor CodeQL ran, and no SARIF was generated; consolidation was therefore unavailable rather than empty. Manual findings and reproductions are consolidated in this report.

### Dependency and supply-chain results

`npm audit --json` and `npm audit --omit=dev --json` matched zero current npm advisories across 211 resolved package records. All lockfile tarballs use `https://registry.npmjs.org/` and include integrity hashes; all direct versions are exact. The only `hasInstallScript` record is optional development dependency `fsevents@2.3.3`, which is not installed on Windows. An isolated `npm ci --ignore-scripts --no-audit --no-fund` succeeded with 156 platform-applicable packages.

The Trail of Bits deterministic supply-chain collector could not run because Python/`uv` were absent. Registry maintainer concentration, project archival/staleness, download data, and repository activity remain unassessed. This distinction is recorded in [`notes/supply-config.md`](notes/supply-config.md) and [`raw/supply-chain-collector-status.json`](raw/supply-chain-collector-status.json). Raw advisory and tree outputs are [`raw/npm-audit-all.json`](raw/npm-audit-all.json), [`raw/npm-audit-production.json`](raw/npm-audit-production.json), [`raw/npm-tree.json`](raw/npm-tree.json), and [`raw/lock-analysis.json`](raw/lock-analysis.json).

### Secrets, build, and deployment

A bounded value-redacting scan checked the current application files for private-key blocks, common provider-token formats, and literal credential assignments; it returned zero candidates ([`raw/secret-scan.json`](raw/secret-scan.json)). Gitleaks and TruffleHog were unavailable. There is no Git history, so committed/deleted secrets are unassessed.

No root lifecycle hook, shell bootstrap, CI/CD, container, infrastructure, `.npmrc`, or checked-in environment file was found. Their security controls are unassessed because those deployment components do not exist. The compiled output contains source maps by design; future publication must decide explicitly whether to ship them.

## Dynamic and invariant testing

- Existing build: passed (`npx tsc` through `npm run build`).
- Existing offline suite: 7 files and 58 tests passed. Raw result: [`raw/vitest-results.json`](raw/vitest-results.json).
- Isolated D2L-001 reproduction: passed and demonstrated listing/search disclosure while direct read denied access.
- Isolated D2L-002 reproductions: passed with bounded 2 MiB output and 20 MiB+1 post-buffer rejection fixtures.
- No live MUN/Brightspace, browser-login, UI, external endpoint, malicious PDF, stress, or deployment test ran.
- Property-based testing was considered for URL and envelope invariants, but the project has no property-testing dependency and production dependencies were not changed. Existing focused tests plus isolated reproductions were used. No fuzzing campaign was run because network/parser resource exhaustion could not be safely bounded in-process and the code has no native memory-unsafe component under direct review.
- `zeroize-audit` compiler workflows target C/C++/Rust and were inapplicable to TypeScript. Secret lifetime was reviewed manually.
- `c-review`, `rust-review`, blockchain scanners, constant-time compiler analysis, and agentic Actions review were inapplicable because the corresponding languages/workflows do not exist here.
- README/SECURITY requirements were compared manually to implementation. The packaged spec-compliance workflow/agents were not callable; discrepancies are captured under D2L-001 and hardening opportunities.

## Coverage matrix

| Area | Manual review | Static scan | Tested | Status / artifact |
| --- | --- | --- | --- | --- |
| Architecture, entry points, trust boundaries | Yes | N/A | N/A | Reviewed; context dossier |
| MCP schemas and tool dispatch | Yes | Semgrep/CodeQL unavailable | Existing unit/smoke code inspected | Reviewed |
| Authentication and silent renewal | Yes | Semgrep/CodeQL unavailable | Offline auth tests passed | Reviewed; live login excluded |
| Session crypto and Credential Manager | Yes | Semgrep/CodeQL unavailable | Tamper/store unit tests passed | Reviewed; OS internals unassessed |
| Authorization and object scoping | Yes | Semgrep/CodeQL unavailable | Synthetic locked-content PoC | D2L-001 confirmed |
| HTTP origin, redirect, pagination | Yes | Semgrep/CodeQL unavailable | Client unit tests passed | SSRF/redirect candidates rejected; pagination candidate open |
| Material/PDF/HTML handling | Yes | Semgrep/CodeQL unavailable | Bounded size PoC | D2L-002 confirmed; hostile parser input excluded |
| Output encoding, links, iCalendar | Yes | Semgrep/CodeQL unavailable | Unit/manual synthetic checks | Reviewed; hardening listed |
| Dependencies and lockfile | Yes | npm advisory service | `npm ci --ignore-scripts` passed | Partial; deterministic health collector unavailable |
| Secrets | Current files only | Gitleaks/Semgrep unavailable | Redacted pattern scan | Partial; Git history unavailable |
| CI/CD and agent workflows | Presence checked | Not applicable | None | No workflows; controls unassessed |
| Containers and infrastructure | Presence checked | Not applicable | None | No definitions; controls unassessed |
| Release/package composition | Yes | N/A | npm pack/publish dry runs | UC-004 |
| Git revision/history | Attempted | N/A | N/A | Unassessed: not a Git checkout |
| Live tenant and UI behavior | Code inspected | N/A | Prohibited by scope | Unassessed |

## Tools, versions, commands, and artifacts

Versions are recorded in [`raw/versions.txt`](raw/versions.txt): Node.js `v24.16.0`, npm `11.13.0`, TypeScript `7.0.2`, and Vitest `5.0.0`. Semgrep and CodeQL were unavailable.

Principal commands executed from the target root:

```text
git rev-parse HEAD
git status --porcelain=v1
rg --files -g !node_modules/** -g !dist/** -g !security-audit-2026-09-13/**
semgrep --version                         # unavailable; no scan executed
codeql version                            # unavailable; no scan executed
npm audit --json
npm audit --omit=dev --json
npm ls --all --json
npm run build
npm test -- --reporter=json --outputFile=<audit>/raw/vitest-results.json
npm run security:audit
npm ci --ignore-scripts --no-audit --no-fund   # isolated directory
npm pack --dry-run --json
npm publish --dry-run --json
npx vitest run security-audit-2026-09-13/poc-tests/resource-limits.test.ts --reporter=json --outputFile=<audit>/raw/poc-resource-limits.json
```

The recorded scanner plan is [`SCAN_PLAN.md`](SCAN_PLAN.md). Independent review records are [`notes/manual-auth-crypto.md`](notes/manual-auth-crypto.md), [`notes/tools-business.md`](notes/tools-business.md), and [`notes/supply-config.md`](notes/supply-config.md). Raw artifacts are under [`raw/`](raw/).

## Limitations and concrete next steps

1. Re-run the recorded Semgrep run-all plan on a supported host with Semgrep and Bash/Python available, with metrics disabled and the audit directory excluded.
2. Install CodeQL locally, create and quality-check a JavaScript/TypeScript database, and execute both planned suites. Add project models only after reviewing extraction and default coverage.
3. Run the deterministic Trail of Bits supply-chain collector with Python 3.11+ or `uv`; preserve its unassessable criteria.
4. Place the project in a Git repository, establish a reviewed baseline commit, and scan the full history for secrets before publication.
5. Fix D2L-001 and D2L-002, then add the regression tests described above and repeat the manual variant review.
6. Perform a separate sandboxed parser assessment with hostile PDF/HTML corpora and OS-enforced memory/time limits.
7. Before a public release, implement the package allowlist and protected release workflow, then audit the final distributable artifact rather than only the source directory.

The assessed scope contains two confirmed Medium-severity findings. Static scanner, repository-history, live-tenant, and deployment-pipeline coverage remain incomplete and are explicitly unassessed.

