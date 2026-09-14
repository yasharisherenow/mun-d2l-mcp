import { describe, expect, it, vi } from 'vitest';
import { BrightspaceClient, MAX_JSON_BYTES, MAX_PAGED_BYTES, MAX_PAGED_ITEMS, MAX_RESPONSE_BYTES, playwrightTransport, type HttpResponse } from '../src/api/client.js';

const response = (value: unknown, status = 200, headers = {}): HttpResponse => ({ status, headers: { 'content-type': 'application/json', ...headers }, body: Buffer.from(JSON.stringify(value)) });
describe('Brightspace client', () => {
  it('rejects an oversized declared body before Playwright buffers it', async () => {
    const body = vi.fn();
    const dispose = vi.fn();
    const context = { get: vi.fn().mockResolvedValue({ status: () => 200, headers: () => ({ 'content-length': String(MAX_RESPONSE_BYTES + 1) }), body, dispose }) };
    await expect(playwrightTransport(context as never)('https://online.mun.ca/d2l/api/test', {})).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
    expect(body).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalled();
  });
  it('rejects an unknown-length body before Playwright buffers it', async () => {
    const body = vi.fn();
    const dispose = vi.fn();
    const context = { get: vi.fn().mockResolvedValue({ status: () => 200, headers: () => ({}), body, dispose }) };
    await expect(playwrightTransport(context as never)('https://online.mun.ca/d2l/api/test', {})).rejects.toMatchObject({ code: 'RESPONSE_SIZE_UNKNOWN' });
    expect(body).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalled();
  });
  it('supports ObjectListPage next links', async () => {
    const transport = vi.fn().mockResolvedValueOnce(response({ Objects: [1], Next: '/d2l/api/quizzes/?bookmark=2' })).mockResolvedValueOnce(response({ Objects: [2], Next: null }));
    expect(await new BrightspaceClient(transport).paged('/d2l/api/quizzes/')).toEqual([1, 2]);
  });
  it.each(['https://evil.example/d2l/api/quizzes/', '/d2l/api/roster/'])('rejects next links leaving the requested resource: %s', async next => {
    const transport = vi.fn().mockResolvedValue(response({ Objects: [], Next: next }));
    await expect(new BrightspaceClient(transport).paged('/d2l/api/quizzes/')).rejects.toMatchObject({ code: 'URL_BLOCKED' });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('rejects next links that remove the original query scope', async () => {
    const transport = vi.fn().mockResolvedValue(response({ Objects: [], Next: '/d2l/api/quizzes/?bookmark=2' }));
    await expect(new BrightspaceClient(transport).paged('/d2l/api/quizzes/?orgUnitId=7')).rejects.toMatchObject({ code: 'URL_BLOCKED' });
  });
  it('discovers tenant versions', async () => {
    const transport = vi.fn().mockResolvedValue(response([{ ProductCode: 'lp', LatestVersion: '1.63', SupportedVersions: ['1.63'] }]));
    const client = new BrightspaceClient(transport);
    expect(await client.route('lp', 'users/whoami')).toBe('/d2l/api/lp/1.63/users/whoami');
    await client.route('lp', 'users/whoami');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('follows bookmarks without losing the original filters', async () => {
    const transport = vi.fn().mockResolvedValueOnce(response({ Items: [1], PagingInfo: { HasMoreItems: true, Bookmark: 'a & b' } })).mockResolvedValueOnce(response({ Items: [2], PagingInfo: { HasMoreItems: false } }));
    expect(await new BrightspaceClient(transport).paged('/d2l/api/lp/1.63/enrollments/myenrollments/?orgUnitTypeId=3')).toEqual([1, 2]);
    const second = new URL(transport.mock.calls[1]![0]);
    expect(second.searchParams.get('bookmark')).toBe('a & b');
    expect(second.searchParams.get('orgUnitTypeId')).toBe('3');
  });
  it('rejects repeated bookmarks instead of silently truncating', async () => {
    const transport = vi.fn().mockResolvedValue(response({ Items: [], PagingInfo: { HasMoreItems: true, Bookmark: 'same' } }));
    await expect(new BrightspaceClient(transport).paged('/d2l/api/test')).rejects.toMatchObject({ code: 'PAGINATION_ERROR' });
  });
  it.each(['https://example.com/d2l/api/test', '//example.com/d2l/api/test', 'https://user:pass@online.mun.ca/d2l/api/test', '/logout'])('blocks credentials to %s', async path => {
    const transport = vi.fn();
    await expect(new BrightspaceClient(transport, 'secret').get(path)).rejects.toMatchObject({ code: 'URL_BLOCKED' });
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([[401, 'AUTH_REQUIRED'], [403, 'PERMISSION_DENIED'], [404, 'NOT_FOUND']])('distinguishes HTTP %s', async (status, code) => {
    await expect(new BrightspaceClient(vi.fn().mockResolvedValue(response({}, status as number))).json('/d2l/api/test')).rejects.toMatchObject({ code });
  });
  it('does not follow redirects', async () => {
    const transport = vi.fn().mockResolvedValue(response({}, 302, { location: 'https://example.com/file' }));
    await expect(new BrightspaceClient(transport, 'secret').get('/d2l/api/test')).rejects.toMatchObject({ code: 'REDIRECT_BLOCKED' });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('honors retry-after with bounded retries', async () => {
    const transport = vi.fn().mockResolvedValueOnce(response({}, 429, { 'retry-after': '2' })).mockResolvedValue(response({ ok: true }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(new BrightspaceClient(transport, undefined, sleep).json('/d2l/api/test')).resolves.toEqual({ ok: true });
    expect(sleep).toHaveBeenCalledWith(2000);
  });
  it('reports long retry-after immediately without retrying early', async () => {
    const sleep = vi.fn();
    await expect(new BrightspaceClient(vi.fn().mockResolvedValue(response({}, 429, { 'retry-after': '120' })), undefined, sleep).get('/d2l/api/test')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(sleep).not.toHaveBeenCalled();
  });
  it('redacts network errors and stops after three attempts', async () => {
    const transport = vi.fn().mockRejectedValue(new Error('Authorization: SECRET'));
    await expect(new BrightspaceClient(transport, undefined, async () => {}).get('/d2l/api/test')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(transport).toHaveBeenCalledTimes(3);
  });
  it('rejects JSON responses over the byte budget', async () => {
    const oversized: HttpResponse = { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.alloc(MAX_JSON_BYTES + 1, 0x20) };
    await expect(new BrightspaceClient(vi.fn().mockResolvedValue(oversized)).json('/d2l/api/test')).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
  });
  it('rejects aggregate pagination over the item budget', async () => {
    const values = Array.from({ length: MAX_PAGED_ITEMS + 1 }, (_, index) => index);
    await expect(new BrightspaceClient(vi.fn().mockResolvedValue(response(values))).paged('/d2l/api/test')).rejects.toMatchObject({ code: 'PAGINATION_LIMIT' });
  });
  it('rejects pagination before cumulative response bytes exceed the operation budget', async () => {
    const chunk = 'x'.repeat(Math.floor(MAX_PAGED_BYTES / 5));
    let page = 0;
    const transport = vi.fn(async () => response({ Objects: [{ chunk }], Next: page++ < 5 ? `/d2l/api/test?bookmark=${page}` : null }));
    await expect(new BrightspaceClient(transport).paged('/d2l/api/test')).rejects.toMatchObject({ code: 'PAGINATION_LIMIT' });
    expect(transport).toHaveBeenCalledTimes(5);
  });
});
