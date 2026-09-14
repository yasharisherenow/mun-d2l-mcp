import { AppError } from './errors.js';

export class BoundedSemaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number, private readonly maxQueue: number, private readonly label: string) {
    if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(maxQueue) || maxQueue < 0) throw new Error('Invalid semaphore limits');
  }

  async run<T>(action: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      if (this.waiters.length >= this.maxQueue) throw new AppError('RESOURCE_LIMIT', `${this.label} is busy. Retry after another operation finishes.`);
      await new Promise<void>(resolve => this.waiters.push(resolve));
    } else {
      this.active++;
    }
    try { return await action(); }
    finally {
      const next = this.waiters.shift();
      if (next) next();
      else this.active--;
    }
  }
}
