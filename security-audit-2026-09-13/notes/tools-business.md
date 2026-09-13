# MCP tools and business-logic security review

## Scope and method

Reviewed `src/server.ts`, `src/tools/service.ts`, `src/tools/format.ts`, `src/api/client.ts`, their tests, and the tool/limitations sections of `README.md`. Applied the installed `audit-context-building`, `sharp-edges`, `fp-check`, and `variant-analysis` guidance directly; their packaged agent workflows were not used because this task was already an independently delegated review area. No live service was contacted and no production source was changed. Synthetic reproductions are under `../pocs/`.

## Context map

- Entry point: the local MCP stdio server registers every operation through the common wrapper at `src/server.ts:13-25`. Zod validates MCP inputs before service calls (`src/server.ts:14,18`), exceptions are redacted through `safeError` (`src/server.ts:21-23`), and all tools are annotated read-only (`src/server.ts:16`).
- Main trust boundary: an authenticated Brightspace API response crosses into `StudyService`. Responses are structurally validated by Zod (`src/tools/service.ts:48-51`), but almost all remote strings and collection sizes are unbounded (`src/tools/service.ts:11-45`). These values become MCP output through an unbounded `JSON.stringify` (`src/server.ts:20`).
- Authorization boundary: course IDs must occur in the authenticated user's enrollment list and be accessible (`src/tools/service.ts:63-67`). Topic reads additionally require the topic to occur in the visible ToC and be unlocked (`src/tools/service.ts:205-210`); assignment attachments must occur in the selected assignment (`src/tools/service.ts:211-215`).
- Network boundary: authenticated HTTP is constrained to the configured origin and `/d2l/` path (`src/api/client.ts:20-24`); pagination must keep the original origin and pathname (`src/api/client.ts:89-92`). Material reading never accepts an arbitrary URL.
- Sensitive output: grade feedback, assignment instructions, announcements, and course documents are intentionally returned to the connected MCP client. The MCP server instructs the client to treat material as untrusted (`src/server.ts:11`), but this is advisory rather than an enforced data/code separation.
- Deployment assumptions: local single-user stdio process, Windows user account owns the encrypted session, and Brightspace/instructors can control course metadata and content. A malicious or compromised MCP client already has the ability to invoke every registered read tool. An instructor, compromised course, or compromised Brightspace response can supply pathological metadata/documents but cannot directly choose arbitrary authenticated request URLs.

Security invariants observed:

1. A requested course must be enrolled and accessible. Enforced by `requireCourse` for course-specific tools.
2. Hidden items should not be exposed. Assignment, quiz, announcement, module, and topic lists filter their corresponding visibility flags (`src/tools/service.ts:75,101,129,141,145`).
3. Locked topic bodies must not be read. Enforced at `src/tools/service.ts:208`.
4. Authenticated requests remain on the MUN origin. Enforced at `src/api/client.ts:20-24` and pagination at `89-92`.
5. Tool work and output should be bounded. Enforced for MCP input array sizes/date windows (`src/server.ts:33,38-50`), readable file bytes/pages and returned document chunk (`src/tools/service.ts:218,226,243-245`), and pages (`src/api/client.ts:82,108`); nothing found that bounds API response bodies, accumulated item counts, most output strings, total extraction expansion, or wall-clock duration.

## Confirmed findings

### TB-MCP-01: Locked topic descriptions are exposed through listing and search

- Severity: **Medium**
- Confidence: **High**
- CWE: CWE-862 / CWE-200
- Affected code: `src/tools/service.ts:139-150`, especially `145`; `src/tools/service.ts:248-267`, especially `255-264`.
- Root cause: lock state is propagated and checked before the topic file is fetched (`src/tools/service.ts:208`), but `content()` still copies `Description` from a locked topic into its result (`src/tools/service.ts:145`). `searchMaterials()` searches title and description before checking `topic.locked` (`src/tools/service.ts:255-258`), so it returns a snippet from a locked description.
- Attacker prerequisites: an authenticated student is enrolled in a course; a locked module/topic returned in the ToC contains description text intended to remain unavailable until release. The student or an MCP-assisted prompt invokes `list_course_content` or searches for a term in the description.
- Exploit path: Brightspace ToC -> `moduleSchema` -> `content()` retains description despite `locked: true` -> direct MCP output, or `searchMaterials()` metadata match -> snippet output. No topic file request is required.
- Impact: premature disclosure of instructor-provided text such as future instructions, hints, or assessment details placed in a locked topic description. The impact is limited to description data already present in the authenticated ToC response; locked file contents remain blocked.
- Executed evidence: `pocs/locked-topic-description.mjs` and `pocs/locked-topic-description.out.txt`. The synthetic run returned `SYNTHETIC_LOCKED_SECRET` from both content and search while direct `readMaterial` returned `PERMISSION_DENIED`.
- FP-check verdict: **TRUE POSITIVE**. Upstream MCP schemas validate only IDs and query shape; `requireCourse` proves enrollment but does not remove locked metadata. The explicit locked-file guard demonstrates the application intends lock state to be an authorization boundary. The result is reachable via both registered tools (`src/server.ts:36,48-50`). Brightspace itself supplying the description limits impact but does not make the service's internally inconsistent policy false.
- Recommended fix: for locked topics, return only non-sensitive identity/path/lock fields and force `description: null`; exclude locked topics entirely from metadata search. Apply the same policy to descendants of locked modules. Add a regression test asserting the locked marker remains visible while locked description strings never occur anywhere in serialized `list_course_content` or `search_course_materials` results.
- Variant analysis: exact match was `description: richText(item.Description)` at line 145. Generalized search over every `richText`/`convert` sink and visibility predicate found no equivalent bypass in quizzes (both `IsDisplayed` and visibility checked), announcements (hidden/published filtered), assignments (hidden filtered), grades (current-user endpoint), or material reads (lock explicitly rejected). The two manifestations above share one root cause and are deduplicated here.

