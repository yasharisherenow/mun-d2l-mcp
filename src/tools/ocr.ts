import { createRequire } from 'node:module';
import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import { AppError } from '../errors.js';

export const MAX_OCR_PAGES = 5;
export const MAX_IMAGE_PIXELS = 8_000_000;
export const MAX_IMAGE_DIMENSION = 5000;
export const OCR_NOTICE = 'Local English OCR can misread words, numbers, formulas and handwriting. Verify important details against the source.';
export interface OcrMetadata {
  language: 'eng';
  pages: number[];
  skipped_pages: number[];
  confidence: number | null;
}
export function checkPixels(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new AppError('EXTRACTION_FAILED', 'The image dimensions are invalid.');
  }
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || width * height > MAX_IMAGE_PIXELS) {
    throw new AppError('EXTRACTION_LIMIT', 'OCR images are limited to 8 million pixels and 5000 pixels per side.');
  }
}
// Read dimensions before any native image decoder can allocate a full raster.
export function imageDimensions(body: Buffer): { width: number; height: number } {
  if (body.length >= 33 && body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && body.toString('ascii', 12, 16) === 'IHDR') {
    return { width: body.readUInt32BE(16), height: body.readUInt32BE(20) };
  }
  if (body[0] === 0xff && body[1] === 0xd8) {
    let offset = 2;
    while (offset < body.length) {
      if (body[offset++] !== 0xff) break;
      while (body[offset] === 0xff) ++offset;
      const marker = body[offset++];
      if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > body.length) break;
      const length = body.readUInt16BE(offset);
      if (length < 2 || offset + length > body.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
        return { width: body.readUInt16BE(offset + 5), height: body.readUInt16BE(offset + 3) };
      }
      offset += length;
    }
  }
  throw new AppError('UNSUPPORTED_FILE', 'OCR supports valid PNG and baseline/progressive JPEG images only.');
}
export class LocalOcr {
  private worker: Worker | undefined;
  async recognize(image: Buffer): Promise<{ text: string; confidence: number }> {
    if (!this.worker) {
      try {
        const require = createRequire(import.meta.url);
        const langPath = join(dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');
        await access(join(langPath, 'eng.traineddata.gz'));
        // An explicit local langPath prevents CDN fallback; no disk cache is written.
        this.worker = await createWorker('eng', OEM.LSTM_ONLY, {
          langPath, cacheMethod: 'none', gzip: true, logger: () => {}, errorHandler: () => {},
        });
        await this.worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, user_defined_dpi: '150' });
      } catch { throw new AppError('OCR_UNAVAILABLE', 'Local OCR could not initialize. Reinstall dependencies and rebuild, then restart the MCP connection.'); }
    }
    try {
      const { data } = await this.worker.recognize(image, {}, { text: true });
      return { text: data.text, confidence: data.confidence };
    } catch { throw new AppError('EXTRACTION_FAILED', 'The image could not be read safely by local OCR.'); }
  }
  async close(): Promise<void> { await this.worker?.terminate(); this.worker = undefined; }
}
