import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import { sessionDirectory } from './config.js';
import { AppError } from './errors.js';
import { baselineWarning, canAcceptBaseline, classify, toolValue, validateCourses, validateDeadlines, verificationError, versionsSchema, type Report } from './verification.js';

const started = performance.now();
const report: Report = {
  timestamp: new Date().toISOString(), application_version: 'unknown', elapsed_ms: 0,
  checks: [], warnings: [], ok: false,
  scope: 'Bounded integration checks, not proof of complete Brightspace correctness.',
};
const elapsed = (start: number) => Math.round(performance.now() - start);
async function check<T>(name: string, action: () => Promise<T>): Promise<T | undefined> {
  const start = performance.now();
  try {
    const result = await action();
    report.checks.push({ check: name, status: 'pass', elapsed_ms: elapsed(start) });
    return result;
  } catch (error) {
    const code = error instanceof AppError ? error.code : error instanceof Error && 'code' in error && error.code === -32001 ? 'CHECK_TIMEOUT' : undefined;
    report.checks.push({ check: name, status: 'fail', elapsed_ms: elapsed(start), ...classify(code) });
    return undefined;
  }
}
async function main() {
  if (process.argv.slice(2).some(arg => !['--json', '--accept-baseline'].includes(arg))) throw verificationError('INVALID_INPUT');
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  report.application_version = z.string().regex(/^\d+\.\d+\.\d+$/).parse(pkg.version);
  const directory = sessionDirectory();
  const entry = fileURLToPath(new URL('./cli.js', import.meta.url));
  await access(entry);
  const doctorStart = performance.now();
  try {
    const output = await new Promise<string>((resolve, reject) => {
      execFile(process.execPath, [entry, 'doctor', '--json'], { timeout: 180_000, maxBuffer: 64 * 1024, windowsHide: true }, (error, stdout) => {
        // Doctor uses exit 1 for failed checks; its bounded JSON still contains the diagnosis.
        if (error && (error.killed || typeof error.code !== 'number' || error.code !== 1)) reject(verificationError(error.killed ? 'CHECK_TIMEOUT' : 'INTERNAL_ERROR'));
        else resolve(stdout);
      });
    });
    let decoded: unknown;
    try { decoded = JSON.parse(output); } catch { throw verificationError('INVALID_RESPONSE'); }
    const doctor = z.object({ checks: z.array(z.object({
      check: z.enum(['chromium', 'authentication', 'api_versions', 'calendar_api', 'origin_guard']),
      ok: z.boolean(), code: z.string().optional(), elapsed_ms: z.number().nonnegative(),
    })), versions: versionsSchema.optional() }).safeParse(decoded);
    if (!doctor.success) throw verificationError('INVALID_RESPONSE');
    const names = new Set(doctor.data.checks.map(c => c.check));
    if (names.size !== doctor.data.checks.length || !names.has('chromium') || !names.has('authentication')) throw verificationError('INVALID_RESPONSE');
    if (doctor.data.checks.find(c => c.check === 'api_versions')?.ok &&
        (!doctor.data.versions || !names.has('calendar_api') || !names.has('origin_guard'))) throw verificationError('INVALID_RESPONSE');
    report.versions = doctor.data.versions;
    for (const item of doctor.data.checks) report.checks.push({ check: item.check, status: item.ok ? 'pass' : 'fail', elapsed_ms: item.elapsed_ms, ...(item.ok ? {} : classify(item.code)) });
  } catch (error) {
    report.checks.push({ check: 'doctor', status: 'fail', elapsed_ms: elapsed(doctorStart), ...classify(error instanceof AppError ? error.code : undefined) });
  }

  const client = new Client({ name: 'mun-d2l-live-verifier', version: report.application_version });
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry, 'serve'],
    env: Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)), stderr: 'pipe' });
  // Drain diagnostics without retaining or printing potentially sensitive data.
  transport.stderr?.on('data', () => {});
  try {
    const connected = await check('mcp_handshake', async () => {
      await client.connect(transport, { timeout: 15_000 });
      const result = await client.listTools(undefined, { timeout: 15_000 });
      const expected = ['list_courses', 'list_assignments', 'list_quizzes', 'get_my_grades', 'get_grade_insights', 'list_announcements', 'list_course_content', 'get_upcoming_deadlines', 'get_weekly_schedule', 'export_calendar_ics', 'search_course_materials', 'read_course_material'];
      if (result.tools.length !== expected.length || !expected.every(n => result.tools.some(t => t.name === n && t.inputSchema.type === 'object' && t.annotations?.readOnlyHint))) throw verificationError('INVALID_RESPONSE');
      return true;
    });
    if (connected) {
      const courses = await check('courses', async () => validateCourses(toolValue(await client.callTool({ name: 'list_courses', arguments: {} }, undefined, { timeout: 120_000 }))));
      if (courses) await check('deadlines', async () => {
        const from = new Date().toISOString();
        validateDeadlines(toolValue(await client.callTool({ name: 'get_upcoming_deadlines', arguments: { days: 7, from } }, undefined, { timeout: 120_000 })), courses, from);
      });
    }
  } finally { await client.close(); }

  const baselineFile = join(directory, 'verification-baseline.json');
  if (report.versions) {
    let baseline: unknown;
    try { baseline = JSON.parse(await readFile(baselineFile, 'utf8')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') report.warnings.push('BASELINE_INVALID');
    }
    const warning = baselineWarning(baseline, report.versions);
    if (warning && !report.warnings.includes('BASELINE_INVALID')) report.warnings.push(warning);
  }
  report.ok = report.checks.every(c => c.status === 'pass');
  // Missing dependent checks can never count as a verified baseline or a successful run.
  report.ok = canAcceptBaseline(report);
  if (process.argv.includes('--accept-baseline')) {
    if (canAcceptBaseline(report)) await check('baseline_saved', async () => {
      const temporary = join(directory, `verification-${randomUUID()}.tmp`);
      try {
        await mkdir(directory, { recursive: true });
        await writeFile(temporary, JSON.stringify({ versions: report.versions, verified_at: report.timestamp, application_version: report.application_version }), { flag: 'wx', mode: 0o600 });
        await rename(temporary, baselineFile);
      } catch { throw verificationError('BASELINE_IO'); }
      finally { await rm(temporary, { force: true }).catch(() => undefined); }
    });
    else report.warnings.push('BASELINE_NOT_ACCEPTED');
  }
  report.ok = report.ok && report.checks.every(c => c.status === 'pass');
}

void main().catch(error => {
  report.ok = false;
  report.checks.push({ check: 'setup', status: 'fail', elapsed_ms: elapsed(started), ...classify(error instanceof AppError ? error.code : undefined) });
}).finally(() => {
  report.elapsed_ms = elapsed(started);
  if (process.argv.includes('--json')) console.log(JSON.stringify(report));
  else {
    console.log(`Live verification ${report.ok ? 'PASS' : 'FAIL'} — ${report.application_version} — ${report.timestamp}`);
    for (const item of report.checks) console.log(`${item.status.toUpperCase()} ${item.check} ${item.elapsed_ms}ms${item.code ? ` ${item.category}/${item.code}` : ''}`);
    if (report.versions) console.log(`Selected APIs: LP ${report.versions.lp}, LE ${report.versions.le}`);
    for (const warning of report.warnings) console.log(`WARN ${warning}`);
    console.log(report.scope);
  }
  process.exitCode = report.ok ? 0 : 1;
});