### TB-MCP-02: Instructor-controlled responses can cause excessive memory, output, CPU, and wall-clock use

- Severity: **Low**
- Confidence: **High**
- CWE: CWE-400
- Affected code: `src/api/client.ts:8-11,78-108`; `src/tools/service.ts:11-45,75-150,156-183,185-199,217-245,248-267`; `src/server.ts:20`; MCP bounds at `src/server.ts:38-52` are incomplete.
- Root cause: the transport buffers every HTTP body before any size check (`src/api/client.ts:10`). Pagination accumulates all objects across as many as 100 pages with no object/byte cap (`src/api/client.ts:79-108`). Remote strings accepted by Zod have no maximum lengths and entire collections/instructions/announcements/feedback are returned. The 20 MiB material check occurs only after the body has been buffered (`src/tools/service.ts:217-218`), and PDF/HTML extraction processes the whole object before output slicing (`src/tools/service.ts:223-245`). The common MCP wrapper then serializes the entire result (`src/server.ts:20`). Multi-course deadlines may issue up to two sequential collections per 100 courses (`src/tools/service.ts:156-180`); material search can serially fetch/extract 30 files (`src/tools/service.ts:254-260`), with no operation deadline or cancellation.
- Attacker prerequisites: a malicious/compromised instructor or Brightspace source can create oversized course metadata or a decompression-expensive document; alternatively, a connected MCP client can request maximum valid course/file batches. The service runs locally with the user's privileges but is single-process stdio.
- Exploit path: oversized response or many paginated items -> full buffering/parsing/aggregation/extraction -> unbounded result serialization; or maximum fan-out plus retry/20-second transport timeouts -> long-lived call.
- Impact: high memory/CPU use, very large MCP messages, and a stalled or terminated local MCP process. This is availability impact only under the assessed deployment, hence Low severity.
- Executed evidence: `pocs/unbounded-announcement-output.mjs` and `.out.txt` show a synthetic 2,097,152-character announcement is returned in full. This is a bounded demonstration; no stress test was run. Reasoning-only evidence establishes the pre-check buffering and sequential request multiplication from the cited lines.
- FP-check verdict: **TRUE POSITIVE**. MCP input constraints reduce fan-out but do not cap aggregate response size, individual API response bytes, extracted character count, or operation time. The 20 MiB and 300-page document checks mitigate common files but happen after buffering and do not bound decompressed text/HTML expansion. Exploitation requires a privileged content author/compromised upstream or the local MCP client, which reduces severity rather than negating the condition.
- Recommended fix: stream with an enforced response-byte ceiling; cap total pagination items and aggregate decoded bytes; set maximum remote string lengths and truncate rich text with an explicit `truncated` marker; impose per-tool output and operation budgets with cancellation; bound extracted characters during extraction rather than afterward; reduce sequential fan-out or stop on a total request/time budget. Regression tests should assert deterministic `RESPONSE_TOO_LARGE`/partial-result behavior and bounded serialization for oversized metadata, page counts, and extraction expansion.
- Variant analysis: exact match was unbounded announcement `Body` -> `richText` -> MCP serialization. Generalization found the same root cause in assignment instructions, quiz instructions/descriptions, grade feedback, calendar titles/descriptions, course/module/topic names/descriptions, pagination arrays, and extraction results. These are one resource-budget finding rather than separate alerts.

## Integrity/spec issue (hardening opportunity)

### H-MCP-01: Unknown-release grade values are labelled and calculated as released

