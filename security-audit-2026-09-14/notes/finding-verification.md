# Independent finding verification and variant analysis

## Method

I reviewed all TypeScript entry points and tests, compared the current checkout with the
2026-09-13 audit and post-fix verification, traced candidate data from MCP arguments and
Brightspace responses to network, storage, parsing, and output sinks, and applied the
`fp-check` standard-verification gates. Variant searches covered every call to `paged`,
visibility/lock predicates, rich-text conversion, document extraction, URL construction,
session encryption/storage, and MCP serialization. No live service was contacted.

## Confirmed finding

### D2L-2026-003 — Pagination has no aggregate byte budget

- **Verdict:** TRUE POSITIVE
- **Severity:** Low
- **Confidence:** Medium
- **Class:** CWE-400, uncontrolled resource consumption
- **Root cause:** `BrightspaceClient.paged()` enforces `MAX_JSON_BYTES` on each response
  and `MAX_PAGED_ITEMS` on the combined item count, but it retains up to 100 accepted pages
  without tracking their combined byte size. A small number of large fields per page can
  therefore pass both limits while accumulating far more than the nominal 5 MiB JSON limit.
- **Locations:** `src/api/client.ts:67-75` (per-response limit) and
  `src/api/client.ts:94-132` (100-page accumulation with item-count-only accounting).
- **Attacker prerequisites:** The authenticated Brightspace origin must emit many pages
  containing large records. In the realistic lower-privilege case, a course content authority
  would need Brightspace to permit enough large announcement, assignment, quiz, grade-feedback,
  calendar, or enrollment records and the user/model must invoke the corresponding tool.
  Exact tenant-side field/page limits were not tested, so confidence is Medium.
- **Exploit path:** Brightspace-controlled page bytes -> per-page JSON parse below 5 MiB ->
  `items.push(...)` across pages -> retained objects and subsequent Zod/output transforms ->
  memory pressure, long processing, or local MCP termination.
- **Impact:** Temporary loss of availability and memory pressure in the credential-bearing local
  MCP process. There is no demonstrated confidentiality or integrity impact. Memory is reclaimable
  when the operation/process terminates, and the amplification is bounded by 100 pages and 10,000
  items, which supports Low rather than Medium severity.
- **Executed reproduction:** `poc-tests/aggregate-pagination.test.ts` returns three individually
  valid pages containing one 1.8-million-character item each. The client retains all three, totaling
  5.4 million payload bytes, exceeding `MAX_JSON_BYTES`, while remaining safely bounded. Result:
  `raw/poc-aggregate-pagination.json` (passed).
- **Recommended fix:** Add an aggregate pagination byte ceiling and account for the raw accepted
  response length before parsing/retaining each page. Abort before adding a page that exceeds the
  remaining budget. Consider lower operation-specific item limits as well.
- **Regression test:** Assert that several individually valid pages whose cumulative body lengths
  exceed the aggregate ceiling fail with `PAGINATION_LIMIT` or `RESPONSE_TOO_LARGE` before the final
  page is retained.

### Variant sweep for D2L-2026-003

Exact calibration matched `items.push(...objectPage.data.Objects)` and
`items.push(...parsed.data.Items)` in `src/api/client.ts`. Generalizing to all accumulation sinks
found the array-return branch at lines 100-103, which has the same absence of byte accounting but
returns immediately and can add only one per-response-limited page; it is not an additional issue.
Generalizing to all `client.paged(...)` callers found courses, assignments, grades, quizzes, news,
deadlines, and calendar events. They share one root cause and are deduplicated under D2L-2026-003.
No other network pagination implementation exists.

The closest related issue is `searchMaterials()` checking its 30-second deadline only between file
operations (`src/tools/service.ts:238-248`). A single `readMaterial()` can outlive the nominal budget
because the HTTP client can make three 20-second attempts. This is listed below as hardening because
the total remains bounded, user-visible, and no stronger attacker-controlled amplification was shown.

