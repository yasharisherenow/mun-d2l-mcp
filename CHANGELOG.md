# Changelog

This file records user-visible and maintenance changes that are verifiable from the
repository history. The project has not published a tagged release yet.

## Unreleased

- Added offline English OCR for PNG/JPEG and scanned PDF pages, with page offsets,
  uncertainty labels, bounded raster/page limits and explicit incomplete coverage.
- Fixed updater checkout validation for Windows junction/short-path aliases and
  gave the large synthetic archive-budget test a CI-specific timeout allowance.
- Enabled repository dependency graph/Dependabot alerts to restore dependency
  review without disabling its moderate-severity gate.

- Added bounded DOCX/PPTX text reading and search through existing material tools,
  preserving worker isolation and rejecting encrypted/macro-enabled Office files.
- Added `npm run update` for clean-main fast-forward updates, dependency/Chromium
  installation, build and smoke verification, with explicit MCP restart guidance.

- Added bounded authentication and MCP queue waits with classified timeout errors.
- Added a redacted, manual live verifier and explicit API-version baseline handling.
- Consolidated Windows CI across Node.js 22 and 24, including a weekly offline run.
- Added editable Mermaid diagrams and setup instructions for multiple MCP clients.
- Added release guidance, error-code documentation, dependency review, secret
  scanning, Semgrep, CodeQL, and automated build/test/smoke checks.
- Hardened response sizing, pagination, content visibility, concurrency, encrypted
  session storage, session lifecycle locking, and authenticated URL handling.

## 0.1.0 — initial repository version

- Added a local, Windows-only, read-only MCP server for MUN Brightspace.
- Added encrypted browser-session persistence using Windows Credential Manager.
- Added twelve study tools backed by discovered Brightspace Valence API versions.
