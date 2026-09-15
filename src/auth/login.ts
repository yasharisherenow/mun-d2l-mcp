import { chromium, request } from 'playwright';
import { resolve } from 'node:path';
import { BASE_URL, sessionHours } from '../config.js';
import { AppError } from '../errors.js';
import { BrightspaceClient, playwrightTransport } from '../api/client.js';
import { SessionStore, type Session } from './store.js';
import { AuthDeadline, AUTH_BUDGET_MS, RENEW_BUDGET_MS, SESSION_LOCK_WAIT_MS } from './deadline.js';

const AUTH_ERRORS = ['AUTH_REQUIRED', 'PERMISSION_DENIED'];
const allowedCookie = (domain: string) => ['online.mun.ca', 'login.mun.ca'].includes(domain.replace(/^\./, '').toLowerCase());
const isAuthError = (error: unknown) => error instanceof AppError && AUTH_ERRORS.includes(error.code);
const closeQuietly = async (close: () => Promise<unknown>) => { try { await close(); } catch { /* Preserve the original error. */ } };

async function loadSession(store: SessionStore, deadline: AuthDeadline) {
  const session = await deadline.run(() => store.load());
  if (!session) throw new AppError('AUTH_REQUIRED', 'No saved session. Run npm run login in the project folder.');
  return session;
}

async function verifiedClient(session: Session, deadline: AuthDeadline) {
  const context = await deadline.run(() => request.newContext({ storageState: session.state }), c => c.dispose());
  const detach = deadline.onCancel(() => { void closeQuietly(() => context.dispose()); });
  try {
    let bearer: string | undefined;
    let client = new BrightspaceClient(playwrightTransport(context, deadline), bearer, deadline.sleep);
    try { await deadline.run(() => client.identity()); }
    catch (error) {
      if (!session.bearer || !isAuthError(error)) throw error;
      bearer = session.bearer;
      client = new BrightspaceClient(playwrightTransport(context, deadline), bearer, deadline.sleep);
      await deadline.run(() => client.identity());
    }
    deadline.check();
    // Course work uses the usual transport limits, not the authentication budget.
    return { client: new BrightspaceClient(playwrightTransport(context), bearer), context };
  } catch (error) {
    await closeQuietly(() => context.dispose());
    throw error;
  } finally { detach(); }
}

/** Hidden SSO only: never enters credentials or opens interactive login. */
async function refreshSessionUnlocked(store: SessionStore, deadline: AuthDeadline, previous: Session): Promise<void> {
  const existing = await loadSession(store, deadline);
  if (existing.savedAt !== previous.savedAt) {
    try {
      const connection = await verifiedClient(existing, deadline);
      await closeQuietly(() => connection.context.dispose());
      return;
    } catch (error) { if (!isAuthError(error)) throw error; }
  }
  const browser = await deadline.run(() => chromium.launch({ headless: true, timeout: deadline.remaining() }), b => b.close());
  const detach = deadline.onCancel(() => { void closeQuietly(() => browser.close()); });
  try {
    const context = await deadline.run(() => browser.newContext({ storageState: existing.state }));
    const page = await deadline.run(() => context.newPage());
    let bearer: string | undefined;
    page.on('request', request => {
      const url = new URL(request.url());
      const authorization = request.headers().authorization;
      if (url.origin === BASE_URL && url.pathname.startsWith('/d2l/') && authorization?.startsWith('Bearer ')) bearer = authorization.slice(7);
    });
    await deadline.run(() => page.goto(`${BASE_URL}/d2l/home`, { waitUntil: 'domcontentloaded', timeout: deadline.remaining() }));
    if (new URL(page.url()).origin === BASE_URL && /\/d2l\/loginh?\/?$/i.test(new URL(page.url()).pathname)) {
      const munLogin = page.getByRole('link', { name: /MUN Login/i }).first();
      if (await deadline.run(() => munLogin.isVisible())) await deadline.run(() => munLogin.click({ timeout: deadline.remaining(10_000) }));
    }
    while (true) {
      deadline.check();
      const current = new URL(page.url());
      if (current.origin === BASE_URL && /^\/d2l\/home(?:\/\d+)?\/?$/.test(current.pathname)) {
        const client = new BrightspaceClient(playwrightTransport(context.request, deadline), bearer, deadline.sleep);
        try {
          await deadline.run(() => client.identity());
          await deadline.run(() => client.courses());
          const raw = await deadline.run(() => context.storageState());
          deadline.check();
          // Retain the lifecycle lock until the fenced atomic save finishes.
          await store.save({ origin: BASE_URL, savedAt: new Date().toISOString(), bearer,
            state: { cookies: raw.cookies.filter(cookie => allowedCookie(cookie.domain)), origins: [] },
          }, deadline.check);
          return;
        } catch (error) { if (!isAuthError(error)) throw error; }
      }
      if (current.hostname === 'login.mun.ca' && await deadline.run(() => page.locator('input[type="password"]').isVisible())) {
        throw new AppError('AUTH_REQUIRED', 'MUN requires a fresh interactive sign-in or MFA. Run npm run login in the project folder.');
      }
      await deadline.sleep(1000);
    }
  } finally { detach(); await closeQuietly(() => browser.close()); }
}

