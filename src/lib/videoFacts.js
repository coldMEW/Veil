const C2PA_UUID = 'd8fec3d61b0e483c92975828877ec481';
const MAX_BOXES = 2_000;

function fourCC(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.length) return null;
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function hex(bytes, offset, length) {
  if (offset < 0 || offset + length > bytes.length) return null;
  return Array.from(bytes.subarray(offset, offset + length), (value) => value.toString(16).padStart(2, '0')).join('');
}

function u32(view, offset) {
  return offset + 4 <= view.byteLength ? view.getUint32(offset, false) : null;
}

function u16(view, offset) {
  return offset + 2 <= view.byteLength ? view.getUint16(offset, false) : null;
}

function u64(view, offset) {
  if (offset + 8 > view.byteLength) return null;
  const value = view.getBigUint64(offset, false);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

/** Read a basic ISO BMFF box header. The parser intentionally stops on malformed boxes. */
function boxAt(bytes, view, start, end) {
  if (start + 8 > end) return null;
  const declared = u32(view, start);
  const type = fourCC(bytes, start + 4);
  if (declared === null || !type) return null;

  let headerSize = 8;
  let size = declared;
  if (declared === 1) {
    const extended = u64(view, start + 8);
    if (extended === null || extended < 16) return null;
    headerSize = 16;
    size = extended;
  } else if (declared === 0) {
    size = end - start;
  }

  if (size < headerSize || start + size > end) return null;
  return { start, end: start + size, size, type, headerSize };
}

function listBoxes(bytes, view, start, end, limit = MAX_BOXES) {
  const boxes = [];
  let cursor = start;
  while (cursor < end && boxes.length < limit) {
    const box = boxAt(bytes, view, cursor, end);
    if (!box) break;
    boxes.push(box);
    cursor = box.end;
  }
  return boxes;
}

function parseMvhd(bytes, view, box) {
  const payload = box.start + box.headerSize;
  if (payload + 4 > box.end) return null;
  const version = bytes[payload];
  const timeScaleOffset = version === 1 ? payload + 20 : payload + 12;
  const durationOffset = version === 1 ? payload + 24 : payload + 16;
  const timeScale = u32(view, timeScaleOffset);
  const duration = version === 1 ? u64(view, durationOffset) : u32(view, durationOffset);
  if (!timeScale || duration === null) return null;
  return duration / timeScale;
}

function countC2paUuids(bytes, view, boxes, depth = 0) {
  if (depth > 8) return 0;
  const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'udta', 'meta', 'ilst']);
  let count = 0;
  for (const box of boxes) {
    if (box.type === 'uuid' && hex(bytes, box.start + box.headerSize, 16) === C2PA_UUID) count += 1;
    if (containers.has(box.type)) {
      // `meta` carries a four-byte full-box header before its children.
      const childStart = box.start + box.headerSize + (box.type === 'meta' ? 4 : 0);
      if (childStart < box.end) count += countC2paUuids(bytes, view, listBoxes(bytes, view, childStart, box.end), depth + 1);
    }
  }
  return count;
}

function readableBrand(value) {
  return value ? value.replace(/\0/g, '').trim() || '(blank)' : '(unreadable)';
}

function childBoxes(bytes, view, box) {
  const offset = box.start + box.headerSize + (box.type === 'meta' ? 4 : 0);
  return offset < box.end ? listBoxes(bytes, view, offset, box.end) : [];
}

function childByType(bytes, view, box, type) {
  return childBoxes(bytes, view, box).find((child) => child.type === type) ?? null;
}

function decodeLanguage(packed) {
  if (packed === null || packed === 0) return null;
  const letters = [(packed >> 10) & 0x1f, (packed >> 5) & 0x1f, packed & 0x1f];
  if (letters.some((letter) => letter === 0)) return null;
  return String.fromCharCode(...letters.map((letter) => letter + 0x60));
}

function fixed1616(value) {
  return value === null ? null : value / 65536;
}

