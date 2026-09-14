# MUN D2L MCP Security Audit

> **Post-fix status (2026-09-14):** The confirmed pagination finding and listed
> hardening items have been implemented in the uncommitted working tree and verified.
> The current post-fix assessment has no confirmed open vulnerability in the assessed
> scope. This is not a claim that the project is secure; live MUN behavior, hostile
> parser corpora, and an actual GitHub-hosted workflow run remain unassessed. See
> [POST_FIX_VERIFICATION.md](POST_FIX_VERIFICATION.md). The body below preserves the
> evidence and state observed at the original audit baseline.

## Executive summary

The current checkout contains one confirmed **Low-severity** availability issue: paginated Brightspace responses are limited to 5 MiB per JSON response, 100 pages, and 10,000 items, but their cumulative raw bytes are not bounded. A safe synthetic reproduction retained 5.4 million attacker-controlled characters across three valid pages. Exploitation requires the authenticated MUN origin to return sufficiently large paginated records and a user or model to invoke an affected tool; no confidentiality or integrity impact was demonstrated.

The two Medium findings from the 2026-09-13 audit were rechecked and are fixed apart from this narrower pagination variant. Locked topic descriptions and search results now fail closed, and response, parser, tree, text, and MCP output limits now constrain the earlier broad resource-exhaustion condition.

Prioritized remediation:

1. Track cumulative raw response bytes inside `BrightspaceClient.paged()` and abort before accepting a page that exceeds the operation budget.
2. Define fail-closed policy for absent visibility flags and pre-start assignment instructions/attachments using documented or separately authorized MUN behavior.
3. Add process-wide concurrency limits for authenticated calls and parser workers, and serialize cross-process session lifecycle operations.
4. Add local CodeQL coverage and a least-privilege CI/release workflow before accepting external contributions or publishing artifacts.

Semgrep OSS completed 13 run-all scan units. Six deduplicated alerts were manually challenged and rejected as false positives. CodeQL was unavailable, so no CodeQL database or query suite ran. Dependency collectors found no known advisory affecting the 10 direct or 199 registry-verified transitive packages at their locked versions. These results do not establish that the codebase is secure; the coverage limits below remain material.

## Scope and reviewed revision

- Target: `<REPOSITORY_ROOT>`
- Commit: `91d08f0f91198178cd7b9a8b25474f8d03170c8d` (`Initial secure MUN D2L MCP server`)
- Initial working tree: clean. The final untracked changes are confined to `security-audit-2026-09-14/`.
- History: one reachable commit and 76 tracked files were inspected.
- Languages/frameworks: TypeScript and JavaScript on Node.js 22+, official MCP TypeScript SDK, Zod, Playwright, Vitest, `html-to-text`, `unpdf`, and a native OS-keyring binding.
- Deployment: local single-user stdio MCP process; no hosted server, CI/CD workflow, container, infrastructure-as-code, or deployment manifest exists in the checkout.
- Reviewed: production source, scripts, tests, documentation, security configuration, manifests, lockfile, package contents, reachable Git history, and prior audit evidence.
- Excluded: live MUN/Brightspace calls, interactive login, deployment, publication, destructive tests, and external source-code upload.

The exact pre-execution plan is [SCAN_PLAN.md](SCAN_PLAN.md). Architecture, boundaries, assumptions, and invariants are in [notes/context-dossier.md](notes/context-dossier.md).

## Threat model

A local MCP client controls valid tool arguments and call frequency. A malicious or compromised course author controls text, links, metadata, and accessible documents returned by Brightspace. The configured origin may return malformed or adversarial API responses. The principal assets are the MUN browser session, bearer token, encrypted session file, OS-held encryption key, private course data, and availability of the credential-bearing local process.

The same Windows account is outside the credential-confidentiality boundary because it can normally access the same credential store and inspect user processes. MUN authorization, TLS/DNS, Node.js, Playwright, the MCP host, and dependency integrity are trusted assumptions. Course content remains untrusted model input even when Brightspace authorizes access.

## Confirmed findings

### D2L-2026-003 — Pagination lacks a cumulative byte budget (resolved in working tree)

