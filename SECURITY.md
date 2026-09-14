# Security

## Security model

This server is intended for one user on a trusted Windows account. It communicates
over MCP stdio and does not listen on a TCP port. It is read-only: it does not submit
course work, post messages, change grades, or collect rosters.

Authenticated requests are restricted to `https://online.mun.ca/d2l/`. Redirects
are not followed with credentials, pagination must remain on the original API path,
and course IDs must come from the authenticated user's enrollments. Material tools
cannot fetch arbitrary URLs. Returned external links must use HTTPS, cannot contain
credentials or credential-like parameters, and cannot target localhost or common
private IPv4 ranges.

The program never reads or stores the user's password. Retained Brightspace and MUN
Login cookies and an optional Brightspace bearer token are encrypted using
AES-256-GCM. The random encryption key is kept in Windows Credential Manager and the
encrypted envelope is kept under `%LOCALAPPDATA%\mun-d2l-mcp`, outside the project.
Browser local storage is discarded. Session envelopes, key lengths, nonces, tags,
timestamps, cookie domains, cookie counts, and field sizes are validated before use.
Login, silent renewal, and logout use an exclusive cross-process lifecycle lock.
Stale locks are recovered with an atomic rename so a replacement lock is not deleted.
MCP calls and document-parser workers have fixed active and queue limits.

Tool output and errors do not include credentials. Brightspace content is untrusted
input and must never be treated as instructions by an MCP host.

## Limits of protection

No local application can protect its session from malware or another process already
running as the same Windows user. A compromised Windows account, Codex host, Node.js
runtime, dependency, browser, university identity provider, or Brightspace tenant can
defeat these controls. Full-disk encryption and a locked Windows session protect data
when the computer is lost or unattended.

Running `npm run logout` removes this application's encrypted session and Credential
Manager key. It does not revoke MUN's server-side SSO session or sign out other browsers.
Use MUN's account controls when server-side revocation is required.

## Before publishing a release

1. Run `npm ci`, `npm run build`, `npm test`, and `npm run security:audit`.
2. Scan the repository and Git history for credentials, session files, logs, and user data.
3. Review dependency lockfile changes and publish from a clean checkout.
4. Require the repository's pinned CI, CodeQL, Semgrep, secret scan, and dependency
   review jobs to pass.
5. Sign release artifacts and publish checksums through the official release workflow.
6. Keep remote transports disabled unless standards-compliant OAuth, per-user session
   isolation, HTTPS, abuse controls, and a separate security review are implemented.

## Reporting a vulnerability

Do not include passwords, cookies, bearer tokens, grades, or course material in a
public issue. Use the repository's private security-advisory channel after publication.
