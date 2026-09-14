# Supply-chain, secrets, and CI/CD results

## Scope and conclusion

Revision `91d08f0f91198178cd7b9a8b25474f8d03170c8d` and the uncommitted audit-output directory were assessed. The project is an npm package with six production dependencies and four development dependencies. `package-lock.json` lockfile version 3 resolves 211 package entries beyond the root entry.

No confirmed vulnerable dependency, committed credential, unsafe lifecycle script reachable on Windows, CI workflow vulnerability, container issue, or infrastructure-as-code issue was identified in this portion of the assessed scope. This conclusion is bounded by the coverage and limitations below.

## Dependency evidence

- The Trail of Bits collector assessed all 10 direct dependencies for known advisories and checked 199 registry-verified transitive packages at locked versions. It found no known advisory affecting those resolved versions.
- Independent `npm audit --json` and `npm audit --omit=dev --json` runs both reported zero vulnerabilities at every severity. Both commands exited 0.
- `npm ls --all --json` exited 0 with no dependency-tree problems.
- All 211 non-root lock entries resolve from `https://registry.npmjs.org/` and carry integrity hashes. No Git, filesystem, or alternate HTTP dependency source was found.
- Direct dependency versions are exact pins. The manifest does not declare `packageManager`, so the npm release used to interpret/update the lockfile is not pinned.
- `npm outdated --json` found three available updates: `@napi-rs/keyring` 2.0.0 to 2.1.0, `zod` 4.6.2 to 4.6.5, and the development-only `@types/node` 22.20.2 to 26.5.1. These are maintenance observations, not advisory findings.
- The collector flagged single-human-publisher concentration for development-only `@types/html-to-text` and `@types/node`. This affects build-host compromise exposure rather than application runtime exposure. It also recorded an upstream OpenSSF Binary-Artifacts score of 6/10 for Playwright. Neither signal establishes a vulnerability in this project.
- The collector established publisher-concentration coverage for 4/10 direct packages. Six provenance-published packages were unassessable for individual publisher concentration. Four dependencies lacked OpenSSF Scorecard reports for several upstream repository criteria.

## Install and publication behavior

- The lockfile marks only `fsevents@2.3.3` as having an install script. It is an optional dependency restricted to Darwin and does not execute on this Windows deployment.
- `npm ci --ignore-scripts --dry-run` exited 0 in this audit. The prior audit artifact at the same revision records an executed isolated `npm ci --ignore-scripts` run with exit code 0. The project therefore supports dependency installation without lifecycle scripts for the assessed platform. Browser provisioning remains an explicit separate command (`npx playwright install chromium`).
- `npm pack --dry-run --json` exited 0 and listed only `README.md`, `SECURITY.md`, `package.json`, and compiled `dist/` output. Audit artifacts, tests, and local session files are excluded from the package payload.
- `private: true` prevents accidental npm publication. Publishing intentionally will require a deliberate manifest change and should add `packageManager`, repository metadata, provenance-enabled release automation, and a release review gate.
- Compiled source maps are included in the dry-run package. This is acceptable for an open-source package but publishes source-level implementation detail; exclude maps if a future distribution model treats TypeScript source as confidential.

## Secret and history inspection

- A value-suppressing scanner checked 76 tracked files in the current tree and every file in the one reachable commit for private-key markers, GitHub tokens, OpenAI keys, AWS access keys, and JWT-shaped values. It found zero matches. The output contains only rule names, locations, and truncated hashes if matches occur; it never records values.
- Tracked filenames and reachable history contain no `.env`, certificate, private-key, credential, cookie, or authentication-state file. The only filename hits for the broad words `secret` or `session` are the prior audit's scanner artifacts.
- `.gitignore` excludes `.env*`, `*session*.json`, logs, build output, package archives, Playwright reports, and test results. Authentication material is therefore protected against common accidental additions, subject to users not overriding Git's ignore controls.
- History coverage contains one commit. Deleted secrets from unreachable objects, reflogs, remote-only branches, forks, CI logs, package registries, and GitHub repository settings were not assessed.

