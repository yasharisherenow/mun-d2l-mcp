import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ launch: vi.fn(), newContext: vi.fn() }));
vi.mock('playwright', () => ({ chromium: { launch: mocks.launch }, request: { newContext: mocks.newContext } }));
import { login, refreshSession, withSession } from '../src/auth/login.js';
import { SessionStore } from '../src/auth/store.js';
import { BASE_URL } from '../src/config.js';

function api() {
  return {
    get: vi.fn(async (url: string) => {
      const body = url.includes('/versions/') ? [{ ProductCode: 'lp', LatestVersion: '1.63', SupportedVersions: ['1.63'] }] : url.includes('/whoami') ? { Identifier: '1' } : [];
      const encoded = Buffer.from(JSON.stringify(body));
      return { status: () => 200, headers: () => ({ 'content-type': 'application/json', 'content-length': String(encoded.length) }), body: async () => encoded, dispose: vi.fn() };
    }), dispose: vi.fn(),
  };
}
function store() {
  return { load: vi.fn(), save: vi.fn(), clear: vi.fn() } as unknown as SessionStore;
}
function browser() {
  const page = { on: vi.fn(), goto: vi.fn(), url: vi.fn(() => `${BASE_URL}/d2l/home`), isClosed: vi.fn(() => false) };
  const context = { newPage: async () => page, request: api(), storageState: async () => ({ cookies: [{ domain: 'online.mun.ca', name: 'session', value: 'SECRET' }, { domain: 'login.mun.ca', name: 'idp', value: 'IDP_SECRET' }], origins: [] }) };
  const browser = { newContext: async () => context, isConnected: () => true, close: vi.fn() };
  mocks.launch.mockResolvedValue(browser);
  return { page, context, browser };
}
beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it('saves only after identity and courses validate, retaining only MUN and Brightspace cookies', async () => {
  const b = browser();
  const s = store();
  const pending = login(s);
  await vi.runAllTimersAsync();
  await pending;
  expect(s.save).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(vi.mocked(s.save).mock.calls[0])).toContain('SECRET');
  expect(JSON.stringify(vi.mocked(s.save).mock.calls[0])).toContain('IDP_SECRET');
  expect(b.context.request.get).toHaveBeenCalledTimes(3);
  expect(b.browser.close).toHaveBeenCalled();
});
it('silently renews an existing browser session and saves it after verification', async () => {
  const b = browser();
  const s = store();
  vi.mocked(s.load).mockResolvedValue({ origin: BASE_URL, savedAt: 'old', state: { cookies: [], origins: [] } });
  const pending = refreshSession(s);
  await vi.runAllTimersAsync();
  await pending;
  expect(s.save).toHaveBeenCalledTimes(1);
  expect(b.browser.close).toHaveBeenCalled();
});
it('cancellation preserves an existing saved session', async () => {
  const b = browser(); b.page.isClosed.mockReturnValue(true);
  const s = store();
  await expect(login(s)).rejects.toMatchObject({ code: 'LOGIN_CANCELLED' });
  expect(s.save).not.toHaveBeenCalled(); expect(s.clear).not.toHaveBeenCalled();
});
it('times out without deleting authentication', async () => {
  const b = browser(); b.page.url.mockReturnValue('https://login.mun.ca/');
  const s = store();
  const assertion = expect(login(s, 100)).rejects.toMatchObject({ code: 'LOGIN_TIMEOUT' });
  await vi.runAllTimersAsync(); await assertion;
  expect(s.clear).not.toHaveBeenCalled(); expect(s.save).not.toHaveBeenCalled();
});
it('restores a saved session without launching a browser', async () => {
  mocks.launch.mockClear();
  const s = store(); vi.mocked(s.load).mockResolvedValue({ origin: BASE_URL, savedAt: new Date().toISOString(), state: { cookies: [], origins: [] } });
  const context = api(); mocks.newContext.mockResolvedValue(context);
  expect(await withSession(s, async c => c.courses())).toEqual([]);
  expect(mocks.launch).not.toHaveBeenCalled(); expect(context.dispose).toHaveBeenCalled();
});
it('network failure preserves the stored session and disposes the request context', async () => {
  const s = store(); vi.mocked(s.load).mockResolvedValue({ origin: BASE_URL, savedAt: new Date().toISOString(), state: { cookies: [], origins: [] } });
  const context = api(); context.get.mockRejectedValue(new Error('SECRET')); mocks.newContext.mockResolvedValue(context);
  const assertion = expect(withSession(s, async c => c.courses())).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  await vi.runAllTimersAsync(); await assertion;
  expect(s.save).not.toHaveBeenCalled(); expect(s.clear).not.toHaveBeenCalled(); expect(context.dispose).toHaveBeenCalled();
});
