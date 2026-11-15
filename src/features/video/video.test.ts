import { describe, expect, it } from 'vitest';
import { inspectContainer, stamp } from './container';
import { describeFrame, findMoments, passages, shotOf, type FrameStats } from './temporal';
import { buildSignals } from './analyze';
import { credentialFinding, videoReasons, videoVerdict } from './record';
import { appendEvent, brokenAt, canonical, SCHEMA, sha256Hex, signRecord, verifySealed, witnessMessage, type Sealed, type Witness } from './seal';
import { witness, witnessInfo } from '../../../server/witness';

/* ---------- a tiny, valid MP4 built by hand ---------- */
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const str = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const box = (type: string, ...payload: number[][]) => {
  const body = payload.flat();
  return [...u32(body.length + 8), ...str(type), ...body];
};
function mp4(options: { tool?: string; c2pa?: boolean; created?: number } = {}): Uint8Array {
  const mvhd = box('mvhd', [0, 0, 0, 0], u32(options.created ?? 0), u32(0), u32(1000), u32(12_000), new Array(80).fill(0));
  const udta = options.tool ? [box('udta', str(`©too....${options.tool}`))] : [];
  const c2pa = options.c2pa ? [box('uuid', [0xd8, 0xfe, 0xc3, 0xd6, 0x1b, 0x0e, 0x48, 0x3c, 0x92, 0x97, 0x58, 0x28, 0x87, 0x7e, 0xc4, 0x81], [1, 2, 3])] : [];
  return Uint8Array.from([
    ...box('ftyp', str('isom'), u32(512), str('isom'), str('mp42')),
    ...box('mdat', new Array(64).fill(7)),
    ...box('moov', mvhd, ...udta),
    ...c2pa.flat(),
  ]);
}

describe('container', () => {
  it('reads brands, length and layout from the bytes', () => {
    const f = inspectContainer(mp4());
    expect(f.supported).toBe(true);
    expect(f.container).toBe('MP4');
    expect(f.brands).toEqual(['isom', 'mp42']);
    expect(f.seconds).toBe(12);
    expect(f.fastStart).toBe(false);
    expect(f.mediaBytes).toBe(64);
    expect(f.createdAt).toBeNull();
    expect(f.c2paBoxes).toBe(0);
    expect(f.writtenBy).toEqual([]);
  });
  it('names the software that saved the file, and finds a credentials box', () => {
    const f = inspectContainer(mp4({ tool: 'Lavf60.16.100', c2pa: true, created: 2082844800 + 1_700_000_000 }));
    expect(f.writtenBy).toEqual(['FFmpeg (Lavf 60.16.100)']);
    expect(f.c2paBoxes).toBe(1);
    expect(f.createdAt).toBe(new Date(1_700_000_000_000).toISOString());
  });
  it('refuses a file that is not MP4 or MOV, and survives truncated input', () => {
    expect(inspectContainer(Uint8Array.from(str('RIFF....WEBPVP8 '))).supported).toBe(false);
    expect(inspectContainer(new Uint8Array(0)).supported).toBe(false);
    expect(inspectContainer(mp4().subarray(0, 40)).supported).toBe(true); // header only: still identified
  });
  it('formats times', () => {
    expect(stamp(67.44)).toBe('01:07.4');
    expect(stamp(Number.NaN)).toBe('00:00.0');
  });
});

/* ---------- temporal ---------- */
const frame = (time: number, difference: number | null, luminance = 0.5, cells: number[] = new Array(24).fill(difference ?? 0)): FrameStats => ({ time, difference, luminance, cells });

describe('temporal', () => {
  it('finds a cut against the video\'s own normal change', () => {
    const frames = [frame(0, null), ...Array.from({ length: 10 }, (_, i) => frame(i + 1, i === 5 ? 0.6 : 0.02))];
    const r = findMoments(frames);
    expect(r.cuts).toEqual([6]);
    expect(r.moments.filter((m) => m.kind === 'cut')).toHaveLength(1);
  });
  it('finds a change limited to one area and says where', () => {
    const cells = new Array(24).fill(0.01);
    cells[0] = 0.5; // top left
    const frames = [frame(0, null), ...Array.from({ length: 8 }, (_, i) => frame(i + 1, i === 3 ? 0.03 : 0.012, 0.5, i === 3 ? cells : new Array(24).fill(0.012)))];
    const local = findMoments(frames).moments.find((m) => m.kind === 'local');
    expect(local?.where).toBe('top left');
    expect(local?.time).toBe(4);
  });
  it('stays quiet on a steady clip', () => {
    const frames = [frame(0, null), ...Array.from({ length: 12 }, (_, i) => frame(i + 1, 0.02 + (i % 3) * 0.002))];
    expect(findMoments(frames).moments).toEqual([]);
  });
  it('measures a frame against the one before it', () => {
    const a = new Uint8ClampedArray(6 * 4 * 4).fill(100);
    const b = new Uint8ClampedArray(a);
    for (let i = 0; i < 4; i++) b[i] = 255; // first pixel only
    const s = describeFrame(1, b, a, 6, 4);
    expect(s.cells[0]).toBeGreaterThan(0.5);
    expect(s.cells[5]).toBe(0);
    expect(describeFrame(0, a, null, 6, 4).difference).toBeNull();
  });
  it('groups neighbouring flagged samples and counts shots', () => {
    const runs = passages([1, 2, 3, 4, 5, 6].map((time) => ({ time })), (s) => [2, 3, 5].includes(s.time));
    expect(runs.map((r) => r.map((s) => s.time))).toEqual([[2, 3], [5]]);
    expect(shotOf(4.9, [2, 5])).toBe(1);
    expect(shotOf(5, [2, 5])).toBe(2);
  });
});

