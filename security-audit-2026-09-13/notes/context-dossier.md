# Audit context dossier

## System and deployment

The target is a private Node.js 22 TypeScript application compiled to ESM JavaScript. It exposes twelve MCP tools over process-local stdio (`src/server.ts:12-59`) and has no network listener, container, database, CI workflow, or infrastructure definition in the assessed checkout. Playwright performs outbound HTTPS requests to a fixed MUN Brightspace origin. Authentication uses an interactive Chromium login and a headless silent-renewal flow (`src/auth/login.ts:29-72,79-98,101-153`).

The checkout is not a Git repository. A commit, branch, working-tree diff, and Git history cannot be established. The audit therefore covers the exact files present at the recorded timestamp in `inventory.json`, including the source changes already present there.

## Architecture and call paths

1. The MCP client sends structured tool arguments over stdio.
2. `createServer` validates each argument with Zod and invokes `withSession` (`src/server.ts:14-24,58`).
3. `withSession` decrypts the local session, attempts scheduled or reactive silent renewal, constructs a Playwright request context, and disposes it after the action (`src/auth/login.ts:79-98`).
4. `StudyService` verifies that caller-supplied course IDs occur in the authenticated enrollment set before constructing Brightspace routes (`src/tools/service.ts:63-69`). Attachment and topic IDs are checked against visible API listings before file retrieval (`src/tools/service.ts:201-219`).
5. `BrightspaceClient` confines authenticated requests to the exact configured HTTPS origin and `/d2l/` path, blocks redirects, discovers API versions, retries bounded transient failures, and enforces same-resource pagination (`src/api/client.ts:20-58,62-75,78-112`).
6. Results are converted to JSON in both MCP text and structured-content fields. Unexpected errors are redacted (`src/server.ts:16-24`; `src/errors.ts:8-12`).

## Trust boundaries and sensitive data

- **MCP client to server:** tool names and arguments are untrusted. Zod bounds scalar fields and array counts, but valid calls can initiate many upstream requests.
- **Brightspace/MUN to server:** API JSON, cookies, bearer tokens, HTML, PDFs, text, calendar data, links, and pagination cursors are untrusted inputs even though TLS authenticates the tenant. Course authors can control a meaningful subset of content.
- **Local persistence:** session cookies and a bearer token are encrypted with AES-256-GCM; ciphertext is stored under `%LOCALAPPDATA%`, while the 256-bit key is stored in Windows Credential Manager (`src/auth/store.ts:37-94`). The Windows user account and processes running as that user remain inside the trusted computing base.
- **Server to model/client:** course content is untrusted data that can contain prompt-injection text. Tool instructions warn the host, but the protocol does not technically isolate retrieved text from model context.
- **Calendar/browser handoff:** returned source URLs and generated iCalendar text may later be consumed by software outside this process.

## Security invariants and enforcement

| Invariant | Enforcement | Assumptions / gaps |
| --- | --- | --- |
| No password capture or storage | Login automation never locates or fills credential fields; only cookies and a captured Brightspace bearer are persisted | Playwright, Chromium, MUN pages, Node runtime, and Windows account are trusted |
| Authenticated HTTP stays at MUN | Exact origin, no credentials in URL, `/d2l/` prefix, zero redirects (`client.ts:20-25,43-47`) | DNS/TLS/platform resolution is trusted |
| Course object access requires enrollment | `requireCourse` enrollment and access check (`service.ts:63-69`) | Calendar response objects are not rechecked against requested membership |
| Locked material cannot be read | `readMaterial` rejects a locked topic (`service.ts:204-210`) | Nothing prevents descriptions already present in the ToC response from being returned or searched |
| Session ciphertext is tamper-evident | AES-GCM with 12-byte random IV and origin AAD; schema validation (`store.ts:44-89`) | JavaScript strings containing key/token material cannot be reliably zeroized |
| Failures do not disclose secrets | Known errors are generic; unknown errors are replaced (`errors.ts:8-12`) | Dependencies and Node diagnostics remain trusted not to dump process memory |
| Read-only operation | Registered tools only call GET routes; annotations declare read-only (`server.ts:16`) | Brightspace GET endpoints are assumed side-effect-free; login changes local session state |
| Resource use is bounded | Three HTTP attempts, 100 pages, 30 searched files, 20 MiB post-fetch file check, 300 PDF pages | Response bodies are fully buffered before size enforcement; aggregate item/text/output size and parsing time are not bounded |

## Attacker capabilities considered

- A malicious or compromised MCP client able to invoke exposed tools repeatedly with schema-valid inputs.
- A course author, compromised instructor account, or compromised Brightspace content item able to control topic metadata, files, announcements, quiz text, calendar text, and some external links.
- A compromised MUN/Brightspace tenant response or on-path actor only if TLS/platform trust has already failed.
- A local unprivileged user distinct from the logged-in Windows user who can inspect ordinary workspace files but cannot access that user's Credential Manager secrets.
- Malware or another process running as the same Windows user is outside the protection claimed by the design and can defeat local session confidentiality.

## Unresolved questions

- MUN's exact API authorization semantics for locked topic descriptions are not documented in the checkout.
- The MCP host's concrete handling of prompt injection and external links is outside this codebase.
- Brightspace response-size guarantees and Playwright streaming support for this request path were not specified locally.
- File ACLs inherited by `%LOCALAPPDATA%` and Credential Manager implementation behavior were not independently verified on this host.
- No release workflow, signing configuration, or repository history was available to assess.
