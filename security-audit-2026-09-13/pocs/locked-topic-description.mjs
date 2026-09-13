import { BrightspaceClient } from '../../dist/api/client.js';
import { StudyService } from '../../dist/tools/service.js';

const json = value => ({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(value)) });
const transport = async url => {
  const path = new URL(url).pathname;
  if (path === '/d2l/api/versions/') return json([
    { ProductCode: 'lp', LatestVersion: '1.63', SupportedVersions: ['1.63'] },
    { ProductCode: 'le', LatestVersion: '1.97', SupportedVersions: ['1.97'] },
  ]);
  if (path.includes('myenrollments')) return json([
    { OrgUnit: { Id: 1, Name: 'Synthetic course', Code: 'SYN' }, Access: { IsActive: true, CanAccess: true } },
  ]);
  if (path.endsWith('/content/toc')) return json({ Modules: [{
    ModuleId: 10, Title: 'Locked module', IsLocked: true, Modules: [],
    Topics: [{ TopicId: 20, Title: 'Future exam', Description: { Text: 'SYNTHETIC_LOCKED_SECRET' } }],
  }] });
  return { status: 404, headers: { 'content-type': 'application/json' }, body: Buffer.from('{}') };
};

const service = new StudyService(new BrightspaceClient(transport));
const content = await service.content(1);
const search = await service.searchMaterials(1, 'synthetic_locked_secret');
let readError;
try { await service.readMaterial({ course_id: 1, topic_id: 20 }); }
catch (error) { readError = error.code; }

console.log(JSON.stringify({
  listedLockedDescription: content.topics[0]?.description,
  searchSnippetContainsDescription: search.matches[0]?.snippet.includes('SYNTHETIC_LOCKED_SECRET'),
  directReadResult: readError,
}, null, 2));
