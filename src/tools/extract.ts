import { Worker } from 'node:worker_threads';
import { AppError } from '../errors.js';

export interface ExtractedDocument {
  text: string;
  pages: number | null;
  pageOffsets: number[] | null;
  truncated: boolean;
}

export async function extractDocument(body: Buffer, mime: string): Promise<ExtractedDocument> {
  if (['text/plain', 'text/markdown', 'text/csv'].includes(mime)) {
    const decoded = body.toString('utf8');
    return { text: decoded.slice(0, 2_000_000), pages: null, pageOffsets: null, truncated: decoded.length > 2_000_000 };
  }
  if (body.subarray(0, 5).toString() !== '%PDF-' && !['text/html', 'application/xhtml+xml'].includes(mime)) {
    throw new AppError('UNSUPPORTED_FILE', 'This material is not readable text or PDF. Open its source link in Brightspace.');
  }
  if (['text/html', 'application/xhtml+xml'].includes(mime) && /\/d2l\/login|<title>[^<]*login/i.test(body.toString('utf8', 0, Math.min(body.length, 100_000)))) {
    throw new AppError('AUTH_REQUIRED', 'Brightspace returned a login page. Run npm run login.');
  }
  const worker = new Worker(new URL('./document-worker.js', import.meta.url), {
    execArgv: process.execArgv.filter(argument => !argument.startsWith('--input-type')),
    resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
  });
  const bytes = Uint8Array.from(body);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new AppError('EXTRACTION_LIMIT', 'Document extraction exceeded its 15-second safety limit. Open the source in Brightspace.'));
    }, 15_000);
    const finish = () => clearTimeout(timer);
    worker.once('message', (message: { ok: boolean; result?: ExtractedDocument; code?: string; message?: string }) => {
      finish();
      void worker.terminate();
      if (message.ok && message.result) resolve(message.result);
      else reject(new AppError(message.code ?? 'UNSUPPORTED_FILE', message.message ?? 'The document could not be read safely.'));
    });
    worker.once('error', () => {
      finish();
      reject(new AppError('EXTRACTION_LIMIT', 'Document extraction failed inside its isolated worker. Open the source in Brightspace.'));
    });
    worker.postMessage({ bytes, mime }, [bytes.buffer]);
  });
}
