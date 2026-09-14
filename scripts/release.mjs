#!/usr/bin/env node

/**
 * Release script: bumps version in package.json and creates a git tag.
 * 
 * Usage:
 *   node scripts/release.mjs patch    # 0.1.0 → 0.1.1
 *   node scripts/release.mjs minor    # 0.1.1 → 0.2.0
 *   node scripts/release.mjs major    # 0.2.0 → 1.0.0
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = path.join(__dirname, '..', 'package.json');

// Parse command line argument
const versionType = process.argv[2];

if (!versionType || !['patch', 'minor', 'major'].includes(versionType)) {
  console.error('Usage: node scripts/release.mjs [patch|minor|major]');
  process.exit(1);
}

// Read current package.json
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const currentVersion = packageJson.version;

// Parse current version
const [major, minor, patch] = currentVersion.split('.').map(Number);

// Calculate new version
let newVersion;
if (versionType === 'major') {
  newVersion = `${major + 1}.0.0`;
} else if (versionType === 'minor') {
  newVersion = `${major}.${minor + 1}.0`;
} else if (versionType === 'patch') {
  newVersion = `${major}.${minor}.${patch + 1}`;
}

console.log(`Bumping version from ${currentVersion} to ${newVersion} (${versionType})`);

// Update package.json
packageJson.version = newVersion;
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

console.log(`✓ Updated package.json`);

// Stage package.json
try {
  execSync('git add package.json', { stdio: 'inherit' });
} catch (error) {
  console.error('Failed to stage package.json');
  process.exit(1);
}

// Create commit (if there are staged changes)
try {
  const status = execSync('git status --short', { encoding: 'utf-8' });
  if (status.includes('M  package.json')) {
    execSync(`git commit -m "chore: bump version to ${newVersion}"`, {
      stdio: 'inherit'
    });
    console.log(`✓ Created commit for version bump`);
  }
} catch (error) {
  console.error('Failed to create commit');
  process.exit(1);
}

// Create annotated tag
try {
  const tag = `v${newVersion}`;
  execSync(`git tag -a ${tag} -m "Release ${tag}"`, { stdio: 'inherit' });
  console.log(`✓ Created git tag: ${tag}`);
} catch (error) {
  console.error('Failed to create git tag');
  process.exit(1);
}

console.log('');
console.log('Release prepared! Next steps:');
console.log('  1. Review changes: git log -1');
console.log('  2. Push to remote:');
console.log(`     git push origin main`);
console.log(`     git push origin v${newVersion}`);
console.log('  3. Create GitHub Release from the tag');
console.log('');
console.log(`Version: ${newVersion}`);
