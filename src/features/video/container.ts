// Reads facts straight from the bytes of an MP4 / MOV file (ISO Base Media). Nothing is decoded,
// changed or uploaded, and nothing here is proof of who made the video: metadata can be edited.

const C2PA_UUID = 'd8fec3d61b0e483c92975828877ec481';
const MAX_BOXES = 2000;
/** Seconds between the QuickTime epoch (1904-01-01) and the Unix epoch. */
const EPOCH_1904 = 2082844800;

interface Box {
  start: number;
  end: number;
  size: number;
  type: string;
  header: number;
}

export interface VideoTrack {
  id: number | null;
  kind: string;
  codec: string | null;
  seconds: number | null;
  width: number | null;
  height: number | null;
  audio: { channels: number | null; sampleRate: number | null } | null;
}

export interface ContainerFacts {
  supported: boolean;
  reason: string | null;
  container: string | null;
  majorBrand: string | null;
  brands: string[];
  seconds: number | null;
  /** Creation time written in the movie header, if any (ISO). Anyone can edit it. */
  createdAt: string | null;
  topLevel: string[];
  tracks: VideoTrack[];
  fragmented: boolean;
  /** True when the index sits before the media data (typical after a re-export for the web). */
  fastStart: boolean | null;
  mediaBytes: number;
  bitrate: number | null;
  /** A C2PA (Content Credentials) box is present. Presence only: the signature is checked separately. */
  c2paBoxes: number;
  /** Software names written into the file by whatever last saved it, verbatim. */
  writtenBy: string[];
}

function fourCC(b: Uint8Array, at: number): string | null {
  if (at < 0 || at + 4 > b.length) return null;
  return String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);
}
function hex(b: Uint8Array, at: number, n: number): string | null {
  if (at < 0 || at + n > b.length) return null;
  let s = '';
  for (let i = at; i < at + n; i++) s += b[i]!.toString(16).padStart(2, '0');
  return s;
}
const u32 = (v: DataView, at: number) => (at >= 0 && at + 4 <= v.byteLength ? v.getUint32(at, false) : null);
const u16 = (v: DataView, at: number) => (at >= 0 && at + 2 <= v.byteLength ? v.getUint16(at, false) : null);
function u64(v: DataView, at: number): number | null {
  if (at < 0 || at + 8 > v.byteLength) return null;
  const n = v.getBigUint64(at, false);
  return n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : null;
}

/** One box header. Returns null on anything malformed, which stops the walk. */
function boxAt(b: Uint8Array, v: DataView, start: number, end: number): Box | null {
  if (start + 8 > end) return null;
  const declared = u32(v, start);
  const type = fourCC(b, start + 4);
  if (declared === null || !type) return null;
  let header = 8;
  let size = declared;
  if (declared === 1) {
    const big = u64(v, start + 8);
    if (big === null || big < 16) return null;
    header = 16;
    size = big;
  } else if (declared === 0) size = end - start;
  if (size < header || start + size > end) return null;
  return { start, end: start + size, size, type, header };
}

function boxes(b: Uint8Array, v: DataView, start: number, end: number): Box[] {
  const out: Box[] = [];
  let at = start;
  while (at < end && out.length < MAX_BOXES) {
    const box = boxAt(b, v, at, end);
    if (!box) break;
    out.push(box);
    at = box.end;
  }
  return out;
}

function children(b: Uint8Array, v: DataView, box: Box): Box[] {
  // `meta` is a full box: four bytes of version and flags come before its children.
  const at = box.start + box.header + (box.type === 'meta' ? 4 : 0);
  return at < box.end ? boxes(b, v, at, box.end) : [];
}
const child = (b: Uint8Array, v: DataView, box: Box, type: string) => children(b, v, box).find((c) => c.type === type) ?? null;

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'udta', 'meta', 'ilst']);
function countC2pa(b: Uint8Array, v: DataView, list: Box[], depth = 0): number {
  if (depth > 8) return 0;
  let n = 0;
  for (const box of list) {
    if (box.type === 'uuid' && hex(b, box.start + box.header, 16) === C2PA_UUID) n++;
    if (CONTAINERS.has(box.type)) n += countC2pa(b, v, children(b, v, box), depth + 1);
  }
  return n;
}

