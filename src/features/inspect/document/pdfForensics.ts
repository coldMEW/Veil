import type { CheckResult } from '../../../contracts';

export const MAX_INFLATED_BYTES = 20 * 1024 * 1024;
const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const MAX_OBJECTS = 50_000;
const MAX_NODES = 300_000;
const MAX_TEXT = 8192;
const FIELDS = ['Producer', 'Creator', 'Author', 'Title', 'CreationDate', 'ModDate'] as const;
export type PdfMetadata = Partial<Record<typeof FIELDS[number], string>>;

export interface PdfAnalysis {
  isPdf: boolean;
  version: string | null;
  sizeBytes: number;
  revisions: number;
  revisionOffsets: number[];
  xrefOffsets: number[];
  prevOffsets: number[];
  info: PdfMetadata;
  xmp: PdfMetadata & { compressed: boolean; read: boolean; status: string };
  datesMismatch: boolean;
  modificationBeforeCreation: boolean;
  dateIssues: string[];
  fonts: Array<{ family: string; subsets: number; subsetPrefixes: string[]; occurrences: number }>;
  signatures: {
    fields: number;
    dictionaries: number;
    byteRangeCount: number;
    ranges: Array<{ offset: number; values: number[]; valid: boolean; end: number | null }>;
    lastSignedEnd: number | null;
    bytesAfterSignature: number;
    changedAfterSigning: boolean;
    verified: false;
  };
  javascript: boolean;
  openAction: boolean;
  embeddedFiles: boolean;
  objectStreams: boolean;
  compressed: boolean;
  encrypted: boolean;
  compression: { streams: number; decodedStreams: number; unreadStreams: number; inflatedBytes: number; limitReached: boolean };
  c2pa: { present: boolean; manifestKey: boolean; jumbfLabel: boolean; trainedAlgorithmicMedia: boolean; aiToolNames: string[]; verified: false };
  warnings: string[];
}

type Value = number | boolean | null | Name | PdfString | Ref | Map<string, Value> | Value[];
interface Name { kind: 'name'; value: string }
interface PdfString { kind: 'string'; value: string }
interface Ref { kind: 'ref'; object: number; generation: number }
interface PdfObject { id: number; generation: number; offset: number; value: Value; stream?: Uint8Array; streamOffset?: number }
interface Budget { nodes: number }
const whitespace = (c: string | undefined) => c !== undefined && /[\x00\t\n\f\r ]/.test(c);
const delimiter = (c: string | undefined) => c === undefined || whitespace(c) || '()<>[]{}/%'.includes(c);
const isDict = (v: Value | undefined): v is Map<string, Value> => v instanceof Map;
const isName = (v: Value | undefined, name: string) => !!v && typeof v === 'object' && 'kind' in v && v.kind === 'name' && v.value === name;
const isRef = (v: Value | undefined): v is Ref => !!v && typeof v === 'object' && 'kind' in v && v.kind === 'ref';

/** One character per original byte, preserving all file offsets (including non-ASCII bytes). */
function binaryString(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 16384) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 16384)));
  return chunks.join('');
}

function decodeString(bytes: number[]): string {
  const data = new Uint8Array(bytes);
  if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder('utf-16be').decode(data.subarray(2)).slice(0, MAX_TEXT);
  if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder('utf-16le').decode(data.subarray(2)).slice(0, MAX_TEXT);
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) return new TextDecoder().decode(data.subarray(3)).slice(0, MAX_TEXT);
  // PDFDocEncoding differs from Latin-1 in these slots.
  const accents = ['˘', 'ˇ', 'ˆ', '˙', '˝', '˛', '˚', '˜'];
  const symbols = ['•', '†', '‡', '…', '—', '–', 'ƒ', '⁄', '‹', '›', '−', '‰', '„', '“', '”', '‘', '’', '‚', '™', 'ﬁ', 'ﬂ', 'Ł', 'Œ', 'Š', 'Ÿ', 'Ž', 'ı', 'ł', 'œ', 'š', 'ž', ''];
  return bytes.slice(0, MAX_TEXT).map((b) => b >= 0x18 && b <= 0x1f ? accents[b - 0x18] :
    b >= 0x80 && b <= 0x9f ? symbols[b - 0x80] : b === 0xa0 ? '€' : String.fromCharCode(b)).join('');
}

