# Post-audit remediation verification

The production fixes were applied after the original 2026-09-13 assessment.

## Fixed

- **D2L-001:** locked topic descriptions are suppressed, inherited module locks are enforced, locked topics are excluded from search, and direct reads remain denied.
- **D2L-002:** unknown-length, compressed, and oversized declared responses fail before body buffering; response/JSON/pagination/content-tree/rich-text/extracted-text/search-time/MCP-output budgets are enforced; PDF and HTML parsing runs in a memory-limited worker with a deadline.
- **UC-004:** npm publication uses an explicit `files` allowlist. The dry-run package excludes source, tests, audit output, local environment files, and logs.
- Grade aggregates no longer claim unknown-release values are released, calendar events are filtered to requested enrolled courses, pagination cannot remove original query filters, private/link-local IPv6 output links are rejected, and far-future session timestamps fail closed.

## Verification

- TypeScript compilation passed.
- The offline Vitest suite passed, including new lock, depth, response-length, JSON-byte, pagination-item, and URL tests.
- The MCP stdio handshake exposed exactly twelve read-only tools.
- The production dependency audit reported zero matched advisories.
- The original synthetic locked-topic reproduction no longer returned the locked marker through listing or search; direct reading still returned `PERMISSION_DENIED`.
- The bounded output reproduction was reduced from 2,097,152 returned characters to the configured 100,000-character rich-text ceiling.
- Isolated HTML worker extraction passed.
- Live status could not be reverified because MUN required a fresh interactive sign-in/MFA. No login was initiated during this automated verification.

Semgrep, CodeQL, supply-chain health metadata, Git history, and live tenant behavior retain the limitations documented in `SECURITY_AUDIT.md`.