function parseTkhd(view, box) {
  const payload = box.start + box.headerSize;
  if (payload + 4 > box.end) return null;
  const version = view.getUint8(payload);
  const trackId = u32(view, version === 1 ? payload + 20 : payload + 12);
  const width = fixed1616(u32(view, box.end - 8));
  const height = fixed1616(u32(view, box.end - 4));
  return {
    trackId,
    width: width && width > 0 ? width : null,
    height: height && height > 0 ? height : null,
  };
}

function parseMdhd(view, box) {
  const payload = box.start + box.headerSize;
  if (payload + 4 > box.end) return null;
  const version = view.getUint8(payload);
  const timeScaleOffset = version === 1 ? payload + 20 : payload + 12;
  const durationOffset = version === 1 ? payload + 24 : payload + 16;
  const languageOffset = version === 1 ? payload + 32 : payload + 20;
  const timeScale = u32(view, timeScaleOffset);
  const duration = version === 1 ? u64(view, durationOffset) : u32(view, durationOffset);
  return {
    timeScale,
    duration,
    durationSeconds: timeScale && duration !== null ? duration / timeScale : null,
    language: decodeLanguage(u16(view, languageOffset)),
  };
}

function parseHdlr(bytes, view, box) {
  const payload = box.start + box.headerSize;
  return payload + 12 <= box.end ? fourCC(bytes, payload + 8) : null;
}

function parseStsd(bytes, view, box, handlerType) {
  const payload = box.start + box.headerSize;
  const entryCount = u32(view, payload + 4);
  if (entryCount === null || payload + 8 > box.end) return { entryCount: null, sampleEntries: [], primary: null };
  const sampleEntries = [];
  let cursor = payload + 8;
  for (let index = 0; index < entryCount && cursor < box.end; index += 1) {
    const entry = boxAt(bytes, view, cursor, box.end);
    if (!entry) break;
    const sample = { codec: entry.type, width: null, height: null, channels: null, sampleRate: null, sampleSize: null };
    const entryPayload = entry.start + entry.headerSize;
    if (handlerType === 'vide') {
      sample.width = u16(view, entryPayload + 24);
      sample.height = u16(view, entryPayload + 26);
    }
    if (handlerType === 'soun') {
      sample.channels = u16(view, entryPayload + 16);
      sample.sampleSize = u16(view, entryPayload + 18);
      sample.sampleRate = fixed1616(u32(view, entryPayload + 24));
    }
    sampleEntries.push(sample);
    cursor = entry.end;
  }
  return { entryCount, sampleEntries, primary: sampleEntries[0] ?? null };
}

function trackKind(handlerType) {
  const kinds = { vide: 'video', soun: 'audio', text: 'text', subt: 'subtitle', clcp: 'caption', meta: 'metadata', hint: 'hint' };
  return kinds[handlerType] ?? (handlerType ? `other:${handlerType}` : 'unknown');
}

function parseTrack(bytes, view, trak) {
  const tkhd = childByType(bytes, view, trak, 'tkhd');
  const mdia = childByType(bytes, view, trak, 'mdia');
  const tkhdFacts = tkhd ? parseTkhd(view, tkhd) : null;
  const mdhd = mdia ? childByType(bytes, view, mdia, 'mdhd') : null;
  const hdlr = mdia ? childByType(bytes, view, mdia, 'hdlr') : null;
  const handlerType = hdlr ? parseHdlr(bytes, view, hdlr) : null;
  const minf = mdia ? childByType(bytes, view, mdia, 'minf') : null;
  const stbl = minf ? childByType(bytes, view, minf, 'stbl') : null;
  const stsd = stbl ? childByType(bytes, view, stbl, 'stsd') : null;
  const sampleDescription = stsd ? parseStsd(bytes, view, stsd, handlerType) : { entryCount: null, sampleEntries: [], primary: null };
  const mediaFacts = mdhd ? parseMdhd(view, mdhd) : null;
  const primary = sampleDescription.primary;
  return {
    id: tkhdFacts?.trackId ?? null,
    kind: trackKind(handlerType),
    handlerType,
    codec: primary?.codec ?? null,
    durationSeconds: mediaFacts?.durationSeconds ?? null,
    timeScale: mediaFacts?.timeScale ?? null,
    language: mediaFacts?.language ?? null,
    dimensions:
      tkhdFacts?.width && tkhdFacts?.height
        ? { width: Math.round(tkhdFacts.width), height: Math.round(tkhdFacts.height) }
        : primary?.width && primary?.height
          ? { width: primary.width, height: primary.height }
          : null,
    audio:
      primary?.channels || primary?.sampleRate
        ? { channels: primary.channels, sampleRate: primary.sampleRate ? Math.round(primary.sampleRate) : null, sampleSizeBits: primary.sampleSize }
        : null,
    sampleDescriptionCount: sampleDescription.entryCount,
    sampleEntries: sampleDescription.sampleEntries,
  };
}

