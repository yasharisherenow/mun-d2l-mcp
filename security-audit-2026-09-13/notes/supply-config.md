# Supply chain, build, deployment, and secret-history review

## Scope and environment

The review covered `package.json`, `package-lock.json`, `.gitignore`, TypeScript build configuration, documentation that defines the deployment model, the resolved `node_modules` tree, project scripts, and the presence of CI/CD, container, infrastructure, and environment configuration. The checkout is a local TypeScript/Node.js MCP stdio application for one Windows user. It has no network listener, container definition, infrastructure-as-code, or CI/CD workflow in the assessed directory.

No Git repository exists at the workspace or any parent directory (`git status`, `git rev-parse HEAD`, and `git log` each returned “not a git repository”). A commit identifier, working-tree state, committed-secret scan, and Git-history scan therefore could not be produced. The filesystem snapshot, including the other auditors' contemporaneous uncommitted audit artifacts, was assessed directly.

Runtime versions were Node.js 24.16.0 and npm 11.13.0. `package.json:24-25` permits Node.js 22 or newer. All six runtime and four development dependencies use exact versions (`package.json:27-39`), and npm lockfile version 3 resolves 211 package records. Every record with a tarball URL used `https://registry.npmjs.org/` and carried an integrity value. No Git, HTTP, local-path, or alternate-registry dependency was present. `npm ls --all` resolved the declared top-level versions without an invalid/extraneous error.

## Confirmed security findings

No dependency vulnerability or secret exposure was confirmed in this review. This result is bounded by the advisory and tooling limitations below and is not a statement that the dependency tree is secure.

## Unresolved candidate: package contents are not constrained for release

**Candidate ID:** SC-C01  
**Severity:** Low in the current local/private deployment; potentially Medium if npm publication is enabled  
**Confidence:** High for package composition; impact depends on future artifact contents and publication decisions

`package.json:4` marks the project private, but it contains no `files` allowlist and the repository has no `.npmignore`. `npm pack --dry-run --json` emitted npm's `gitignore-fallback` warning. The final contemporaneous `npm publish --dry-run --json` selected 84 entries, 44 of them under the audit directory. The selected payload included all `src/` and `tests/` files plus the entire `security-audit-2026-09-13/` directory, including raw scanner output and isolated proof-of-concept artifacts. The current audit artifacts were deliberately sanitized, so this run did not demonstrate disclosure of a credential. A later release could nevertheless package diagnostic logs, course-derived fixtures, or other private workspace files that do not match `.gitignore`.

The root cause is artifact selection by fallback ignore behavior rather than an explicit release manifest. An accidental or intentional npm publication after removing the local-only restriction would upload every selected file. Source maps (`tsconfig.json:14`) and TypeScript source are also selected; that may be appropriate for an open-source release but should be an explicit choice.

Before any publication, add a minimal `files` allowlist such as `dist/`, `README.md`, `SECURITY.md`, and other intentionally shipped assets; explicitly exclude audit, test, coverage, and local diagnostic directories; then gate release on inspection of `npm pack --dry-run --json`. Retain `private: true` until a reviewed public release is ready. A regression check should parse the dry-run file list and fail if it includes `security-audit-*`, `tests/`, local sessions, logs, `.env` files, or other disallowed paths.

## Dependency advisory and install-script results

- `npm audit --json` and `npm audit --omit=dev --json` matched the currently resolved lockfile versions against npm advisories and reported zero known vulnerabilities across 211 total dependency records (113 production, 86 development, 59 optional, and 38 peer records; npm categories overlap). This means no npm advisory matched the assessed resolved versions at the time of the run. It does not establish reachability safety or cover unpublished vulnerabilities.
- Lockfile inspection found one package marked `hasInstallScript`: optional development dependency `fsevents@2.3.3` (`package-lock.json:1729-1734`), pulled through the test/build stack and not installed on this Windows host. The lockfile records no runtime package with `hasInstallScript`.
- A clean isolated `npm ci --ignore-scripts --no-audit --no-fund` completed with exit code 0 and installed 156 platform-applicable packages. The project's install step can therefore disable npm lifecycle scripts. Browser provisioning remains a separate explicit step: `npx playwright install chromium` (`README.md:13`). That command downloads and installs a browser binary outside npm's package-lock integrity coverage, so releases should pin the Playwright package, use the locally installed CLI, and treat the browser cache/source as a separate artifact trust boundary.
- `npm outdated --json` reported three direct packages behind the registry's current version: `@napi-rs/keyring` 2.0.0 versus 2.1.0, `zod` 4.6.2 versus 4.6.4, and development-only `@types/node` 22.20.2 versus 26.5.1. Staleness alone is not a vulnerability. Exact pins prevent silent upgrades; dependency updates require deliberate lockfile review and tests.
- The Windows Credential Manager integration depends on a native prebuilt `@napi-rs/keyring` platform package. The lockfile pins and integrity-protects its registry tarball, but compromise of that publisher or binary build pipeline would execute native code with the user's privileges when imported. This is a structural trust dependency, not evidence of current compromise.

