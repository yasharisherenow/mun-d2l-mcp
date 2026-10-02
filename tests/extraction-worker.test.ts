import { describe, expect, it, vi } from 'vitest';
const behavior = vi.hoisted(() => ({ mode: 'error' }));
vi.mock('node:worker_threads', async () => {
  const { EventEmitter } = await import('node:events');
  return { Worker: class extends EventEmitter {
    terminate = vi.fn(async () => 0);
    postMessage() {
      queueMicrotask(() => {
        if (behavior.mode === 'error') this.emit('error', new Error('PRIVATE DOCUMENT CONTENT'));
        if (behavior.mode === 'exit') this.emit('exit', 0);
      });
    }
  } };
});
import { extractDocument } from '../src/tools/extract.js';

describe('document worker failure handling', () => {
  it.each(['error', 'exit'])('rejects worker %s without leaking content or occupying a slot', async mode => {
    behavior.mode = mode;
    for (let i = 0; i < 3; i++) {
      await expect(extractDocument(Buffer.from('<p>private</p>'), 'text/html')).rejects.toMatchObject({ code: 'EXTRACTION_LIMIT' });
    }
    await expect(extractDocument(Buffer.from('<p>private</p>'), 'text/html')).rejects.not.toThrow('PRIVATE');
  });
  it('terminates and rejects a non-responsive worker at the existing deadline', async () => {
    vi.useFakeTimers(); behavior.mode = 'timeout';
    try {
      const rejection = expect(extractDocument(Buffer.from('<p>private</p>'), 'text/html')).rejects.toMatchObject({ code: 'EXTRACTION_LIMIT' });
      await vi.advanceTimersByTimeAsync(15_001);
      await rejection;
    } finally { vi.useRealTimers(); }
  });
});