function movieHeader(b: Uint8Array, v: DataView, box: Box): { seconds: number | null; createdAt: string | null } {
  const p = box.start + box.header;
  if (p + 4 > box.end) return { seconds: null, createdAt: null };
  const v1 = b[p] === 1;
  const created = v1 ? u64(v, p + 4) : u32(v, p + 4);
  const scale = u32(v, v1 ? p + 20 : p + 12);
  const duration = v1 ? u64(v, p + 24) : u32(v, p + 16);
  const unix = created ? created - EPOCH_1904 : 0;
  return {
    seconds: scale && duration !== null ? duration / scale : null,
    // Encoders that do not know the time write 0 (1904); that is "not recorded", not a date.
    createdAt: unix > 0 && unix < 4102444800 ? new Date(unix * 1000).toISOString() : null,
  };
}

const KINDS: Record<string, string> = { vide: 'video', soun: 'audio', text: 'text', subt: 'subtitle', clcp: 'caption', meta: 'metadata', hint: 'hint' };

function track(b: Uint8Array, v: DataView, trak: Box): VideoTrack {
  const tkhd = child(b, v, trak, 'tkhd');
  const mdia = child(b, v, trak, 'mdia');
  const mdhd = mdia ? child(b, v, mdia, 'mdhd') : null;
  const hdlr = mdia ? child(b, v, mdia, 'hdlr') : null;
  const minf = mdia ? child(b, v, mdia, 'minf') : null;
  const stbl = minf ? child(b, v, minf, 'stbl') : null;
  const stsd = stbl ? child(b, v, stbl, 'stsd') : null;

  const handler = hdlr && hdlr.start + hdlr.header + 12 <= hdlr.end ? fourCC(b, hdlr.start + hdlr.header + 8) : null;
  let id: number | null = null;
  let width: number | null = null;
  let height: number | null = null;
  if (tkhd) {
    const p = tkhd.start + tkhd.header;
    id = u32(v, b[p] === 1 ? p + 20 : p + 12);
    const w = u32(v, tkhd.end - 8);
    const h = u32(v, tkhd.end - 4);
    width = w ? Math.round(w / 65536) || null : null;
    height = h ? Math.round(h / 65536) || null : null;
  }
  let seconds: number | null = null;
  if (mdhd) {
    const p = mdhd.start + mdhd.header;
    const v1 = b[p] === 1;
    const scale = u32(v, v1 ? p + 20 : p + 12);
    const duration = v1 ? u64(v, p + 24) : u32(v, p + 16);
    seconds = scale && duration !== null ? duration / scale : null;
  }
  let codec: string | null = null;
  let audio: VideoTrack['audio'] = null;
  if (stsd) {
    const p = stsd.start + stsd.header;
    const entry = boxAt(b, v, p + 8, stsd.end);
    if (entry) {
      codec = entry.type;
      const e = entry.start + entry.header;
      if (handler === 'vide') {
        width ??= u16(v, e + 24);
        height ??= u16(v, e + 26);
      }
      if (handler === 'soun') {
        const rate = u32(v, e + 24);
        audio = { channels: u16(v, e + 16), sampleRate: rate ? Math.round(rate / 65536) : null };
      }
    }
  }
  return { id, kind: handler ? (KINDS[handler] ?? `other (${handler})`) : 'unknown', codec, seconds, width, height, audio };
}

/**
 * Software that names itself in the file. Looked for only outside the media data, in the parts of
 * the file that hold metadata, so a 300 MB video costs a few kilobytes of scanning.
 */
