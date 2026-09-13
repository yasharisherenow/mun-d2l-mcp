import { convert } from 'html-to-text';
import { BASE_URL, TIME_ZONE } from '../config.js';

export function richText(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const rich = value as { Text?: unknown; Html?: unknown };
  const limit = 100_000;
  if (typeof rich.Text === 'string' && rich.Text.trim()) return rich.Text.slice(0, limit);
  if (typeof rich.Html === 'string' && rich.Html.trim()) return convert(rich.Html.slice(0, 500_000), {
    wordwrap: false, selectors: [{ selector: 'img', format: 'skip' }, { selector: 'script', format: 'skip' }, { selector: 'style', format: 'skip' }],
  }).slice(0, limit);
  return null;
}

export function timestamp(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { original: value, local: null, timeZone: TIME_ZONE };
  return {
    original: value,
    local: new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, dateStyle: 'medium', timeStyle: 'long' }).format(date),
    timeZone: TIME_ZONE,
  };
}
export const courseLink = (id: number) => `${BASE_URL}/d2l/home/${id}`;
export const topicLink = (courseId: number, topicId: number) => `${BASE_URL}/d2l/le/content/${courseId}/viewContent/${topicId}/View`;
export const assignmentLink = (courseId: number, id: number) => `${BASE_URL}/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${id}&ou=${courseId}`;

export function publicLink(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, BASE_URL);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '::1' || hostname === '0:0:0:0:0:0:0:1') return null;
    if (/^(?:fc|fd)[0-9a-f]{2}:/.test(hostname) || /^fe[89ab][0-9a-f]:/.test(hostname)) return null;
    const octets = hostname.split('.').map(Number);
    if (octets.length === 4 && octets.every(part => Number.isInteger(part) && part >= 0 && part <= 255)) {
      const [a, b] = octets as [number, number, number, number];
      if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return null;
    }
    for (const key of url.searchParams.keys()) if (/token|secret|signature|password|auth|session/i.test(key)) return null;
    if (/token|secret|signature|password|auth|session/i.test(url.hash)) return null;
    return url.href;
  } catch { return null; }
}
