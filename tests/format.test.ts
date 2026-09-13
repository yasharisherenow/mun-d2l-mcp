import { expect, it } from 'vitest';
import { publicLink, richText, timestamp } from '../src/tools/format.js';
it('uses Newfoundland winter and summer offsets, preserving the API timestamp', () => {
  const winter = timestamp('2026-01-15T12:00:00Z')!;
  const summer = timestamp('2026-07-15T12:00:00Z')!;
  expect(winter.original).toBe('2026-01-15T12:00:00Z');
  expect(winter.local).toContain('8:30:00');
  expect(summer.local).toContain('9:30:00');
  expect(timestamp(null)).toBeNull();
});
it('handles the spring clock transition', () => {
  expect(timestamp('2026-03-08T05:29:00Z')!.local).toContain('1:59:00');
  expect(timestamp('2026-03-08T05:30:00Z')!.local).toContain('3:00:00');
});
it('extracts readable HTML without scripts', () => {
  expect(richText({ Html: '<p>Due <b>Friday</b> &amp; Monday.</p><script>secret()</script>' })).toBe('Due Friday & Monday.');
});
  it('does not expose unsafe or credential-bearing links', () => {
  expect(publicLink('javascript:alert(1)')).toBeNull();
  expect(publicLink('https://example.com/?token=secret')).toBeNull();
  expect(publicLink('http://example.com/course')).toBeNull();
  expect(publicLink('https://localhost/private')).toBeNull();
  expect(publicLink('https://127.0.0.1/private')).toBeNull();
  expect(publicLink('https://192.168.1.2/private')).toBeNull();
  expect(publicLink('https://[fc00::1]/private')).toBeNull();
  expect(publicLink('https://[fe80::1]/private')).toBeNull();
  expect(publicLink('https://example.com/#access_token=secret')).toBeNull();
  expect(publicLink('/d2l/home')).toBe('https://online.mun.ca/d2l/home');
  });
