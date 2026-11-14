import { describe, expect, it } from 'vitest';
import { createTiles, mapToOriginal, mergeDetections, intersectionOverUnion } from './tiles';

describe('source-resolution tiles', () => {
  it('covers edges without stretching or losing pixels', () => {
    const tiles = createTiles(3000, 2000);
    expect(tiles.length).toBe(12);
    expect(tiles[0]! ).toEqual({ x: 0, y: 0, w: 960, h: 960 });
    expect(tiles[tiles.length - 1]! ).toEqual({ x: 2040, y: 1040, w: 960, h: 960 });
    for (let y = 0; y < 2000; y += 37) for (let x = 0; x < 3000; x += 37) {
      expect(tiles.some(t => x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h)).toBe(true);
    }
  });
  it('returns one small tile for a tiny image', () => {
    expect(createTiles(21, 10)).toEqual([{ x: 0, y: 0, w: 21, h: 10 }]);
  });
  it('avoids duplicate tiles at exact boundaries', () => {
    expect(createTiles(960, 960)).toHaveLength(1);
    expect(createTiles(1792, 960)).toHaveLength(2);
  });
  it('rejects an overlap that cannot advance or invalid dimensions', () => {
    expect(() => createTiles(2000, 1000, 960, 960)).toThrow();
    expect(() => createTiles(0, 100)).toThrow();
  });
  it('maps tile pixels to normalized original coordinates, clipping edges', () => {
    expect(mapToOriginal({ x: 10, y: 20, w: 100, h: 40 }, { x: 832, y: 832, w: 960, h: 960 }, 3000, 2000))
      .toEqual({ pixelRect: { x: 842, y: 852, w: 100, h: 40 }, rect: { x: 842 / 3000, y: 852 / 2000, w: 100 / 3000, h: 40 / 2000 } });
    expect(mapToOriginal({ x: -5, y: 0, w: 20, h: 20 }, { x: 0, y: 0, w: 10, h: 10 }, 10, 10).rect)
      .toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
  it('suppresses duplicate overlapping detections, preserving distinct nearby text', () => {
    const detections = [
      { pixelRect: { x: 100, y: 100, w: 100, h: 20 }, detScore: 0.9 },
      { pixelRect: { x: 102, y: 100, w: 100, h: 20 }, detScore: 0.8 },
      { pixelRect: { x: 220, y: 100, w: 100, h: 20 }, detScore: 0.7 },
    ];
    expect(mergeDetections(detections)).toEqual([detections[0]! , detections[2]! ]);
    expect(intersectionOverUnion({ x: 0, y: 0, w: 0, h: 0 }, detections[0]! .pixelRect)).toBe(0);
  });
});