/**
 * Reads non-authoritative container facts directly from original video bytes.
 * It never decodes, changes, uploads, or treats metadata as proof of authenticity.
 */
export function inspectVideoContainer(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const topLevel = listBoxes(bytes, view, 0, bytes.length);
  const ftyp = topLevel.find((box) => box.type === 'ftyp');
  if (!ftyp || ftyp.start !== 0 || ftyp.size < 16) {
    return {
      supported: false,
      reason: 'The file does not begin with a readable ISO Base Media (MP4/MOV) container.',
      container: null,
      majorBrand: null,
      compatibleBrands: [],
      durationFromContainer: null,
      topLevelBoxes: topLevel.map((box) => box.type),
      c2paManifestCandidate: false,
      c2paManifestCandidateCount: 0,
      tracks: [],
      trackCount: 0,
      structure: { movieHeaderPresent: false, fragmented: false, fastStart: null, metadataBoxes: [], mediaDataBytes: 0, averageBitrate: null },
    };
  }

  const majorBrand = readableBrand(fourCC(bytes, ftyp.start + ftyp.headerSize));
  const compatibleBrands = [];
  for (let offset = ftyp.start + ftyp.headerSize + 8; offset + 4 <= ftyp.end; offset += 4) {
    const brand = fourCC(bytes, offset);
    if (brand) compatibleBrands.push(readableBrand(brand));
  }
  const moov = topLevel.find((box) => box.type === 'moov');
  const moovChildren = moov ? childBoxes(bytes, view, moov) : [];
  const mvhd = moovChildren.find((box) => box.type === 'mvhd') ?? null;
  const tracks = moovChildren.filter((box) => box.type === 'trak').map((track) => parseTrack(bytes, view, track));
  const c2paManifestCandidateCount = countC2paUuids(bytes, view, topLevel);
  const mediaBoxes = topLevel.filter((box) => box.type === 'mdat');
  const metadataBoxes = topLevel.filter((box) => ['udta', 'meta', 'uuid', 'free', 'skip'].includes(box.type)).map((box) => box.type);
  const firstMdat = mediaBoxes[0] ?? null;
  const containerDuration = mvhd ? parseMvhd(bytes, view, mvhd) : null;
  const isQuickTime = majorBrand === 'qt' || compatibleBrands.includes('qt');

  return {
    supported: true,
    reason: null,
    container: isQuickTime ? 'QuickTime / ISO Base Media' : 'ISO Base Media',
    majorBrand,
    compatibleBrands: [...new Set(compatibleBrands)],
    durationFromContainer: containerDuration,
    topLevelBoxes: topLevel.map((box) => box.type),
    c2paManifestCandidate: c2paManifestCandidateCount > 0,
    c2paManifestCandidateCount,
    tracks,
    trackCount: tracks.length,
    structure: {
      movieHeaderPresent: Boolean(mvhd),
      fragmented: topLevel.some((box) => box.type === 'moof'),
      fastStart: moov && firstMdat ? moov.start < firstMdat.start : null,
      metadataBoxes: [...new Set(metadataBoxes)],
      mediaDataBytes: mediaBoxes.reduce((total, box) => total + Math.max(0, box.size - box.headerSize), 0),
      averageBitrate: containerDuration && containerDuration > 0 ? Math.round((bytes.length * 8) / containerDuration) : null,
    },
  };
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

export function formatSeconds(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return 'Unknown';
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remaining = whole % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}` : `${minutes}:${String(remaining).padStart(2, '0')}`;
}

export function formatTimestamp(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00.0';
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${remaining.toFixed(1).padStart(4, '0')}`;
}