## CI/CD, containers, and infrastructure

- No `.github/workflows` directory exists. The agentic-actions-auditor therefore analyzed zero workflows and zero AI-action instances; its specialized vectors are inapplicable.
- No container manifest, Docker Compose file, Terraform, Bicep, or other infrastructure definition was found. Container and infrastructure configuration are unassessed because no such deployment configuration exists in the checkout.
- The absence of CI eliminates workflow-trigger and token-permission attack surface in this checkout, but it also leaves tests, dependency auditing, secret scanning, and release integrity unenforced on pushes and pull requests. Before accepting outside contributions or publishing releases, add a least-privilege workflow pinned to immutable action commit SHAs, set top-level `permissions: contents: read`, avoid privileged PR triggers, and enable dependency update review.

## Tool and coverage limitations

- `uv` was unavailable on Windows and WSL. Because the supplied collector is Python 3.11+ standard-library-only, it was executed with WSL Python 3 instead of `uv run`; collection and rendering both exited 0.
- The collector reported GitHub as unauthenticated because it ran inside WSL while `gh` authentication exists only on Windows. Repository metadata was still returned, but unauthenticated GitHub rate limits constrained repeatability and may cause criteria to become unavailable on later runs.
- Secret scanning used deterministic patterns rather than entropy analysis or a dedicated `gitleaks`/`trufflehog` binary. Zero pattern matches do not establish that arbitrary credentials are absent.
- `npm audit` covers advisories known to the npm advisory service at scan time. It does not establish reachability or detect unknown vulnerabilities.

## Exact commands

Commands were run from `<REPOSITORY_ROOT>` unless an explicit path appears.

```text
git rev-parse HEAD
git status --short
rg --files -g 'package*.json' -g 'npm-shrinkwrap.json' -g '.github/workflows/*.yml' -g '.github/workflows/*.yaml' -g 'Dockerfile*' -g 'docker-compose*.yml' -g 'docker-compose*.yaml' -g '*.tf' -g '*.bicep' -g '*.toml' -g '*.lock' -g '.npmrc' -g '.nvmrc' -g '.node-version' -g '*.ps1' -g '*.sh'
gh auth status
node --version
npm --version
wsl.exe -d Ubuntu -u root -- bash -lc "cd '<USER_PROFILE>/.codex/skills/supply-chain-risk-auditor/scripts' && python3 collect.py '<REPOSITORY_ROOT>' --json '<REPOSITORY_ROOT>/security-audit-2026-09-14/raw/supply-chain-findings.json'"
wsl.exe -d Ubuntu -u root -- bash -lc "cd '<USER_PROFILE>/.codex/skills/supply-chain-risk-auditor/scripts' && python3 render.py '<REPOSITORY_ROOT>/security-audit-2026-09-14/raw/supply-chain-findings.json' --out '<REPOSITORY_ROOT>/security-audit-2026-09-14/raw/supply-chain-report.md'"
npm audit --json
npm audit --omit=dev --json
npm ls --all --json
npm outdated --json
npm ci --ignore-scripts --dry-run
npm pack --dry-run --json
node security-audit-2026-09-14/raw/scan-secrets.mjs
git ls-files
git log --all --name-only --pretty=format:
```

## Raw artifacts

- `raw/supply-chain-findings.json`: deterministic collector data.
- `raw/supply-chain-report.md`: rendered Trail of Bits supply-chain report.
- `raw/npm-audit-all.json` and `raw/npm-audit-production.json`: resolved advisory checks.
- `raw/npm-ls-all.json`: installed dependency-tree state.
- `raw/npm-outdated.json`: available-version observations.
- `raw/install-scripts.json`: lockfile lifecycle-script inventory.
- `raw/npm-ci-ignore-scripts-dry-run.txt`: no-lifecycle-script installation dry run.
- `raw/npm-pack-dry-run.json`: exact package payload.
- `raw/secret-scan.json` and `raw/scan-secrets.mjs`: value-suppressing current-tree and history scan.
