import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ launch: vi.fn(), newContext: vi.fn() }));
vi.mock('playwright', () => ({ chromium: { launch: mocks.launch }, request: { newContext: mocks.newContext } }));
import { login, refreshSession, withSession } from '../src/auth/login.js';
import { SessionStore } from '../src/auth/store.js';
import { BASE_URL } from '../src/config.js';
import { AppError } from '../src/errors.js';

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
  return { load: vi.fn(), save: vi.fn(), clear: vi.fn(), withLifecycleLock: vi.fn((action: () => Promise<unknown>) => action()) } as unknown as SessionStore;
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

const saved = () => ({ origin: BASE_URL, savedAt: new Date().toISOString(), state: { cookies: [], origins: [] } });
it('bounds a stalled session load without starting later work', async () => {
  const s = store();
  let finish!: (value: ReturnType<typeof saved>) => void;
  vi.mocked(s.load).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const action = vi.fn();
  const assertion = expect(withSession(s, action)).rejects.toMatchObject({ code: 'AUTH_TIMEOUT' });
  await vi.advanceTimersByTimeAsync(40_000);
  await assertion;
  finish(saved());
  await vi.advanceTimersByTimeAsync(1);
  expect(action).not.toHaveBeenCalled();
  expect(s.save).not.toHaveBeenCalled();
});

it('disposes a request context when identity verification stalls', async () => {
  const s = store(); vi.mocked(s.load).mockResolvedValue(saved());
  const context = api(); context.get.mockImplementation(() => new Promise(() => {})); mocks.newContext.mockResolvedValue(context);
  const assertion = expect(withSession(s, vi.fn())).rejects.toMatchObject({ code: 'AUTH_TIMEOUT' });
  await vi.advanceTimersByTimeAsync(40_000); await assertion;
  expect(context.dispose).toHaveBeenCalled();
  expect(s.save).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('closes a stalled renewal browser and prevents a late navigation from saving', async () => {
  const b = browser(), s = store();
  vi.mocked(s.load).mockResolvedValue({ ...saved(), savedAt: 'old' });
  let finish!: () => void;
  b.page.goto.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const assertion = expect(withSession(s, vi.fn())).rejects.toMatchObject({ code: 'AUTH_TIMEOUT' });
  await vi.advanceTimersByTimeAsync(40_000); await assertion;
  expect(b.browser.close).toHaveBeenCalled();
  finish(); await vi.advanceTimersByTimeAsync(1);
  expect(s.save).not.toHaveBeenCalled(); expect(s.clear).not.toHaveBeenCalled();
});

it('preserves SESSION_BUSY from the five-second renewal lock wait', async () => {
  const s = store(); vi.mocked(s.load).mockResolvedValue({ ...saved(), savedAt: 'old' });
  vi.mocked(s.withLifecycleLock).mockImplementation(async (_action, timeout) => {
    expect(timeout).toBe(5_000);
    await new Promise(resolve => setTimeout(resolve, timeout));
    throw new AppError('SESSION_BUSY', 'Busy');
  });
  const assertion = expect(withSession(s, vi.fn())).rejects.toMatchObject({ code: 'SESSION_BUSY' });
  await vi.advanceTimersByTimeAsync(5_000); await assertion;
  expect(s.save).not.toHaveBeenCalled();
});

it('reuses a session renewed by another process while waiting for the lock', async () => {
  mocks.launch.mockClear();
  const s = store();
  vi.mocked(s.load).mockResolvedValueOnce({ ...saved(), savedAt: 'old' }).mockResolvedValue(saved());
  mocks.newContext.mockResolvedValue(api());
  await expect(withSession(s, async () => 'ok')).resolves.toBe('ok');
  expect(mocks.launch).not.toHaveBeenCalled(); expect(s.save).not.toHaveBeenCalled();
});

it('does not start another renewal after a renewed session is rejected', async () => {
  browser(); const s = store(); vi.mocked(s.load).mockResolvedValue({ ...saved(), savedAt: 'old' });
  const context = api(); context.get.mockResolvedValue({ status: () => 401, headers: () => ({ 'content-length': '2' }), body: async () => Buffer.from('{}'), dispose: vi.fn() });
  mocks.newContext.mockResolvedValue(context);
  await expect(withSession(s, vi.fn())).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  expect(s.withLifecycleLock).toHaveBeenCalledTimes(1);
});

it('shares renewal by store path without a timed-out caller cancelling another waiter', async () => {
  const b = browser(), s = store(), other = store();
  Object.assign(s, { file: 'C:/fixture/session.encrypted.json' });
  Object.assign(other, { file: 'C:/fixture/session.encrypted.json' });
  const old = { ...saved(), savedAt: 'old' };
  vi.mocked(s.load).mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(old), 10_000))).mockResolvedValue(old);
  vi.mocked(other.load).mockResolvedValue(old);
  let navigate!: () => void;
  b.page.goto.mockImplementation(() => new Promise<void>(resolve => { navigate = resolve; }));
  mocks.newContext.mockResolvedValue(api());
  const first = expect(withSession(s, vi.fn())).rejects.toMatchObject({ code: 'AUTH_TIMEOUT' });
  await vi.advanceTimersByTimeAsync(20_000);
  const second = withSession(other, async () => 'ok');
  await vi.advanceTimersByTimeAsync(20_000); await first;
  expect(b.browser.close).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(5_000); navigate();
  await expect(second).resolves.toBe('ok');
  expect(s.save).toHaveBeenCalledTimes(1); expect(other.withLifecycleLock).not.toHaveBeenCalled();
});

it('stops retry backoff when the authentication budget expires', async () => {
  const s = store(); vi.mocked(s.load).mockResolvedValue(saved());
  const context = api();
  context.get.mockImplementation(async () => {
    await new Promise(resolve => setTimeout(resolve, 19_000));
    throw new Error('PRIVATE');
  });
  mocks.newContext.mockResolvedValue(context);
  const assertion = expect(withSession(s, vi.fn())).rejects.toMatchObject({ code: 'AUTH_TIMEOUT' });
  await vi.advanceTimersByTimeAsync(40_000); await assertion;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(context.get).toHaveBeenCalledTimes(3);
  expect(context.dispose).toHaveBeenCalled(); expect(s.save).not.toHaveBeenCalled();
});

it('gives explicit CLI renewal 120 seconds without changing interactive login', async () => {
  const b = browser(), s = store(); vi.mocked(s.load).mockResolvedValue(saved());
  b.page.goto.mockImplementation(() => new Promise(() => {}));
  const assertion = expect(refreshSession(s)).rejects.toMatchObject({ code: 'AUTH_TIMEOUT' });
  await vi.advanceTimersByTimeAsync(119_000);
  expect(b.browser.close).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1_000); await assertion;
  expect(b.browser.close).toHaveBeenCalled(); expect(s.save).not.toHaveBeenCalled();
});
