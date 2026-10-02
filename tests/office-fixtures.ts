import { deflateRawSync } from 'node:zlib';

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function zip(entries: Array<[string, string]>, flags = 0): Buffer {
  const locals: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const filename = Buffer.from(name), body = Buffer.from(text), compressed = deflateRawSync(body);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(flags, 6);
    header.writeUInt16LE(8, 8); header.writeUInt32LE(crc32(body), 14);
    header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(body.length, 22); header.writeUInt16LE(filename.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(flags, 8); directory.writeUInt16LE(8, 10); directory.writeUInt32LE(crc32(body), 16);
    directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(body.length, 24);
    directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
    locals.push(header, filename, compressed); central.push(directory, filename);
    offset += header.length + filename.length + compressed.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(Buffer.concat(central).length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...central, end]);
}
const typesNS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const relNS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const wordNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export function docxEntries(body = '<w:p><w:r><w:t>Hello résumé 世界</w:t></w:r></w:p>'): Array<[string, string]> {
  return [
    ['[Content_Types].xml', `<Types xmlns="${typesNS}"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`],
    ['_rels/.rels', `<Relationships xmlns="${relNS}"><Relationship Id="r1" Type="${rel}/officeDocument" Target="word/document.xml"/></Relationships>`],
    ['word/document.xml', `<w:document xmlns:w="${wordNS}"><w:body>${body}</w:body></w:document>`],
  ];
}
export function pptxEntries(): Array<[string, string]> {
  const p = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const slide = (text: string, hidden = false) => `<p:sld xmlns:p="${p}" xmlns:a="${a}" show="${hidden ? '0' : '1'}"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  return [
    ['[Content_Types].xml', `<Types xmlns="${typesNS}"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${[1,2,3].map(n => `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', `<Relationships xmlns="${relNS}"><Relationship Id="r1" Type="${rel}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`],
    ['ppt/presentation.xml', `<p:presentation xmlns:p="${p}" xmlns:r="${rel}"><p:sldIdLst><p:sldId r:id="r2"/><p:sldId r:id="r1"/><p:sldId r:id="r3"/></p:sldIdLst></p:presentation>`],
    ['ppt/_rels/presentation.xml.rels', `<Relationships xmlns="${relNS}">${[1,2,3].map(n => `<Relationship Id="r${n}" Type="${rel}/slide" Target="slides/slide${n}.xml"/>`).join('')}</Relationships>`],
    ['ppt/slides/slide1.xml', slide('Second')], ['ppt/slides/slide2.xml', slide('First')], ['ppt/slides/slide3.xml', slide('SECRET', true)],
    ['ppt/notesSlides/notesSlide1.xml', '<secret>NOTES SECRET</secret>'],
  ];
}
