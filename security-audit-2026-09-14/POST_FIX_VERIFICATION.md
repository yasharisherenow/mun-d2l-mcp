# Post-fix security verification

## Outcome

The sole confirmed audit finding, D2L-2026-003, is fixed in the current uncommitted
working tree. The post-fix review found no additional confirmed vulnerability in the
assessed local code paths. This result does not establish that the codebase is secure:
live MUN authorization semantics, hostile document corpora, and GitHub-hosted execution
were not tested.

## Implemented remediation

- Pagination enforces a 20 MiB cumulative raw-response budget across every page.
- Missing visibility, active, or publication flags fail closed. Future assignment
  instructions, links, and attachments are withheld, and direct reads are denied.
- MCP dispatch permits four active calls and sixteen queued calls. Parser work permits
  two active workers and four queued jobs. Overflow returns `RESOURCE_LIMIT`.
- Login, silent renewal, and logout are serialized across processes. Lock creation is
  exclusive, stale recovery uses atomic rename, and contention returns `SESSION_BUSY`.
- iCalendar escaping handles CRLF, LF, and lone CR line endings.
- GitHub Actions run tests, dependency audit/review, secret scanning, Semgrep, and
  CodeQL. Third-party actions are pinned to commit SHAs with least-privilege tokens.

## Executed verification

| Check | Result |
| --- | --- |
| TypeScript build | Passed |
| Vitest | 8 files, 70 tests passed |
| MCP stdio smoke | Passed; twelve tool definitions discovered |
| `npm audit` | 0 known vulnerabilities |
| CodeQL database | Finalized; 20 project files, 1,605 baseline lines |
| CodeQL suite | Trail of Bits run-all; 224 official JavaScript queries resolved |
| CodeQL analysis | Completed with local threat model; 17 candidates triaged below |
| Semgrep post-fix scan | Registry scan timed out at 60 seconds before producing output; prior 13-unit run-all scan remains the available coverage |

The CodeQL database archive contains all twelve production TypeScript files and eight
test files. The Trail of Bits `check_db_quality.py` helper incorrectly compared CodeQL's
Windows archive prefix (`C_/Users/...`) with the metadata prefix (`C:/Users/...`) and
reported a layout mismatch. The archive and metadata were independently inspected;
this helper failure is retained as a tooling limitation rather than reported as a pass.

## CodeQL candidate validation

CodeQL produced 17 alerts: fourteen `js/path-injection` results in `SessionStore` and
three experimental `js/untrusted-data-to-external-api-more-sources` results.

All path candidates share the injectable `directory` constructor parameter used by
offline tests. Production constructs `SessionStore` without that argument in the CLI,
server, and default login path, so the directory is derived solely from `%LOCALAPPDATA%`
plus a fixed component. MCP arguments and Brightspace data cannot reach it. These are
false positives for the documented local application deployment; library consumers
must treat this constructor as privileged configuration.

Two external-API alerts identify the Credential Manager value passed to AES-GCM. It is
the intended key, is decoded as Base64, must be exactly 32 bytes, and is zero-filled
after use. The remaining alert is in a test assertion. No candidate is confirmed.

No custom CodeQL model was added because manual tracing found no project wrapper hiding
a source-to-dangerous-sink flow. No third-party CodeQL packs were installed, so run-all
covers the official security-and-quality and security-experimental suites only.

## Regression evidence

Focused tests cover cumulative pagination bytes, fail-closed visibility, future
attachment denial without a network request, lone-CR calendar escaping, bounded
concurrency, queue overflow, and lifecycle-lock contention. Existing authentication,
crypto-tamper, origin, redirect, response-size, permission, timezone, extraction, and
MCP tests also passed.

## CI review

The two workflows contain no AI-agent action. They do not use `pull_request_target`,
execute event text, persist checkout credentials, or interpolate untrusted event data
into shell commands. Actions are commit-pinned. The top-level token is read-only; only
the CodeQL workflow receives `security-events: write` for SARIF upload.

## Raw artifacts

- [CodeQL plan](post-fix-codeql/scan-plan.txt)
- [CodeQL suite](post-fix-codeql/raw/run-all.qls)
- [CodeQL SARIF](post-fix-codeql/results.sarif)
- [CodeQL candidate summary](post-fix-codeql/results-summary.json)
- [npm audit](post-fix-npm-audit.json)

The attempted post-fix registry Semgrep scan used metrics-off mode and a 60-second
bound, but stalled before emitting JSON. It was terminated and is recorded as failed,
not clean. The earlier audit's 13-unit Semgrep run-all results, including Trail of Bits
rules, remain under `semgrep/`; CodeQL and manual review covered the changed paths.

## Remaining work before a public release

1. Push to a private GitHub repository first and confirm every workflow succeeds on
   GitHub's runners, including native Windows keyring dependency installation.
2. Perform a separately authorized, read-only live MUN verification for visibility,
   availability windows, identity, courses, deadlines, and grades.
3. Run a bounded hostile PDF/HTML corpus in an OS sandbox before advertising parser
   resilience to untrusted documents.
4. Enable private vulnerability reporting, branch protection, required checks,
   Dependabot alerts, and secret scanning where the account plan supports them.
