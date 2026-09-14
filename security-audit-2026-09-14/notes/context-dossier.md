# Audit context dossier

## System and deployment

`mun-d2l-mcp` is a local Node.js 22+ TypeScript MCP server transported over stdio. It authenticates through a visible Playwright browser, saves a sanitized browser state encrypted with AES-256-GCM, stores the encryption key in Windows Credential Manager, and performs read-only Brightspace GET requests. It is not a hosted HTTP service. The package is marked `private: true`.

## Entry points and trust boundaries

- `src/cli.ts` exposes login, renew, status, doctor, test-course, logout, and serve commands.
- `src/server.ts` exposes twelve MCP tools and validates caller input with Zod before invoking `StudyService`.
- `src/auth/login.ts` crosses the interactive MUN SSO boundary and converts browser state into an API session.
- `src/auth/store.ts` crosses the filesystem/keyring boundary. The ciphertext is outside the repository; the key is stored separately in the OS credential store.
- `src/api/client.ts` crosses the network boundary. Exact origin/path checks, disabled redirects, retry limits, per-response byte limits, and page/item limits constrain Brightspace responses.
- `src/tools/service.ts` maps untrusted Brightspace records into structured MCP output, applies enrollment and content visibility checks, and returns source links.
- `src/tools/extract.ts` and `document-worker.ts` cross the untrusted document-parser boundary in a bounded worker.

## Attacker capabilities and assumptions

A connected local MCP client controls tool arguments and call frequency. A course author can control course names, announcements, instructions, links, and accessible documents within Brightspace policy. The configured Brightspace origin can return malformed, oversized, or adversarial API data. A same-Windows-account attacker is outside the credential confidentiality boundary because that actor can normally use the same credential store and inspect or terminate user processes. MUN, TLS/DNS, Node.js, Playwright, the MCP host, and resolved dependencies are trusted components.

## Security invariants

- Authenticated requests must remain on the exact configured HTTPS origin and `/d2l/` path, and redirects must not carry credentials elsewhere.
- Every course-scoped request must first establish current enrollment and access.
- Topic and attachment reads must be derived from visible listings; locked topics must not expose descriptions or bodies.
- The password and MFA values must remain inside the visible login browser and must never be persisted by the application.
- Session data must never fall back to plaintext; authentication or network failures must preserve the last saved session.
- Remote responses, document parsing, pagination, recursion, output, retries, and elapsed work must be bounded.
- MCP tools must remain read-only and unexpected failures must not disclose secrets.

## Unenforced or partly enforced assumptions

- Pagination limits individual response bytes and total item/page counts, but nothing enforces a cumulative raw-byte limit across accepted pages.
- Optional Brightspace visibility flags are treated as visible when absent; local evidence cannot establish whether the student API ever omits the fields for hidden records.
- Separate CLI/server processes assume session save, refresh, and logout do not race; no cross-process lock enforces this.
- Assignment availability start dates are returned but not treated as an attachment/instruction confidentiality boundary.
- The stdio host is assumed to apply reasonable concurrency; the server has no process-wide semaphore.

## Open questions

- What tenant-side page and field-size ceilings does MUN enforce on student API responses?
- Does MUN omit or redact assignment instructions and attachments before `Availability.StartDate`?
- Can the MCP host dispatch enough concurrent parser calls to make the absence of a global budget practical?
- Does MUN use 403 from `whoami` as an expiration signal, or can renewal be limited to 401/auth redirects?