- **Severity:** Low
- **Confidence:** Medium
- **CWE:** CWE-400, uncontrolled resource consumption
- **Locations:** `src/api/client.ts:67-75`, `src/api/client.ts:94-132`
- **Root cause:** `json()` limits each response to 5 MiB. `paged()` then retains up to 100 accepted pages and 10,000 items without accounting for the combined raw response size.
- **Attacker prerequisites:** The authenticated Brightspace origin must supply multiple individually valid, large pages. A course author would also need Brightspace to permit enough large accessible fields, and the user/model must invoke a paged tool. Tenant-side limits were not tested.
- **Exploit path:** Brightspace-controlled page body → per-page JSON check and parse → repeated `items.push(...)` → retained objects and Zod/tool transformations → memory pressure, latency, or MCP process termination.
- **Impact:** Temporary local availability loss and memory pressure in the credential-bearing MCP process. The existing 100-page and 10,000-item limits bound amplification, and no data disclosure or mutation was demonstrated.
- **Evidence:** The executed [aggregate-pagination test](poc-tests/aggregate-pagination.test.ts) supplied three pages containing one 1.8-million-character item each. All pages passed individual checks and 5.4 million payload characters were retained. The test result is [raw/poc-aggregate-pagination.json](raw/poc-aggregate-pagination.json).
- **Recommended fix:** Maintain a cumulative raw-byte counter in `paged()`, using the accepted response body length before parsing/retaining each page. Abort with a stable resource-limit error before a page exceeds the remaining operation budget. Consider smaller operation-specific item ceilings.
- **Regression guidance:** Supply several individually valid pages whose combined body lengths exceed the aggregate ceiling. Assert rejection occurs before the final page is retained, while an exactly-at-limit sequence succeeds. Cover both supported pagination shapes and all paged callers through the shared client behavior.

The variant sweep found the same root cause in every `client.paged(...)` caller: enrollments, assignments, grades, quizzes, announcements, deadlines, and calendar events. These are one shared client defect and are deduplicated under D2L-2026-003.

## Unresolved candidates

### UC-2026-01 — Visibility flags fail open when omitted

Assignments, modules, and topics are included when `IsHidden` is absent; quizzes and announcements are included when `IsActive` or `IsPublished` is absent (`src/tools/service.ts:73`, `99`, `127`, `143`, `147`, `178`). This becomes a disclosure only if MUN's student APIs return non-visible records with omitted flags. Require documented fields or fail closed where the endpoint does not guarantee student-visible results.

### UC-2026-02 — Future assignment attachments may precede availability

Assignment availability dates are parsed, but assignment instructions and attachment IDs are returned without enforcing `Availability.StartDate`; attachment reads rely on membership in that listing (`src/tools/service.ts:16-21`, `71-82`, `216-220`). MUN API behavior and the intended product policy are unknown. If the start date is a confidentiality boundary, suppress protected details and deny reads before it opens.

### UC-2026-03 — Cross-process session lifecycle race

Atomic rename prevents partial files and in-process renewal is coalesced, but independent login, renew, serve, and logout processes have no shared lock (`src/auth/store.ts:45-65`, `92-95`; `src/auth/login.ts:74-76`). Likely effects are last-writer-wins state, envelope/key mismatch, or unexpected persistence after logout. A native-keyring race was not executed. Add a named mutex or lock with defined logout precedence if concurrent commands are supported.

### UC-2026-04 — iCalendar escaping leaves standalone carriage returns

The escaper replaces CRLF and LF but does not replace a lone CR (`src/tools/service.ts:261`). Exploitation depends on a calendar importer treating lone CR as a content-line boundary. Replace all CR/LF forms and add RFC 5545 folding/import tests.

### UC-2026-05 — Aggregate concurrent work is not bounded

Each parser worker has memory/time bounds, but the server imposes no process-wide semaphore (`src/tools/extract.ts:22-43`; `src/server.ts:13-27`). Practical exploitability depends on MCP host concurrency and the same-user threat boundary. Add separate queue ceilings for authenticated operations and parser workers.

## Scanner candidate validation

Semgrep's merged SARIF contained six candidates:

- Five Apiiro malicious-code heuristics flagged compact mapping/escaping expressions in `src/tools/service.ts`. Manual inspection showed readable application logic with no obfuscation, dynamic loading, exfiltration, or concealed execution. **Verdict: false positive.**
- `javascript.node-crypto.security.gcm-no-tag-length` flagged `createDecipheriv` at `src/auth/store.ts:84`. The caller decodes the stored tag and rejects every tag whose length is not exactly 16 bytes at line 83 before constructing the decipher, then authenticates it through `setAuthTag()` and `final()`. **Verdict: false positive.** Specifying `authTagLength: 16` would make the invariant visible to tooling but does not change the enforced current behavior.

No scanner candidate was promoted to a confirmed finding. The validation record and variant analysis are in [notes/finding-verification.md](notes/finding-verification.md).

## Hardening opportunities

