# Release Process

This guide documents the formal process for releasing new versions of mun-d2l-mcp.

## Pre-release checklist

### 1. Code quality

Before creating a release tag, verify:

```powershell
npm ci              # Clean install
npm run build       # TypeScript compilation
npm test            # Unit tests pass
npm run security:audit  # No high/critical vulnerabilities
```

### 2. Dependency audit

- Review `package-lock.json` for new or updated dependencies
- Run `npm audit` and resolve any vulnerabilities
- Confirm Dependabot auto-merge tests pass (if enabled)
- Document any breaking dependency changes in release notes

### 3. Repository scan

Verify no credentials are present:

```powershell
git log --all --grep="secret\|password\|token\|key" --oneline
git log -S "SECRET\|PASSWORD" --oneline
git log -S "APIKEY\|API_KEY" --oneline
```

Check for leaked session files or logs:

```powershell
git ls-files | findstr /E "\.log session encrypted" 
```

Ensure `.gitignore` covers:
- `node_modules/`
- `dist/` (or verify it's not tracked)
- `*.log`
- `*session*.json`
- `.env*`

### 4. Documentation review

- [ ] README is current (no outdated instructions)
- [ ] SECURITY.md is accurate
- [ ] TROUBLESHOOTING.md covers known issues
- [ ] ERROR_CODES.md includes recent errors
- [ ] CHANGELOG or release notes document changes
- [ ] All links point to correct versions

### 5. GitHub Actions verification

All CI/CD workflows must pass:

- [ ] **Build** workflow passes (npm run build succeeds)
- [ ] **Test** workflow passes (npm test + npm run security:audit succeed)
- [ ] **Smoke Test** workflow passes (MCP handshake validated)
- [ ] No pending branch protection violations

### 6. Security review

For any changes involving authentication, session handling, or external requests:

- [ ] Review changes in SECURITY.md threat model
- [ ] Verify no new cross-site request forgery (CSRF) risks
- [ ] Confirm credential redaction in errors/logs
- [ ] Validate origin guard is still enforced

## Release workflow

### Step 1: Prepare release branch (optional)

For major releases, create a release branch:

```powershell
git checkout -b release/v0.2.0
```

For patch/minor releases, work on main or a feature branch.

### Step 2: Bump version

Use the release script to bump and tag:

```powershell
npm run release:version -- patch   # 0.1.0 → 0.1.1
npm run release:version -- minor   # 0.1.1 → 0.2.0
npm run release:version -- major   # 0.2.0 → 1.0.0
```

This:
- Updates `package.json` version
- Creates an annotated git tag (e.g., `v0.2.0`)
- Outputs the new version for CI/CD use

### Step 3: Push tag to GitHub

```powershell
git push origin main
git push origin v0.2.0
```

### Step 4: Create GitHub Release

On GitHub:

1. Go to **Releases** → **Draft a new release**
2. Select the tag you just pushed
3. Title: "Release v0.2.0" or descriptive title
4. Body:
   - Summary of major changes
   - Breaking changes (if any)
   - Dependencies updated (if significant)
   - Contributors
5. Mark as **latest** if this is the current stable release
6. Publish

### Step 5: Generate release artifacts (if applicable)

If publishing to npm:

```powershell
npm run build       # Ensure dist/ is fresh
npm pack            # Create tarball
```

Verify tarball contents:

```powershell
npm pack --dry-run
```

### Step 6: Sign and publish

For security-sensitive releases:

```powershell
# Sign the tarball (if GPG is configured)
gpg --armor --detach-sign mun-d2l-mcp-0.2.0.tgz

# Create checksums
certutil -hashfile mun-d2l-mcp-0.2.0.tgz SHA256 > mun-d2l-mcp-0.2.0.sha256

# Publish via npm (if the package is public)
npm publish
```

## Post-release

### 1. Announce

- Update team/user channels about new release
- Include summary of key fixes and features
- Link to GitHub Release

### 2. Document breaking changes

If the release includes breaking changes:

- Add to a CHANGELOG.md or BREAKING_CHANGES.md
- Update README with migration steps
- Post in security advisory if credentials/security affected

### 3. Monitor for issues

In the first 24-48 hours after release:

- Monitor GitHub Issues for reports
- Check Dependabot for automated dependency problems
- Watch CI/CD runs on dependent projects (if any)

### 4. Backport critical fixes

If a critical security or stability fix is needed but you've already released a new major version, consider:

```powershell
git checkout v0.1.0                 # Check out the old tag
git checkout -b backport/0.1.x      # Create backport branch
# Apply the fix
git commit -m "fix: critical issue"
npm run release:version -- patch    # Bumps to v0.1.1
git push origin v0.1.1
# Create a GitHub Release for v0.1.1
```

## Security advisory process

### Private vulnerability disclosure

If you discover a security vulnerability:

1. **Do not** open a public issue or pull request
2. Use GitHub's **Security Advisory** feature:
   - Go to **Security** → **Advisories** → **New draft advisory**
   - Fill in vulnerability details (without revealing exploit)
   - Add affected versions
3. Request a CVE from GitHub (automatic)
4. Set embargo period (typically 90 days)
5. Invite maintainers/trusted reviewers
6. Coordinate a fix in a private branch
7. Create release with fix
8. Publish advisory when fix is released

### Public advisory (after fix is published)

After releasing a security fix:

1. Publish the GitHub Security Advisory
2. Update SECURITY.md with:
   - Vulnerability description
   - Versions affected
   - Mitigation (upgrade to fixed version)
   - CVE identifier
3. Announce in user channels
4. Consider a security release blog post or notice

### Reporting a vulnerability to the team

Contributors who find vulnerabilities should:

1. Email: Include vulnerability details (but not exploit code)
2. Provide: Affected versions, reproduction steps, potential impact
3. Allow: 90 days for a fix before public disclosure
4. Reference: SECURITY.md for full reporting guidance

## Checklist: Ready to release?

Before tagging a release, confirm:

- [ ] All pre-release checks passed
- [ ] No credentials in git history
- [ ] GitHub Actions workflows pass
- [ ] Documentation is current
- [ ] Version is bumped correctly
- [ ] Tag created and pushed
- [ ] GitHub Release drafted
- [ ] Team/users notified

## Rollback procedure (if release is broken)

If a released version is critically broken:

```powershell
# Mark the release as not-latest on GitHub
# Go to Release → click release → Edit → uncheck "latest"

# Optionally deprecate on npm
npm deprecate mun-d2l-mcp@0.2.0 "Use v0.2.1 instead"

# Create a patch release fixing the issue
npm run release:version -- patch
git push origin main && git push origin v0.2.1
```

Users will still see the broken version by default; communicate clearly that they should upgrade to the patch release.

## Release frequency

- **Security fixes**: As soon as verified and tested (can be within hours)
- **Bug fixes**: Weekly or as-needed batches
- **Features**: Monthly or when feature-complete and tested
- **Major versions**: Only when breaking changes are necessary and well-documented