- Evidence: `myGrades()` explicitly labels missing `ReleasedDate` as `release_status: 'unknown'` (`src/tools/service.ts:92,95`), but `gradeInsights()` selects every numeric point value without checking release status (`src/tools/service.ts:111-120`) and returns them under `released_grades` / `released_points_summary` (`119-123`). The existing test deliberately uses an item with no `ReleasedDate` and expects it in the 80% summary (`tests/service.test.ts:56-61`). README says missing release status remains unknown (`README.md:132-136`) while advertising released-point summaries (`README.md:104`).
- FP-check verdict: **Confirmed semantic inconsistency**, but classified as hardening rather than a security vulnerability because the endpoint returns the current user's own grade value and evidence is insufficient that a missing release timestamp means the value is unreleased. The misleading label can still damage academic-decision integrity.
- Recommendation: rename the aggregate to `available_numeric_points_summary`, preserve `unknown` grouping, and calculate a strictly released summary only when the API exposes a reliable release boolean/date. Never infer release from numeric presence.

### H-MCP-02: Calendar response org-unit IDs are trusted without membership validation

- Evidence: requested courses are enrolled/accessible at `src/tools/service.ts:188-192`, but mapped events accept any positive `OrgUnitId` supplied by the response and construct a source link from it (`src/tools/service.ts:42-46,194`).
- FP-check verdict: **Unresolved candidate**, not a confirmed exploit. An enrolled student cannot normally control the Brightspace calendar endpoint's response, and no local reproduction can establish that MUN returns cross-scope events without contacting the live service (prohibited for this audit). Defense in depth should filter every returned `OrgUnitId` against the requested ID set and mark unexpected records unavailable.

### H-MCP-03: Generated iCalendar has interoperability/correctness edge cases

- Evidence: all timestamps are emitted as UTC date-times (`src/tools/service.ts:273-280`) even for `all_day` events; lines are not folded at RFC 5545's 75-octet recommendation; `event_count` reports input event count even when events lacking valid start times are skipped (`src/tools/service.ts:277-285`). CR/LF, commas, semicolons, and backslashes are escaped, so no calendar property injection was confirmed (`src/tools/service.ts:273`).
- Recommendation: emit `VALUE=DATE` for all-day events, fold content lines by UTF-8 octets, and count emitted events. Add parser-based round-trip tests. Treat this as correctness, not a security finding.

### H-MCP-04: Search completeness can be misunderstood

- Evidence: `max_files` truncates the topic list before even metadata searching (`src/tools/service.ts:254`), and `complete` is false when additional topics exist (`267`). This is disclosed structurally, but a client may overlook it. Locked metadata is currently searched, which is the confirmed issue above.
- Recommendation: search bounded metadata separately from bounded document fetches, return an explicit `topics_total`, and keep `complete=false` prominent.

## Negative findings and defenses validated

- No arbitrary authenticated URL fetch: all paths are derived from validated numeric IDs and `BrightspaceClient.get` enforces exact origin and `/d2l/` prefix (`src/api/client.ts:20-24`). `publicLink()` only returns links and never fetches them (`src/tools/format.ts:28-43`). Therefore its incomplete DNS/private-IPv6 filtering is not an SSRF vulnerability in current code.
- Object-level checks exist for course IDs, topic IDs, and assignment attachment IDs (`src/tools/service.ts:63-67,205-215`). Synthetic tests already assert unenrolled courses and unlisted attachments are rejected (`tests/service.test.ts:75-78,94-97`).
- Hidden/inactive/unpublished filtering is present for primary list types, and quiz instructions/descriptions additionally respect `IsDisplayed` (`src/tools/service.ts:101-107,126-129`).
- ICS text injection was challenged: CR/LF and reserved text characters are escaped at `src/tools/service.ts:273`; numerical IDs form UID and timestamps are reconstructed, so no property-boundary injection was found.
- Hypothetical input is bounded to 100 items; names and scores are validated, scores cannot exceed possible points (`src/server.ts:31-34`), and output contains a direct non-official warning (`src/tools/service.ts:123`). Numeric overflow to `Infinity` is rejected by Zod number validation in ordinary parsing.
- Deadline and schedule date windows are MCP-bounded and ISO-offset validated (`src/server.ts:37-47`). Date ordering is explicit and missing dates remain unknown (`src/tools/service.ts:161-183`).

## Tests/coverage used

- Executed two synthetic PoCs only; outputs are saved adjacent to scripts.
- Inspected all service tests and server schemas. Existing tests cover category separation, missing values, private-comment omission, deadline boundaries/partial failures, quiz metadata, grade warning, enrolled-course enforcement, locked direct reads, attachment allowlisting, and material slicing (`tests/service.test.ts:18-98`).
- No live Brightspace endpoint, browser, credential store, external calendar importer, or external service was accessed.