/* ---------- signals, verdict, reasons ---------- */
const sampled = (ai: Array<number | null>, faceFake: Array<number | null> = []) =>
  ai.map((score, i) => ({ time: i, thumb: `t${i}`, ai: score, faceFake: faceFake[i] ?? null, luminance: 0.5, difference: i ? 0.02 : null, cells: i ? new Array(24).fill(0.02) : [], faces: faceFake[i] != null ? 1 : 0 }));

describe('signals and wording', () => {
  it('joins flagged frames into one stretch and keeps a lone frame separate', () => {
    const signals = buildSignals(sampled([0.1, 0.95, 0.97, 0.2, 0.99, 0.1, 0.1, 0.1]), [], 0.85);
    const ai = signals.filter((s) => s.check === 'ai-frames');
    expect(ai.map((s) => [s.start, s.end])).toEqual([[1, 2], [4, 4]]);
    expect(ai[0]!.title).toBe('Frames look AI-made');
    expect(ai[1]!.title).toBe('One frame looks AI-made');
    expect(ai.every((s) => s.innocent.length > 0)).toBe(true);
  });
  it('keeps one passage whole when a frame dips, and ignores frames that only lean', () => {
    // Measured on our spliced test clip: 0.89, 0.99, 0.52, 0.88 across the inserted segment.
    const ai = buildSignals(sampled([0, 0.595, 0.001, 0.891, 0.986, 0.524, 0.883, 0]), [], 0.85).filter((s) => s.check === 'ai-frames');
    expect(ai.map((s) => [s.start, s.end])).toEqual([[3, 6]]);
    expect(ai[0]!.says).toBe('4 sampled frames in a row lean AI-made on our image model, peaking at 99 out of 100.');
  });
  it('needs two neighbouring frames before the face model flags a video', () => {
    const one = buildSignals(sampled([0, 0, 0, 0, 0, 0], [0.7, 0.9, 0.7, 0.8, 0.7, 0.7]), [], 0.85);
    expect(one.filter((s) => s.check === 'face-model')).toEqual([]);
    const two = buildSignals(sampled([0, 0, 0, 0, 0, 0], [0.7, 0.9, 0.92, 0.8, 0.7, 0.7]), [], 0.85);
    expect(two.filter((s) => s.check === 'face-model').map((s) => [s.start, s.end])).toEqual([[1, 2]]);
  });
  it('never flags a frame the model did not score', () => {
    expect(buildSignals(sampled([null, null, null, null]), [], 0.85)).toEqual([]);
  });
  const facts = inspectContainer(mp4());
  const analysis = (ai: Array<number | null>, faceFake: Array<number | null> = []) => {
    const frames = sampled(ai, faceFake);
    return { seconds: ai.length, width: 640, height: 360, frames, signals: buildSignals(frames, [], 0.85), checks: [], took: 1, backend: null };
  };
  it('a lone high frame is a lead; a stretch makes it worth a closer look; nothing means nothing decisive', () => {
    const none = credentialFinding(facts, 'skipped');
    expect(none.state).toBe('none');
    expect(videoVerdict(none, analysis([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]), false)).toBe('unclear');
    expect(videoVerdict(none, analysis([0.1, 0.95, 0.96, 0.1]), false)).toBe('suspect');
    expect(videoVerdict(none, null, true)).toBe('checking');
    // A strong signal shows while the scan is still running.
    expect(videoVerdict(none, analysis([0.1, 0.95, 0.96, 0.1]), true)).toBe('suspect');
  });
  it('gives at most three reasons a side, and only measured ones', () => {
    const quiet = videoReasons(facts, credentialFinding(facts, 'skipped'), analysis([0.02, 0.03, 0.01, 0.02, 0.02, 0.04, 0.01, 0.02], [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]));
    expect(quiet.for).toEqual([]);
    expect(quiet.against.length).toBeGreaterThan(0);
    expect(quiet.against.length).toBeLessThanOrEqual(3);
    expect(quiet.against[0]).toContain('stay low on the AI-image model');

    const flagged = videoReasons(inspectContainer(mp4({ tool: 'Lavf60.16.100' })), credentialFinding(facts, 'skipped'), analysis([0.95, 0.96, 0.97, 0.1], [0.9, 0.95, 0.2, 0.1]));
    expect(flagged.for.length).toBe(3);
    expect(flagged.for[0]).toContain('face-forgery model');
    // Nothing was scored: no bullet may claim the models found it clean.
    expect(videoReasons(facts, credentialFinding(facts, 'skipped'), analysis([null, null, null])).against.join(' ')).not.toContain('AI-image model');
  });
});

