import { describe, expect, it } from 'vitest';
import { widenToTrainingCrop } from './faceBox';

describe('widenToTrainingCrop', () => {
  it('widens like the upstream dlib crop (w/2.5 sides and below, w/1.5 above)', () => {
    // 100 px wide, 120 px tall face at (450, 400) in a 1000 x 1000 image.
    const out = widenToTrainingCrop({ x: 0.45, y: 0.4, w: 0.1, h: 0.12 }, 1000, 1000);
    expect(out.x * 1000).toBeCloseTo(410);
    expect(out.y * 1000).toBeCloseTo(400 - 100 / 1.5);
    expect((out.x + out.w) * 1000).toBeCloseTo(590);
    expect((out.y + out.h) * 1000).toBeCloseTo(560);
  });

  it('clamps to the image edges', () => {
    const out = widenToTrainingCrop({ x: 0, y: 0, w: 0.5, h: 0.5 }, 800, 600);
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
    expect(out.x + out.w).toBeLessThanOrEqual(1);
    expect(out.y + out.h).toBeLessThanOrEqual(1);
  });
});
