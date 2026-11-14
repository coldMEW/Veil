import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateCheckResult } from '../../../contracts';
import { analysePdf, MAX_INFLATED_BYTES, toDocumentCheckResult } from './pdfForensics';
import { documentEvidence } from './documentEvidence';

const encode = (text: string) => new TextEncoder().encode(text);
function join(...parts: Array<string | Uint8Array>): Uint8Array {
  const bytes = parts.map((part) => typeof part === 'string' ? encode(part) : part);
  const out = new Uint8Array(bytes.reduce((sum, part) => sum + part.length, 0));
  let pos = 0;
  for (const part of bytes) { out.set(part, pos); pos += part.length; }
  return out;
}
const object = (id: number, body: string | Uint8Array) => join(`${id} 0 obj\n`, body, '\nendobj\n');
const stream = (id: number, dict: string, data: Uint8Array) => object(id, join(`<< ${dict} /Length ${data.length} >>\nstream\n`, data, '\nendstream'));
function pdf(objects: Uint8Array[], trailer = '') {
  const body = join('%PDF-1.7\n', ...objects);
  return join(body, `xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 30 ${trailer} >>\nstartxref\n${body.length}\n%%EOF\n`);
}
const xml = (properties: string) => `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:dc="http://purl.org/dc/elements/1.1/">${properties}</rdf:Description></rdf:RDF></x:xmpmeta>`;
async function deflate(bytes: Uint8Array) {
  return new Uint8Array(await new Response(new Blob([bytes.slice()]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
}
function signedBytes() {
  const raw = new TextDecoder().decode(pdf([
    object(1, '<< /Type /Sig /Filter /Adobe.PPKLite /ByteRange [0 40 80 0000000000] /Contents <0123456789> >>'),
    object(2, '<< /FT /Sig /V 1 0 R >>'),
  ]));
  return encode(raw.replace('80 0000000000', `80 ${String(raw.length - 80).padStart(10, '0')}`));
}

afterEach(() => vi.unstubAllGlobals());

describe('PDF revisions and metadata syntax', () => {
  it('recognises a single revision and reports byte offsets', async () => {
    const bytes = pdf([object(1, '<< /Type /Catalog >>'), object(2, '<< /Creator (Microsoft Word) /Producer (Adobe Acrobat 24.1) /Title (A (nested) title) >>')], '/Info 2 0 R');
    const result = await analysePdf(bytes);
    expect(result).toMatchObject({ isPdf: true, version: '1.7', sizeBytes: bytes.length, revisions: 1 });
    const text = new TextDecoder().decode(bytes);
    expect(result.revisionOffsets).toEqual([text.indexOf('%%EOF')]);
    expect(result.xrefOffsets).toEqual([text.indexOf('xref')]);
    expect(result.info).toEqual({ Creator: 'Microsoft Word', Producer: 'Adobe Acrobat 24.1', Title: 'A (nested) title' });
    const check = toDocumentCheckResult('asset', result);
    expect(validateCheckResult(check)).toEqual([]);
    expect(check).toMatchObject({ id: 'document-structure', kind: 'provenance', finding: 'inconclusive' });
    expect(check.observation).toContain('Creator metadata: Microsoft Word');
    expect(check.observation).toContain('Producer metadata: Adobe Acrobat 24.1');
  });

  it('reads the latest Info reference after an incremental save, including /Prev', async () => {
    const first = pdf([object(1, '<< /Title (First title) >>')], '/Info 1 0 R');
    const previous = new TextDecoder().decode(first).indexOf('xref');
    const second = join(first, object(2, '<< /Title (Revised title) >>'), `xref\n0 1\n0000000000 65535 f\ntrailer\n<< /Info 2 0 R /Prev ${previous} >>\nstartxref\n${first.length}\n%%EOF\n`);
    const result = await analysePdf(second);
    expect(result.revisions).toBe(2);
    expect(result.revisionOffsets).toHaveLength(2);
    expect(result.xrefOffsets).toHaveLength(2);
    expect(result.prevOffsets).toEqual([previous]);
    expect(result.info.Title).toBe('Revised title');
    expect(toDocumentCheckResult('asset', result).observation).toContain('Saved 2 times: 1 incremental update');
    expect(toDocumentCheckResult('asset', result).finding).toBe('inconclusive');
  });

  it('handles literal escapes, octal bytes, line continuation, hex strings and UTF-16BE BOM', async () => {
    const literal = String.raw`<< /Producer (A \(test\) \\ \101\nnext) /Creator <FEFF004A006F007300E9> /Author (Price \24010) /Title (one` + '\\' + '\r\n' + 'two) >>';
    const result = await analysePdf(pdf([object(1, literal)], '/Info 1 0 R'));
    expect(result.info).toEqual({ Producer: 'A (test) \\ A\nnext', Creator: 'José', Author: 'Price €10', Title: 'onetwo' });
  });

  it('resolves indirect metadata strings and preserves fields inherited from a prior trailer', async () => {
    const first = pdf([object(1, '<< /Creator 2 0 R >>'), object(2, '(Writer)')], '/Info 1 0 R');
    const bytes = join(first, 'trailer\n<< /Prev 0 >>\n%%EOF\n');
    expect((await analysePdf(bytes)).info.Creator).toBe('Writer');
  });

  it('does not count syntax-looking text inside strings or page-content streams', async () => {
    const text = '\n%%EOF\n/JavaScript /OpenAction /EmbeddedFiles /BaseFont /ABCDEF+Invented /C2PA_Manifest';
    const result = await analysePdf(pdf([
      object(1, `<< /Title (${text}) >>`), stream(2, '', encode(text + '\n99 0 obj << /Type /Sig /ByteRange [0 1 2 3] >> endobj')),
    ], '/Info 1 0 R'));
    expect(result.revisions).toBe(1);
    expect(result.xrefOffsets).toHaveLength(1);
    expect(result).toMatchObject({ javascript: false, openAction: false, embeddedFiles: false, fonts: [], c2pa: { present: false } });
    expect(result.signatures.byteRangeCount).toBe(0);
  });

  it('returns a soft result for a non-PDF and a malformed PDF', async () => {
    const nonPdf = await analysePdf(encode('not a PDF /Producer (OpenAI) %%EOF'));
    expect(nonPdf.isPdf).toBe(false);
    expect(nonPdf.info).toEqual({});
    expect(nonPdf.c2pa.aiToolNames).toEqual([]);
    expect(toDocumentCheckResult('asset', nonPdf)).toMatchObject({ execution: 'unavailable', finding: 'inconclusive' });
    expect(validateCheckResult(toDocumentCheckResult('asset', nonPdf))).toEqual([]);
    const malformed = await analysePdf(encode('%PDF-1.7\n1 0 obj << /Title (unterminated'));
    expect(malformed.warnings).toContain('Unterminated PDF literal string.');
    expect(toDocumentCheckResult('asset', malformed).finding).toBe('inconclusive');
  });
});

describe('XMP and date comparisons', () => {
  it('extracts XMP tags, RDF title/author containers and attribute properties', async () => {
    const packet = xml('<xmp:CreatorTool>Writer &amp; Co</xmp:CreatorTool><pdf:Producer>Acrobat</pdf:Producer><dc:title><rdf:Alt><rdf:li xml:lang="x-default">A &lt;title&gt;</rdf:li></rdf:Alt></dc:title><dc:creator><rdf:Seq><rdf:li>Sam</rdf:li></rdf:Seq></dc:creator><xmp:CreateDate>2026-11-14T10:00:00Z</xmp:CreateDate>');
    const result = await analysePdf(pdf([stream(1, '/Type /Metadata /Subtype /XML', encode(packet))]));
    expect(result.xmp).toMatchObject({ read: true, Creator: 'Writer & Co', Producer: 'Acrobat', Author: 'Sam', Title: 'A <title>', CreationDate: '2026-11-14T10:00:00Z' });
    const alias = '<x:xmpmeta><rdf:Description xmlns:m="http://ns.adobe.com/xap/1.0/" m:CreatorTool="Tool &#65;" m:ModifyDate="2026-11-14T11:00:00Z" /></x:xmpmeta>';
    expect((await analysePdf(pdf([stream(1, '/Type /Metadata', encode(alias))]))).xmp).toMatchObject({ Creator: 'Tool A', ModDate: '2026-11-14T11:00:00Z' });
  });

  it('reports an Info/XMP mismatch without concluding inconsistency', async () => {
    const result = await analysePdf(pdf([
      object(1, '<< /CreationDate (D:20261114100000Z) >>'),
      stream(2, '/Type /Metadata /Subtype /XML', encode(xml('<xmp:CreateDate>2026-11-15T10:00:00Z</xmp:CreateDate>'))),
    ], '/Info 1 0 R'));
    expect(result.datesMismatch).toBe(true);
    expect(result.dateIssues).toContain('Info and XMP CreationDate do not match.');
    expect(result.modificationBeforeCreation).toBe(false);
    expect(toDocumentCheckResult('asset', result).finding).toBe('inconclusive');
  });

  it('compares equivalent timezones and partial precision without false mismatches', async () => {
    const result = await analysePdf(pdf([
      object(1, '<< /CreationDate (D:20261114090000-05\'00\') /ModDate (D:2026) >>'),
      stream(2, '/Type /Metadata', encode(xml('<xmp:CreateDate>2026-11-14T14:00:00Z</xmp:CreateDate><xmp:ModifyDate>2026-11-14T15:00:00</xmp:ModifyDate>'))),
    ], '/Info 1 0 R'));
    expect(result.datesMismatch).toBe(false);
    expect(result.modificationBeforeCreation).toBe(false);
  });

  it.each(['info', 'xmp'])('only a ModDate before CreationDate permits an inconsistent date finding (%s)', async (source) => {
    const objects = source === 'info' ? [object(1, '<< /CreationDate (D:20261114110000Z) /ModDate (D:20261114100000Z) >>')] :
      [stream(1, '/Type /Metadata', encode(xml('<xmp:CreateDate>2026-11-14T11:00:00Z</xmp:CreateDate><xmp:ModifyDate>2026-11-14T10:00:00Z</xmp:ModifyDate>')))];
    const result = await analysePdf(pdf(objects, source === 'info' ? '/Info 1 0 R' : ''));
    expect(result.modificationBeforeCreation).toBe(true);
    expect(toDocumentCheckResult('asset', result).finding).toBe('inconsistent');
    expect(validateCheckResult(toDocumentCheckResult('asset', result))).toEqual([]);
  });

  it('does not compare invalid dates or unknown timezone against known timezone', async () => {
    const result = await analysePdf(pdf([
      object(1, '<< /CreationDate (D:20260230000000Z) /ModDate (D:20261114100000) >>'),
      stream(2, '/Type /Metadata', encode(xml('<xmp:ModifyDate>2026-11-14T16:00:00Z</xmp:ModifyDate>'))),
    ], '/Info 1 0 R'));
    expect(result.modificationBeforeCreation).toBe(false);
    expect(result.datesMismatch).toBe(false);
    expect(result.warnings.some((warning) => warning.includes('unreadable date'))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('missing timezone'))).toBe(true);
  });
});

describe('signatures, fonts and feature markers', () => {
  it('detects appended bytes after the last declared signed ByteRange', async () => {
    const signed = signedBytes();
    const original = await analysePdf(signed);
    expect(original.signatures).toMatchObject({ fields: 1, dictionaries: 1, byteRangeCount: 1, lastSignedEnd: signed.length, bytesAfterSignature: 0, changedAfterSigning: false, verified: false });
    const appended = await analysePdf(join(signed, 'APPENDED'));
    expect(appended.signatures).toMatchObject({ bytesAfterSignature: 8, changedAfterSigning: true });
    const check = toDocumentCheckResult('asset', appended);
    expect(check.finding).toBe('inconsistent');
    expect(check.observation).toContain('8 bytes follow the last declared signed ByteRange end');
    expect(validateCheckResult(check)).toEqual([]);
  });

  it('uses the furthest valid signed end when a later signature covers the full file', async () => {
    const original = signedBytes();
    const appended = join(original, object(3, '<< /Type /Sig /ByteRange [0 40 80 0000000000] /Contents <beef> >>'), '%%EOF\n');
    const text = new TextDecoder().decode(appended);
    const result = await analysePdf(encode(text.replace('80 0000000000', `80 ${String(appended.length - 80).padStart(10, '0')}`)));
    expect(result.signatures.byteRangeCount).toBe(2);
    expect(result.signatures.changedAfterSigning).toBe(false);
  });

  it('rejects out-of-bounds, overlapping and non-integer ByteRanges', async () => {
    for (const ranges of ['0 10 20 999999', '0 50 20 10', '0 1.5 20 10', '-1 10 20 10', '0 10 20']) {
      const result = await analysePdf(pdf([object(1, `<< /Type /Sig /ByteRange [${ranges}] /Contents <beef> >>`)]));
      expect(result.signatures.ranges[0]?.valid).toBe(false);
      expect(result.signatures.changedAfterSigning).toBe(false);
      expect(toDocumentCheckResult('asset', result).finding).toBe('inconclusive');
    }
  });

  it('counts distinct subset prefixes by family and detects active features without executing them', async () => {
    const result = await analysePdf(pdf([
      object(1, '<< /Type /Font /BaseFont /ABCDEF+Helvetica >>'), object(2, '<< /BaseFont /GHIJKL+Helvetica >>'),
      object(3, '<< /BaseFont /ABCDEF+Helvetica >>'), object(4, '<< /BaseFont /Times#2DRoman >>'),
      object(5, '<< /OpenAction 6 0 R /Names << /EmbeddedFiles [] >> >>'), object(6, '<< /S /JavaScript /JS (doNothing()) >>'),
    ]));
    expect(result.fonts).toEqual([
      { family: 'Helvetica', subsets: 2, subsetPrefixes: ['ABCDEF', 'GHIJKL'], occurrences: 3 },
      { family: 'Times-Roman', subsets: 0, subsetPrefixes: [], occurrences: 1 },
    ]);
    expect(result).toMatchObject({ javascript: true, openAction: true, embeddedFiles: true });
    expect(toDocumentCheckResult('asset', result).finding).toBe('inconclusive');
    expect(documentEvidence(result)).toContainEqual(expect.objectContaining({ label: 'Fonts', severity: 'notice' }));
  });

  it('finds AI tool names only in readable metadata, not page text', async () => {
    const body = stream(2, '', encode('(ChatGPT OpenAI Midjourney Firefly Gemini Copilot Stable Diffusion) Tj'));
    const result = await analysePdf(pdf([
      object(1, '<< /Producer (ChatGPT / OpenAI) /Creator (DALL-E) >>'), body,
      stream(3, '/Type /Metadata', encode(xml('<dc:description>Midjourney Firefly Gemini Copilot Stable Diffusion trainedAlgorithmicMedia</dc:description>'))),
    ], '/Info 1 0 R'));
    expect(result.c2pa.aiToolNames).toEqual(['ChatGPT', 'OpenAI', 'DALL', 'Midjourney', 'Firefly', 'Gemini', 'Copilot', 'Stable Diffusion']);
    expect(result.c2pa.trainedAlgorithmicMedia).toBe(true);
    expect(result.c2pa.present).toBe(false);
    expect(toDocumentCheckResult('asset', result).finding).toBe('inconclusive');
    expect((await analysePdf(pdf([body]))).c2pa.aiToolNames).toEqual([]);
  });

  it('detects the C2PA_Manifest relationship and actual JUMBF c2pa label without validating trust', async () => {
    function box(type: string, contents: Uint8Array) {
      const header = new Uint8Array(8);
      new DataView(header.buffer).setUint32(0, contents.length + 8);
      header.set(encode(type), 4);
      return join(header, contents);
    }
    const descriptor = box('jumd', join(new Uint8Array(16), new Uint8Array([2]), encode('c2pa\0')));
    const manifest = box('jumb', join(descriptor, box('json', encode('{"softwareAgent":"OpenAI","source":"trainedAlgorithmicMedia"}'))));
    const result = await analysePdf(pdf([stream(1, '/Type /EmbeddedFile /Subtype /application#2Fc2pa', manifest)]));
    expect(result.c2pa).toMatchObject({ present: true, jumbfLabel: true, manifestKey: false, verified: false, trainedAlgorithmicMedia: true, aiToolNames: ['OpenAI'] });
    const relationship = await analysePdf(pdf([object(1, '<< /AFRelationship /C2PA_Manifest >>')]));
    expect(relationship.c2pa.present).toBe(true);
    const wordOnly = await analysePdf(pdf([object(1, '<< /Title (c2pa) >>')], '/Info 1 0 R'));
    expect(wordOnly.c2pa.present).toBe(false);
  });
});

describe('bounded compression and object streams', () => {
  it('inflates XMP with DecompressionStream and reports its fields', async () => {
    const packet = encode(xml('<pdf:Producer>Compressed writer</pdf:Producer>'));
    const result = await analysePdf(pdf([stream(1, '/Type /Metadata /Subtype /XML /Filter /FlateDecode', await deflate(packet))]));
    expect(result.xmp).toMatchObject({ read: true, compressed: true, Producer: 'Compressed writer', status: 'read' });
    expect(result.compression).toMatchObject({ streams: 1, decodedStreams: 1, unreadStreams: 0, inflatedBytes: packet.length });
  });

  it('resolves an indirect stream Length before decoding, excluding delimiter newlines', async () => {
    const packet = encode(xml('<pdf:Producer>Indirect length writer</pdf:Producer>'));
    const compressed = await deflate(packet);
    const metadata = object(1, join('<< /Type /Metadata /Filter /FlateDecode /Length 2 0 R >>\nstream\n', compressed, '\r\nendstream'));
    const result = await analysePdf(pdf([metadata, object(2, String(compressed.length))]));
    expect(result.xmp).toMatchObject({ Producer: 'Indirect length writer', read: true });
    expect(result.compression).toMatchObject({ decodedStreams: 1, unreadStreams: 0, inflatedBytes: packet.length });
  });

  it('inflates an object stream and resolves Info, font names and JavaScript from its children', async () => {
    const first = '<< /Producer (Object stream writer) >>';
    const second = '<< /BaseFont /ABCDEF+EmbeddedFont >>';
    const third = '<< /S /JavaScript >>';
    const header = `5 0 6 ${first.length + 1} 7 ${first.length + second.length + 2} `;
    const data = encode(header + first + ' ' + second + ' ' + third);
    const result = await analysePdf(pdf([stream(1, `/Type /ObjStm /N 3 /First ${header.length} /Filter /FlateDecode`, await deflate(data))], '/Info 5 0 R'));
    expect(result.objectStreams).toBe(true);
    expect(result.info.Producer).toBe('Object stream writer');
    expect(result.fonts[0]).toMatchObject({ family: 'EmbeddedFont', subsets: 1 });
    expect(result.javascript).toBe(true);
    expect(result.compression.unreadStreams).toBe(0);
  });

  it('counts a cross-reference stream separately from EOF revisions', async () => {
    const result = await analysePdf(pdf([stream(1, '/Type /XRef /W [1 2 1] /Size 1', new Uint8Array([0, 0, 0, 0]))]));
    expect(result.revisions).toBe(1);
    expect(result.xrefOffsets).toHaveLength(2);
  });

  it.each(['LZWDecode', 'FlateDecode'])('fails soft on unsupported or broken %s XMP streams', async (filter) => {
    const result = await analysePdf(pdf([stream(1, `/Type /Metadata /Filter /${filter}`, encode('not compressed'))]));
    expect(result.xmp).toMatchObject({ read: false, status: 'xmp compressed, not read' });
    expect(result.compression.unreadStreams).toBe(1);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(toDocumentCheckResult('asset', result).finding).toBe('inconclusive');
  });

  it('fails soft when browser decompression is unavailable or the document is encrypted', async () => {
    const compressed = await deflate(encode(xml('<pdf:Producer>Writer</pdf:Producer>')));
    vi.stubGlobal('DecompressionStream', undefined);
    const unavailable = await analysePdf(pdf([stream(1, '/Type /Metadata /Filter /FlateDecode', compressed)]));
    expect(unavailable.warnings.some((warning) => warning.includes('DecompressionStream is unavailable'))).toBe(true);
    const encrypted = await analysePdf(pdf([object(1, '<< /Producer (Unreadable encrypted metadata) >>')], '/Info 1 0 R /Encrypt 9 0 R'));
    expect(encrypted.encrypted).toBe(true);
    expect(encrypted.info).toEqual({});
  });

  it('enforces a shared 20 MiB output budget across streams, failing soft', async () => {
    const padding = ' '.repeat(11 * 1024 * 1024);
    const packet = encode(xml(`<!--${padding}--><pdf:Producer>Budget writer</pdf:Producer>`));
    const compressed = await deflate(packet);
    const result = await analysePdf(pdf([
      stream(1, '/Type /Metadata /Filter /FlateDecode', compressed),
      stream(2, '/Type /Metadata /Filter /FlateDecode', compressed),
    ]));
    expect(result.compression.limitReached).toBe(true);
    expect(result.compression.inflatedBytes).toBeLessThanOrEqual(MAX_INFLATED_BYTES);
    expect(result.compression.decodedStreams).toBe(1);
    expect(result.compression.unreadStreams).toBe(1);
    expect(result.warnings.some((warning) => warning.includes('20 MiB total decompression limit'))).toBe(true);
    expect(toDocumentCheckResult('asset', result).finding).toBe('inconclusive');
  }, 15_000);
});
