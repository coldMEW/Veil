import { describe, expect, it } from 'vitest';
import { detectorSize, preprocessDetection, postprocessDetection } from './det';

describe('DB detection', () => {
  it('resizes to multiples of 32 while limiting the longest side', () => {
    expect(detectorSize(3000, 2000)).toEqual({ width: 960, height: 640 });
    expect(detectorSize(12, 8)).toEqual({ width: 32, height: 32 });
    expect(() => detectorSize(0, 100)).toThrow();
  });
  it('normalizes a white RGBA image to CHW ImageNet values', () => {
    const prep = preprocessDetection({ width: 32, height: 32, data: new Uint8ClampedArray(32 * 32 * 4).fill(255) });
    expect(prep.dims).toEqual([1, 3, 32, 32]);
    expect(prep.data[0]! ).toBeCloseTo((1 - 0.485) / 0.229, 5);
    expect(prep.data[1024]! ).toBeCloseTo((1 - 0.456) / 0.224, 5);
    expect(prep.data[2048]! ).toBeCloseTo((1 - 0.406) / 0.225, 5);
  });
  it('uses BGR input ordering like Paddle inference, compositing transparent pixels on white', () => {
    const data = new Uint8ClampedArray(32 * 32 * 4);
    for (let i = 0; i < data.length; i += 4) { data[i]!  = 255; data[i + 3]!  = 255; }
    const prep = preprocessDetection({ width: 32, height: 32, data });
    expect(prep.data[0]! ).toBeCloseTo(-0.485 / 0.229, 5);
    expect(prep.data[2048]! ).toBeCloseTo((1 - 0.406) / 0.225, 5);
    data.fill(0);
    expect(preprocessDetection({ width: 32, height: 32, data }).data[0]! ).toBeCloseTo((1 - 0.485) / 0.229, 5);
  });
  it('thresholds components, filters weak scores and maps unclipped boxes to source pixels', () => {
    const map = new Float32Array(100 * 100);
    for (let y = 20; y < 30; y++) for (let x = 10; x < 40; x++) map[y * 100 + x]!  = 0.9;
    for (let y = 60; y < 70; y++) for (let x = 10; x < 40; x++) map[y * 100 + x]!  = 0.4;
    const boxes = postprocessDetection(map, 100, 100, 200, 100);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]! .detScore).toBeCloseTo(0.9);
    expect(boxes[0]! .pixelRect.x).toBeLessThan(20);
    expect(boxes[0]! .pixelRect.x + boxes[0]! .pixelRect.w).toBeGreaterThan(80);
    expect(boxes[0]! .pixelRect.y).toBeLessThan(20);
  });
  it('clips expanded boxes, ignores isolated noise, and rejects malformed maps', () => {
    const map = new Float32Array(32 * 32);
    map[31 * 32 + 31]!  = 1;
    for (let y = 0; y < 10; y++) for (let x = 0; x < 20; x++) map[y * 32 + x]!  = 1;
    const boxes = postprocessDetection(map, 32, 32, 32, 32);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]! .pixelRect.x).toBe(0);
    expect(boxes[0]! .pixelRect.y).toBe(0);
    expect(() => postprocessDetection(new Float32Array(2), 32, 32, 32, 32)).toThrow();
  });
});
