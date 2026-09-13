import { BrightspaceClient } from '../../dist/api/client.js';
import { StudyService } from '../../dist/tools/service.js';

const payload = 'A'.repeat(2 * 1024 * 1024);
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
  if (path.endsWith('/news/')) return json([{ Id: 1, Title: 'Synthetic', Body: { Text: payload }, IsPublished: true }]);
  return { status: 404, headers: { 'content-type': 'application/json' }, body: Buffer.from('{}') };
};

const service = new StudyService(new BrightspaceClient(transport));
const result = await service.announcements(1);
console.log(JSON.stringify({ inputCharacters: payload.length, returnedCharacters: result.announcements[0].text.length }));