## Secret and history assessment

A value-redacting local scanner checked 22 application, test, script, manifest, and documentation files for private-key blocks, OpenAI and GitHub token formats, AWS access keys, and literal credential assignments. It returned zero candidates and recorded only file, line, detector, and a truncated one-way fingerprint when a match would occur. `.gitignore:4-6` excludes `.env*`, logs, and names containing `session` with a `.json` suffix. The encrypted session is documented as residing outside the workspace under `%LOCALAPPDATA%`, reducing accidental repository inclusion.

`gitleaks` and `trufflehog` were unavailable. No `.git` directory or Git history was present, so committed and deleted-history secrets remain unassessed. The raw workspace scan did not inspect dependency source or generated `dist/` files independently because they derive from assessed source; it also cannot detect arbitrary credentials that do not match its bounded patterns.

## Build, CI/CD, container, and infrastructure assessment

`package.json:10-22` contains only TypeScript compilation, Vitest, npm audit, local MCP smoke/UI checks, and local login/session/server commands. No lifecycle hook (`preinstall`, `install`, `postinstall`, `prepare`, or `prepublishOnly`) appears in the root manifest. No application command invokes a shell, remote bootstrap script, package publisher, deployment client, or release upload.

No `.github/workflows`, GitLab CI, Azure Pipelines, CircleCI, Jenkins, Dockerfile, Compose file, Terraform, Wrangler, deployment manifest, `.npmrc`, or checked-in environment file was present. CI permission, pull-request injection, container hardening, infrastructure access controls, provenance generation, and release-token handling were therefore unassessed rather than clean. `SECURITY.md:38-45` calls for clean-checkout release, checksums, signing, and a formal OAuth review for remote transport, but no automated release workflow currently enforces those invariants.

## Supply-chain collector limitation

The installed `supply-chain-risk-auditor` skill requires its deterministic Python collector and renderer. Both `uv` and Python were unavailable on the host, so the collector could not measure registry maintainer ACL concentration, download counts, repository archival/staleness, or dependency repository activity. GitHub CLI authentication was available, but the skill expressly prohibits substituting ad hoc GitHub measurements for its collector. Those criteria remain unassessed. npm advisory, exact lockfile, install-script, registry-origin, and integrity coverage proceeded independently as described above.

## Raw evidence

- `raw/npm-audit-all.json` and `raw/npm-audit-production.json`: exact npm advisory output.
- `raw/npm-ls-all.json` and `raw/npm-ls-production.json`: resolved installed trees.
- `raw/lock-analysis.json`: registry origins, integrity coverage, pins, and install-script flags.
- `raw/npm-ci-ignore-scripts.txt` and `raw/npm-ci-ignore-scripts-exit.txt`: isolated install result.
- `raw/npm-outdated.json`: direct package current/wanted/latest values.
- `raw/npm-pack-dry-run.json` and `raw/npm-publish-dry-run.json`: release payload evidence. The npm warning preceding JSON in the pack artifact records fallback to `.gitignore`.
- `raw/secret-scan.json`: redacted current-files secret scan.
- `raw/repository-files.txt` and `raw/config-deployment-files.txt`: assessed file/config inventories.
- `raw/build-install-script-review.txt`: broad build/install keyword review; lockfile integrity lines make this artifact intentionally noisy.

## Recommended priorities

1. Add and test an explicit npm package allowlist before enabling publication.
2. Run installs with `npm ci --ignore-scripts`, then provision the pinned Playwright browser in a separately controlled step.
3. Establish a Git repository and protected CI/release workflow before public distribution; add secret/history scanning, lockfile review, signed provenance/checksums, least-privilege tokens, and dry-run package-content enforcement.
4. Re-run the deterministic supply-chain collector on a host with Python 3.11+ or `uv` to assess maintainer, repository, and registry-health signals that remained unavailable.
