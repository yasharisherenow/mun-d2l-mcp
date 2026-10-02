import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const expectedRemote = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)yasharisherenow\/mun-d2l-mcp(?:\.git)?\/?$/i;

export function runProcess(command, args, cwd, capture = true) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error('Command failed.');
  return result.stdout?.trim() ?? '';
}

export function update({ root = repositoryRoot, platform = process.platform, nodeVersion = process.versions.node,
  run = runProcess, exists = existsSync, log = console.log } = {}) {
  let step = 'preflight', oldHead = 'unknown', newHead = 'unknown';
  const git = (...args) => run('git', args, root);
  const npmCli = process.env.npm_execpath;
  const npm = (...args) => {
    if (!npmCli || !exists(npmCli)) throw new Error('Run this command through npm run update.');
    return run(process.execPath, [npmCli, ...args], root, false);
  };
  try {
    if (platform !== 'win32' || Number(nodeVersion.split('.')[0]) < 22) throw new Error('Requires native Windows and Node.js 22 or newer.');
    if (!npmCli || !exists(npmCli)) throw new Error('Run this command through npm run update.');
    git('--version');
    if (resolve(git('rev-parse', '--show-toplevel')).toLowerCase() !== resolve(root).toLowerCase()) throw new Error('Run from this repository checkout.');
    for (const state of ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer']) {
      if (exists(resolve(root, git('rev-parse', '--git-path', state)))) throw new Error('Complete the active Git operation first.');
    }
    if (git('symbolic-ref', '--quiet', '--short', 'HEAD') !== 'main') throw new Error('Switch to branch main first.');
    if (git('status', '--porcelain', '--untracked-files=all')) throw new Error('Commit or move local changes and untracked files before updating.');
    if (git('rev-parse', '--abbrev-ref', '@{upstream}') !== 'origin/main') throw new Error('main must track origin/main.');
    const remotes = git('remote', 'get-url', '--all', 'origin').split(/\r?\n/);
    if (remotes.length !== 1 || !expectedRemote.test(remotes[0])) throw new Error('origin must point to yasharisherenow/mun-d2l-mcp on GitHub.');
    oldHead = git('rev-parse', 'HEAD');
    step = 'fetch';
    run('git', ['fetch', '--no-tags', 'origin', 'refs/heads/main'], root, false);
    newHead = git('rev-parse', 'FETCH_HEAD');
    step = 'ancestry check';
    // merge-base rejects local-ahead and divergent history without changing the checkout.
    git('merge-base', '--is-ancestor', oldHead, newHead);
    if (oldHead === newHead) { log(`Already current: ${oldHead}. No reinstall or rebuild needed.`); return; }
    step = 'fast-forward';
    run('git', ['merge', '--ff-only', newHead], root, false);
    step = 'dependencies'; npm('ci');
    step = 'Chromium'; npm('exec', '--', 'playwright', 'install', 'chromium');
    step = 'build'; npm('run', 'build');
    step = 'smoke'; npm('run', 'smoke');
    log(`Updated ${oldHead} -> ${newHead}. Restart your MCP connection to load the new build.`);
  } catch (error) {
    const recovery = {
      dependencies: 'npm ci; npx playwright install chromium; npm run build; npm run smoke',
      Chromium: 'npx playwright install chromium; npm run build; npm run smoke',
      build: 'npm run build; npm run smoke', smoke: 'npm run smoke',
    }[step];
    const detail = step === 'preflight' ? error.message : step === 'ancestry check' ? 'Local history is ahead of or diverges from GitHub; reconcile it manually.' : 'The command failed; inspect the preceding output or check Git/network access.';
    const lockedModule = step === 'dependencies' ? ' If Windows reports EPERM for the keyring module, disconnect MCP clients using this checkout before retrying.' : '';
    throw new Error(`Update stopped at ${step}. Old: ${oldHead}; fetched: ${newHead}. ${detail}${lockedModule}${recovery ? ` Source was updated; no rollback was attempted. Fix the failure, then run in PowerShell: ${recovery}. Restart the MCP connection after recovery.` : ''}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { update(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
