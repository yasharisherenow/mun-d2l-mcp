import { AppError } from '../errors.js';

export const AUTH_BUDGET_MS = 40_000;
export const RENEW_BUDGET_MS = 120_000;
export const SESSION_LOCK_WAIT_MS = 5_000;

/** Cooperative deadline: closes owned I/O and fences subsequent work on expiry. */
export class AuthDeadline {
  private readonly expires: number;
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  constructor(ms: number) {
    this.expires = performance.now() + ms;
    this.timer = setTimeout(() => this.cancel(), ms);
  }
  private error() { return new AppError('AUTH_TIMEOUT', 'Authentication took too long. Run npm run renew locally, then retry.'); }
  cancel() { this.controller.abort(); }
  check = () => {
    if (this.controller.signal.aborted || performance.now() >= this.expires) {
      this.cancel();
      throw this.error();
    }
  };
  remaining(max = Infinity) { this.check(); return Math.max(1, Math.min(max, this.expires - performance.now())); }
  onCancel(cleanup: () => void) {
    if (this.controller.signal.aborted) cleanup();
    else this.controller.signal.addEventListener('abort', cleanup, { once: true });
    return () => this.controller.signal.removeEventListener('abort', cleanup);
  }
  async run<T>(work: () => Promise<T>, disposeLate?: (value: T) => Promise<unknown>): Promise<T> {
    this.check();
    return new Promise<T>((resolve, reject) => {
      const remove = this.onCancel(() => reject(this.error()));
      Promise.resolve().then(() => { this.check(); return work(); }).then(async value => {
        remove();
        try { this.check(); resolve(value); }
        catch (error) { await disposeLate?.(value).catch(() => undefined); reject(error); }
      }, error => {
        remove();
        try { this.check(); reject(error); } catch (timeout) { reject(timeout); }
      }).catch(reject);
    });
  }
  sleep = async (ms: number) => {
    this.check();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await this.run(() => new Promise<void>(resolve => { timer = setTimeout(resolve, Math.min(ms, this.remaining())); })); }
    finally { clearTimeout(timer); }
    this.check();
  };
  dispose() { clearTimeout(this.timer); }
}
