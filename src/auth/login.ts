import { chromium, request } from 'playwright';
import { BASE_URL, sessionHours } from '../config.js';
import { AppError } from '../errors.js';
import { BrightspaceClient, playwrightTransport } from '../api/client.js';
import { SessionStore, type Session } from './store.js';

const AUTH_ERRORS = ['AUTH_REQUIRED', 'PERMISSION_DENIED'];
const allowedCookie = (domain: string) => ['online.mun.ca', 'login.mun.ca'].includes(domain.replace(/^\./, '').toLowerCase());
let refreshInProgress: Promise<void> | undefined;

async function verifiedClient(session: Session) {
  const context = await request.newContext({ storageState: session.state });
  try {
    let client = new BrightspaceClient(playwrightTransport(context));
    try { await client.identity(); }
    catch (error) {
      if (!session.bearer || !(error instanceof AppError) || !AUTH_ERRORS.includes(error.code)) throw error;
      client = new BrightspaceClient(playwrightTransport(context), session.bearer);
      await client.identity();
    }
    return { client, context };
  } catch (error) {
    await context.dispose();
    throw error;
  }
}

/** Try MUN's existing SSO cookies in a hidden browser; never enters credentials or triggers MFA intentionally. */
export async function refreshSession(store: SessionStore): Promise<void> {
  const existing = await store.load();
  if (!existing) throw new AppError('AUTH_REQUIRED', 'No saved session. Run npm run login in the project folder.');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: existing.state });
  const page = await context.newPage();
  let bearer: string | undefined;
  page.on('request', request => {
    const url = new URL(request.url());
    const authorization = request.headers().authorization;
    if (url.origin === BASE_URL && url.pathname.startsWith('/d2l/') && authorization?.startsWith('Bearer ')) bearer = authorization.slice(7);
  });
  try {
    await page.goto(`${BASE_URL}/d2l/home`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    if (new URL(page.url()).origin === BASE_URL && /\/d2l\/loginh?\/?$/i.test(new URL(page.url()).pathname)) {
      const munLogin = page.getByRole('link', { name: /MUN Login/i }).first();
      if (await munLogin.isVisible().catch(() => false)) await munLogin.click({ timeout: 10_000 });
    }
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const current = new URL(page.url());
      if (current.origin === BASE_URL && /^\/d2l\/home(?:\/\d+)?\/?$/.test(current.pathname)) {
        const client = new BrightspaceClient(playwrightTransport(context.request), bearer);
        try {
          await client.identity();
          await client.courses();
          const raw = await context.storageState();
          await store.save({
            origin: BASE_URL,
            savedAt: new Date().toISOString(),
            bearer,
            state: { cookies: raw.cookies.filter(cookie => allowedCookie(cookie.domain)), origins: [] },
          });
          return;
        } catch (error) {
          if (!(error instanceof AppError) || !AUTH_ERRORS.includes(error.code)) throw error;
        }
      }
      if (current.hostname === 'login.mun.ca' && await page.locator('input[type="password"]').isVisible().catch(() => false)) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new AppError('AUTH_REQUIRED', 'MUN requires a fresh interactive sign-in or MFA. Run npm run login in the project folder.');
  } finally { await browser.close(); }
}

async function refreshOnce(store: SessionStore) {
  refreshInProgress ??= refreshSession(store).finally(() => { refreshInProgress = undefined; });
  return refreshInProgress;
}

export async function withSession<T>(store: SessionStore, action: (client: BrightspaceClient) => Promise<T>): Promise<T> {
  let session = await store.load();
  if (!session) throw new AppError('AUTH_REQUIRED', 'No saved session. Run npm run login in the project folder.');
  const interval = sessionHours();
  const savedAt = Date.parse(session.savedAt);
  if (interval > 0 && (!Number.isFinite(savedAt) || Date.now() - savedAt >= interval * 3_600_000)) {
    await refreshOnce(store);
    session = (await store.load())!;
  }
  let connection: Awaited<ReturnType<typeof verifiedClient>>;
  try {
    connection = await verifiedClient(session);
  } catch (error) {
    if (!(error instanceof AppError) || !AUTH_ERRORS.includes(error.code)) throw error;
    await refreshOnce(store);
    session = (await store.load())!;
    connection = await verifiedClient(session);
  }
  try { return await action(connection.client); }
  finally { await connection.context.dispose(); }
}

export async function login(store = new SessionStore(), timeoutMs = 10 * 60_000): Promise<void> {
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
