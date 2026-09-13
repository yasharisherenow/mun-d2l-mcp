import { parentPort } from 'node:worker_threads';
import { extractText, getDocumentProxy } from 'unpdf';
import { convert } from 'html-to-text';

const MAX_PAGES = 300;
const MAX_TEXT_CHARACTERS = 2_000_000;

if (!parentPort) throw new Error('Document worker requires a parent port.');

parentPort.once('message', async ({ bytes, mime }: { bytes: Uint8Array; mime: string }) => {
  try {
    const body = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let text = '';
    let pages: number | null = null;
    let pageOffsets: number[] | null = null;
    let truncated = false;
    if (body.subarray(0, 5).toString() === '%PDF-') {
      const pdf = await getDocumentProxy(new Uint8Array(body), { verbosity: 0 });
      try {
        if (pdf.numPages > MAX_PAGES) throw { code: 'FILE_TOO_LARGE', message: 'This PDF exceeds the 300-page reading limit.' };
        const result = await extractText(pdf, { mergePages: false });
        pageOffsets = [];
        for (const page of result.text) {
          const separator = text ? '\n\f\n' : '';
          if (text.length + separator.length + page.length > MAX_TEXT_CHARACTERS) {
            text += `${separator}${page.slice(0, Math.max(0, MAX_TEXT_CHARACTERS - text.length - separator.length))}`;
            truncated = true;
            break;
          }
          text += separator;
          pageOffsets.push(text.length);
          text += page;
        }
        pages = result.totalPages;
      } finally { await pdf.loadingTask.destroy(); }
    } else if (['text/html', 'application/xhtml+xml'].includes(mime)) {
      const html = body.toString('utf8');
      if (/\/d2l\/login|<title>[^<]*login/i.test(html)) throw { code: 'AUTH_REQUIRED', message: 'Brightspace returned a login page. Run npm run login.' };
      const converted = convert(html, { wordwrap: false, selectors: [{ selector: 'img', format: 'skip' }, { selector: 'script', format: 'skip' }, { selector: 'style', format: 'skip' }] });
      truncated = converted.length > MAX_TEXT_CHARACTERS;
      text = converted.slice(0, MAX_TEXT_CHARACTERS);
    } else if (['text/plain', 'text/markdown', 'text/csv'].includes(mime)) {
      const decoded = body.toString('utf8');
      truncated = decoded.length > MAX_TEXT_CHARACTERS;
      text = decoded.slice(0, MAX_TEXT_CHARACTERS);
    } else throw { code: 'UNSUPPORTED_FILE', message: 'This material is not readable text or PDF. Open its source link in Brightspace.' };
    parentPort!.postMessage({ ok: true, result: { text, pages, pageOffsets, truncated } });
  } catch (error) {
    const safe = error as { code?: string; message?: string };
    parentPort!.postMessage({ ok: false, code: safe.code ?? 'EXTRACTION_FAILED', message: safe.message ?? 'The document could not be read safely.' });
  }
});
