# Recorded scan plan

Recorded before execution on 2026-09-13.

- Target: current workspace checkout, excluding `node_modules`, compiled `dist`, and this audit output directory where supported.
- Mode: Semgrep `run all`, telemetry/metrics disabled.
- Languages: TypeScript/JavaScript, JSON, Markdown, PowerShell where rules exist.
- Semgrep engine: check Pro availability first; use OSS if Pro is unavailable.
- Semgrep rulesets intended: official `p/typescript`, `p/javascript`, `p/nodejs`, `p/security-audit`, `p/secrets`, plus applicable Trail of Bits, 0xdea, and Decurity third-party rules from the installed skill runner. Record failures and skipped rulesets.
- CodeQL: check CLI availability; if present, create a JavaScript/TypeScript database from the current source and run the standard JavaScript security-and-quality/security-extended suites, recording extraction and suite coverage. If absent, record unavailability and continue.
- Dependency analysis: `npm audit --json --omit=dev`, resolved package inventory, lifecycle scripts, lockfile integrity/pinning, and direct dependency review.
- Secret review: local source plus accessible Git history only, without printing candidate secret values. This directory is not a Git checkout, so history coverage may be unavailable.
- Dynamic tests: existing offline Vitest suite and isolated, bounded audit PoCs only. No live MUN/Brightspace or other external-service tests.
- Consolidation: preserve raw JSON/SARIF where generated; triage every alert as candidate evidence, manually verify reachability and guards, then hunt root-cause variants.
