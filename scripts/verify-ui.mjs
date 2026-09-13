// Optional read-only live comparison. Prints check results, never course content.
import { chromium } from 'playwright';
import { SessionStore } from '../dist/auth/store.js';
import { withSession } from '../dist/auth/login.js';
import { StudyService } from '../dist/tools/service.js';
import { BASE_URL } from '../dist/config.js';

const store = new SessionStore();
const session = await store.load();
if (!session) throw new Error('Run npm run login first.');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: session.state, timezoneId: 'America/St_Johns' });
const page = await context.newPage();
const checks = [];
async function visibleText(text) {
  if (!text) return false;
  try { await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 8000 }); return true; }
  catch { return false; }
}
try {
  await withSession(store, async client => {
    const service = new StudyService(client);
    const courses = (await client.courses()).filter(c => c.Access.CanAccess).sort((a, b) => (b.Access.LastAccessed ?? '').localeCompare(a.Access.LastAccessed ?? ''));
    const sample = courses[0];
    if (!sample) throw new Error('No accessible courses.');
    const id = sample.OrgUnit.Id;
    await page.goto(`${BASE_URL}/d2l/home/${id}`, { waitUntil: 'domcontentloaded' });
    checks.push({ check: 'Course name matches Brightspace UI', passed: await visibleText(sample.OrgUnit.Name) });

    const announcements = (await service.announcements(id)).announcements;
    if (announcements[0]) {
      await page.goto(announcements[0].source_url, { waitUntil: 'domcontentloaded' });
      checks.push({ check: 'Announcement title matches Brightspace UI', passed: await visibleText(announcements[0].title) });
    }
    const assignments = (await service.listAssignments(id)).assignments;
    const assignment = assignments.find(a => a.due) ?? assignments[0];
    if (assignment) {
      await page.goto(`${BASE_URL}/d2l/lms/dropbox/user/folders_list.d2l?ou=${id}`, { waitUntil: 'domcontentloaded' });
      checks.push({ check: 'Assignment name matches Brightspace UI', passed: await visibleText(assignment.name) });
      if (assignment.due) {
        const expected = new Intl.DateTimeFormat('en-US', { timeZone: 'America/St_Johns', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(assignment.due.original));
        checks.push({ check: 'Assignment due date matches Brightspace UI', passed: await visibleText(expected) });
      }
    }
    const content = await service.content(id);
    const topic = content.topics.find(item => !item.locked);
    if (topic) {
      await page.goto(topic.source_url, { waitUntil: 'domcontentloaded' });
      checks.push({ check: 'Content topic title matches Brightspace UI', passed: await visibleText(topic.title) });
    }
    let gradeCompared = false;
    for (const course of courses) {
      const result = await service.myGrades(course.OrgUnit.Id);
      if (!result.grades.length) continue;
      const value = result.grades[0];
      await page.goto(result.source_url, { waitUntil: 'domcontentloaded' });
      const name = await visibleText(value.name);
      const score = value.api_displayed_grade ? await visibleText(value.api_displayed_grade) : true;
      checks.push({ check: 'Individual grade name and API value match Brightspace UI', passed: name && score });
      gradeCompared = true;
      break;
    }
    if (!gradeCompared) console.log('SKIP: No individual API grade values available; category placeholders were excluded.');
  });
  for (const check of checks) console.log(`${check.passed ? 'PASS' : 'UNCONFIRMED'}: ${check.check}`);
  if (checks.some(check => !check.passed)) process.exitCode = 1;
} finally { await browser.close(); }
