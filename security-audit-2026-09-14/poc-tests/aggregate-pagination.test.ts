import { expect, it, vi } from 'vitest';
import { BrightspaceClient, MAX_JSON_BYTES, type HttpResponse } from '../../src/api/client.js';

function jsonResponse(value: unknown): HttpResponse {
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify(value)),
  };
}

it('retains aggregate paginated data beyond the per-response JSON byte ceiling', async () => {
  // Each response is individually accepted, while their combined retained payload is
  // larger than MAX_JSON_BYTES. The fixture is deliberately small enough for a safe audit.
  const payload = 'A'.repeat(1_800_000);
  let page = 0;
  const transport = vi.fn(async (): Promise<HttpResponse> => {
    page += 1;
    return jsonResponse({
      Objects: [{ page, payload }],
      Next: page < 3 ? `/d2l/api/le/1.0/example/?bookmark=${page + 1}` : null,
    });
  });

  const result = await new BrightspaceClient(transport).paged('/d2l/api/le/1.0/example/');
  const retainedBytes = result.reduce((total, item) => total + Buffer.byteLength((item as { payload: string }).payload), 0);

  expect(transport).toHaveBeenCalledTimes(3);
  expect(result).toHaveLength(3);
  expect(retainedBytes).toBeGreaterThan(MAX_JSON_BYTES);
});
