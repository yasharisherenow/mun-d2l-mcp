import { describe, expect, it } from 'vitest';
import { AppError } from '../src/errors.js';
import { baselineWarning, canAcceptBaseline, classify, toolValue, validateCourses, validateDeadlines, type Report } from '../src/verification.js';

const courses = {
  courses: [
    { id: 11, active: true, accessible: true },
    { id: 12, active: false, accessible: true },
  ],
  total: 2,
};
const from = '2026-09-15T12:00:00.000Z';
const emptyDeadlines = {
  from: { original: from },
  until_exclusive: { original: '2026-09-22T12:00:00.000Z' },
  deadlines: [], courses_checked: 1, complete: true, unavailable: [], coverage: 'Bounded sources',
};

describe('live verification contracts', () => {
  it('accepts empty valid course and deadline results', () => {
    const parsed = validateCourses(courses);
    expect(() => validateDeadlines(emptyDeadlines, parsed, from)).not.toThrow();
  });

  it('rejects malformed totals, ordering, windows, and unknown courses', () => {
    expect(() => validateCourses({ ...courses, total: 3 })).toThrowError(AppError);
    const parsed = validateCourses(courses);
    const item = (course_id: number, original: string) => ({ course_id, kind: 'assignment_due', date: { original } });
    expect(() => validateDeadlines({ ...emptyDeadlines, deadlines: [
      item(11, '2026-09-17T12:00:00.000Z'), item(11, '2026-09-16T12:00:00.000Z'),
    ] }, parsed, from)).toThrowError(AppError);
    expect(() => validateDeadlines({ ...emptyDeadlines, deadlines: [item(11, '2026-09-22T12:00:00.000Z')] }, parsed, from)).toThrowError(AppError);
    expect(() => validateDeadlines({ ...emptyDeadlines, deadlines: [item(999, '2026-09-16T12:00:00.000Z')] }, parsed, from)).toThrowError(AppError);
  });

  it('classifies incomplete coverage as a failure', () => {
    const parsed = validateCourses(courses);
    expect(() => validateDeadlines({ ...emptyDeadlines, complete: false,
      unavailable: [{ course_id: 11, source: 'quizzes', code: 'API_ERROR' }],
    }, parsed, from)).toThrowError(expect.objectContaining({ code: 'INCOMPLETE_COVERAGE' }));
  });

  it('reports API baseline absence, corruption, drift, and equality as warnings', () => {
    const versions = { lp: '1.44', le: '1.75' };
    expect(baselineWarning(undefined, versions)).toBe('BASELINE_MISSING');
    expect(baselineWarning({}, versions)).toBe('BASELINE_INVALID');
    expect(baselineWarning({ versions: { ...versions, le: '1.76' }, verified_at: from, application_version: '0.1.0' }, versions)).toBe('API_VERSION_CHANGED');
    expect(baselineWarning({ versions, verified_at: from, application_version: '0.1.0' }, versions)).toBeUndefined();
  });

  it('requires every live check before accepting a baseline', () => {
    const names = ['chromium', 'authentication', 'api_versions', 'calendar_api', 'origin_guard', 'mcp_handshake', 'courses', 'deadlines'];
    const report: Report = { timestamp: from, application_version: '0.1.0', elapsed_ms: 10,
      versions: { lp: '1.44', le: '1.75' }, checks: names.map(check => ({ check, status: 'pass', elapsed_ms: 1 })),
      warnings: ['BASELINE_MISSING'], ok: true, scope: 'test' };
    expect(canAcceptBaseline(report)).toBe(true);
    expect(canAcceptBaseline({ ...report, checks: report.checks.slice(0, -1) })).toBe(false);
    expect(canAcceptBaseline({ ...report, checks: report.checks.map(c => c.check === 'courses' ? { ...c, status: 'fail' as const } : c) })).toBe(false);
  });

  it('allowlists error codes and never returns raw error text', () => {
    expect(classify('AUTH_REQUIRED')).toEqual({ category: 'authentication', code: 'AUTH_REQUIRED' });
    expect(classify('SECRET_cookie=value')).toEqual({ category: 'setup', code: 'INTERNAL_ERROR' });
    expect(() => toolValue({ isError: true, structuredContent: { error: { code: 'SECRET_token' } } })).toThrowError(expect.objectContaining({ code: 'INTERNAL_ERROR' }));
    expect(toolValue({ structuredContent: { total: 0 } })).toEqual({ total: 0 });
  });
});
