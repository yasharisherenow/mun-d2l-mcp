import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionStore, type KeyStore, type Session } from '../src/auth/store.js';
import { BASE_URL } from '../src/config.js';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'mun-d2l-test-'));
  directories.push(directory);
  let secret: string | undefined;
  const keys: KeyStore = { getPassword: () => secret, setPassword: value => { secret = value; }, deletePassword: () => { secret = undefined; } };
  return { store: new SessionStore(directory, keys), keys };
}
const session: Session = { origin: BASE_URL, savedAt: new Date().toISOString(), bearer: 'SENSITIVE_TOKEN', state: { cookies: [], origins: [] } };
it('encrypts on disk and survives a fresh store instance', async () => {
  const { store, keys } = await fixture();
  await store.save(session);
  expect(await readFile(store.file, 'utf8')).not.toContain('SENSITIVE_TOKEN');
  expect(await new SessionStore(store.directory, keys).load()).toEqual(session);
  const updated = new Date(Date.now() + 1000).toISOString();
  await store.save({ ...session, savedAt: updated });
  expect((await store.load())?.savedAt).toBe(updated);
});
it('does not persist browser storage or cookies from unapproved domains', async () => {
  const { store } = await fixture();
  const cookie = { name: 'session', value: 'value', domain: 'evil.example', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' as const };
  await store.save({ ...session, state: { cookies: [cookie], origins: [{ origin: 'https://evil.example', localStorage: [{ name: 'token', value: 'SECRET' }] }] } });
  const loaded = await store.load();
  expect(loaded?.state).toEqual({ cookies: [], origins: [] });
  expect(await readFile(store.file, 'utf8')).not.toContain('SECRET');
});
it('rejects tampering without deleting saved state', async () => {
  const { store } = await fixture();
  await store.save(session);
  const content = JSON.parse(await readFile(store.file, 'utf8'));
  content.tag = Buffer.alloc(16).toString('base64');
  await writeFile(store.file, JSON.stringify(content));
  await expect(store.load()).rejects.toMatchObject({ code: 'SESSION_UNREADABLE' });
  expect(await readFile(store.file, 'utf8')).toContain(content.tag);
});
it('logout removes the session and key', async () => {
  const { store, keys } = await fixture();
  await store.save(session);
  await store.clear();
  expect(await store.load()).toBeNull();
  expect(keys.getPassword()).toBeUndefined();
  await store.clear();
});
it('never falls back to plaintext when the keyring fails', async () => {
  const { store, keys } = await fixture();
  keys.getPassword = () => { throw new Error('locked'); };
  await expect(store.save(session)).rejects.toMatchObject({ code: 'KEYRING_UNAVAILABLE' });
  await expect(readFile(store.file)).rejects.toMatchObject({ code: 'ENOENT' });
});
it('serializes session lifecycle operations across store instances', async () => {
  const { store, keys } = await fixture();
  const second = new SessionStore(store.directory, keys);
  let release!: () => void;
  const held = store.withLifecycleLock(() => new Promise<void>(resolve => { release = resolve; }));
  while (!release) await new Promise(resolve => setTimeout(resolve, 1));
  await expect(second.withLifecycleLock(async () => undefined, 0)).rejects.toMatchObject({ code: 'SESSION_BUSY' });
  release();
  await held;
  await expect(second.withLifecycleLock(async () => 'ok', 0)).resolves.toBe('ok');
});

describe('path traversal protection', () => {
  it('ensures session files stay within the specified directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mun-d2l-test-'));
    directories.push(directory);
    const keys: KeyStore = { getPassword: () => undefined, setPassword: () => {}, deletePassword: () => {} };
    
    // Valid directory should create files within it
    const store = new SessionStore(directory, keys);
    
    // Verify files are within the directory using path resolution
    const resolvedDir = path.resolve(directory);
    const resolvedFile = path.resolve(store.file);
    const resolvedLock = path.resolve(store.lockFile);
    
    expect(resolvedFile.startsWith(resolvedDir + path.sep)).toBe(true);
    expect(resolvedLock.startsWith(resolvedDir + path.sep)).toBe(true);
  });

  it('prevents file paths from escaping the base directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mun-d2l-test-'));
    directories.push(directory);
    const keys: KeyStore = { getPassword: () => undefined, setPassword: () => {}, deletePassword: () => {} };
    
    const store = new SessionStore(directory, keys);
    
    // Verify the resolved paths don't escape the base directory
    const normalizedBase = path.resolve(directory);
    const normalizedFile = path.resolve(store.file);
    const normalizedLock = path.resolve(store.lockFile);
    
    // Both files should be within the base directory
    expect(normalizedFile.startsWith(normalizedBase)).toBe(true);
    expect(normalizedLock.startsWith(normalizedBase)).toBe(true);
    
    // Relative paths should not start with '..'
    expect(path.relative(normalizedBase, normalizedFile).startsWith('..')).toBe(false);
    expect(path.relative(normalizedBase, normalizedLock).startsWith('..')).toBe(false);
  });

  it('validates that hardcoded filenames cannot be manipulated to escape', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mun-d2l-test-'));
    directories.push(directory);
    const keys: KeyStore = { getPassword: () => undefined, setPassword: () => {}, deletePassword: () => {} };
    
    // The implementation uses hardcoded filenames 'session.encrypted.json' and 'session.lock'
    // This test verifies they are properly constrained within the directory
    const store = new SessionStore(directory, keys);
    
    // Extract just the filename from the full path
    const fileName = path.basename(store.file);
    const lockName = path.basename(store.lockFile);
    
    // Verify the filenames are exactly what we expect (no path traversal injected)
    expect(fileName).toBe('session.encrypted.json');
    expect(lockName).toBe('session.lock');
    
    // Verify the parent directory is the one we specified
    expect(path.dirname(store.file)).toBe(path.resolve(directory));
    expect(path.dirname(store.lockFile)).toBe(path.resolve(directory));
  });
});
