import { describe, expect, it } from 'vitest';
import { StudyService } from '../../src/tools/service.js';

describe('audit reproduction: response size is enforced after buffering', () => {
  it('receives a complete oversized body before rejecting it', async () => {
    let bodyDelivered = false;
    const oversized = Buffer.alloc(20 * 1024 * 1024 + 1, 0x41);
    const client = {
      courses: async () => [{ OrgUnit: { Id: 1, Name: 'Synthetic', Code: 'TEST' }, Access: { IsActive: true, CanAccess: true } }],
      route: async (_product: string, suffix: string) => `/d2l/api/le/1.0/${suffix}`,
      paged: async () => [{ Id: 2, Name: 'Synthetic assignment', DueDate: null, Attachments: [{ FileId: 3, FileName: 'large.txt' }] }],
      get: async () => {
        bodyDelivered = true;
        return { status: 200, headers: { 'content-type': 'text/plain' }, body: oversized };
      },
    };
    const service = new StudyService(client as never);

    await expect(service.readMaterial({ course_id: 1, assignment_id: 2, attachment_id: 3 }))
      .rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    expect(bodyDelivered).toBe(true);
  });
});
