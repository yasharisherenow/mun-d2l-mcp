# Security review evidence

These are internal review artifacts created during development. They document scope,
methods, findings, remediation, and known limits; they are not an independent audit,
certification, or guarantee of security.

## 2026-09-14 review

- [Audit report](../security-audit-2026-09-14/SECURITY_AUDIT.md)
- [Scan plan](../security-audit-2026-09-14/SCAN_PLAN.md)
- [Post-fix verification](../security-audit-2026-09-14/POST_FIX_VERIFICATION.md)

This review revisited earlier findings, identified a low-severity pagination resource
limit, and records the implemented response, parser, visibility, concurrency, and
session-lifecycle hardening. Its stated limits include live MUN behavior, hostile
parser corpora, and workflow execution at the reviewed point in time.

## 2026-09-13 review

- [Audit report](../security-audit-2026-09-13/SECURITY_AUDIT.md)
- [Scan plan](../security-audit-2026-09-13/SCAN_PLAN.md)
- [Post-fix verification](../security-audit-2026-09-13/POST_FIX_VERIFICATION.md)

This initial review covers authentication and cryptography, tool behavior, dependency
risk, input/output limits, and manual code analysis at its recorded revision. Read the
reports themselves for exact tool coverage, rejected findings, and residual risks.

## Current automated evidence

GitHub Actions run the Windows Node.js test matrix, dependency audit, dependency
review, secret scan, Semgrep, and CodeQL. Passing automation is bounded evidence for
the checked revision; it does not replace review of the trust model or live tenant
behavior.
