import { describe, expect, it, vi } from 'vitest';
import { BrightspaceClient, type HttpResponse } from '../src/api/client.js';
import { StudyService } from '../src/tools/service.js';
const response = (value: unknown, status = 200): HttpResponse => ({ status, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(value)) });
const course = { OrgUnit: { Id: 1, Name: 'Test course', Code: 'TEST' }, Access: { IsActive: true, CanAccess: true } };
function service(routes: Record<string, unknown | HttpResponse>) {
  const transport = vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    if (path === '/d2l/api/versions/') return response([{ ProductCode: 'lp', LatestVersion: '1.63', SupportedVersions: ['1.63'] }, { ProductCode: 'le', LatestVersion: '1.97', SupportedVersions: ['1.97'] }]);
    if (path.includes('myenrollments')) return response([course]);
    const value = routes[path.replace('/d2l/api/le/1.97/1/', '')];
    if (value === undefined) return response({}, 404);
    if (value && typeof value === 'object' && 'status' in value && 'body' in value) return value as HttpResponse;
    return response(value);
  });
  return { service: new StudyService(new BrightspaceClient(transport)), transport };
}
describe('study tools', () => {
  it('separates category placeholder totals from individual grades', async () => {
    const { service: s } = service({ 'grades/values/myGradeValues/': [
      { GradeObjectIdentifier: '2', GradeObjectName: 'Quizzes', GradeObjectTypeName: 'Category', DisplayedGrade: '0 / 30', PointsNumerator: 0 },
      { GradeObjectIdentifier: '3', GradeObjectName: 'Essay', GradeObjectTypeName: 'Numeric', PointsNumerator: 8 },
    ] });
    const result = await s.myGrades(1);
    expect(result.grades.map(g => g.name)).toEqual(['Essay']);
    expect(result.grades[0]?.release_status).toBe('unknown');
    expect(result.category_summaries[0]?.name).toBe('Quizzes');
  });
  it('keeps missing dates and grades distinct from zero', async () => {
    const { service: s } = service({ 'dropbox/folders/': [{ Id: 2, Name: 'Essay', DueDate: null, IsHidden: false }], 'grades/values/myGradeValues/': [{ GradeObjectIdentifier: '2', GradeObjectName: 'Essay', PointsNumerator: null }] });
    expect((await s.listAssignments(1)).assignments[0]?.due).toBeNull();
    expect((await s.myGrades(1)).grades[0]?.points).toBeNull();
  });
  it('does not include private comment fields', async () => {
    const { service: s } = service({ 'grades/values/myGradeValues/': [{ GradeObjectIdentifier: '2', GradeObjectName: 'Essay', PrivateComments: { Text: 'PRIVATE' }, Comments: { Text: 'Feedback' } }] });
    const result = await s.myGrades(1);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(result.grades[0]?.feedback).toBe('Feedback');
  });
  it('combines due and closing dates, excludes hidden quizzes, and respects exclusive end', async () => {
    const { service: s } = service({
      'dropbox/folders/': [{ Id: 2, Name: 'Essay', DueDate: '2026-09-13T12:00:00Z', IsHidden: false }, { Id: 3, Name: 'Next week', DueDate: '2026-09-19T00:00:00Z', IsHidden: false }],
      'quizzes/': { Objects: [{ QuizId: 4, Name: 'Quiz', EndDate: '2026-09-12T18:00:00Z', IsHidden: false, IsActive: true }, { QuizId: 5, Name: 'Hidden', DueDate: '2026-09-13T12:00:00Z', IsHidden: true, IsActive: true }], Next: null },
    });
    const result = await s.deadlines([1], 7, '2026-09-12T00:00:00Z');
    expect(result.deadlines.map(d => d.kind)).toEqual(['quiz_closes', 'assignment_due']);
    expect(result.complete).toBe(true);
  });
  it('returns read-only quiz limits and availability metadata', async () => {
    const { service: s } = service({ 'quizzes/': { Objects: [{ QuizId: 4, Name: 'Quiz 1', StartDate: '2026-09-12T12:00:00Z', DueDate: '2026-09-13T12:00:00Z', EndDate: '2026-09-14T12:00:00Z', IsHidden: false, IsActive: true, AttemptsAllowed: { IsUnlimited: false, NumberOfAttemptsAllowed: 2 }, SubmissionTimeLimit: { IsEnforced: true, TimeLimitValue: 45 } }], Next: null } });
    const result = await s.listQuizzes(1);
    expect(result.quizzes[0]?.attempts).toEqual({ unlimited: false, allowed: 2 });
    expect(result.quizzes[0]?.time_limit).toEqual({ enforced: true, minutes: 45 });
    expect(result.note).toContain('never starts');
  });
  it('labels grade projections as local hypothetical arithmetic', async () => {
    const { service: s } = service({ 'grades/values/myGradeValues/': [{ GradeObjectIdentifier: '3', GradeObjectName: 'Essay', GradeObjectTypeName: 'Numeric', PointsNumerator: 8, PointsDenominator: 10 }] });
    const result = await s.gradeInsights(1, [{ name: 'Future quiz', earned: 9, possible: 10 }]);
    expect(result.available_numeric_points_summary?.percent).toBe(80);
    expect(result.hypothetical?.combined_with_available_points.percent).toBe(85);
    expect(result.warning).toContain('not an official');
  });
  it('searches topic metadata with module paths without fetching unrelated topics', async () => {
    const { service: s, transport } = service({ 'content/toc': { Modules: [{ ModuleId: 1, Title: 'Week 1', IsHidden: false, Modules: [], Topics: [{ TopicId: 2, Title: 'Database normalization notes', IsHidden: false, Description: { Text: 'First normal form' } }] }] } });
    const result = await s.searchMaterials(1, 'normalization');
    expect(result.matches[0]?.module_path).toEqual(['Week 1']);
    expect(transport.mock.calls.some(([url]) => url.includes('/content/topics/2/file'))).toBe(false);
  });
  it('reports partial permission failures instead of claiming no deadlines', async () => {
    const { service: s } = service({ 'dropbox/folders/': [], 'quizzes/': response({}, 403) });
    const result = await s.deadlines([1]);
    expect(result.complete).toBe(false);
    expect(result.unavailable[0]?.code).toBe('PERMISSION_DENIED');
  });
  it('rejects courses outside your enrollments before requesting their data', async () => {
    const { service: s, transport } = service({});
    await expect(s.myGrades(999)).rejects.toMatchObject({ code: 'COURSE_NOT_ENROLLED' });
    expect(transport.mock.calls.some(([url]) => url.includes('/999/'))).toBe(false);
  });
  it('does not read topics inside locked modules', async () => {
    const { service: s } = service({ 'content/toc': { Modules: [{ ModuleId: 1, Title: 'Locked', IsHidden: false, IsLocked: true, Modules: [], Topics: [{ TopicId: 2, Title: 'Topic', IsHidden: false, Description: { Text: 'LOCKED SECRET' } }] }] } });
    const content = await s.content(1);
    expect(content.topics[0]?.description).toBeNull();
    expect(JSON.stringify(content)).not.toContain('LOCKED SECRET');
    expect((await s.searchMaterials(1, 'LOCKED SECRET')).matches).toEqual([]);
    await expect(s.readMaterial({ course_id: 1, topic_id: 2 })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
  it('rejects content trees deeper than the safety limit without recursive traversal', async () => {
    let nested: unknown = { ModuleId: 60, Title: 'Deep', IsHidden: false, Modules: [], Topics: [] };
    for (let index = 59; index > 0; index--) nested = { ModuleId: index, Title: `Level ${index}`, IsHidden: false, Modules: [nested], Topics: [] };
    const { service: s } = service({ 'content/toc': { Modules: [nested] } });
    await expect(s.content(1)).rejects.toMatchObject({ code: 'CONTENT_LIMIT' });
  });
  it('pages readable material without losing the source', async () => {
    const { service: s } = service({
      'content/toc': { Modules: [{ ModuleId: 1, Title: 'Module', IsHidden: false, Modules: [], Topics: [{ TopicId: 2, Title: 'Topic', IsHidden: false }] }] },
      'content/topics/2/file': { status: 200, headers: { 'content-type': 'text/plain' }, body: Buffer.from('abcdefghij') },
    });
    const result = await s.readMaterial({ course_id: 1, topic_id: 2, offset: 2, max_characters: 3 });
    expect(result.text).toBe('cde');
    expect(result.next_offset).toBe(5);
    expect(result.source_url).toContain('/viewContent/2/');
  });
  it('rejects ambiguous material IDs and unlisted attachments', async () => {
    const { service: s } = service({ 'dropbox/folders/': [{ Id: 2, Name: 'Essay', IsHidden: false, Attachments: [] }] });
    await expect(s.readMaterial({ course_id: 1, topic_id: 2, assignment_id: 2 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(s.readMaterial({ course_id: 1, assignment_id: 2, attachment_id: 3 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('fails closed when Brightspace visibility flags are missing', async () => {
    const { service: s } = service({
      'dropbox/folders/': [{ Id: 2, Name: 'Unknown visibility' }],
      'quizzes/': { Objects: [{ QuizId: 3, Name: 'Unknown visibility' }], Next: null },
      'news/': { Objects: [{ Id: 4, Title: 'Unknown visibility' }], Next: null },
      'content/toc': { Modules: [{ ModuleId: 5, Title: 'Unknown visibility', Modules: [], Topics: [] }] },
    });
    expect((await s.listAssignments(1)).assignments).toEqual([]);
    expect((await s.listQuizzes(1)).quizzes).toEqual([]);
    expect((await s.announcements(1)).announcements).toEqual([]);
    expect((await s.content(1)).modules).toEqual([]);
  });
  it('hides future assignment details and blocks future attachments', async () => {
    const { service: s, transport } = service({ 'dropbox/folders/': [{
      Id: 2, Name: 'Future assignment', IsHidden: false, CustomInstructions: { Text: 'SECRET' },
      Availability: { StartDate: '2999-01-01T00:00:00Z' }, Attachments: [{ FileId: 3, FileName: 'future.pdf' }],
      LinkAttachments: [{ LinkId: 4, LinkName: 'future', Href: 'https://example.com/future' }],
    }] });
    const assignment = (await s.listAssignments(1)).assignments[0]!;
    expect(assignment).toMatchObject({ instructions: null, attachments: [], links: [] });
    await expect(s.readMaterial({ course_id: 1, assignment_id: 2, attachment_id: 3 })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(transport.mock.calls.some(([url]) => url.includes('/attachments/3'))).toBe(false);
  });
  it('escapes standalone carriage returns in iCalendar values', async () => {
    const { service: s } = service({});
    vi.spyOn(s, 'weeklySchedule').mockResolvedValue({ events: [{ course_id: 1, id: 2, title: 'Title\rINJECT', starts: { original: '2026-09-14T12:00:00Z' }, source_url: 'https://online.mun.ca/d2l/home/1' }], complete: true } as never);
    const result = await s.calendarIcs([1]);
    expect(result.ics).toContain('SUMMARY:Title\\nINJECT');
    expect(result.ics.replaceAll('\r\n', '')).not.toContain('\r');
  });
});
