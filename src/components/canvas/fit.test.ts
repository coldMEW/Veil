import { describe, expect, it } from 'vitest';
import { containFit, imageToView, normalize, viewToImage } from './fit';

describe('containFit', () => {
  it('letterboxes a landscape image in a square view', () => {
    const fit = containFit(4000, 2000, 800, 800);
    expect(fit.scale).toBe(0.2);
    expect(fit).toMatchObject({ offsetX: 0, offsetY: 200, width: 800, height: 400 });
  });

  it('pillarboxes a portrait image in a wide view', () => {
    const fit = containFit(1000, 2000, 1000, 500);
    expect(fit).toMatchObject({ scale: 0.25, offsetX: 375, offsetY: 0, width: 250, height: 500 });
  });

  it('can refuse to upscale small images', () => {
    expect(containFit(100, 100, 800, 800, false).scale).toBe(1);
  });

  it('returns an empty fit for zero sizes', () => {
    expect(containFit(0, 100, 800, 800).scale).toBe(0);
  });
});

describe('coordinate round trip', () => {
  const W = 3000;
  const H = 4000;
  const views = [
    [360, 640],
    [1440, 900],
    [500, 500],
  ] as const;

  it('maps image points to the view and back at any view size', () => {
    for (const [vw, vh] of views) {
      const fit = containFit(W, H, vw, vh);
      for (const [x, y] of [
        [0, 0],
        [W, H],
        [1234.5, 987.25],
      ] as const) {
        const v = imageToView(fit, x, y);
        const back = viewToImage(fit, W, H, v.x, v.y);
        expect(back?.x).toBeCloseTo(x, 6);
        expect(back?.y).toBeCloseTo(y, 6);
      }
    }
  });

  it('gives the same normalized point regardless of view size', () => {
    const results = views.map(([vw, vh]) => {
      const fit = containFit(W, H, vw, vh);
      const v = imageToView(fit, 1500, 1000);
      const p = viewToImage(fit, W, H, v.x, v.y)!;
      return normalize(p.x, p.y, W, H);
    });
    for (const r of results) {
      expect(r.x).toBeCloseTo(0.5, 9);
      expect(r.y).toBeCloseTo(0.25, 9);
    }
  });

  it('rejects clicks in the letterbox', () => {
    const fit = containFit(W, H, 1440, 900);
    expect(viewToImage(fit, W, H, 5, 450)).toBeNull();
  });
});
