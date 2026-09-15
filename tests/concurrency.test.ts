import { expect, it, vi } from 'vitest';
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

it('removes timed-out queue waiters without leaking or stealing a slot', async () => {
  vi.useFakeTimers();
  try {
    const semaphore = new BoundedSemaphore(1, 1, 'Test', 5_000);
    let release!: () => void;
    const first = semaphore.run(() => new Promise<void>(resolve => { release = resolve; }));
    const expiredAction = vi.fn();
    const expired = expect(semaphore.run(expiredAction)).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
    await vi.advanceTimersByTimeAsync(5_000); await expired;
    const next = semaphore.run(async () => 'next');
    release(); await first;
    await expect(next).resolves.toBe('next');
    await expect(semaphore.run(async () => 'last')).resolves.toBe('last');
    expect(expiredAction).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
