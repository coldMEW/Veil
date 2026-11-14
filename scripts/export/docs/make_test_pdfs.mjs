// Dependency-free, synthetic one-page PDFs for document-structure demonstrations.
// signed_then_changed.pdf contains a placeholder signature value, not a certificate
// or cryptographic signature. It tests declared ByteRange coverage only.
import { lstat, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const names = ['original.pdf', 'edited.pdf', 'signed_then_changed.pdf', 'ai_metadata.pdf'];
const created = 'D:20261114100000Z';
const createdXmp = '2026-11-14T10:00:00Z';
const originalProducer = 'Microsoft Word for Microsoft 365';
const literal = (text) => `(${text.replace(/([\\()])/g, '\\$1')})`;
const ascii = (text) => Buffer.from(text, 'latin1');

function stream(dict, text) {
  const bytes = Buffer.from(text, 'utf8');
  return Buffer.concat([ascii(`<< ${dict} /Length ${bytes.length} >>\nstream\n`), bytes, ascii('\nendstream')]);
}

function page(contents = 5) {
  return `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents ${contents} 0 R >>`;
}

function invoice(total, coverage = false) {
  return [
    'BT', '/F1 24 Tf', '72 708 Td', `${literal('INVOICE #1042')} Tj`,
    '/F1 16 Tf', '0 -48 Td', `${literal(`Total ${total}`)} Tj`,
    '/F1 11 Tf', '0 -60 Td', `${literal('Synthetic invoice for Veil document tests.')} Tj`,
    ...(coverage ? ['0 -24 Td', `${literal('Signature coverage fixture only; no cryptographic signature.')} Tj`] : []),
    'ET', '',
  ].join('\n');
}

function info(producer, creator = originalProducer, modified = created) {
  return `<< /Title ${literal('Synthetic invoice #1042')} /Author (Veil test fixture) /Creator ${literal(creator)} /Producer ${literal(producer)} /CreationDate ${literal(created)} /ModDate ${literal(modified)} >>`;
}

function xmp(producer, creator = originalProducer, modified = createdXmp, ai = false) {
  // Inputs are fixed fixture strings, not user-provided XML.
  return `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:iptcExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/">
<xmp:CreatorTool>${creator}</xmp:CreatorTool><pdf:Producer>${producer}</pdf:Producer>
<xmp:CreateDate>${createdXmp}</xmp:CreateDate><xmp:ModifyDate>${modified}</xmp:ModifyDate>
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Synthetic invoice #1042</rdf:li></rdf:Alt></dc:title>
${ai ? '<iptcExt:DigitalSourceType>http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia</iptcExt:DigitalSourceType>' : ''}
</rdf:Description></rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`;
}

/** Append only updated/new objects, with actual byte offsets and an optional /Prev. */
function writeRevision(objects, { prefix = ascii('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n'), prev, size } = {}) {
  const chunks = [prefix];
  const offsets = new Map();
  let position = prefix.length;
  const ids = [...objects.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    const body = objects.get(id);
    const object = Buffer.concat([ascii(`${id} 0 obj\n`), Buffer.isBuffer(body) ? body : ascii(body), ascii('\nendobj\n')]);
    offsets.set(id, position);
    chunks.push(object);
    position += object.length;
  }
  const xrefOffset = position;
  let xref = 'xref\n0 1\n0000000000 65535 f \n';
  for (let index = 0; index < ids.length;) {
    const start = index++;
    while (index < ids.length && ids[index] === ids[index - 1] + 1) index++;
    xref += `${ids[start]} ${index - start}\n`;
    for (let i = start; i < index; i++) xref += `${String(offsets.get(ids[i])).padStart(10, '0')} 00000 n \n`;
  }
  const objectCount = size ?? Math.max(...ids) + 1;
  xref += `trailer\n<< /Size ${objectCount} /Root 1 0 R /Info 6 0 R${prev === undefined ? '' : ` /Prev ${prev}`} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(ascii(xref));
  return { bytes: Buffer.concat(chunks), xrefOffset };
}

function originalObjects({ producer = originalProducer, creator = originalProducer, ai = false, signature = false } = {}) {
  const objects = new Map([
    [1, `<< /Type /Catalog /Pages 2 0 R /Metadata 7 0 R${signature ? ' /AcroForm 9 0 R' : ''} >>`],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, page()], [4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'],
    [5, stream('', invoice('$1,250.00', signature))], [6, info(producer, creator)],
    [7, stream('/Type /Metadata /Subtype /XML', xmp(producer, creator, createdXmp, ai))],
  ]);
  if (signature) {
    objects.set(8, `<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /M ${literal(created)} /ByteRange [${Array(4).fill('0000000000').join(' ')}] /Contents <${'00'.repeat(256)}> >>`);
    objects.set(9, '<< /Fields [10 0 R] /SigFlags 3 >>');
    objects.set(10, '<< /FT /Sig /T (Synthetic coverage field) /V 8 0 R >>');
  }
  return objects;
}

function makeFixtures() {
  const original = writeRevision(originalObjects());
  const edited = writeRevision(new Map([
    [3, page(8)],
    [6, info('Adobe Acrobat Pro 24.1', originalProducer, 'D:20261114113000Z')],
    [7, stream('/Type /Metadata /Subtype /XML', xmp('Adobe Acrobat Pro 24.1', originalProducer, '2026-11-14T11:30:00Z'))],
    [8, stream('', invoice('$9,250.00'))],
  ]), { prefix: original.bytes, prev: original.xrefOffset, size: 9 });

  const coverage = writeRevision(originalObjects({ signature: true })).bytes;
  const signatureText = coverage.toString('latin1');
  const contentsStart = signatureText.indexOf('/Contents <') + '/Contents '.length;
  const contentsEnd = signatureText.indexOf('>', contentsStart) + 1;
  const values = [0, contentsStart, contentsEnd, coverage.length - contentsEnd];
  const marker = `/ByteRange [${Array(4).fill('0000000000').join(' ')}]`;
  const filled = `/ByteRange [${values.map((value) => String(value).padStart(10, '0')).join(' ')}]`;
  if (contentsStart < '/Contents '.length || contentsEnd <= contentsStart || marker.length !== filled.length) throw new Error('Invalid synthetic signature layout.');
  const signed = ascii(signatureText.replace(marker, filled));
  const appended = ascii('% Synthetic bytes appended after the declared signed range.\n');
  const ai = writeRevision(originalObjects({ producer: 'ChatGPT', creator: 'OpenAI', ai: true })).bytes;
  return new Map([
    ['original.pdf', original.bytes], ['edited.pdf', edited.bytes],
    ['signed_then_changed.pdf', Buffer.concat([signed, appended])], ['ai_metadata.pdf', ai],
  ]);
}

async function main() {
  if (!process.argv[2] || process.argv.length !== 3) throw new Error('Usage: node make_test_pdfs.mjs <output-folder>');
  const target = resolve(process.argv[2]);
  await mkdir(target, { recursive: true });
  // Refuse to overwrite a PDF the caller may still want. Exclusive writes also
  // protect against a file appearing between this preflight and the write.
  for (const name of names) {
    try { await lstat(join(target, name)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw new Error(`Refusing to overwrite ${name}; choose an empty output folder.`);
  }
  for (const [name, bytes] of makeFixtures()) await writeFile(join(target, name), bytes, { flag: 'wx' });
  console.log('Wrote 4 synthetic PDF fixtures. Signature coverage uses a placeholder value.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Could not write synthetic PDF fixtures.');
  process.exitCode = 1;
});