## Prior findings rechecked

### D2L-001 locked topic disclosure

- **Verdict in current code:** FALSE POSITIVE / fixed.
- `content()` propagates parent locks, emits `description: null` for locked topics, and
  `readMaterial()` rejects locked topics. `searchMaterials()` skips locked topics before metadata
  or file search. The existing regression test at `tests/service.test.ts:80-87` exercises inherited
  locks and passes.
- Variant search across `IsLocked`, `IsHidden`, `IsDisplayed`, and rich-text sinks found no other
  confirmed lock-description bypass.

### D2L-002 unbounded remote parsing/output

- **Verdict in current code:** The original broad claim is mostly fixed; the aggregate-pagination
  variant above remains.
- Per-response declared length, encoding, response body, JSON, item count, page count, content-tree,
  rich-text, extracted-text, worker time/memory, and MCP-output limits are present. The aggregate byte
  omission is separately reported to avoid overstating the remaining impact.

## Unresolved candidates

### UC-2026-01 — Visibility flags fail open when omitted

Assignments, modules, and topics are included when `IsHidden` is absent; quizzes and announcements
are included when `IsActive`/`IsPublished` is absent (`src/tools/service.ts:73,99,127,143,147,178`).
This could disclose draft metadata only if MUN's student-facing APIs return such records with omitted
flags. Upstream Brightspace authorization may guarantee that they do not. No live tenant/API-contract
evidence was collected, so this is not confirmed. Prefer schemas that require documented visibility
fields or fail closed where the endpoint does not itself guarantee student-visible results.

### UC-2026-02 — Cross-process session save/logout race

Atomic rename protects file completeness, and in-process renewal is coalesced, but independent CLI
and MCP processes have no shared lock (`src/auth/store.ts:45-65,92-95`; `src/auth/login.ts:74-76`).
A save and logout, or two first-time saves, can leave an envelope/key mismatch or undo logout. The
likely impact is local availability or unexpected session persistence and requires the same Windows
account to run concurrent commands. This was not raced against the real native keyring during the
audit. Add a Windows named mutex or lock file with defined logout precedence if concurrent use is
supported.

### UC-2026-03 — iCalendar escaping leaves lone carriage returns

The calendar escaper replaces CRLF and LF but not a standalone CR (`src/tools/service.ts:261`). A
course-controlled title or description can therefore place a raw CR in generated iCalendar text.
RFC 5545 requires CRLF content-line boundaries, so exploitation depends on a target calendar parser
leniently treating lone CR as a new line. No importer was tested. Replace all CR, LF, and CRLF forms
with escaped `\\n`, and fold long lines according to RFC 5545.

## Rejected candidates and hardening

- **Off-origin credential leakage:** rejected. `BrightspaceClient.get()` requires the exact HTTPS
  origin, disallows URL credentials, requires `/d2l/`, and Playwright follows zero redirects.
- **Caller-selected object ID access:** rejected. Course IDs are checked against current enrollment;
  topic and attachment IDs must occur in visible course listings before download.
- **Session ciphertext tampering:** rejected. AES-256-GCM authenticates ciphertext with the fixed
  origin as AAD, validates key/IV/tag lengths, and validates decrypted structure and timestamps.
- **Public-link SSRF:** rejected. `publicLink()` only returns text to the caller; the server never
  fetches these external URLs.
- **Search deadline precision:** hardening. Propagate an absolute deadline/cancellation signal into
  HTTP retries and extraction if the documented 30-second ceiling is intended to be strict.
- **Saved cookie attributes:** hardening. Cookie domains are allowlisted and storage is encrypted,
  but `secure` is validated only as a boolean rather than required true. Requiring secure cookies
  would reduce risk if future navigation ever reaches cleartext HTTP, subject to MUN compatibility.

## Counts

- 1 TRUE POSITIVE (Low, Medium confidence)
- 2 prior findings verified fixed
- 3 unresolved candidates
- 4 rejected or hardening-only candidates
