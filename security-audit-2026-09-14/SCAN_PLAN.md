# Security Audit Scan Plan

Target: `<REPOSITORY_ROOT>`

Mode: run all. Authorization was explicitly granted in the audit request. No source code will be uploaded to external services.

1. Inventory the current commit and working tree; map TypeScript/Node.js entry points, trust boundaries, sensitive state, and deployment assumptions.
2. Check Semgrep OSS/Pro availability with metrics disabled. If available, run `p/security-audit`, `p/secrets`, `p/typescript`, `p/javascript`, and `p/nodejs`, plus applicable Trail of Bits, elttam, and Apiiro JavaScript/TypeScript rule repositories through the installed skill runner. Record every failure, skip, partial scan, and zero-coverage result; merge successful SARIF locally.
3. Check CodeQL availability. If available, build a JavaScript/TypeScript database, verify extraction quality and explicit suite coverage, add project-specific models where warranted, then run security-and-quality and security-experimental suites. Record unavailable or failed coverage.
4. Run the installed supply-chain collector against `package.json` and `package-lock.json`; supplement it with `npm audit`, resolved-version inspection, install-script review, package allowlist verification, and `npm pack --dry-run`.
5. Inspect reachable Git history and the current checkout for secret patterns without printing matched values.
6. Run build, tests, isolated security PoCs, and bounded property-style checks where they materially exercise authentication, URL restrictions, parsing limits, pagination, rate limiting, and timezone invariants. Do not access MUN or any live service.
7. Manually trace attacker-controlled data through authentication, session storage, API transport, content extraction, MCP tool inputs and outputs, diagnostics, and calendar export. Validate every scanner candidate with caller/guard/reachability analysis and search for variants by root cause.
8. Consolidate confirmed findings, unresolved candidates, hardening opportunities, coverage, commands, versions, limitations, and prioritized remediation in `SECURITY_AUDIT.md`.
