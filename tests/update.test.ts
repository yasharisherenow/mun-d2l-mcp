import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { update, runProcess } from '../scripts/update.mjs';

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) {
    if (resolve(dir).startsWith(resolve(tmpdir()) + '\\') || resolve(dir).startsWith(resolve(tmpdir()) + '/')) rmSync(dir, { recursive: true, force: true });
  }
});
function fixture() {
  const temp = mkdtempSync(join(tmpdir(), 'mun-update-test-')); temporary.push(temp);
  const root = join(temp, 'checkout'), remote = join(temp, 'remote.git'); mkdirSync(root);
  const git = (...args: string[]) => runProcess('git', args, root);
  runProcess('git', ['init', '--bare', remote], temp);
  git('init', '-b', 'main'); git('config', 'user.name', 'Synthetic Test'); git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(root, 'file.txt'), 'first'); git('add', '.'); git('commit', '-m', 'first');
  git('remote', 'add', 'origin', 'https://github.com/yasharisherenow/mun-d2l-mcp.git');
  git('push', remote, 'main'); git('fetch', remote, 'main:refs/remotes/origin/main'); git('branch', '--set-upstream-to=origin/main', 'main');
  const old = git('rev-parse', 'HEAD');
  const calls: string[][] = [], messages: string[] = [];
  const run = (command: string, args: string[], cwd: string, capture = true) => {
    calls.push([command, ...args]);
    if (command === 'git') {
      const actual = args[0] === 'fetch' ? args.map(arg => arg === 'origin' ? remote : arg) : args;
      return runProcess(command, actual, cwd, true);
    }
    return '';
  };
  const options = { root, platform: 'win32', nodeVersion: '22.0.0', run, log: (message: string) => messages.push(message), exists: existsSync };
  const advanceRemote = () => {
    writeFileSync(join(root, 'file.txt'), 'second'); git('add', '.'); git('commit', '-m', 'second'); git('push', remote, 'main');
    const next = git('rev-parse', 'HEAD');
    // Only the disposable synthetic checkout is reset, never the user's repository.
    git('reset', '--hard', old);
    return next;
  };
  return { ...options, options, git, root, calls, messages, old, advanceRemote, remote };
}

describe('safe explicit updater', () => {
  it('fast-forwards a temporary checkout, installs, builds and verifies in order', () => {
    const f = fixture(), next = f.advanceRemote();
    update(f.options);
    expect(f.git('rev-parse', 'HEAD')).toBe(next);
    expect(f.calls.filter(call => call[0] !== 'git').map(call => call.slice(2))).toEqual([
      ['ci'], ['exec', '--', 'playwright', 'install', 'chromium'], ['run', 'build'], ['run', 'smoke'],
    ]);
    expect(f.messages.join('\n')).toContain('Restart your MCP connection');
  });
  it('does nothing beyond fetching when already current', () => {
    const f = fixture(); update(f.options);
    expect(f.calls.every(call => call[0] === 'git')).toBe(true);
    expect(f.messages.join('')).toContain('Already current');
  });
  it.each(['tracked', 'untracked', 'branch', 'detached', 'remote', 'upstream', 'merge', 'rebase'])('refuses %s preflight state without fetching', state => {
    const f = fixture();
    if (state === 'tracked') writeFileSync(join(f.root, 'file.txt'), 'local');
    if (state === 'untracked') writeFileSync(join(f.root, 'new.txt'), 'local');
    if (state === 'branch') f.git('checkout', '-b', 'feature');
    if (state === 'detached') f.git('checkout', '--detach');
    if (state === 'remote') f.git('remote', 'set-url', 'origin', 'https://github.com/other/repo.git');
    if (state === 'upstream') f.git('branch', '--unset-upstream');
    if (state === 'merge') writeFileSync(join(f.root, '.git', 'MERGE_HEAD'), f.old);
    if (state === 'rebase') mkdirSync(join(f.root, '.git', 'rebase-merge'));
    expect(() => update(f.options)).toThrow('preflight');
    expect(f.calls.some(call => call[1] === 'fetch')).toBe(false);
    expect(f.git('rev-parse', 'HEAD')).toBe(f.old);
  });
  it.each(['ahead', 'divergent'])('refuses %s history without changing local HEAD', state => {
    const f = fixture(); if (state === 'divergent') f.advanceRemote();
    writeFileSync(join(f.root, 'local.txt'), 'local'); f.git('add', '.'); f.git('commit', '-m', 'local');
    const head = f.git('rev-parse', 'HEAD');
    expect(() => update(f.options)).toThrow('ancestry check');
    expect(f.git('rev-parse', 'HEAD')).toBe(head);
    expect(f.calls.some(call => call[0] !== 'git')).toBe(false);
  });
  it.each(['fetch', 'dependencies', 'Chromium', 'build', 'smoke'])('stops at %s failure and reports recovery', failure => {
    const f = fixture(), next = f.advanceRemote();
    let npmStep = 0;
    const run = (command: string, args: string[], cwd: string, capture = true) => {
      const step = command === 'git' ? args[0] : ['dependencies', 'Chromium', 'build', 'smoke'][npmStep++];
      if (step === failure) throw new Error('synthetic failure');
      return f.run(command, args, cwd, capture);
    };
    expect(() => update({ ...f.options, run })).toThrow(`stopped at ${failure}`);
    expect(f.git('rev-parse', 'HEAD')).toBe(failure === 'fetch' ? f.old : next);
    expect(npmStep).toBe(failure === 'fetch' ? 0 : ['dependencies', 'Chromium', 'build', 'smoke'].indexOf(failure) + 1);
  });
  it('rejects unsupported runtimes before invoking Git', () => {
    const run = () => { throw new Error('must not run'); };
    expect(() => update({ platform: 'linux', run })).toThrow('native Windows');
    expect(() => update({ platform: 'win32', nodeVersion: '20.0.0', run })).toThrow('Node.js 22');
  });
});
