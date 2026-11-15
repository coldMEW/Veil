import assert from 'node:assert/strict';
import test from 'node:test';
import { formatBytes, formatSeconds, inspectVideoContainer } from './videoFacts.js';

function fourCC(value) {
  return Array.from(value, (char) => char.charCodeAt(0));
}

function box(type, body) {
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length, false);
  out.set(fourCC(type), 4);
  out.set(body, 8);
  return out;
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function hexBytes(value) {
  return new Uint8Array(value.match(/.{2}/g).map((pair) => Number.parseInt(pair, 16)));
}

test('reads basic MP4 brands and movie duration', () => {
  const ftypBody = new Uint8Array([...fourCC('isom'), 0, 0, 0, 0, ...fourCC('isom'), ...fourCC('mp42')]);
  const mvhdBody = new Uint8Array(20);
  const view = new DataView(mvhdBody.buffer);
  view.setUint32(12, 1_000, false);
  view.setUint32(16, 12_500, false);
  const bytes = concat(box('ftyp', ftypBody), box('moov', box('mvhd', mvhdBody)), box('mdat', new Uint8Array()));

  const facts = inspectVideoContainer(bytes);
  assert.equal(facts.supported, true);
  assert.equal(facts.majorBrand, 'isom');
  assert.deepEqual(facts.compatibleBrands, ['isom', 'mp42']);
  assert.equal(facts.durationFromContainer, 12.5);
  assert.deepEqual(facts.topLevelBoxes, ['ftyp', 'moov', 'mdat']);
});

test('does not mistake arbitrary bytes for an MP4 container', () => {
  const facts = inspectVideoContainer(new TextEncoder().encode('not a video'));
  assert.equal(facts.supported, false);
  assert.equal(facts.c2paManifestCandidate, false);
});

test('marks a C2PA UUID container as a candidate without treating it as validation', () => {
  const ftypBody = new Uint8Array([...fourCC('isom'), 0, 0, 0, 0, ...fourCC('isom')]);
  const c2paUuid = hexBytes('d8fec3d61b0e483c92975828877ec481');
  const bytes = concat(box('ftyp', ftypBody), box('uuid', c2paUuid));

  const facts = inspectVideoContainer(bytes);
  assert.equal(facts.supported, true);
  assert.equal(facts.c2paManifestCandidate, true);
});

test('reads video track dimensions, codec, duration, and language from a movie track', () => {
  const ftypBody = new Uint8Array([...fourCC('isom'), 0, 0, 0, 0, ...fourCC('isom')]);
  const tkhdBody = new Uint8Array(84);
  const tkhdView = new DataView(tkhdBody.buffer);
  tkhdView.setUint32(12, 1, false);
  tkhdView.setUint32(tkhdBody.length - 8, 1920 * 65536, false);
  tkhdView.setUint32(tkhdBody.length - 4, 1080 * 65536, false);

  const mdhdBody = new Uint8Array(24);
  const mdhdView = new DataView(mdhdBody.buffer);
  mdhdView.setUint32(12, 1_000, false);
  mdhdView.setUint32(16, 4_000, false);
  mdhdView.setUint16(20, 0x15c7, false); // eng

  const hdlrBody = new Uint8Array(12);
  hdlrBody.set(fourCC('vide'), 8);
  const videoEntryBody = new Uint8Array(28);
  const videoEntryView = new DataView(videoEntryBody.buffer);
  videoEntryView.setUint16(24, 1920, false);
  videoEntryView.setUint16(26, 1080, false);
  const videoEntry = box('avc1', videoEntryBody);
  const stsdBody = new Uint8Array(8 + videoEntry.length);
  new DataView(stsdBody.buffer).setUint32(4, 1, false);
  stsdBody.set(videoEntry, 8);

  const stbl = box('stbl', box('stsd', stsdBody));
  const minf = box('minf', stbl);
  const mdia = box('mdia', concat(box('mdhd', mdhdBody), box('hdlr', hdlrBody), minf));
  const trak = box('trak', concat(box('tkhd', tkhdBody), mdia));
  const bytes = concat(box('ftyp', ftypBody), box('moov', trak), box('mdat', new Uint8Array(100)));

  const facts = inspectVideoContainer(bytes);
  assert.equal(facts.trackCount, 1);
  assert.deepEqual(facts.tracks[0].dimensions, { width: 1920, height: 1080 });
  assert.equal(facts.tracks[0].codec, 'avc1');
  assert.equal(facts.tracks[0].durationSeconds, 4);
  assert.equal(facts.tracks[0].language, 'eng');
  assert.equal(facts.structure.mediaDataBytes, 100);
});

test('formats human-readable facts', () => {
  assert.equal(formatBytes(1536), '1.5 KiB');
  assert.equal(formatSeconds(65), '1:05');
  assert.equal(formatSeconds(3665), '1:01:05');
});
