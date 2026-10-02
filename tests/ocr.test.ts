import { describe, expect, it } from 'vitest';
import { extractDocument } from '../dist/tools/extract.js';
import { imageDimensions, checkPixels } from '../src/tools/ocr.js';
import { scanPdf, textImage } from './ocr-fixtures.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

describe('local OCR', () => {
  it('works with network disabled in the process and nested workers, without protocol diagnostics', () => {
    const hook = fileURLToPath(new URL('./no-network.cjs', import.meta.url));
    const root = fileURLToPath(new URL('..', import.meta.url));
    const result = spawnSync(process.execPath, ['--require', hook, '--input-type=module', '-e',
      "import {extractDocument} from './dist/tools/extract.js';let bytes=[];for await (const chunk of process.stdin)bytes.push(chunk);console.log(JSON.stringify(await extractDocument(Buffer.concat(bytes),'image/png')));"], {
      cwd: root, input: textImage().toBuffer('image/png'), encoding: 'utf8', timeout: 20_000, windowsHide: true,
    });
    expect(result.status).toBe(0); expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout).text).toContain('MUN COURSE OCR 12345');
  }, 25_000);
  it.each(['image/png', 'image/jpeg', 'application/octet-stream'])('recognizes image text served as %s', async mime => {
    const canvas = textImage();
    const bytes = mime === 'image/jpeg' ? canvas.toBuffer('image/jpeg', 95) : canvas.toBuffer('image/png');
    const result = await extractDocument(bytes, mime);
    expect(result.text).toContain('MUN COURSE OCR 12345');
    expect(result.ocr).toMatchObject({ language: 'eng', pages: [1], skipped_pages: [] });
    expect(result.ocr!.confidence).toBeGreaterThan(50); expect(result.pages).toBeNull();
  }, 20_000);
  it('OCRs only scanned pages in a mixed PDF and preserves page offsets', async () => {
    const result = await extractDocument(scanPdf(['text', 'scan', 'text']), 'application/pdf');
    expect(result.pages).toBe(3);
    expect(result.ocr?.pages).toEqual([2]);
    expect(result.text).toContain('MUN COURSE OCR 12345');
    expect(result.pageOffsets).toHaveLength(3);
    expect(result.text.slice(result.pageOffsets![1], result.pageOffsets![2])).toContain('OCR 12345');
  }, 20_000);
  it('keeps selectable-text PDFs on the existing extraction path', async () => {
    const result = await extractDocument(scanPdf(['text']), 'application/pdf');
    expect(result.text).toContain('Selectable course text'); expect(result.ocr).toBeNull();
  });
  it('labels incomplete OCR coverage after five pages', async () => {
    const result = await extractDocument(scanPdf(['scan', 'scan', 'scan', 'scan', 'scan', 'scan', 'text']), 'application/pdf');
    expect(result.ocr?.pages).toEqual([1, 2, 3, 4, 5]);
    expect(result.ocr?.skipped_pages).toEqual([6]); expect(result.truncated).toBe(true);
    expect(result.text.slice(result.pageOffsets![6])).toContain('Selectable course text');
  }, 20_000);
  it('returns empty text for blank image pages, without inventing words', async () => {
    const result = await extractDocument(textImage('').toBuffer('image/png'), 'image/png');
    expect(result.text.trim()).toBe(''); expect(result.ocr?.pages).toEqual([1]);
  }, 20_000);
  it('rejects oversized dimensions before decoding, corrupt files, and unsupported images', async () => {
    const body = textImage().toBuffer('image/png'); body.writeUInt32BE(50_000, 16);
    await expect(extractDocument(body, 'image/png')).rejects.toMatchObject({ code: 'EXTRACTION_LIMIT' });
    await expect(extractDocument(Buffer.from('PRIVATE bad image'), 'image/png')).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE' });
    await expect(extractDocument(Buffer.from('GIF89a'), 'image/gif')).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE' });
    expect(() => checkPixels(4000, 4000)).toThrow('8 million');
    expect(() => checkPixels(0, 1)).toThrow('invalid');
    expect(imageDimensions(textImage().toBuffer('image/jpeg', 95))).toEqual({ width: 1200, height: 220 });
  });
});