/* ---------- seal ---------- */
async function sealedRecord() {
  const sha = await sha256Hex(Uint8Array.from([1, 2, 3]));
  let events = await appendEvent([], sha, 'opened', 'Opened the file.', '2026-11-15T10:00:00.000Z');
  events = await appendEvent(events, sha, 'scanned', '24 frames examined.', '2026-11-15T10:00:30.000Z');
  const record = { schema: SCHEMA, caseId: 'VC-TEST', asset: { name: 'clip.mp4', sha256: sha }, events, notes: [] as string[] };
  const keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])) as CryptoKeyPair;
  const sealed = await signRecord(record, keys);
  sealed.witness = witness(await sha256Hex(canonical(record)), new Date('2026-11-15T10:00:31.000Z')) as Witness;
  return { sealed, sha };
}
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const state = (lines: Awaited<ReturnType<typeof verifySealed>>) => Object.fromEntries(lines.map((l) => [l.id, l.ok]));

describe('seal', () => {
  it('canonical JSON ignores key order', () => {
    expect(canonical({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: 3 } })).toBe(canonical({ a: { c: 3, d: [2, { y: 2, z: 1 }] }, b: 1 }));
  });
  it('an untouched record passes every check, with the server stamp made by the Node witness', async () => {
    const { sealed } = await sealedRecord();
    expect(state(await verifySealed(sealed, Uint8Array.from([1, 2, 3]), witnessInfo().keyId))).toEqual({ file: true, chain: true, device: true, witness: true });
    // Survives a round trip through a file on disk.
    expect(state(await verifySealed(clone(sealed), null, null))).toEqual({ file: null, chain: true, device: true, witness: null });
  });
  it('catches a different video', async () => {
    const { sealed } = await sealedRecord();
    expect(state(await verifySealed(sealed, Uint8Array.from([1, 2, 4]), null)).file).toBe(false);
  });
  it('catches an edited note, a reworded log entry, a removed entry and a reordered log', async () => {
    const { sealed, sha } = await sealedRecord();
    const edited = clone(sealed) as Sealed<{ notes: string[] }> & typeof sealed;
    edited.record.notes.push('added later');
    expect(state(await verifySealed(edited)).device).toBe(false);

    const reworded = clone(sealed);
    reworded.record.events[0]!.detail = 'Opened a different file.';
    expect(state(await verifySealed(reworded)).chain).toBe(false);

    expect(await brokenAt(sealed.record.events.slice(1), sha)).toBe(0);
    expect(await brokenAt([...sealed.record.events].reverse(), sha)).toBe(0);
    expect(await brokenAt(sealed.record.events, sha)).toBe(-1);
  });
  it('catches a server stamp moved from another record, or made with another key', async () => {
    const { sealed } = await sealedRecord();
    const moved = clone(sealed);
    moved.witness = witness('a'.repeat(64)) as Witness;
    expect(state(await verifySealed(moved)).witness).toBe(false);

    const backdated = clone(sealed);
    backdated.witness!.at = '2020-01-01T00:00:00.000Z';
    expect(state(await verifySealed(backdated)).witness).toBe(false);

    expect(state(await verifySealed(sealed, null, 'not-the-server-key')).witness).toBe(false);
  });
  it('the witness only accepts a hash', () => {
    expect(witness('not a hash')).toBeNull();
    expect(witness({ video: 'bytes' })).toBeNull();
    const stamp = witness('b'.repeat(64))!;
    expect(witnessMessage(stamp.digest, stamp.at)).toContain('veil-witness/v1');
    expect(Object.keys(stamp).sort()).toEqual(['at', 'digest', 'keyId', 'publicKey', 'signature']);
  });
});
