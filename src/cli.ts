#!/usr/bin/env node
import { doctor } from './doctor.js';
import { login, refreshSession, withSession } from './auth/login.js';
import { SessionStore } from './auth/store.js';
import { AppError, safeError } from './errors.js';
import { serve } from './server.js';
import { sessionHours } from './config.js';

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'serve';
  const store = new SessionStore();
  switch (command) {
    case 'login': await login(store); break;
    case 'status':
      await withSession(store, async client => {
        await client.identity();
        const courses = await client.courses();
        const session = await store.load();
        const ageMinutes = session ? Math.max(0, Math.floor((Date.now() - Date.parse(session.savedAt)) / 60_000)) : null;
        const renewalMinutes = sessionHours() * 60;
        const renewal = renewalMinutes > 0 && ageMinutes !== null ? `${Math.max(0, Math.ceil(renewalMinutes - ageMinutes))} minutes` : 'disabled';
        console.error(`Authenticated. Session age: ${ageMinutes ?? 'unknown'} minutes; next silent-renewal check: ${renewal}; ${courses.length} course enrollments retrieved.`);
        console.error('MUN controls the actual SSO expiry, so its exact expiry time is not exposed.');
      });
      break;
    case 'doctor': {
      const result = await doctor(store);
      if (process.argv.includes('--json')) console.log(JSON.stringify(result));
      else {
        for (const check of result.checks) console.error(`${check.ok ? 'PASS' : 'FAIL'} ${check.check}: ${check.code ?? 'OK'} (${check.elapsed_ms}ms)`);
        if (result.versions) console.error(`Selected APIs: LP ${result.versions.lp}, LE ${result.versions.le}`);
      }
      if (result.checks.some(check => !check.ok)) process.exitCode = 1;
      break;
    }
    case 'renew':
      try { await refreshSession(store); console.error('Session renewed silently.'); }
      catch (error) {
        if (!(error instanceof AppError) || error.code !== 'AUTH_REQUIRED') throw error;
        console.error('Silent renewal requires interactive MUN sign-in or MFA. Opening the login browser.');
        await login(store);
      }
      break;
    case 'test-course': {
      const courseId = Number(process.argv[3]);
      if (!Number.isInteger(courseId) || courseId <= 0) throw new AppError('INVALID_INPUT', 'Usage: mun-d2l-mcp test-course <course-id>');
      await withSession(store, async client => {
        const service = new (await import('./tools/service.js')).StudyService(client);
        const [assignments, quizzes, grades, content] = await Promise.allSettled([service.listAssignments(courseId), service.listQuizzes(courseId), service.myGrades(courseId), service.content(courseId)]);
        const results = [['assignments', assignments], ['quizzes', quizzes], ['grades', grades], ['content', content]] as const;
        for (const [name, result] of results) console.error(`${result.status === 'fulfilled' ? 'PASS' : 'FAIL'} ${name}${result.status === 'rejected' ? `: ${safeError(result.reason).code}` : ''}`);
        if (results.some(([, result]) => result.status === 'rejected')) process.exitCode = 1;
      });
      break;
    }
    case 'logout': await store.clear(); console.error('Local session and encryption key removed. This does not sign out other browsers.'); break;
    case 'serve': await serve(); break;
    default: console.error('Usage: mun-d2l-mcp <login|serve|status|renew|doctor|test-course|logout>'); process.exitCode = 1;
  }
}
main().catch(error => { const safe = safeError(error); console.error(`${safe.code}: ${safe.message}`); process.exitCode = 1; });
