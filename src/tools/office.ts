import yauzl, { type Entry, type ZipFile } from 'yauzl';
import { SaxesParser, type SaxesTagNS } from 'saxes';
import { posix } from 'node:path';
import { AppError } from '../errors.js';

export const WORD_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const SLIDE_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
export const officeMimes = [WORD_MIME, SLIDE_MIME, 'application/octet-stream', 'application/zip', 'application/x-zip-compressed'];
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const invalid = () => new AppError('EXTRACTION_FAILED', 'The Office document is malformed or could not be read safely.');
const unsupported = () => new AppError('UNSUPPORTED_FILE', 'Only unencrypted, non-macro DOCX and PPTX Office documents are supported.');
const limit = () => new AppError('EXTRACTION_LIMIT', 'The Office document exceeds safe extraction limits.');
function attr(tag: SaxesTagNS, name: string, uri = ''): string | undefined {
  return Object.values(tag.attributes).find(a => a.local === name && a.uri === uri)?.value;
}
function xml(input: string, open: (tag: SaxesTagNS) => void, close: (tag: SaxesTagNS) => void = () => {}, text: (value: string) => void = () => {}): void {
  const parser = new SaxesParser({ xmlns: true });
  let depth = 0;
  parser.on('doctype', () => { throw invalid(); });
  parser.on('error', () => { throw invalid(); });
  parser.on('opentag', tag => { if (++depth > 128) throw limit(); open(tag); });
  parser.on('closetag', tag => { close(tag); --depth; });
  parser.on('text', text);
  parser.on('cdata', text);
  parser.write(input).close();
}
function safePath(name: string): boolean {
  return !name.includes('\\') && !name.includes('\0') && !name.includes(':') && !name.startsWith('/') && !name.split('/').some(p => p === '..' || p === '.');
}
function openZip(body: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => yauzl.fromBuffer(body, { autoClose: false, lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => error || !zip ? reject(invalid()) : resolve(zip)));
}
async function inventory(zip: ZipFile): Promise<Map<string, Entry>> {
  return new Promise((resolve, reject) => {
    const entries = new Map<string, Entry>();
    zip.on('error', () => reject(invalid()));
    zip.on('entry', (entry: Entry) => {
      if (entries.size >= 2000) { reject(limit()); return; }
      if (!safePath(entry.fileName) || entries.has(entry.fileName)) { reject(invalid()); return; }
      if ((entry.generalPurposeBitFlag & 1) || /vbaProject\.bin$/i.test(entry.fileName)) { reject(unsupported()); return; }
      entries.set(entry.fileName, entry);
      zip.readEntry();
    });
    zip.once('end', () => resolve(entries));
    zip.readEntry();
  });
}
export async function extractOffice(body: Buffer, mime: string): Promise<{ text: string; truncated: boolean }> {
  let zip: ZipFile | undefined;
  try {
    zip = await openZip(body);
    const entries = await inventory(zip);
    let totalBytes = 0;
    const read = async (name: string): Promise<string> => {
      const entry = entries.get(name);
      if (!entry || name.endsWith('/')) throw invalid();
      if (entry.uncompressedSize > 10 * 1024 * 1024 || totalBytes + entry.uncompressedSize > 40 * 1024 * 1024) throw limit();
      return new Promise((resolve, reject) => zip!.openReadStream(entry, (error, stream) => {
        if (error || !stream) { reject(invalid()); return; }
        let size = 0;
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => {
          size += chunk.length; totalBytes += chunk.length;
          if (size > 10 * 1024 * 1024 || totalBytes > 40 * 1024 * 1024) { stream.destroy(); reject(limit()); return; }
          chunks.push(chunk);
        });
        stream.once('error', () => reject(invalid()));
        stream.once('end', () => {
          if (size !== entry.uncompressedSize) { reject(invalid()); return; }
          try { resolve(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); } catch { reject(invalid()); }
        });
      }));
    };
    const types = new Map<string, string>();
    let typesRoot = false;
    xml(await read('[Content_Types].xml'), tag => {
      if (!typesRoot) { if (tag.uri !== CT || tag.local !== 'Types') throw invalid(); typesRoot = true; }
      const type = attr(tag, 'ContentType');
      if (type && /macroenabled|vbaProject/i.test(type)) throw unsupported();
      if (tag.uri === CT && tag.local === 'Override') {
        const name = attr(tag, 'PartName');
        if (!name || !type || types.has(name)) throw invalid();
        types.set(name, type);
      }
    });
    const relationships = async (name: string) => {
      const result = new Map<string, { target: string; type: string; external: boolean }>();
      let root = false;
      xml(await read(name), tag => {
        if (!root) { if (tag.uri !== REL || tag.local !== 'Relationships') throw invalid(); root = true; }
        if (tag.uri !== REL || tag.local !== 'Relationship') return;
        const id = attr(tag, 'Id'), target = attr(tag, 'Target'), type = attr(tag, 'Type');
        if (!id || !target || !type || result.has(id)) throw invalid();
        result.set(id, { target, type, external: attr(tag, 'TargetMode') === 'External' });
      });
      return result;
    };
    const resolvePart = (base: string, target: string) => {
      if (/[\\:#?%\0]/.test(target)) throw invalid();
      const path = posix.normalize(target.startsWith('/') ? target.slice(1) : posix.join(base, target));
      if (!safePath(path) || !entries.has(path)) throw invalid();
      return path;
    };
    const roots = [...(await relationships('_rels/.rels')).values()].filter(r => r.type === `${R}/officeDocument`);
    if (roots.length !== 1 || roots[0]!.external) throw invalid();
    const main = resolvePart('', roots[0]!.target);
    const mainType = types.get(`/${main}`);
    const word = mainType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
    const slides = mainType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml';
    if (!word && !slides) throw unsupported();
    if ((mime === WORD_MIME && !word) || (mime === SLIDE_MIME && !slides)) throw invalid();
    let output = '', truncated = false;
    const append = (value: string) => {
      const remaining = 2_000_000 - output.length;
      if (value.length > remaining) truncated = true;
      output += value.slice(0, remaining);
    };
    if (word) {
      let inBody = 0, ignored = 0, inText = 0, bodyCount = 0;
      const stack: boolean[] = [];
      let root = false;
      xml(await read(main), tag => {
        if (!stack.length) { root = tag.uri === W && tag.local === 'document'; if (!root) throw invalid(); }
        if (tag.uri === W && tag.local === 'body') { if (++bodyCount !== 1 || stack.length !== 1) throw invalid(); ++inBody; }
        const skip = tag.uri === W && ['del', 'moveFrom', 'drawing', 'object', 'pict'].includes(tag.local);
        stack.push(skip); if (skip) ++ignored;
        if (inBody && !ignored && tag.uri === W) {
          if (tag.local === 't') ++inText;
          if (tag.local === 'tab') append('\t');
          if (['br', 'cr'].includes(tag.local)) append('\n');
        }
      }, tag => {
        if (inBody && !ignored && tag.uri === W) {
          if (tag.local === 't') --inText;
          if (tag.local === 'p') append('\n');
          if (tag.local === 'tc') { if (output.endsWith('\n')) output = output.slice(0, -1); append('\t'); }
          if (tag.local === 'tr') { if (output.endsWith('\t')) output = output.slice(0, -1); append('\n'); }
        }
        if (stack.pop()) --ignored;
        if (tag.uri === W && tag.local === 'body') --inBody;
      }, value => { if (inBody && !ignored && inText) append(value); });
      if (!root || bodyCount !== 1) throw invalid();
    } else {
      const ids: string[] = [];
      let depth = 0, inList = false;
      xml(await read(main), tag => {
        if (!depth && (tag.uri !== P || tag.local !== 'presentation')) throw invalid();
        ++depth;
        if (tag.uri === P && tag.local === 'sldIdLst') inList = true;
        if (inList && tag.uri === P && tag.local === 'sldId') {
          const id = attr(tag, 'id', R); if (!id || ids.includes(id)) throw invalid(); ids.push(id);
        }
      }, tag => { --depth; if (tag.uri === P && tag.local === 'sldIdLst') inList = false; });
      const rels = ids.length ? await relationships(posix.join(posix.dirname(main), '_rels', `${posix.basename(main)}.rels`)) : new Map();
      for (const [index, id] of ids.entries()) {
        const rel = rels.get(id);
        if (!rel || rel.external || rel.type !== `${R}/slide`) throw invalid();
        const path = resolvePart(posix.dirname(main), rel.target);
        if (types.get(`/${path}`) !== 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml') throw invalid();
        let hidden = false, depth = 0, shape = 0, table = 0, textDepth = 0;
        xml(await read(path), tag => {
          if (!depth) {
            if (tag.uri !== P || tag.local !== 'sld') throw invalid();
            hidden = ['0', 'false'].includes(attr(tag, 'show') ?? '1');
            if (!hidden) append(`${output ? '\n' : ''}Slide ${index + 1}\n`);
          }
          ++depth;
          if (tag.uri === P && tag.local === 'sp') ++shape;
          if (tag.uri === A && tag.local === 'tbl') ++table;
          if (!hidden && (shape || table) && tag.uri === A) {
            if (tag.local === 't') ++textDepth;
            if (tag.local === 'br') append('\n');
          }
        }, tag => {
          if (!hidden && (shape || table) && tag.uri === A) {
            if (tag.local === 't') --textDepth;
            if (tag.local === 'p') append('\n');
            if (tag.local === 'tc') { if (output.endsWith('\n')) output = output.slice(0, -1); append('\t'); }
            if (tag.local === 'tr') { if (output.endsWith('\t')) output = output.slice(0, -1); append('\n'); }
          }
          if (tag.uri === P && tag.local === 'sp') --shape;
          if (tag.uri === A && tag.local === 'tbl') --table;
          --depth;
        }, value => { if (!hidden && (shape || table) && textDepth) append(value); });
      }
    }
    return { text: output, truncated };
  } catch (error) { throw error instanceof AppError ? error : invalid(); }
  finally { zip?.close(); }
}
