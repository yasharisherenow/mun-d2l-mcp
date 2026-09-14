import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Entry } from '@napi-rs/keyring';
import type { BrowserContext } from 'playwright';
import { z } from 'zod';
import { BASE_URL, sessionDirectory } from '../config.js';
import { AppError } from '../errors.js';

export type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;
export interface Session {
  origin: string;
  savedAt: string;
  state: StorageState;
  bearer?: string;
}
export interface KeyStore {
  getPassword(): string | null | undefined;
  setPassword(value: string): void;
  deletePassword(): void;
}
const envelope = z.object({ version: z.literal(1), iv: z.string(), tag: z.string(), data: z.string() });
const cookieSchema = z.object({
  name: z.string().min(1).max(1024), value: z.string().max(64 * 1024), domain: z.string().min(1).max(255),
  path: z.string().max(4096), expires: z.number(), httpOnly: z.boolean(), secure: z.boolean(), sameSite: z.enum(['Strict', 'Lax', 'None']),
});
const sessionSchema = z.object({
  origin: z.literal(BASE_URL), savedAt: z.iso.datetime({ offset: true }), bearer: z.string().min(1).max(64 * 1024).optional(),
  state: z.object({ cookies: z.array(cookieSchema).max(500), origins: z.array(z.unknown()).max(20) }),
});
const allowedCookie = (domain: string) => ['online.mun.ca', 'login.mun.ca'].includes(domain.replace(/^\./, '').toLowerCase());
function sanitizeSession(value: unknown): Session {
  const parsed = sessionSchema.parse(value);
  if (Date.parse(parsed.savedAt) > Date.now() + 10 * 60_000) throw new AppError('SESSION_UNREADABLE', 'Saved session timestamp is too far in the future.');
  return { origin: BASE_URL, savedAt: parsed.savedAt, bearer: parsed.bearer, state: { cookies: parsed.state.cookies.filter(cookie => allowedCookie(cookie.domain)), origins: [] } };
}

export class SessionStore {
  readonly file: string;
  readonly lockFile: string;
  constructor(
    readonly directory = sessionDirectory(),
    private readonly keys: KeyStore = new Entry('mun-d2l-mcp', BASE_URL),
  ) {
    this.file = join(directory, 'session.encrypted.json');
    this.lockFile = join(directory, 'session.lock');
  }

  async withLifecycleLock<T>(action: () => Promise<T>, timeoutMs = 11 * 60_000): Promise<T> {
    await mkdir(this.directory, { recursive: true });
    const deadline = Date.now() + timeoutMs;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    while (!handle) {
      try {
        handle = await open(this.lockFile, 'wx', 0o600);
        await handle.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new AppError('SESSION_LOCK_FAILED', 'Cannot lock the local session lifecycle.');
        try {
          const info = await stat(this.lockFile);
          if (Date.now() - info.mtimeMs > 15 * 60_000) {
            const staleFile = `${this.lockFile}.stale-${process.pid}-${randomBytes(8).toString('hex')}`;
            try {
              await rename(this.lockFile, staleFile);
              await rm(staleFile, { force: true });
            } catch (renameError) {
              if (!['ENOENT', 'EACCES', 'EPERM'].includes((renameError as NodeJS.ErrnoException).code ?? '')) {
                throw new AppError('SESSION_LOCK_FAILED', 'Cannot recover the local session lifecycle lock.');
              }
            }
            continue;
          }
        } catch (statError) {
          if ((statError as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw new AppError('SESSION_LOCK_FAILED', 'Cannot inspect the local session lifecycle lock.');
        }
        if (Date.now() >= deadline) throw new AppError('SESSION_BUSY', 'Another login, renewal, or logout operation is still running.');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    try { return await action(); }
    finally {
      await handle.close().catch(() => undefined);
      await rm(this.lockFile, { force: true }).catch(() => undefined);
    }
  }

  async save(session: Session): Promise<void> {
    let secret: string | null | undefined;
    try {
      secret = this.keys.getPassword();
      if (!secret) {
        secret = randomBytes(32).toString('base64');
        this.keys.setPassword(secret);
      }
    } catch { throw new AppError('KEYRING_UNAVAILABLE', 'Windows Credential Manager is unavailable. Session was not saved.'); }
    const key = Buffer.from(secret, 'base64');
    if (key.length !== 32) throw new AppError('KEYRING_INVALID', 'Session encryption key is invalid. Run logout, then login.');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(BASE_URL));
    const data = Buffer.concat([cipher.update(JSON.stringify(sanitizeSession(session)), 'utf8'), cipher.final()]);
    await mkdir(this.directory, { recursive: true });
    const temporary = join(this.directory, `session-${randomBytes(8).toString('hex')}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }), { flag: 'wx', mode: 0o600 });
      await rename(temporary, this.file);
    } finally { key.fill(0); await rm(temporary, { force: true }); }
  }

  async load(): Promise<Session | null> {
    let content: string;
    try { content = await readFile(this.file, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new AppError('SESSION_UNREADABLE', 'Cannot read the saved session.');
    }
    try {
      const secret = this.keys.getPassword();
      if (!secret) throw new Error('Missing key');
      if (content.length > 2 * 1024 * 1024) throw new Error('Oversized session envelope');
      const saved = envelope.parse(JSON.parse(content));
      const key = Buffer.from(secret, 'base64');
      const iv = Buffer.from(saved.iv, 'base64');
      const tag = Buffer.from(saved.tag, 'base64');
      if (key.length !== 32 || iv.length !== 12 || tag.length !== 16 || saved.data.length > 2 * 1024 * 1024) throw new Error('Invalid envelope');
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(Buffer.from(BASE_URL));
      decipher.setAuthTag(tag);
      try { return sanitizeSession(JSON.parse(Buffer.concat([decipher.update(Buffer.from(saved.data, 'base64')), decipher.final()]).toString('utf8'))); }
      finally { key.fill(0); }
    } catch { throw new AppError('SESSION_UNREADABLE', 'Cannot decrypt the session. Run logout, then login.'); }
  }

  async clear(): Promise<void> {
    await this.withLifecycleLock(async () => {
      await rm(this.file, { force: true });
      try { if (this.keys.getPassword()) this.keys.deletePassword(); }
      catch { throw new AppError('KEYRING_UNAVAILABLE', 'Session file removed; the encryption key could not be removed from Windows Credential Manager.'); }
    });
  }
}
