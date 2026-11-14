import { describe, expect, it } from 'vitest';
import { aiSignalFinding, evidenceLevel, LEVEL_TEXT, provenanceFinding, type Finding } from './findings';
import type { FocusState } from '../../features/inspect/model/useModelFocus';
import type { FocusResult } from '../../features/inspect/model/focusTypes';
import type { ProvenanceState } from '../inspect/useProvenance';
import type { CredentialSummary, MetadataHints } from '../../features/inspect/provenance/contentCredentials';

const crop = { x: 0, y: 0, width: 384, height: 384 };
const done = (logit: number, deltas: number[], views?: FocusResult['views']): FocusState => ({
  status: 'done',
  result: { logit, deltas: Float32Array.from(deltas), grid: 2, crop, views, backend: 'wasm', threads: 1, timings: { loadMs: 0, baseMs: 0, occlusionMs: 0 } },
  magnitudes: new Float32Array(4),
  overlay: new Uint8ClampedArray(16),
  checkResult: {} as never,
});

const noCredentials: CredentialSummary = {
  present: false, generator: null, signer: null, signedAt: null, actions: [], sourceTypes: [], validationState: null,
  statusCodes: [], failures: [], contentChanged: false, credentialProblem: false, manifestCount: 0,
};
const noHints: MetadataHints = { toolNames: [], sourceTypes: [], software: [] };
const prov = (credentials: Partial<CredentialSummary>, hints: Partial<MetadataHints> = {}): ProvenanceState => ({
  status: 'done',
  result: { credentials: { ...noCredentials, ...credentials }, hints: { ...noHints, ...hints }, error: null, ms: 1 },
  checkResult: {} as never,
});

const VERDICT = /\b(real|fake|authentic|genuine|forged|tampered)\b|\d+\s?%/i;
const allText = (f: Finding) => [f.headline, ...(f.why ?? []), f.limits ?? ''].join(' ');

describe('aiSignalFinding', () => {
  it('reports a saturated detector output instead of "nothing flagged" (regression)', () => {
    // Output 9.8 (sigmoid 0.9999): covering any one cell barely moves it, so the heatmap is empty.
    const f = aiSignalFinding(done(9.8, [0.3, 0.3, 0.3, 0.3]));
    expect(f.tone).toBe('alert');
    expect(f.headline).toBe('AI-like patterns in the pixels: the detector leans strongly toward "AI-generated" on the centre crop.');
    expect(f.why).toContain('The heatmap stays empty because the output is already at its top: no single area changes it.');
  });

  it('counts parts of the photo and stays quiet for camera-like outputs', () => {
    const views = [
      { label: 'center' as const, logit: -6, crop },
      { label: 'start' as const, logit: 0.4, crop: { ...crop, x: 0 } },
      { label: 'end' as const, logit: -5, crop: { ...crop, x: 200 } },
    ];
    const f = aiSignalFinding(done(-6, [0, 0, 0, 0], views));
    expect(f).toMatchObject({ tone: 'notice', headline: 'Some AI-like patterns: the detector leans toward "AI-generated" in 1 of 3 parts of the photo.' });
    expect(f.why).toContain('It scored the left AI-like, the middle camera-like, the right camera-like.');
    expect(f.views).toBe(views);
    expect(aiSignalFinding(done(-7.65, [1.4, 1.4, 1.4, 1.4]))).toMatchObject({ tone: 'clear', headline: "The detector's output stays camera-like on the centre crop." });
  });

  it('does not call a raised output low when no single area stands out', () => {
    // Output -1 is sigmoid 0.27: under the 0.5 line, far above measured phone photos (<= 0.001).
    expect(aiSignalFinding(done(-1, [0, 0, 0, 0]))).toMatchObject({ tone: 'notice', headline: "The detector's output is raised but under the 0.5 display line on the centre crop." });
  });

  it('always explains the basis and the limits, with no verdict words', () => {
    for (const [logit, deltas] of [[9.8, [0, 0, 0, 0]], [0.3, [0, 0, 0, 0]], [-1, [3, 0, 0, 0]], [-8, [0, 0, 0, 0]]] as const) {
      const f = aiSignalFinding(done(logit, [...deltas]));
      expect(f.why?.[0]).toMatch(/^Reads texture and noise patterns in the pixels/);
      expect(f.limits).toMatch(/can fool it/);
      expect(allText(f)).not.toMatch(VERDICT);
    }
  });
});

describe('provenanceFinding', () => {
  it('explains a signed AI declaration and why it is strong', () => {
    const f = provenanceFinding(prov({ present: true, signer: 'OpenAI Media Service', generator: 'OpenAI Media Service API', sourceTypes: ['trainedAlgorithmicMedia'] }));
    expect(f.tone).toBe('alert');
    expect(f.why).toEqual([
      'The file carries Content Credentials: a record of how it was made, signed by OpenAI Media Service.',
      'That record says the image was created by a generative AI model, by OpenAI Media Service API.',
      'Veil checked the signature on this device, and the pixels still match what was signed.',
    ]);
    expect(f.limits).toBe('This is the strongest signal when present. A screenshot or a re-save in most apps removes it.');
  });

  it('marks an unsigned metadata label as amber and says anyone can add or remove it', () => {
    const f = provenanceFinding(prov({}, { toolNames: ['Made with Google AI'], sourceTypes: ['trainedAlgorithmicMedia'] }));
    expect(f.tone).toBe('notice');
    expect(f.why).toEqual([
      "The file's metadata text names Made with Google AI.",
      'It carries the industry tag for images created by a generative AI model (IPTC "trainedAlgorithmicMedia").',
      'This label is not signed, so anyone can add or remove it.',
    ]);
  });

  it('treats missing labels as no signal, not as a clean result', () => {
    const f = provenanceFinding(prov({}));
    expect(f.tone).toBe('neutral');
    expect(f.why?.[1]).toBe('Screenshots, messaging apps and most editors remove them, so missing labels are not a flag either way.');
  });

  it('keeps every provenance explanation free of verdict words', () => {
    for (const s of [
      prov({ present: true, contentChanged: true, signer: 'X' }),
      prov({ present: true, signer: 'X', credentialProblem: true }),
      prov({}, { toolNames: ['ChatGPT'] }),
      prov({}),
    ]) expect(allText(provenanceFinding(s))).not.toMatch(VERDICT);
  });
});

describe('evidenceLevel', () => {
  const f = (tone: Finding['tone']): Finding => ({ id: tone, title: tone, tone, headline: '', group: 'model' });
  it('takes the strongest single flag, never a count', () => {
    expect(evidenceLevel([f('alert'), f('clear'), f('clear'), f('clear')])).toBe('strong');
    expect(evidenceLevel([f('notice'), f('clear')])).toBe('some');
    expect(evidenceLevel([f('clear'), f('neutral'), f('idle')])).toBe('none');
    expect(evidenceLevel([f('neutral'), f('idle')])).toBe('unknown');
    expect(evidenceLevel([f('pending'), f('notice')])).toBe('checking');
    expect(evidenceLevel([f('pending'), f('alert')])).toBe('strong');
  });

  it('never claims a photo came from a camera', () => {
    expect(LEVEL_TEXT.none.body).toBe('Not proof it came from a camera.');
    for (const t of Object.values(LEVEL_TEXT)) expect(`${t.title} ${t.body}`).not.toMatch(VERDICT);
  });
});
