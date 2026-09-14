import { expect, it } from 'vitest';
import { BoundedSemaphore } from '../src/concurrency.js';

it('bounds active work and rejects calls beyond the queue ceiling', async () => {
  const semaphore = new BoundedSemaphore(1, 1, 'Test capacity');
  let release!: () => void;
  const first = semaphore.run(() => new Promise<void>(resolve => { release = resolve; }));
  const second = semaphore.run(async () => 'second');
  await expect(semaphore.run(async () => 'third')).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
  release();
  await first;
  await expect(second).resolves.toBe('second');
});