/** Bounded PDF syntax reader. Strings/comments are consumed, never searched as dictionaries. */
class Reader {
  pos = 0;
  constructor(readonly text: string, readonly budget: Budget) {}

  skip(eofs?: number[]) {
    while (this.pos < this.text.length) {
      if (whitespace(this.text[this.pos])) { this.pos++; continue; }
      if (this.text[this.pos] !== '%') break;
      const start = this.pos;
      while (this.pos < this.text.length && !/[\r\n]/.test(this.text[this.pos]!)) this.pos++;
      if (/^%%EOF[\x00\t\f ]*$/.test(this.text.slice(start, this.pos))) eofs?.push(start);
    }
  }

  word(): string {
    this.skip();
    const start = this.pos;
    while (!delimiter(this.text[this.pos])) this.pos++;
    return this.text.slice(start, this.pos);
  }

  value(depth = 0): Value {
    if (++this.budget.nodes > MAX_NODES || depth > 48) throw new Error('PDF syntax complexity limit reached.');
    this.skip();
    const c = this.text[this.pos];
    if (c === '(') {
      this.pos++;
      const bytes: number[] = [];
      let nesting = 1;
      while (this.pos < this.text.length && nesting) {
        const ch = this.text[this.pos++]!;
        if (ch === '\\') {
          const next = this.text[this.pos++];
          if (next === undefined) break;
          if (next === '\r' || next === '\n') { if (next === '\r' && this.text[this.pos] === '\n') this.pos++; continue; }
          const escapes: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12 };
          if (/[0-7]/.test(next)) {
            let octal = next;
            for (let k = 0; k < 2 && /[0-7]/.test(this.text[this.pos] ?? 'x'); k++) octal += this.text[this.pos++]!;
            bytes.push(parseInt(octal, 8) & 255);
          } else bytes.push(escapes[next] ?? next.charCodeAt(0));
        } else if (ch === '(') { nesting++; bytes.push(40); }
        else if (ch === ')') { if (--nesting) bytes.push(41); }
        else if (ch === '\r') { if (this.text[this.pos] === '\n') this.pos++; bytes.push(10); }
        else bytes.push(ch.charCodeAt(0));
        if (bytes.length > 1024 * 1024) throw new Error('PDF string size limit reached.');
      }
      if (nesting) throw new Error('Unterminated PDF literal string.');
      return { kind: 'string', value: decodeString(bytes) };
    }
    if (this.text.startsWith('<<', this.pos)) {
      this.pos += 2;
      const dict = new Map<string, Value>();
      while (this.pos < this.text.length) {
        this.skip();
        if (this.text.startsWith('>>', this.pos)) { this.pos += 2; return dict; }
        const key = this.value(depth + 1);
        if (!key || typeof key !== 'object' || !('kind' in key) || key.kind !== 'name') throw new Error('Invalid PDF dictionary key.');
        dict.set(key.value, this.value(depth + 1));
      }
      throw new Error('Unterminated PDF dictionary.');
    }
    if (c === '<') {
      this.pos++;
      let hex = '';
      while (this.pos < this.text.length && this.text[this.pos] !== '>') {
        const ch = this.text[this.pos++]!;
        if (whitespace(ch)) continue;
        if (!/[0-9a-f]/i.test(ch)) throw new Error('Invalid PDF hex string.');
        hex += ch;
        if (hex.length > 2 * 1024 * 1024) throw new Error('PDF string size limit reached.');
      }
      if (this.text[this.pos++] !== '>') throw new Error('Unterminated PDF hex string.');
      if (hex.length % 2) hex += '0';
      const bytes: number[] = [];
      for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
      return { kind: 'string', value: decodeString(bytes) };
    }
    if (c === '/') {
      const start = ++this.pos;
      while (!delimiter(this.text[this.pos])) this.pos++;
      return { kind: 'name', value: this.text.slice(start, this.pos).replace(/#([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))) };
    }
    if (c === '[') {
      this.pos++;
      const values: Value[] = [];
      while (this.pos < this.text.length) {
        this.skip();
        if (this.text[this.pos] === ']') { this.pos++; return values; }
        values.push(this.value(depth + 1));
      }
      throw new Error('Unterminated PDF array.');
    }
    const word = this.word();
    if (word === 'null') return null;
    if (word === 'true' || word === 'false') return word === 'true';
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(word)) {
      const number = Number(word);
      const end = this.pos;
      if (Number.isSafeInteger(number) && number >= 0) {
        this.skip();
        const generation = this.word();
        if (/^\d+$/.test(generation) && this.word() === 'R') return { kind: 'ref', object: number, generation: Number(generation) };
        this.pos = end;
      }
      return number;
    }
    throw new Error('Unsupported or malformed PDF value.');
  }
}

