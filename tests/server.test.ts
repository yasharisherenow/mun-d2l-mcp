import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from '../src/server.js';
import { StudyService } from '../src/tools/service.js';
import { AppError } from '../src/errors.js';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
async function connect(run: Parameters<typeof createServer>[0]) {
  const server = createServer(run);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  cleanup.push(async () => { await client.close(); await server.close(); });
  return client;
}
it('advertises exactly twelve read-only tools and returns structured content', async () => {
  const fake = { listCourses: async () => ({ courses: [], total: 0 }) } as unknown as StudyService;
  const client = await connect(action => action(fake));
  const { tools } = await client.listTools();
  expect(tools.map(t => t.name).sort()).toEqual(['export_calendar_ics', 'get_grade_insights', 'get_my_grades', 'get_upcoming_deadlines', 'get_weekly_schedule', 'list_announcements', 'list_assignments', 'list_course_content', 'list_courses', 'list_quizzes', 'read_course_material', 'search_course_materials']);
  expect(tools.every(t => t.annotations?.readOnlyHint)).toBe(true);
  const result = await client.callTool({ name: 'list_courses', arguments: {} });
  expect(result.structuredContent).toEqual({ courses: [], total: 0 });
});
it('validates IDs before executing', async () => {
  const run = vi.fn();
  const client = await connect(run);
  const result = await client.callTool({ name: 'get_my_grades', arguments: { course_id: -1 } });
  expect(result.isError).toBe(true);
  expect(run).not.toHaveBeenCalled();
});
it('returns authentication errors without leaking secrets', async () => {
  const client = await connect(async () => { throw new AppError('AUTH_REQUIRED', 'Run npm run login.'); });
  const result = await client.callTool({ name: 'list_courses', arguments: {} });
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toEqual({ error: { code: 'AUTH_REQUIRED', message: 'Run npm run login.' } });
});
it('redacts unexpected errors', async () => {
  const client = await connect(async () => { throw new Error('SECRET_TOKEN'); });
  expect(JSON.stringify(await client.callTool({ name: 'list_courses', arguments: {} }))).not.toContain('SECRET_TOKEN');
});
