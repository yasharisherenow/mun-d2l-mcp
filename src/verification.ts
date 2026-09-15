import { z } from 'zod';
import { AppError } from './errors.js';

const categories = {
  authentication: ['AUTH_REQUIRED'],
  timeout_busy: ['AUTH_TIMEOUT', 'SESSION_BUSY', 'RESOURCE_LIMIT', 'CHECK_TIMEOUT'],
  upstream: ['NETWORK_ERROR', 'SERVICE_UNAVAILABLE', 'RATE_LIMITED', 'API_ERROR'],
  coverage: ['INCOMPLETE_COVERAGE', 'PERMISSION_DENIED', 'COURSE_NOT_ENROLLED'],
  contract: ['INVALID_RESPONSE', 'API_UNSUPPORTED', 'NOT_FOUND', 'REDIRECT_BLOCKED', 'URL_BLOCKED', 'PAGINATION_ERROR', 'PAGINATION_LIMIT', 'RESPONSE_SIZE_UNKNOWN', 'RESPONSE_ENCODING_BLOCKED', 'RESPONSE_TOO_LARGE', 'OUTPUT_LIMIT', 'ORIGIN_GUARD_FAILED'],
  setup: ['KEYRING_INVALID', 'KEYRING_UNAVAILABLE', 'SESSION_UNREADABLE', 'SESSION_LOCK_FAILED', 'PLATFORM_UNSUPPORTED', 'INVALID_CONFIG', 'INVALID_INPUT', 'CHROMIUM_MISSING', 'BASELINE_IO', 'INTERNAL_ERROR'],
} as const;

/** Allowlist codes; never serialize raw exceptions or server-provided messages. */
export function classify(code: unknown) {
  for (const [category, codes] of Object.entries(categories)) {
    if (typeof code === 'string' && (codes as readonly string[]).includes(code)) return { category, code };
  }
  return { category: 'setup', code: 'INTERNAL_ERROR' };
}
export function verificationError(code: unknown): AppError {
  return new AppError(classify(code).code, 'Verification failed; see the classified error code.');
}
const invalid = () => verificationError('INVALID_RESPONSE');
const timestamp = z.object({ original: z.iso.datetime({ offset: true }) });
const courseSchema = z.object({
  courses: z.array(z.object({ id: z.number().int().positive(), active: z.boolean(), accessible: z.boolean() })),
  total: z.number().int().nonnegative(),
});
export function validateCourses(value: unknown) {
  const parsed = courseSchema.safeParse(value);
  if (!parsed.success || parsed.data.total !== parsed.data.courses.length || new Set(parsed.data.courses.map(c => c.id)).size !== parsed.data.total) throw invalid();
  return parsed.data;
}
export function validateDeadlines(value: unknown, courses: ReturnType<typeof validateCourses>, from: string) {
  const schema = z.object({
    from: timestamp, until_exclusive: timestamp,
    deadlines: z.array(z.object({ course_id: z.number().int().positive(), date: timestamp,
      kind: z.enum(['assignment_due', 'assignment_closes', 'quiz_due', 'quiz_closes']) })),
    courses_checked: z.number().int().nonnegative(), complete: z.boolean(),
    unavailable: z.array(z.object({ course_id: z.number().int().positive(), source: z.enum(['assignments', 'quizzes']), code: z.string() })),
    coverage: z.string().min(1),
  });
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw invalid();
  const data = parsed.data;
  const active = new Set(courses.courses.filter(c => c.active && c.accessible).map(c => c.id));
  const start = Date.parse(from), end = start + 7 * 86_400_000;
  if (Date.parse(data.from.original) !== start || Date.parse(data.until_exclusive.original) !== end ||
      data.courses_checked !== active.size || data.complete !== (data.unavailable.length === 0)) throw invalid();
  let previous = start;
  for (const item of data.deadlines) {
    const date = Date.parse(item.date.original);
    if (!active.has(item.course_id) || date < previous || date >= end) throw invalid();
    previous = date;
  }
  const sources = new Set<string>();
  for (const item of data.unavailable) {
    const key = `${item.course_id}:${item.source}`;
    if (!active.has(item.course_id) || sources.has(key)) throw invalid();
    sources.add(key);
  }
  if (!data.complete) throw verificationError('INCOMPLETE_COVERAGE');
}

export const versionsSchema = z.object({ lp: z.string().regex(/^\d+\.\d+$/), le: z.string().regex(/^\d+\.\d+$/) });
export type Versions = z.infer<typeof versionsSchema>;
const baselineSchema = z.object({ versions: versionsSchema, verified_at: z.iso.datetime(), application_version: z.string().regex(/^\d+\.\d+\.\d+$/) });
export function baselineWarning(value: unknown, versions: Versions) {
  if (value === undefined) return 'BASELINE_MISSING';
  const parsed = baselineSchema.safeParse(value);
  if (!parsed.success) return 'BASELINE_INVALID';
  return parsed.data.versions.lp === versions.lp && parsed.data.versions.le === versions.le ? undefined : 'API_VERSION_CHANGED';
}
export interface Check {
  check: string; status: 'pass' | 'fail'; elapsed_ms: number; category?: string; code?: string;
}
export interface Report {
  timestamp: string; application_version: string; elapsed_ms: number;
  versions?: Versions; checks: Check[]; warnings: string[]; ok: boolean;
  scope: string;
}
export function canAcceptBaseline(report: Report) {
  const required = ['chromium', 'authentication', 'api_versions', 'calendar_api', 'origin_guard', 'mcp_handshake', 'courses', 'deadlines'];
  return report.ok && !!report.versions && required.every(name => report.checks.some(c => c.check === name && c.status === 'pass')) && report.checks.every(c => c.status === 'pass');
}
export function toolValue(value: unknown): unknown {
  const envelope = z.object({ isError: z.boolean().optional(), structuredContent: z.unknown() }).safeParse(value);
  if (!envelope.success) throw invalid();
  const result = envelope.data;
  if (result.isError) {
    const parsed = z.object({ error: z.object({ code: z.string() }) }).safeParse(result.structuredContent);
    throw verificationError(parsed.success ? parsed.data.error.code : undefined);
  }
  return result.structuredContent;
}