function resolve(value: Value | undefined, objects: Map<string, PdfObject>): Value | undefined {
  const seen = new Set<string>();
  while (isRef(value)) {
    const key = `${value.object}:${value.generation}`;
    if (seen.has(key) || seen.size > 32) return undefined;
    seen.add(key);
    value = objects.get(key)?.value;
  }
  return value;
}

function metadata(dict: Value | undefined, objects: Map<string, PdfObject>): PdfMetadata {
  const result: PdfMetadata = {};
  if (isDict(dict)) for (const key of FIELDS) {
    const value = resolve(dict.get(key), objects);
    if (value && typeof value === 'object' && 'kind' in value && value.kind === 'string') result[key] = value.value;
  }
  return result;
}

function xmlText(text: string): string {
  const escaped = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, body: string) => body.replace(/&/g, '&amp;').replace(/</g, '&lt;'));
  return escaped.replace(/<[^>]*>/g, ' ').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '�';
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[entity.toLowerCase()]!;
  }).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}

function readXmp(xml: string): PdfMetadata {
  const clean = xml.replace(/<!--[\s\S]*?-->/g, '');
  const prefixes = { xmp: ['xmp'], pdf: ['pdf'], dc: ['dc'] };
  const uris: Record<string, keyof typeof prefixes> = {
    'http://ns.adobe.com/xap/1.0/': 'xmp', 'http://ns.adobe.com/pdf/1.3/': 'pdf', 'http://purl.org/dc/elements/1.1/': 'dc',
  };
  for (const match of clean.matchAll(/xmlns:([\w.-]+)\s*=\s*(["'])(.*?)\2/g)) {
    const group = uris[match[3]!];
    if (group) prefixes[group].push(match[1]!);
  }
  function property(group: keyof typeof prefixes, name: string) {
    for (const prefix of prefixes[group]) {
      const tag = `${prefix}:${name}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const attribute = new RegExp(`(?:^|\\s)${tag}\\s*=\\s*(["'])([\\s\\S]*?)\\1`).exec(clean);
      if (attribute) return xmlText(attribute[2]!);
      const element = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}\\s*>`).exec(clean);
      if (element) return xmlText(element[1]!);
    }
    return undefined;
  }
  const result: PdfMetadata = {};
  const fields: Array<[keyof PdfMetadata, keyof typeof prefixes, string]> = [
    ['Creator', 'xmp', 'CreatorTool'], ['Producer', 'pdf', 'Producer'], ['CreationDate', 'xmp', 'CreateDate'],
    ['ModDate', 'xmp', 'ModifyDate'], ['Author', 'dc', 'creator'], ['Title', 'dc', 'title'],
  ];
  for (const [key, group, name] of fields) { const value = property(group, name); if (value !== undefined) result[key] = value; }
  return result;
}

interface DateSpan { start: number; end: number; zoned: boolean }
function dateSpan(value: string): DateSpan | null {
  const pdf = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(Z|[+-]\d{2}(?:'?\d{2}'?)?)?$/.exec(value.trim());
  const iso = /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?)?)?$/.exec(value.trim());
  const m = pdf ?? iso;
  if (!m) return null;
  const parts = [Number(m[1]), Number(m[2] ?? 1), Number(m[3] ?? 1), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)];
  const [year, month, day, hour, minute, second] = parts as [number, number, number, number, number, number];
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null;
  const start = new Date(0);
  start.setUTCFullYear(year, month - 1, day);
  start.setUTCHours(hour, minute, second, 0);
  if (start.getUTCMonth() !== month - 1 || start.getUTCDate() !== day) return null;
  const end = new Date(start);
  let precision = 1;
  while (precision < 6 && m[precision + 1] !== undefined) precision++;
  if (precision === 1) end.setUTCFullYear(year + 1);
  else if (precision === 2) end.setUTCMonth(month);
  else if (precision === 3) end.setUTCDate(day + 1);
  else if (precision === 4) end.setUTCHours(hour + 1);
  else if (precision === 5) end.setUTCMinutes(minute + 1);
  else end.setUTCSeconds(second + 1);
  let offset = 0;
  const zone = m[7];
  if (zone && zone !== 'Z') {
    const digits = zone.slice(1).replace(/[':]/g, '');
    const hours = Number(digits.slice(0, 2));
    const minutes = Number(digits.slice(2) || 0);
    if (hours > 23 || minutes > 59) return null;
    offset = (hours * 60 + minutes) * 60_000 * (zone[0] === '+' ? 1 : -1);
  }
  return { start: start.getTime() - offset, end: end.getTime() - offset - 1, zoned: !!zone };
}

function compareDates(analysis: PdfAnalysis) {
  for (const [label, source] of [['Info', analysis.info], ['XMP', analysis.xmp]] as const) {
    const created = source.CreationDate ? dateSpan(source.CreationDate) : null;
    const modified = source.ModDate ? dateSpan(source.ModDate) : null;
    if (source.CreationDate && !created || source.ModDate && !modified) analysis.warnings.push(`${label} contains an unreadable date.`);
    if (created && modified && created.zoned === modified.zoned && modified.end < created.start) {
      analysis.modificationBeforeCreation = true;
      analysis.dateIssues.push(`${label} ModDate is earlier than CreationDate.`);
    }
  }
  for (const key of ['CreationDate', 'ModDate'] as const) {
    const info = analysis.info[key] ? dateSpan(analysis.info[key]!) : null;
    const xmp = analysis.xmp[key] ? dateSpan(analysis.xmp[key]!) : null;
    if (info && xmp && info.zoned === xmp.zoned && (info.end < xmp.start || xmp.end < info.start)) {
      analysis.dateIssues.push(`Info and XMP ${key} do not match.`);
    } else if (info && xmp && info.zoned !== xmp.zoned) analysis.warnings.push(`${key} comparison is limited by a missing timezone.`);
  }
  analysis.datesMismatch = analysis.dateIssues.length > 0;
}

async function inflate(data: Uint8Array, analysis: PdfAnalysis): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('DecompressionStream is unavailable.');
  const reader = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value.byteLength > MAX_INFLATED_BYTES - analysis.compression.inflatedBytes) {
        analysis.compression.limitReached = true;
        throw new Error('20 MiB total decompression limit reached.');
      }
      analysis.compression.inflatedBytes += value.byteLength;
      length += value.byteLength;
      chunks.push(value);
    }
  } catch (error) {
    try { await reader.cancel(); } catch { /* Preserve the original decoding error. */ }
    throw error;
  } finally { reader.releaseLock(); }
  const out = new Uint8Array(length);
  let pos = 0;
  for (const chunk of chunks) { out.set(chunk, pos); pos += chunk.length; }
  return out;
}

function hasJumbfLabel(bytes: Uint8Array, start = 0, end = bytes.length, depth = 0): boolean {
  if (depth > 20) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let pos = start; pos + 8 <= end;) {
    const size = view.getUint32(pos);
    if (size < 8 || pos + size > end) break;
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    if (type === 'jumd' && size >= 26 && (bytes[pos + 24]! & 2)) {
      const zero = bytes.indexOf(0, pos + 25);
      if (zero >= 0 && zero < pos + size && binaryString(bytes.subarray(pos + 25, zero)) === 'c2pa') return true;
    }
    if (type === 'jumb' && hasJumbfLabel(bytes, pos + 8, pos + size, depth + 1)) return true;
    pos += size;
  }
  return false;
}

/** Browser-local, bounded structural scan. No rendering, script execution or external retrieval. */
export async function analysePdf(bytes: Uint8Array): Promise<PdfAnalysis> {
  const header = /^%PDF-(\d\.\d)(?=[\r\n\x00\t ])/i.exec(binaryString(bytes.subarray(0, 16)));
  const analysis: PdfAnalysis = {
    isPdf: !!header, version: header?.[1] ?? null, sizeBytes: bytes.byteLength,
    revisions: 0, revisionOffsets: [], xrefOffsets: [], prevOffsets: [], info: {},
    xmp: { compressed: false, read: false, status: 'absent' }, datesMismatch: false, modificationBeforeCreation: false, dateIssues: [], fonts: [],
    signatures: { fields: 0, dictionaries: 0, byteRangeCount: 0, ranges: [], lastSignedEnd: null, bytesAfterSignature: 0, changedAfterSigning: false, verified: false },
    javascript: false, openAction: false, embeddedFiles: false, objectStreams: false, compressed: false, encrypted: false,
    compression: { streams: 0, decodedStreams: 0, unreadStreams: 0, inflatedBytes: 0, limitReached: false },
    c2pa: { present: false, manifestKey: false, jumbfLabel: false, trainedAlgorithmicMedia: false, aiToolNames: [], verified: false }, warnings: [],
  };
  if (!header) { analysis.warnings.push('No PDF header at the start of the file.'); return analysis; }
  if (bytes.byteLength > MAX_INPUT_BYTES) { analysis.warnings.push('Input exceeds the 64 MiB structure-scan limit; structures were not read.'); return analysis; }
  const objects = new Map<string, PdfObject>();
  const trailers: Array<{ offset: number; value: Map<string, Value> }> = [];
  const reader = new Reader(binaryString(bytes), { nodes: 0 });
  const addObject = (object: PdfObject) => {
    const key = `${object.id}:${object.generation}`;
    const previous = objects.get(key);
    if (!previous || previous.offset <= object.offset) objects.set(key, object);
  };
  try {
    while (reader.pos < reader.text.length) {
      reader.skip(analysis.revisionOffsets);
      if (reader.pos >= reader.text.length) break;
      const offset = reader.pos;
      const objectHeader = /^(\d+)\s+(\d+)\s+obj\b/.exec(reader.text.slice(offset, offset + 100));
      if (objectHeader) {
        if (objects.size >= MAX_OBJECTS) throw new Error('PDF object count limit reached.');
        reader.pos += objectHeader[0].length;
        const value = reader.value();
        const object: PdfObject = { id: Number(objectHeader[1]), generation: Number(objectHeader[2]), offset, value };
        reader.skip();
        if (isDict(value) && reader.text.startsWith('stream', reader.pos)) {
          reader.pos += 6;
          if (reader.text[reader.pos] === '\r') reader.pos++;
          if (reader.text[reader.pos] === '\n') reader.pos++;
          const start = reader.pos;
          const length = value.get('Length');
          let end = typeof length === 'number' && Number.isSafeInteger(length) && length >= 0 ? start + length : -1;
          let fallback = false;
          if (end < start || end > bytes.length || !/^[\r\n]*endstream\b/.test(reader.text.slice(end, end + 20))) {
            fallback = true;
            end = reader.text.indexOf('endstream', start);
            if (end < 0) throw new Error('Unterminated PDF stream.');
            analysis.warnings.push('A stream used delimiter fallback because its Length was indirect or invalid.');
          }
          // A delimiter-fallback EOL belongs to endstream, not the compressed payload.
          // The exact indirect Length is resolved again before decoding below.
          let dataEnd = end;
          if (fallback && reader.text[dataEnd - 1] === '\n') dataEnd--;
          if (fallback && reader.text[dataEnd - 1] === '\r') dataEnd--;
          object.stream = bytes.subarray(start, dataEnd);
          object.streamOffset = start;
          reader.pos = end;
          reader.skip();
          if (reader.word() !== 'endstream') throw new Error('Invalid PDF stream ending.');
        }
        addObject(object);
        if (isDict(value) && isName(value.get('Type'), 'XRef')) {
          analysis.xrefOffsets.push(offset);
          trailers.push({ offset, value });
        }
        if (reader.word() !== 'endobj') throw new Error('Missing PDF endobj marker.');
      } else {
        const word = reader.word();
        if (word === 'xref') analysis.xrefOffsets.push(offset);
        else if (word === 'trailer') { const value = reader.value(); if (isDict(value)) trailers.push({ offset, value }); }
        else if (!word) reader.value(); // Consume stray string/array as syntax, not feature keywords.
      }
    }
  } catch (error) { analysis.warnings.push(error instanceof Error ? error.message : 'PDF structure parsing stopped.'); }
  analysis.revisions = analysis.revisionOffsets.length;
  if (!analysis.revisions) analysis.warnings.push('No complete %%EOF revision marker was read.');
  for (const trailer of trailers) {
    if (trailer.value.has('Encrypt') && trailer.value.get('Encrypt') !== null) analysis.encrypted = true;
    const prev = trailer.value.get('Prev');
    if (typeof prev === 'number' && Number.isSafeInteger(prev) && prev >= 0) analysis.prevOffsets.push(prev);
  }
  if (analysis.encrypted) analysis.warnings.push('Encrypted metadata and object streams were not decrypted.');

  const streams = [...objects.values()].filter((object) => object.stream !== undefined && isDict(object.value)).sort((a, b) => a.offset - b.offset);
  const metadataTexts: string[] = [];
  const decoded = new Map<PdfObject, Uint8Array | null>();
  async function decodeStream(object: PdfObject): Promise<Uint8Array | null> {
    if (decoded.has(object)) return decoded.get(object)!;
    const dict = object.value as Map<string, Value>;
    const length = resolve(dict.get('Length'), objects);
    if (object.streamOffset !== undefined && typeof length === 'number' && Number.isSafeInteger(length) && length >= 0 &&
        object.streamOffset + length <= bytes.length && /^[\r\n]*endstream\b/.test(reader.text.slice(object.streamOffset + length, object.streamOffset + length + 20))) {
      object.stream = bytes.subarray(object.streamOffset, object.streamOffset + length);
    }
    const filter = resolve(dict.get('Filter'), objects);
    const filters = filter == null ? [] : Array.isArray(filter) ? filter : [filter];
    if (!filters.length) { decoded.set(object, object.stream!); return object.stream!; }
    try {
      if (analysis.encrypted) throw new Error('Encrypted stream not read.');
      const parms = resolve(dict.get('DecodeParms'), objects);
      if (isDict(parms) && typeof parms.get('Predictor') === 'number' && Number(parms.get('Predictor')) > 1) throw new Error('Predictor filter not read.');
      let data = object.stream!;
      for (const name of filters) {
        if (!isName(name, 'FlateDecode') && !isName(name, 'Fl')) throw new Error('Unsupported stream filter.');
        data = await inflate(data, analysis);
      }
      analysis.compression.decodedStreams++;
      decoded.set(object, data);
      return data;
    } catch (error) {
      decoded.set(object, null);
      analysis.warnings.push(`Stream ${object.id}: ${error instanceof Error ? error.message : 'could not be decoded'}`);
      return null;
    }
  }

  for (const object of streams) {
    const dict = object.value as Map<string, Value>;
    if (dict.has('Filter')) { analysis.compression.streams++; analysis.compressed = true; }
    const objectStream = isName(dict.get('Type'), 'ObjStm');
    const xmp = isName(dict.get('Type'), 'Metadata') || isName(dict.get('Subtype'), 'XML');
    analysis.objectStreams ||= objectStream;
    if (xmp && dict.has('Filter')) analysis.xmp.compressed = true;
    if (!objectStream && !xmp && !isName(dict.get('Type'), 'EmbeddedFile') && !isName(dict.get('AFRelationship'), 'C2PA_Manifest')) continue;
    const data = await decodeStream(object);
    if (!data) { if (xmp) analysis.xmp.status = 'xmp compressed, not read'; continue; }
    const jumbf = hasJumbfLabel(data);
    analysis.c2pa.jumbfLabel ||= jumbf;
    if (jumbf) metadataTexts.push(binaryString(data));
    if (xmp) {
      if (analysis.encrypted) { analysis.xmp.status = 'encrypted, not read'; continue; }
      const xml = data[0] === 0xfe && data[1] === 0xff ? new TextDecoder('utf-16be').decode(data.subarray(2)) :
        data[0] === 0xff && data[1] === 0xfe ? new TextDecoder('utf-16le').decode(data.subarray(2)) : new TextDecoder().decode(data);
      Object.assign(analysis.xmp, readXmp(xml));
      analysis.xmp.read = true;
      analysis.xmp.status = 'read';
      metadataTexts.push(xml);
    }
    if (objectStream) {
      try {
        const n = resolve(dict.get('N'), objects);
        const first = resolve(dict.get('First'), objects);
        if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0 || n + objects.size > MAX_OBJECTS ||
            typeof first !== 'number' || !Number.isSafeInteger(first) || first < 0 || first > data.length) throw new Error('Invalid object stream header.');
        const text = binaryString(data);
        const headerReader = new Reader(text.slice(0, first), reader.budget);
        const entries: Array<{ id: number; start: number }> = [];
        for (let i = 0; i < n; i++) {
          const id = Number(headerReader.word());
          const start = Number(headerReader.word());
          if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(start) || start < 0 || first + start >= data.length ||
              i > 0 && start <= entries[i - 1]!.start) throw new Error('Invalid object stream offsets.');
          entries.push({ id, start });
        }
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i]!;
          const child = new Reader(text.slice(first + entry.start, first + (entries[i + 1]?.start ?? data.length - first)), reader.budget);
          addObject({ id: entry.id, generation: 0, offset: object.offset, value: child.value() });
        }
      } catch (error) { analysis.warnings.push(error instanceof Error ? error.message : 'Object stream could not be read.'); }
    }
  }
  analysis.compression.unreadStreams = streams.filter((object) => (object.value as Map<string, Value>).has('Filter') && !decoded.get(object)).length;

  let infoValue: Value | undefined;
  for (const trailer of trailers.sort((a, b) => a.offset - b.offset)) if (trailer.value.has('Info')) infoValue = trailer.value.get('Info');
  if (!analysis.encrypted) analysis.info = metadata(resolve(infoValue, objects), objects);
  metadataTexts.push(...Object.values(analysis.info));
  const families = new Map<string, { prefixes: Set<string>; occurrences: number }>();
  const seen = new Set<Value>();
  function visit(value: Value, offset: number) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) { for (const child of value) visit(child, offset); return; }
    if (!(value instanceof Map)) return;
    if (isName(value.get('FT'), 'Sig')) analysis.signatures.fields++;
    if (isName(value.get('Type'), 'Sig')) analysis.signatures.dictionaries++;
    if (value.has('ByteRange')) {
      analysis.signatures.byteRangeCount++;
      const raw = resolve(value.get('ByteRange'), objects);
      const ranges = Array.isArray(raw) && raw.every((n) => typeof n === 'number') ? raw as number[] : [];
      let valid = ranges.length >= 4 && ranges.length % 2 === 0 && ranges[0] === 0;
      let end = 0;
      for (let i = 0; i < ranges.length; i += 2) {
        const start = ranges[i]!;
        const length = ranges[i + 1]!;
        valid &&= Number.isSafeInteger(start) && Number.isSafeInteger(length) && start >= end && length >= 0 && start + length <= bytes.length;
        end = start + length;
      }
      analysis.signatures.ranges.push({ offset, values: ranges, valid, end: valid ? end : null });
      if (valid && (isName(value.get('Type'), 'Sig') || value.has('Contents'))) analysis.signatures.lastSignedEnd = Math.max(analysis.signatures.lastSignedEnd ?? 0, end);
      if (!valid) analysis.warnings.push('An invalid or out-of-bounds signature ByteRange was not used.');
    }
    for (const [key, child] of value) {
      if (key === 'JavaScript' || key === 'JS' || isName(child, 'JavaScript')) analysis.javascript = true;
      if (key === 'OpenAction') analysis.openAction = true;
      if (key === 'EmbeddedFiles' || key === 'EF' || isName(child, 'EmbeddedFile')) analysis.embeddedFiles = true;
      if (key === 'C2PA_Manifest' || isName(child, 'C2PA_Manifest')) analysis.c2pa.manifestKey = true;
      if (key === 'BaseFont' && child && typeof child === 'object' && 'kind' in child && child.kind === 'name') {
        const prefix = /^([A-Z]{6})\+/.exec(child.value);
        const family = child.value.replace(/^[A-Z]{6}\+/, '');
        const entry = families.get(family) ?? { prefixes: new Set<string>(), occurrences: 0 };
        if (prefix) entry.prefixes.add(prefix[1]!);
        entry.occurrences++;
        families.set(family, entry);
      }
      visit(child, offset);
    }
  }
  for (const object of objects.values()) visit(object.value, object.offset);
  for (const trailer of trailers) visit(trailer.value, trailer.offset);
  analysis.fonts = [...families].map(([family, entry]) => ({ family, subsets: entry.prefixes.size, subsetPrefixes: [...entry.prefixes].sort(), occurrences: entry.occurrences })).sort((a, b) => a.family.localeCompare(b.family));
  const end = analysis.signatures.lastSignedEnd;
  if (end !== null) analysis.signatures.bytesAfterSignature = Math.max(0, bytes.length - end);
  analysis.signatures.changedAfterSigning = analysis.signatures.bytesAfterSignature > 0;
  analysis.c2pa.present = analysis.c2pa.manifestKey || analysis.c2pa.jumbfLabel;
  const readable = metadataTexts.join('\n');
  analysis.c2pa.trainedAlgorithmicMedia = /\btrainedAlgorithmicMedia\b/i.test(readable);
  const tools: Array<[string, RegExp]> = [
    ['ChatGPT', /\bChatGPT\b/i], ['OpenAI', /\bOpenAI\b/i], ['DALL', /\bDALL(?:[·.\s-]?E)?\b/i],
    ['Midjourney', /\bMidjourney\b/i], ['Firefly', /\bFirefly\b/i], ['Gemini', /\bGemini\b/i],
    ['Copilot', /\bCopilot\b/i], ['Stable Diffusion', /\bStable[\s-]+Diffusion\b/i],
  ];
  analysis.c2pa.aiToolNames = tools.filter(([, pattern]) => pattern.test(readable)).map(([name]) => name);
  compareDates(analysis);
  analysis.warnings = [...new Set(analysis.warnings)];
  return analysis;
}

export function toDocumentCheckResult(assetId: string, analysis: PdfAnalysis): CheckResult {
  const facts: string[] = [];
  if (!analysis.isPdf) facts.push('No PDF header was found.');
  else {
    if (analysis.revisions > 1) facts.push(`Saved ${analysis.revisions} times: ${analysis.revisions - 1} incremental update${analysis.revisions === 2 ? '' : 's'} after the first save.`);
    else facts.push(`${analysis.revisions} complete PDF revision marker${analysis.revisions === 1 ? '' : 's'} found.`);
    if (analysis.info.Creator) facts.push(`Creator metadata: ${analysis.info.Creator}.`);
    if (analysis.info.Producer) facts.push(`Producer metadata: ${analysis.info.Producer}.`);
    if (analysis.signatures.changedAfterSigning) facts.push(`${analysis.signatures.bytesAfterSignature} bytes follow the last declared signed ByteRange end.`);
    facts.push(...analysis.dateIssues);
    if (analysis.c2pa.aiToolNames.length) facts.push(`Readable metadata mentions ${analysis.c2pa.aiToolNames.join(', ')}.`);
    if (analysis.c2pa.present) facts.push('A C2PA manifest marker is present; it was not validated.');
  }
  const inconsistent = analysis.isPdf && (analysis.signatures.changedAfterSigning || analysis.modificationBeforeCreation);
  return {
    id: 'document-structure', assetId, kind: 'provenance', execution: analysis.isPdf ? 'complete' : 'unavailable',
    finding: inconsistent ? 'inconsistent' : 'inconclusive', title: 'Document structure', observation: facts.join(' '),
    method: 'Local PDF syntax and metadata scan, including readable FlateDecode object streams and XMP, with a 20 MiB total decompression budget. No rendering or script execution.',
    assumptions: ['Readable metadata and declared byte ranges describe the document structure; their claims have not been independently verified.'],
    limitations: [
      'Structure shows editing history, not who wrote the content or whether it is true.',
      'Metadata can be changed or removed; tool names in metadata do not establish authorship.',
      'Incremental saves, mixed font subsets and active features can occur in ordinary workflows.',
      'Signature cryptography, certificate trust, permitted post-signature changes and C2PA claims were not verified.',
      'This is a bounded structural scan, not a full PDF validator; revision markers can be missing or misleading.',
      `${analysis.compression.unreadStreams} compressed stream(s) were not read; encrypted data and unsupported filters are not decoded.`,
      'Incomplete dates and missing timezones limit date comparisons.',
      ...analysis.warnings,
    ],
    reason: inconsistent ? undefined : 'These structural observations do not establish content authorship or truth.',
    evidence: { ...analysis }, overlays: [], source: 'live',
  };
}
