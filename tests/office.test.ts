import { describe, expect, it } from 'vitest';
import { extractOffice, WORD_MIME, SLIDE_MIME } from '../src/tools/office.js';
import { extractDocument } from '../dist/tools/extract.js';
import { zip, docxEntries, pptxEntries } from './office-fixtures.js';

describe('bounded Office extraction', () => {
  it('reads Word paragraphs, tabs, breaks, Unicode and tables, excluding tracked deletions and objects', async () => {
    const body = '<w:p><w:r><w:t>Hello résumé 世界</w:t><w:tab/><w:t>next</w:t><w:br/></w:r><w:del><w:r><w:t>SECRET</w:t></w:r></w:del><w:drawing><w:t>OBJECT</w:t></w:drawing></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cell B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const entries = docxEntries(body);
    entries.push(['word/comments.xml', '<comment>PRIVATE</comment>'], ['word/header1.xml', '<header>HEADER</header>']);
    const result = await extractDocument(zip(entries), WORD_MIME);
    expect(result.text).toContain('Hello résumé 世界\tnext\n');
    expect(result.text).toContain('Cell A\tCell B\n');
    expect(result.text).not.toMatch(/SECRET|OBJECT|PRIVATE|HEADER/);
    expect(result).toMatchObject({ pages: null, pageOffsets: null, truncated: false });
  });
  it('reads slides in presentation order and skips hidden slides and notes', async () => {
    const result = await extractDocument(zip(pptxEntries()), SLIDE_MIME);
    expect(result.text).toBe('Slide 1\nFirst\n\nSlide 2\nSecond\n');
    expect(result.pages).toBeNull();
  });
  it.each(['application/octet-stream', 'application/zip', 'application/x-zip-compressed'])('recognizes valid packages with %s MIME', async mime => {
    expect((await extractDocument(zip(docxEntries()), mime)).text).toContain('Hello');
  });
  it('accepts empty Word and PowerPoint documents', async () => {
    expect((await extractOffice(zip(docxEntries('')), WORD_MIME)).text).toBe('');
    const entries = pptxEntries();
    entries[2]![1] = entries[2]![1].replace(/<p:sldIdLst>.*<\/p:sldIdLst>/, '');
    expect((await extractOffice(zip(entries), SLIDE_MIME)).text).toBe('');
  });
  it('caps text and reports truncation', async () => {
    const result = await extractOffice(zip(docxEntries(`<w:p><w:r><w:t>${'a'.repeat(2_000_001)}</w:t></w:r></w:p>`)), WORD_MIME);
    expect(result.text.length).toBe(2_000_000); expect(result.truncated).toBe(true);
  });
  it('rejects mismatched MIME types, generic archives, legacy and corrupt documents', async () => {
    await expect(extractDocument(zip(docxEntries()), SLIDE_MIME)).rejects.toMatchObject({ code: 'EXTRACTION_FAILED' });
    await expect(extractDocument(zip([['file.txt', 'hello']]), 'application/zip')).rejects.toMatchObject({ code: 'EXTRACTION_FAILED' });
    await expect(extractDocument(Buffer.from('legacy'), 'application/msword')).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE' });
    await expect(extractDocument(Buffer.from('PRIVATE malformed data'), WORD_MIME)).rejects.toMatchObject({ code: 'EXTRACTION_FAILED' });
  });
  it('rejects encrypted and macro-enabled archives', async () => {
    await expect(extractOffice(zip(docxEntries(), 1), WORD_MIME)).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE' });
    const entries = docxEntries(); entries.push(['word/vbaProject.bin', 'macro']);
    await expect(extractOffice(zip(entries), WORD_MIME)).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE' });
    entries.pop(); entries[0]![1] = entries[0]![1].replace('wordprocessingml.document.main+xml', 'wordprocessingml.document.macroEnabled.main+xml');
    await expect(extractOffice(zip(entries), WORD_MIME)).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE' });
  });
  it('rejects traversal, duplicate entries, DTDs, malformed XML, and external main relationships', async () => {
    for (const name of ['../escape.xml', '/absolute.xml', 'bad\\path.xml', 'C:bad.xml']) {
      await expect(extractOffice(zip([...docxEntries(), [name, 'bad']]), WORD_MIME)).rejects.toMatchObject({ code: 'EXTRACTION_FAILED' });
    }
    await expect(extractOffice(zip([...docxEntries(), docxEntries()[2]!]), WORD_MIME)).rejects.toMatchObject({ code: 'EXTRACTION_FAILED' });
    for (const content of ['<!DOCTYPE w:document [<!ENTITY secret SYSTEM "file:///secret">]><w:document/>', '<w:document>PRIVATE', '<x/>']) {
      const entries = docxEntries(); entries[2]![1] = content;
      await expect(extractOffice(zip(entries), WORD_MIME)).rejects.toMatchObject({ code: 'EXTRACTION_FAILED' });
    }
    const entries = docxEntries(); entries[1]![1] = entries[1]![1].replace('Target="word/document.xml"', 'Target="https://example.com/doc" TargetMode="External"');
    await expect(extractOffice(zip(entries), WORD_MIME)).rejects.toMatchObject({ code: 'EXTRACTION_FAILED' });
  });
  it('enforces entry count, XML nesting, decompressed XML and input sizes', async () => {
    await expect(extractOffice(zip(Array.from({ length: 2001 }, (_, n) => [`file${n}`, ''])), WORD_MIME)).rejects.toMatchObject({ code: 'EXTRACTION_LIMIT' });
    await expect(extractOffice(zip(docxEntries('<w:p>'.repeat(129) + '</w:p>'.repeat(129))), WORD_MIME)).rejects.toMatchObject({ code: 'EXTRACTION_LIMIT' });
    await expect(extractOffice(zip(docxEntries('a'.repeat(10 * 1024 * 1024))), WORD_MIME)).rejects.toMatchObject({ code: 'EXTRACTION_LIMIT' });
    await expect(extractDocument(Buffer.alloc(20 * 1024 * 1024 + 1), WORD_MIME)).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });
  it('enforces actual decompressed sizes rather than trusting ZIP metadata', async () => {
    const body = zip(docxEntries());
    let index = 0, directory = -1;
    while ((index = body.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), index)) >= 0) { directory = index; index += 4; }
    body.writeUInt32LE(body.readUInt32LE(directory + 24) - 1, directory + 24);
    await expect(extractOffice(body, WORD_MIME)).rejects.toMatchObject({ code: 'EXTRACTION_FAILED' });
  });
  it('enforces the cumulative selected XML limit across slides', async () => {
    const entries = pptxEntries(), pad = ' '.repeat(8 * 1024 * 1024);
    for (let n = 4; n <= 6; n++) {
      entries[0]![1] = entries[0]![1].replace('</Types>', `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`);
      entries[2]![1] = entries[2]![1].replace('</p:sldIdLst>', `<p:sldId r:id="r${n}"/></p:sldIdLst>`);
      entries[3]![1] = entries[3]![1].replace('</Relationships>', `<Relationship Id="r${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${n}.xml"/></Relationships>`);
      entries.push([`ppt/slides/slide${n}.xml`, entries[4]![1]]);
    }
    for (const entry of entries) if (/^ppt\/slides\//.test(entry[0])) entry[1] += pad;
    await expect(extractOffice(zip(entries), SLIDE_MIME)).rejects.toMatchObject({ code: 'EXTRACTION_LIMIT' });
  });
  it('includes slide tables but excludes text in embedded chart objects', async () => {
    const entries = pptxEntries();
    entries[4]![1] = entries[4]![1].replace('</p:spTree>', '<p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Table cell</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame><p:graphicFrame><a:graphic><a:graphicData><a:t>CHART SECRET</a:t></a:graphicData></a:graphic></p:graphicFrame></p:spTree>');
    const result = await extractOffice(zip(entries), SLIDE_MIME);
    expect(result.text).toContain('Table cell'); expect(result.text).not.toContain('CHART SECRET');
  });
});