export async function refreshSession(store: SessionStore): Promise<void> {
  const deadline = new AuthDeadline(RENEW_BUDGET_MS);
  try {
    const previous = await loadSession(store, deadline);
    await store.withLifecycleLock(() => refreshSessionUnlocked(store, deadline, previous), deadline.remaining(), deadline.check);
  } finally { deadline.dispose(); }
}

interface Renewal { deadline: AuthDeadline; promise: Promise<void>; waiters: number }
const renewals = new Map<string | SessionStore, Renewal>();
async function refreshOnce(store: SessionStore, caller: AuthDeadline, previous: Session) {
  const key = store.file ? resolve(store.file).toLowerCase() : store;
  let renewal = renewals.get(key);
  if (!renewal) {
    const deadline = new AuthDeadline(AUTH_BUDGET_MS);
    renewal = { deadline, waiters: 0, promise: Promise.resolve() };
    const entry = renewal;
    entry.promise = store.withLifecycleLock(() => refreshSessionUnlocked(store, deadline, previous), SESSION_LOCK_WAIT_MS, deadline.check)
      .finally(() => { deadline.dispose(); if (renewals.get(key) === entry) renewals.delete(key); });
    renewals.set(key, entry);
  }
  const entry = renewal;
  entry.waiters++;
  try { await caller.run(() => entry.promise); }
  finally {
    entry.waiters--;
    // A timed-out waiter cannot cancel renewal that another caller still owns.
    if (entry.waiters === 0) {
      entry.deadline.cancel();
      if (renewals.get(key) === entry) renewals.delete(key);
    }
  }
}

export async function withSession<T>(store: SessionStore, action: (client: BrightspaceClient) => Promise<T>): Promise<T> {
  const deadline = new AuthDeadline(AUTH_BUDGET_MS);
  let connection: Awaited<ReturnType<typeof verifiedClient>> | undefined;
  try {
    let session = await loadSession(store, deadline);
    let renewed = false;
    const interval = sessionHours();
    const savedAt = Date.parse(session.savedAt);
    if (interval > 0 && (!Number.isFinite(savedAt) || Date.now() - savedAt >= interval * 3_600_000)) {
      await refreshOnce(store, deadline, session);
      renewed = true;
      session = await loadSession(store, deadline);
    }
    try { connection = await verifiedClient(session, deadline); }
    catch (error) {
      if (renewed || !isAuthError(error)) throw error;
      await refreshOnce(store, deadline, session);
      session = await loadSession(store, deadline);
      connection = await verifiedClient(session, deadline);
    }
    deadline.check();
  } catch (error) {
    if (connection) await closeQuietly(() => connection!.context.dispose());
    throw error;
  } finally { deadline.dispose(); }
  try { return await action(connection.client); }
  finally { await closeQuietly(() => connection.context.dispose()); }
}

async function loginUnlocked(store: SessionStore, timeoutMs: number): Promise<void> {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  let bearer: string | undefined;
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin !== BASE_URL || !url.pathname.startsWith('/d2l/')) return;
    const authorization = request.headers().authorization;
    if (authorization?.startsWith('Bearer ')) bearer = authorization.slice(7);
  });
  const stop = () => { void browser.close(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  console.error('Sign in using MUN Login in the browser. Complete any MFA there. Waiting up to 10 minutes.');
  try {
    await page.goto(`${BASE_URL}/d2l/home`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const deadline = Date.now() + timeoutMs;
    let checked = false;
    while (Date.now() < deadline) {
      if (!browser.isConnected() || page.isClosed()) throw new AppError('LOGIN_CANCELLED', 'Login cancelled. Existing saved session was preserved.');
      const url = new URL(page.url());
      if (url.origin === BASE_URL && /^\/d2l\/home(?:\/\d+)?\/?$/.test(url.pathname)) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const client = new BrightspaceClient(playwrightTransport(context.request), bearer);
        try {
          await client.identity();
          const courses = await client.courses();
          const raw = await context.storageState();
          const session: Session = {
            origin: BASE_URL,
            savedAt: new Date().toISOString(),
            bearer,
            state: {
              cookies: raw.cookies.filter(cookie => allowedCookie(cookie.domain)),
              origins: [],
            },
          };
          await store.save(session);
          console.error(`Login verified: identity and ${courses.length} course enrollments retrieved. Encrypted session saved.`);
          return;
        } catch (error) {
          if (!(error instanceof AppError) || !['AUTH_REQUIRED', 'PERMISSION_DENIED'].includes(error.code)) throw error;
          if (!checked) { console.error('Brightspace opened, but API access is not yet verified. Waiting for the signed-in page to finish loading.'); checked = true; }
        }
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new AppError('LOGIN_TIMEOUT', 'Login/API verification timed out. Existing saved session was preserved.');
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await browser.close();
  }
}

export async function login(store = new SessionStore(), timeoutMs = 10 * 60_000): Promise<void> {
  return store.withLifecycleLock(() => loginUnlocked(store, timeoutMs), timeoutMs + 60_000);
}
