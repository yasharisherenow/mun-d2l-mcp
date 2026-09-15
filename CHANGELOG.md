# Changelog

This file records user-visible and maintenance changes that are verifiable from the
repository history. The project has not published a tagged release yet.

## Unreleased

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
