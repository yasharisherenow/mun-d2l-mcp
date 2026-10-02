import { parentPort } from 'node:worker_threads';
import { extractText, getDocumentProxy, createIsomorphicCanvasFactory, renderPageAsImage } from 'unpdf';
import { convert } from 'html-to-text';
import { extractOffice, officeMimes } from './office.js';
import { LocalOcr, checkPixels, imageDimensions, MAX_OCR_PAGES, type OcrMetadata } from './ocr.js';

const MAX_PAGES = 300;
const MAX_TEXT_CHARACTERS = 2_000_000;

if (!parentPort) throw new Error('Document worker requires a parent port.');

parentPort.once('message', async ({ bytes, mime }: { bytes: Uint8Array; mime: string }) => {
  const engine = new LocalOcr();
  try {
    const body = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let text = '';
    let pages: number | null = null;
    let pageOffsets: number[] | null = null;
    let truncated = false;
    let ocr: OcrMetadata | null = null;
    const confidences: number[] = [];
    if (body.subarray(0, 5).toString() === '%PDF-') {
      const CanvasFactory = await createIsomorphicCanvasFactory(() => import('@napi-rs/canvas'));
      const pdfOptions = {
        verbosity: 0, CanvasFactory, isEvalSupported: false, useSystemFonts: false,
        disableFontFace: true, maxImageSize: 8_000_000,
      };
      const pdf = await getDocumentProxy(new Uint8Array(body), pdfOptions);
      try {
        if (pdf.numPages > MAX_PAGES) throw { code: 'FILE_TOO_LARGE', message: 'This PDF exceeds the 300-page reading limit.' };
        const result = await extractText(pdf, { mergePages: false });
        pageOffsets = [];
        for (const [index, extracted] of result.text.entries()) {
          let page = extracted;
          if (!page.trim()) {
            ocr ??= { language: 'eng', pages: [], skipped_pages: [], confidence: null };
            if (ocr.pages.length < MAX_OCR_PAGES) {
              const pdfPage = await pdf.getPage(index + 1);
              const viewport = pdfPage.getViewport({ scale: 2 });
              checkPixels(Math.ceil(viewport.width), Math.ceil(viewport.height));
              const image = await renderPageAsImage(pdf, index + 1, { scale: 2, canvasImport: () => import('@napi-rs/canvas') });
              const recognized = await engine.recognize(Buffer.from(image));
              page = recognized.text;
              ocr.pages.push(index + 1); confidences.push(recognized.confidence);
              pdfPage.cleanup();
            } else { ocr.skipped_pages.push(index + 1); truncated = true; }
          }
          const separator = index ? '\n\f\n' : '';
          if (text.length + separator.length > MAX_TEXT_CHARACTERS) { truncated = true; break; }
          text += separator;
          pageOffsets.push(text.length);
          if (text.length + page.length > MAX_TEXT_CHARACTERS) {
            text += page.slice(0, Math.max(0, MAX_TEXT_CHARACTERS - text.length));
            truncated = true;
            break;
          }
          text += page;
        }
        pages = result.totalPages;
      } finally { await pdf.loadingTask.destroy(); }
    } else if (['image/png', 'image/jpeg'].includes(mime) || (mime === 'application/octet-stream' && (body[0] === 137 || (body[0] === 0xff && body[1] === 0xd8)))) {
      const dimensions = imageDimensions(body);
      checkPixels(dimensions.width, dimensions.height);
      const recognized = await engine.recognize(body);
      text = recognized.text.slice(0, MAX_TEXT_CHARACTERS);
      truncated = recognized.text.length > MAX_TEXT_CHARACTERS;
      ocr = { language: 'eng', pages: [1], skipped_pages: [], confidence: recognized.confidence };
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
    } else if (officeMimes.includes(mime)) {
      const result = await extractOffice(body, mime);
      text = result.text;
      truncated = result.truncated;
    } else throw { code: 'UNSUPPORTED_FILE', message: 'This material is not supported text, PDF, DOCX, or PPTX. Open its source link in Brightspace.' };
    if (ocr && confidences.length) ocr.confidence = Math.round(confidences.reduce((sum, value) => sum + value, 0) / confidences.length);
    await engine.close();
    parentPort!.postMessage({ ok: true, result: { text, pages, pageOffsets, truncated, ocr } });
  } catch (error) {
    const safe = error as { code?: string; message?: string };
    parentPort!.postMessage({ ok: false, code: safe.code ?? 'EXTRACTION_FAILED', message: safe.code ? safe.message : 'The document could not be read safely.' });
  } finally { await engine.close(); }
});
