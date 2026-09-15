import { access } from 'node:fs/promises';
import { chromium } from 'playwright';
import { withSession } from './auth/login.js';
import { SessionStore } from './auth/store.js';
import { AppError } from './errors.js';
import { classify, versionsSchema, type Versions } from './verification.js';

export async function doctor(store: SessionStore) {
  const checks: Array<{ check: string; ok: boolean; code?: string; elapsed_ms: number }> = [];
  let versions: Versions | undefined;
  let start = performance.now();
  try { await access(chromium.executablePath()); checks.push({ check: 'chromium', ok: true, elapsed_ms: Math.round(performance.now() - start) }); }
  catch { checks.push({ check: 'chromium', ok: false, code: 'CHROMIUM_MISSING', elapsed_ms: Math.round(performance.now() - start) }); }
  start = performance.now();
  let authenticated = false;
  try {
    await withSession(store, async client => {
      authenticated = true;
      checks.push({ check: 'authentication', ok: true, elapsed_ms: Math.round(performance.now() - start) });
      start = performance.now();
      const parsed = versionsSchema.safeParse(await client.apiVersions());
      if (!parsed.success) throw new AppError('API_UNSUPPORTED', 'Required API versions are missing.');
      versions = parsed.data;
      checks.push({ check: 'api_versions', ok: true, elapsed_ms: Math.round(performance.now() - start) });
      const [major, minor] = versions.le.split('.').map(Number);
      const calendar = major! > 1 || (major === 1 && minor! >= 75);
      checks.push({ check: 'calendar_api', ok: calendar, ...(calendar ? {} : { code: 'API_UNSUPPORTED' }), elapsed_ms: 0 });
      start = performance.now();
      let guarded = false;
      try { await client.get('https://example.com/d2l/api/test'); }
      catch (error) { guarded = error instanceof AppError && error.code === 'URL_BLOCKED'; }
      checks.push({ check: 'origin_guard', ok: guarded, ...(guarded ? {} : { code: 'ORIGIN_GUARD_FAILED' }), elapsed_ms: Math.round(performance.now() - start) });
    });
  } catch (error) {
    checks.push({ check: authenticated ? 'api_versions' : 'authentication', ok: false, code: classify(error instanceof AppError ? error.code : undefined).code, elapsed_ms: Math.round(performance.now() - start) });
  }
  return { checks, versions };
}
