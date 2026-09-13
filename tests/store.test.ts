import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
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
