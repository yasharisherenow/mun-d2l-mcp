import { afterEach, expect, it } from 'vitest';
import { DEFAULT_SESSION_HOURS, sessionHours } from '../src/config.js';

afterEach(() => { delete process.env.MUN_D2L_SESSION_HOURS; });
it('defaults proactive session renewal to four hours', () => {
  expect(DEFAULT_SESSION_HOURS).toBe(4);
  expect(sessionHours()).toBe(4);
});
it.each([['8', 8], ['0.5', 0.5], ['168', 168], ['0', 0]])('accepts configurable hours %s', (input, expected) => {
  expect(sessionHours(input)).toBe(expected);
});
it.each(['nope', '-1', '0.1', '169', 'Infinity'])('rejects invalid session hours %s', input => {
  expect(() => sessionHours(input)).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }));
});