1. `PERMISSION_DENIED` participates in authentication renewal. Limit refresh to `AUTH_REQUIRED` unless verified MUN behavior requires a narrow 403 exception (`src/auth/login.ts:7`, `88-96`).
2. Treat malformed nonempty deadline timestamps as invalid/unavailable instead of silently omitting them while returning `complete: true` (`src/tools/service.ts:165-169`).
3. Require secure persisted-cookie attributes and, after live compatibility validation, allowlist required MUN cookie names (`src/auth/store.ts:23-35`).
4. Propagate an absolute deadline/cancellation signal into HTTP retries and extraction so the documented 30-second search ceiling also constrains a single in-flight read (`src/tools/service.ts:238-248`).
5. Pin the package manager using `packageManager` in `package.json`; add reproducible checks, secret scanning, least-privilege CI permissions, artifact verification, and protected release steps before public distribution.
6. Review whether source maps belong in a future distributable package. `private: true` currently prevents npm publication, and the `files` allowlist limits package contents.
7. JavaScript cannot reliably zero immutable bearer, cookie, and base64-key strings. Keep the process single-purpose and avoid heap/crash dumps containing process memory.

## Static and dependency analysis

### Semgrep and SARIF

Semgrep OSS `1.177.0` ran with `--metrics=off`. Pro was checked and unavailable because no Semgrep login/token was configured. The installed Trail of Bits runner executed 13 units covering official `p/security-audit`, `p/secrets`, `p/owasp-top-ten`, `p/cwe-top-25`, `p/insecure-transport`, `p/gitleaks`, `p/javascript`, `p/typescript`, and `p/nodejs`, plus Trail of Bits, elttam, and Apiiro repositories. All 13 produced results; none failed, skipped, or covered zero files. Elttam and Apiiro were partial because 12 and 4 individual rules respectively failed to compile; successful rules and their findings were retained. Details are in [semgrep/scans.json](semgrep/scans.json) and [raw/semgrep-rule-errors.json](raw/semgrep-rule-errors.json).

The 13 SARIF files were locally consolidated and deduplicated into [results/semgrep-results.sarif](results/semgrep-results.sarif), containing six candidates. The cloned rule repositories remain isolated under the audit output directory because the local deletion control rejected recursive cleanup.

### CodeQL

The CodeQL CLI was absent from Windows and WSL. No JavaScript/TypeScript database was created, so extraction quality, explicit suite coverage, inter-file taint analysis, and project-specific source/sink models were not assessed. Planned `security-and-quality` and `security-experimental` suites are recorded in [raw/codeql-status.json](raw/codeql-status.json). No CodeQL SARIF exists.

### Dependencies and install surface

The deterministic Trail of Bits collector assessed all 10 direct dependencies and advisory status for 199 registry-verified transitive packages at lockfile-resolved versions. It found no known advisories. `npm audit` independently reported zero vulnerabilities for both the full and production trees. The lock contains 211 package records, registry tarballs carry integrity hashes, and direct versions are exact.

The collector flagged build-only single-publisher concentration for two `@types` packages and an upstream OpenSSF Binary-Artifacts score of 6/10 for production dependency Playwright. These are maintenance/supply-chain signals, not demonstrated application exploits. Publisher concentration remained unassessable for six provenance-based publishers, and several Scorecard criteria were unavailable for four repositories. Full measured coverage is in [supply-chain/report.md](supply-chain/report.md) and raw data in [supply-chain/findings.json](supply-chain/findings.json).

The only lockfile lifecycle script belongs to optional, Darwin-only `fsevents@2.3.3`; it is not installed on Windows. `npm pack --dry-run` and package allowlist behavior were reviewed. No root lifecycle scripts exist.

### Secrets and history

A value-redacting scan inspected the one reachable commit for private-key blocks, provider token formats, bearer literals, and credential assignments without printing values. It found zero candidates ([raw/secret-scan.json](raw/secret-scan.json)). Semgrep `p/secrets` and `p/gitleaks` also found zero candidates. This does not replace organization-level secret scanning or cover unreachable objects/reflogs.

## Dynamic and invariant testing

- `npm run build`: passed.
- Vitest: 11 files and 65 tests passed ([raw/vitest-results.json](raw/vitest-results.json)).
- MCP smoke test: handshake and all twelve tool definitions passed ([raw/smoke.txt](raw/smoke.txt)).
- Isolated cumulative-pagination reproduction: passed and confirmed D2L-2026-003.
- Prior locked-content regression: passed; the former D2L-001 disclosure is fixed.
- No live MUN, browser-login, hostile PDF corpus, stress, deployment, or publication test ran.

