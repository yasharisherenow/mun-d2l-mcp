import { join } from 'node:path';
import { AppError } from './errors.js';

export const BASE_URL = 'https://online.mun.ca';
export const TIME_ZONE = 'America/St_Johns';
export const DEFAULT_SESSION_HOURS = 4;

/** Local interval for proactive silent renewal. Zero disables proactive renewal. */
export function sessionHours(value = process.env.MUN_D2L_SESSION_HOURS): number {
  if (value === undefined || value.trim() === '') return DEFAULT_SESSION_HOURS;
  const parsed = Number(value);
  if (parsed === 0) return 0;
  if (!Number.isFinite(parsed) || parsed < 0.25 || parsed > 168) {
    throw new AppError('INVALID_CONFIG', 'MUN_D2L_SESSION_HOURS must be 0 or a number from 0.25 to 168.');
  }
  return parsed;
}
export function sessionDirectory(): string {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) {
    throw new AppError('PLATFORM_UNSUPPORTED', 'This version requires Windows and Windows Credential Manager.');
  }
  return join(process.env.LOCALAPPDATA, 'mun-d2l-mcp');
}
