import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), recognize: vi.fn(), terminate: vi.fn(), createWorker: vi.fn() }));
vi.mock('node:fs/promises', () => ({ access: mocks.access }));
vi.mock('tesseract.js', () => ({
  OEM: { LSTM_ONLY: 1 }, PSM: { AUTO: 3 }, createWorker: mocks.createWorker,
}));
import { LocalOcr } from '../src/tools/ocr.js';
afterEach(() => vi.resetAllMocks());
describe('OCR failure redaction', () => {
  it('reports a missing model without downloading replacements or exposing paths', async () => {
    mocks.access.mockRejectedValue(new Error('PRIVATE sensitive path'));
    const engine = new LocalOcr();
    await expect(engine.recognize(Buffer.from('image'))).rejects.toMatchObject({ code: 'OCR_UNAVAILABLE' });
    expect(mocks.createWorker).not.toHaveBeenCalled(); await engine.close();
  });
  it('redacts engine failures and terminates the local engine', async () => {
    mocks.access.mockResolvedValue(undefined);
    mocks.createWorker.mockResolvedValue({ recognize: mocks.recognize, terminate: mocks.terminate, setParameters: vi.fn() });
    mocks.recognize.mockRejectedValue(new Error('PRIVATE image details'));
    const engine = new LocalOcr();
    await expect(engine.recognize(Buffer.from('image'))).rejects.toMatchObject({ code: 'EXTRACTION_FAILED', message: 'The image could not be read safely by local OCR.' });
    expect(mocks.createWorker.mock.calls[0]![2]).toMatchObject({ cacheMethod: 'none' });
    expect(mocks.createWorker.mock.calls[0]![2].langPath).not.toMatch(/^https?:/);
    await engine.close(); expect(mocks.terminate).toHaveBeenCalledOnce();
  });
});