const TOOLS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/Lavf(\d+\.\d+\.\d+)/, (m) => `FFmpeg (Lavf ${m[1]})`],
  [/HandBrake ([\d.]+)/, (m) => `HandBrake ${m[1]}`],
  [/Adobe Premiere[ A-Za-z]{0,12}/, (m) => m[0].trim()],
  [/Adobe After Effects/, (m) => m[0]],
  [/CapCut/, () => 'CapCut'],
  [/DaVinci Resolve/, (m) => m[0]],
  [/Final Cut Pro/, (m) => m[0]],
  [/iMovie/, () => 'iMovie'],
  [/\b(OpenAI Sora|Sora|Runway|Pika Labs|Kling AI|Google Veo|Luma Dream Machine|Synthesia|HeyGen)\b/, (m) => m[0]],
];
/** Names in TOOLS that are video generators rather than editors. */
export const AI_VIDEO_TOOL = /Sora|Runway|Pika|Kling|Veo|Luma|Synthesia|HeyGen/;

function writtenBy(b: Uint8Array, v: DataView, top: Box[]): string[] {
  const found = new Set<string>();
  const decoder = new TextDecoder('latin1');
  // Only the boxes that hold text: user data and metadata. Sample tables are binary and would give chance matches.
  const moov = top.find((x) => x.type === 'moov');
  const regions = [
    ...top.filter((x) => ['udta', 'meta', 'uuid'].includes(x.type)),
    ...(moov ? children(b, v, moov).filter((x) => ['udta', 'meta'].includes(x.type)) : []),
  ];
  for (const box of regions) {
    const text = decoder.decode(b.subarray(box.start, Math.min(box.end, box.start + 1024 * 1024)));
    for (const [pattern, name] of TOOLS) {
      const m = text.match(pattern);
      if (m) found.add(name(m));
    }
  }
  return [...found].slice(0, 6);
}

const brand = (s: string | null) => (s ? s.replace(/\0/g, '').trim() || '(blank)' : '(unreadable)');

export function inspectContainer(bytes: Uint8Array): ContainerFacts {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const top = boxes(bytes, view, 0, bytes.length);
  const ftyp = top.find((x) => x.type === 'ftyp');
  if (!ftyp || ftyp.start !== 0 || ftyp.size < 16) {
    return {
      supported: false,
      reason: 'This file does not start like an MP4 or MOV video.',
      container: null, majorBrand: null, brands: [], seconds: null, createdAt: null,
      topLevel: top.map((x) => x.type), tracks: [], fragmented: false, fastStart: null, mediaBytes: 0, bitrate: null, c2paBoxes: 0, writtenBy: [],
    };
  }
  const majorBrand = brand(fourCC(bytes, ftyp.start + ftyp.header));
  const brands: string[] = [];
  for (let at = ftyp.start + ftyp.header + 8; at + 4 <= ftyp.end; at += 4) brands.push(brand(fourCC(bytes, at)));
  const moov = top.find((x) => x.type === 'moov') ?? null;
  const inMoov = moov ? children(bytes, view, moov) : [];
  const mvhd = inMoov.find((x) => x.type === 'mvhd') ?? null;
  const header = mvhd ? movieHeader(bytes, view, mvhd) : { seconds: null, createdAt: null };
  const media = top.filter((x) => x.type === 'mdat');
  const quicktime = majorBrand === 'qt' || brands.includes('qt');
  return {
    supported: true,
    reason: null,
    container: quicktime ? 'QuickTime (MOV)' : 'MP4',
    majorBrand,
    brands: [...new Set(brands)],
    seconds: header.seconds,
    createdAt: header.createdAt,
    topLevel: top.map((x) => x.type),
    tracks: inMoov.filter((x) => x.type === 'trak').map((t) => track(bytes, view, t)),
    fragmented: top.some((x) => x.type === 'moof'),
    fastStart: moov && media[0] ? moov.start < media[0].start : null,
    mediaBytes: media.reduce((n, x) => n + Math.max(0, x.size - x.header), 0),
    bitrate: header.seconds && header.seconds > 0 ? Math.round((bytes.length * 8) / header.seconds) : null,
    c2paBoxes: countC2pa(bytes, view, top),
    writtenBy: writtenBy(bytes, view, top),
  };
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return 'Unknown';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = n / 1024;
  let u = 0;
  while (value >= 1024 && u < units.length - 1) {
    value /= 1024;
    u++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[u]}`;
}

/** 01:07.4 */
export function stamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00.0';
  const m = Math.floor(seconds / 60);
  return `${String(m).padStart(2, '0')}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
}