Property-based and fuzzing campaigns were considered. Existing focused boundary tests and the isolated pagination harness gave direct evidence for the material invariants without adding dependencies or risking uncontrolled parser resource use. Native sanitizers, constant-time compiler analysis, C/Rust reviewers, blockchain scanners, and zeroization compiler workflows were inapplicable to this TypeScript project. There are no AI-agent GitHub Actions to assess.

## Coverage matrix

| Area | Manual | Static/dependency | Executed tests | Status |
| --- | --- | --- | --- | --- |
| Architecture and trust boundaries | Complete | N/A | N/A | Reviewed; dossier linked above |
| MCP schemas and dispatch | Complete | Semgrep | Unit + smoke | Reviewed |
| Authentication and renewal | Complete | Semgrep; CodeQL unavailable | Offline unit tests | Live SSO excluded |
| Session crypto/keyring | Complete | Semgrep candidate validated | Store/tamper tests | OS internals and cross-process race untested |
| Origin, redirects, retries | Complete | Semgrep | Client tests | Reviewed |
| Pagination | Complete | Semgrep | New isolated PoC | One Low finding |
| Course/object authorization | Complete | Semgrep | Service tests | MUN availability semantics unresolved |
| PDF/HTML extraction | Complete | Semgrep | Existing bounded tests | Hostile corpus/stress excluded |
| Output, links, calendar | Complete | Semgrep | Unit tests | Lone-CR candidate unresolved |
| Dependencies/lockfile | Complete | Collector + npm audit | Tree/pack inspection | Advisories clean in assessed data; metadata partly unavailable |
| Secrets/history | Complete for reachable commit | Semgrep + redacted scan | N/A | Reflogs/unreachable objects unassessed |
| CI/CD | Presence checked | N/A | None | No workflows exist; future controls unassessed |
| Containers/IaC | Presence checked | N/A | None | No definitions exist |
| CodeQL inter-file analysis | Manual substitute only | Not run | None | Unassessed |
| Live tenant/deployment | Code inspected | N/A | Prohibited by scope | Unassessed |

## Tool versions and commands

Recorded versions include Node.js `v24.16.0`, npm `11.13.0`, Git `2.55.0.windows.3`, ripgrep `15.2.0`, Semgrep OSS `1.177.0`, TypeScript `7.0.2`, and Vitest `5.0.0`. The Windows preflight is [raw/tool-versions.json](raw/tool-versions.json).

Principal commands:

```text
git rev-parse HEAD
git status --porcelain=v2
git log --all --format=...
npm run build
npm test -- --reporter=json --outputFile=<audit>/raw/vitest-results.json
npm run smoke
npm audit --json
npm audit --omit=dev --json
npm ls --all --json
npm pack --dry-run --json
semgrep --pro --validate --metrics=off --config p/default   # Pro unavailable
run-scans.sh --target <local snapshot> --output-dir <audit>/semgrep --mode run-all --rulesets <audit>/rulesets.json --jobs 2
merge_sarif.py <audit>/semgrep/raw <audit>/results/semgrep-results.sarif --scans <audit>/semgrep/scans.json
collect.py <project> --json <audit>/supply-chain/findings.json
render.py <audit>/supply-chain/findings.json --out <audit>/supply-chain/report.md
node <audit>/raw/secret-scan.mjs
```

Independent review records are [notes/manual-review.md](notes/manual-review.md), [notes/finding-verification.md](notes/finding-verification.md), and [notes/supply-ci-results.md](notes/supply-ci-results.md). Raw and machine-readable artifacts remain under `raw/`, `semgrep/`, `results/`, and `supply-chain/`.

## Limitations and next steps

1. Install CodeQL locally, create a JavaScript/TypeScript database, run the explicit planned suites, verify extraction/query coverage, and add models only where inspection shows missing project wrappers.
2. Apply the pagination fix and rerun the isolated harness, full unit suite, Semgrep, and manual variant review.
3. Resolve MUN visibility/availability semantics through vendor documentation or a separately authorized non-destructive tenant test.
4. Run hostile PDF/HTML corpus tests in an OS sandbox with enforced process memory and wall-clock ceilings.
5. Audit the final GitHub Actions and distributable package if CI or public release is added; current absence means those controls were not assessable.

The assessed scope contains one confirmed Low-severity finding. CodeQL, live-tenant behavior, hostile parser corpora, concurrency stress, and future deployment/release controls were not successfully assessed and must not be inferred clean from the other results.
