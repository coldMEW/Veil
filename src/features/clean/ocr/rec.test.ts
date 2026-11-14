import { describe, expect, it } from 'vitest';
import { parseDictionary, decodeCtc, preprocessRecognition } from './rec';

describe('CTC recognition', () => {
  it('keeps spaces, removes CRLF and appends one Paddle space token', () => {
    expect(parseDictionary('A\r\nB\r\n')).toEqual(['', 'A', 'B', ' ']);
    expect(parseDictionary('A\n \n')).toEqual(['', 'A', ' ']);
  });
  it('collapses repeats but preserves repeats separated by blank', () => {
    const dictionary = ['', 'A', 'B', ' '];
    const ids = [0, 1, 1, 0, 1, 3, 3, 2, 0];
    const logits = new Float32Array(ids.length * 4).fill(-4);
    ids.forEach((id, t) => { logits[t * 4 + id]!  = 4; });
    const out = decodeCtc(logits, [1, ids.length, 4], dictionary, 'logits');
    expect(out.text).toBe('AA B');
    expect(out.recScore).toBeGreaterThan(0.99);
  });
  it('supports model softmax outputs without softmaxing them again', () => {
    expect(decodeCtc(new Float32Array([0.1, 0.9, 0.8, 0.2]), [1, 2, 2], ['', 'A']))
      .toEqual({ text: 'A', recScore: expect.closeTo(0.9, 5) });
    expect(decodeCtc(new Float32Array([1, 0]), [1, 1, 2], ['', 'A']).text).toBe('');
    expect(() => decodeCtc(new Float32Array(6), [1, 2, 3], ['', 'A'])).toThrow(/dictionary/i);
  });
  it('resizes to model height, keeps aspect ratio, and pads with normalized zero', () => {
    const image = { width: 80, height: 20, data: new Uint8ClampedArray(80 * 20 * 4).fill(255) };
    const p = preprocessRecognition(image, { x: 0, y: 0, w: 80, h: 20 }, 48);
    expect(p.dims).toEqual([1, 3, 48, 320]);
    expect(p.data[0]! ).toBe(1);
    expect(p.data[319]! ).toBe(0);
  });
  it('rotates tall crops before recognition and validates height/crop', () => {
    const image = { width: 20, height: 80, data: new Uint8ClampedArray(20 * 80 * 4).fill(255) };
    const p = preprocessRecognition(image, { x: 0, y: 0, w: 20, h: 80 }, 48);
    expect(p.rotated).toBe(true);
    expect(p.resizedWidth).toBe(192);
    expect(() => preprocessRecognition(image, { x: 0, y: 0, w: 0, h: 1 }, 48)).toThrow();
  });
});
