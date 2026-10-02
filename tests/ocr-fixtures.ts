import { createCanvas } from '@napi-rs/canvas';

export function textImage(text = 'MUN COURSE OCR 12345') {
  const canvas = createCanvas(1200, 220), ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1200, 220);
  ctx.fillStyle = 'black'; ctx.font = '60px Arial'; ctx.fillText(text, 40, 120);
  return canvas;
}
// A small standards-conforming PDF with JPEG scan pages and optional selectable text.
export function scanPdf(pageTypes: Array<'scan' | 'text' | 'blank'> = ['scan']): Buffer {
  const objects: Buffer[] = [], jpeg = textImage().toBuffer('image/jpeg', 95);
  const text = (value: string) => Buffer.from(value, 'ascii');
  const stream = (dictionary: string, bytes: Buffer) => Buffer.concat([text(`<< ${dictionary} /Length ${bytes.length} >>\nstream\n`), bytes, text('\nendstream')]);
  const add = (body: Buffer) => { objects.push(body); return objects.length; };
  add(text('<< /Type /Catalog /Pages 2 0 R >>')); add(Buffer.alloc(0));
  const font = add(text('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'));
  const image = add(stream('/Type /XObject /Subtype /Image /Width 1200 /Height 220 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode', jpeg));
  const kids: number[] = [];
  for (const type of pageTypes) {
    const commands = type === 'scan' ? 'q 600 0 0 110 0 0 cm /Im Do Q' : type === 'text' ? 'BT /F1 20 Tf 20 60 Td (Selectable course text) Tj ET' : '';
    const content = add(stream('', text(commands)));
    kids.push(add(text(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 110] /Resources << /Font << /F1 ${font} 0 R >> /XObject << /Im ${image} 0 R >> >> /Contents ${content} 0 R >>`)));
  }
  objects[1] = text(`<< /Type /Pages /Count ${kids.length} /Kids [${kids.map(id => `${id} 0 R`).join(' ')}] >>`);
  const chunks = [text('%PDF-1.4\n')], offsets = [0]; let offset = chunks[0]!.length;
  for (const [index, object] of objects.entries()) {
    offsets.push(offset);
    const chunk = Buffer.concat([text(`${index + 1} 0 obj\n`), object, text('\nendobj\n')]); chunks.push(chunk); offset += chunk.length;
  }
  chunks.push(text(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(value => `${value.toString().padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
  return Buffer.concat(chunks);
}
