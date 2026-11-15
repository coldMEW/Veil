import { describe, expect, it } from 'vitest';
import { aiEvidence, checkReasons, type ReasonInputs } from './check';
import type { ProvenanceResult } from '../features/inspect/provenance/contentCredentials';

const provenance = (over: Partial<ProvenanceResult> = {}): ProvenanceResult => ({
  credentials: { present: false, generator: null, signer: null, signedAt: null, actions: [], sourceTypes: [], validationState: null, statusCodes: [], failures: [], contentChanged: false, credentialProblem: false, manifestCount: 0 },
  hints: { toolNames: [], sourceTypes: [], software: [] },
  camera: null,
  error: null,
  ms: 1,
  ...over,
});
const matching = { aspectRatioDifference: 0, meanDifference: 1, grid: new Float32Array(64), cols: 8 as const, rows: 8 as const, differingCells: [] };
const base: ReasonInputs = { provenance: provenance(), preview: 'none', markFound: false, comparison: null, aiProbability: null, faceFake: null, evidence: [] };

describe('checkReasons', () => {
  it('says nothing when nothing was measured', () => {
    expect(checkReasons(base)).toEqual({ for: [], against: [], source: [] });
  });
  it('lists what points away from tampering, strongest first, three at most', () => {
    const r = checkReasons({
      ...base,
      preview: matching,
      aiProbability: 0.03,
      faceFake: { score: 0.12, lead: 0.85, faces: 1 },
      provenance: provenance({ camera: { make: 'Google', model: 'Pixel 7', software: null, dateTimeOriginal: '2026:11:14 16:12:49' } }),
    });
    expect(r.for).toEqual([]);
    expect(r.against).toHaveLength(3);
    expect(r.against[0]).toContain('preview stored inside the file matches');
    expect(r.against[1]).toBe('The AI-image model stays low: 3 of 100 for AI-made.');
    expect(r.against[2]).toContain('0.12 of 1');
  });
  it('puts facts about the file ahead of model scores', () => {
    const ai = aiEvidence(0.97)!;
    const r = checkReasons({
      ...base,
      aiProbability: 0.97,
      faceFake: { score: 0.91, lead: 0.85, faces: 1 },
      comparison: { says: '', regions: [{ x: 0, y: 0, w: 1, h: 1 }, { x: 2, y: 2, w: 1, h: 1 }], changed: true },
      markFound: true,
      evidence: [ai],
    });
    expect(r.for).toEqual([
      'It differs from your original in 2 areas.',
      'The face-forgery model scores the face 0.91 of 1 for swapped or generated.',
      'The AI-image model scores it 97 of 100 for AI-made.',
    ]);
    // The mark is where the picture came from, never a red or a green reason.
    expect(r.source).toEqual(['Your invisible Veil mark is inside: this picture was made from a photo you shielded.']);
    expect(r.against).toEqual([]);
  });
  it('a model that leans but stays under the line is said to be under the line', () => {
    const r = checkReasons({ ...base, aiProbability: 0.7 });
    expect(r.for).toEqual(['The AI-image model leans AI-made (70 of 100), under the 90 line Veil needs.']);
    expect(r.against).toEqual([]);
  });
  it('a face model that did not find a face gives no bullet', () => {
    expect(checkReasons({ ...base, faceFake: { score: 0, lead: 0.85, faces: 0 } })).toEqual({ for: [], against: [], source: [] });
    expect(checkReasons({ ...base, faceFake: 'none' })).toEqual({ for: [], against: [], source: [] });
  });
});
