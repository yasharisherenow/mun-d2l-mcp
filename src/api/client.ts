import type { APIRequestContext } from 'playwright';
import { z } from 'zod';
import { BASE_URL } from '../config.js';
import { AppError } from '../errors.js';
import type { AuthDeadline } from '../auth/deadline.js';

export interface HttpResponse { status: number; headers: Record<string, string>; body: Buffer }
export type Transport = (url: string, headers: Record<string, string>) => Promise<HttpResponse>;
export const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
export const MAX_JSON_BYTES = 5 * 1024 * 1024;
export const MAX_PAGED_BYTES = 20 * 1024 * 1024;
export const MAX_PAGED_ITEMS = 10_000;
export const playwrightTransport = (context: APIRequestContext, deadline?: AuthDeadline): Transport => async (url, headers) => {
  deadline?.check();
  const response = await context.get(url, { headers: { ...headers, 'Accept-Encoding': 'identity' }, maxRedirects: 0, timeout: deadline?.remaining(20_000) ?? 20_000, failOnStatusCode: false });
  try {
    const responseHeaders = response.headers();
    const lengthHeader = responseHeaders['content-length'];
    if (!lengthHeader || !/^\d+$/.test(lengthHeader)) throw new AppError('RESPONSE_SIZE_UNKNOWN', 'Brightspace did not provide a safe response length. The body was not buffered.');
    const encoding = responseHeaders['content-encoding'];
    if (encoding && encoding.toLowerCase() !== 'identity') throw new AppError('RESPONSE_ENCODING_BLOCKED', 'Brightspace returned compressed content despite the identity request. The body was not buffered.');
    const declared = Number(lengthHeader);
    if (!Number.isSafeInteger(declared) || declared > MAX_RESPONSE_BYTES) throw new AppError('RESPONSE_TOO_LARGE', 'Brightspace returned a response larger than the safety limit.');
    const body = await response.body();
    if (body.length > MAX_RESPONSE_BYTES) throw new AppError('RESPONSE_TOO_LARGE', 'Brightspace returned a response larger than the safety limit.');
    return { status: response.status(), headers: responseHeaders, body };
  }
  finally { await response.dispose(); }
};
const versionsSchema = z.array(z.object({ ProductCode: z.string(), LatestVersion: z.string().regex(/^\d+\.\d+$/), SupportedVersions: z.array(z.string()) }));
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export class BrightspaceClient {
  private versions?: Record<string, string>;
  constructor(private readonly transport: Transport, private readonly bearer?: string, private readonly sleep = wait) {}

  async get(path: string): Promise<HttpResponse> {
    const url = new URL(path, BASE_URL);
    if (url.origin !== BASE_URL || url.username || url.password || !url.pathname.startsWith('/d2l/')) {
      throw new AppError('URL_BLOCKED', 'Authenticated requests must stay on the configured Brightspace origin.');
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: HttpResponse;
      try { response = await this.transport(url.href, this.bearer ? { Authorization: `Bearer ${this.bearer}` } : {}); }
      catch (error) {
        if (error instanceof AppError) throw error;
        if (attempt < 2) { await this.sleep(500 * 2 ** attempt); continue; }
        throw new AppError('NETWORK_ERROR', 'Brightspace could not be reached. Retry later; your saved session was preserved.');
      }
      if (response.status === 429 || response.status >= 500) {
        const header = response.headers['retry-after'];
        const retry = header ? (/^\d+(\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now()) : 500 * 2 ** attempt;
        if (attempt < 2 && Number.isFinite(retry) && retry <= 10_000) { await this.sleep(Math.max(0, retry)); continue; }
        throw new AppError(response.status === 429 ? 'RATE_LIMITED' : 'SERVICE_UNAVAILABLE', 'Brightspace is temporarily unavailable or rate limited. Retry later; your saved session was preserved.');
      }
      if (response.status === 401 || (response.status === 403 && /not authenticated|invalid token/i.test(response.body.toString('utf8')))) throw new AppError('AUTH_REQUIRED', 'Your Brightspace session expired. Run npm run login in the project folder.');
      if (response.status === 403) throw new AppError('PERMISSION_DENIED', 'Brightspace denied access to this resource. It may be unavailable to your student account.');
      if (response.status === 404) throw new AppError('NOT_FOUND', 'The requested Brightspace resource was not found.');
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.location ?? '';
        if (/login|saml|cas\//i.test(location)) throw new AppError('AUTH_REQUIRED', 'Brightspace requires sign-in. Run npm run login in the project folder.');
        throw new AppError('REDIRECT_BLOCKED', 'Brightspace redirected this request. Redirects are not followed with credentials.');
      }
      if (response.status < 200 || response.status >= 300) throw new AppError('API_ERROR', `Brightspace returned HTTP ${response.status}.`);
      return response;
    }
    throw new AppError('API_ERROR', 'Request did not complete.');
  }

  private parseJson(response: HttpResponse): unknown {
    if (response.body.length > MAX_JSON_BYTES) throw new AppError('RESPONSE_TOO_LARGE', 'Brightspace returned too much JSON data for one response.');
    if (!/json/i.test(response.headers['content-type'] ?? '')) {
      if (/login|not authenticated|sessionExpired/i.test(response.body.toString('utf8'))) throw new AppError('AUTH_REQUIRED', 'Brightspace requires sign-in. Run npm run login in the project folder.');
      throw new AppError('INVALID_RESPONSE', 'Brightspace returned an unexpected response instead of JSON.');
    }
    try { return JSON.parse(response.body.toString('utf8')); }
    catch { throw new AppError('INVALID_RESPONSE', 'Brightspace returned invalid JSON.'); }
  }

  async json(path: string): Promise<unknown> {
    return this.parseJson(await this.get(path));
  }

  async route(product: 'lp' | 'le', suffix: string): Promise<string> {
    if (!this.versions) {
      const result = versionsSchema.safeParse(await this.json('/d2l/api/versions/'));
      if (!result.success) throw new AppError('INVALID_RESPONSE', 'Brightspace API version discovery returned an unexpected format.');
      this.versions = Object.fromEntries(result.data.map(item => [item.ProductCode, item.LatestVersion]));
    }
    const version = this.versions[product];
    if (!version) throw new AppError('API_UNSUPPORTED', `Brightspace does not advertise the ${product} API.`);
    return `/d2l/api/${product}/${version}/${suffix}`;
  }

  async apiVersions(): Promise<Record<string, string>> {
    await this.route('lp', 'users/whoami');
    return { ...this.versions };
  }

  async paged(path: string): Promise<unknown[]> {
    const items: unknown[] = [];
    const seen = new Set<string>();
    let acceptedBytes = 0;
    let current = path;
    for (let page = 0; page < 100; page++) {
      const response = await this.get(current);
      if (acceptedBytes + response.body.length > MAX_PAGED_BYTES) throw new AppError('PAGINATION_LIMIT', 'Brightspace pagination exceeded the cumulative response byte limit. Narrow the request and try again.');
      acceptedBytes += response.body.length;
      const value = this.parseJson(response);
      if (Array.isArray(value)) {
        if (items.length + value.length > MAX_PAGED_ITEMS) throw new AppError('PAGINATION_LIMIT', 'Brightspace returned too many items for one operation.');
        return [...items, ...value];
      }
      const objectPage = z.object({ Objects: z.array(z.unknown()), Next: z.string().nullable() }).safeParse(value);
      if (objectPage.success) {
        if (items.length + objectPage.data.Objects.length > MAX_PAGED_ITEMS) throw new AppError('PAGINATION_LIMIT', 'Brightspace returned too many items for one operation.');
        items.push(...objectPage.data.Objects);
        if (objectPage.data.Next === null) return items;
        const next = new URL(objectPage.data.Next, new URL(current, BASE_URL));
        const original = new URL(path, BASE_URL);
        if (next.origin !== original.origin || next.pathname !== original.pathname || next.username || next.password) throw new AppError('URL_BLOCKED', 'Pagination attempted to leave the requested Brightspace resource.');
        for (const key of new Set(original.searchParams.keys())) {
          if (key !== 'bookmark' && original.searchParams.getAll(key).join('\0') !== next.searchParams.getAll(key).join('\0')) throw new AppError('URL_BLOCKED', 'Pagination attempted to alter the original query scope.');
        }
        if (seen.has(next.href)) throw new AppError('PAGINATION_ERROR', 'Brightspace pagination did not advance.');
        seen.add(next.href);
        current = next.href;
        continue;
      }
      const parsed = z.object({ Items: z.array(z.unknown()), PagingInfo: z.object({ HasMoreItems: z.boolean(), Bookmark: z.string().nullable().optional() }) }).safeParse(value);
      if (!parsed.success) throw new AppError('INVALID_RESPONSE', 'Brightspace returned an unexpected page format.');
      if (items.length + parsed.data.Items.length > MAX_PAGED_ITEMS) throw new AppError('PAGINATION_LIMIT', 'Brightspace returned too many items for one operation.');
      items.push(...parsed.data.Items);
      if (!parsed.data.PagingInfo.HasMoreItems) return items;
      const bookmark = parsed.data.PagingInfo.Bookmark;
      if (!bookmark || seen.has(bookmark)) throw new AppError('PAGINATION_ERROR', 'Brightspace pagination did not advance. Results would be incomplete.');
      seen.add(bookmark);
      const next = new URL(path, BASE_URL);
      next.searchParams.set('bookmark', bookmark);
      current = next.href;
    }
    throw new AppError('PAGINATION_LIMIT', 'Too many pages to return a complete result.');
  }

  async identity(): Promise<{ Identifier: string | number }> {
    const parsed = z.object({ Identifier: z.union([z.string().min(1), z.number()]) }).safeParse(await this.json(await this.route('lp', 'users/whoami')));
    if (!parsed.success) throw new AppError('INVALID_RESPONSE', 'Could not verify the authenticated Brightspace identity.');
    return parsed.data;
  }

  async courses(): Promise<unknown[]> {
    return this.paged(await this.route('lp', 'enrollments/myenrollments/?orgUnitTypeId=3'));
  }
}
