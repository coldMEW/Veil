import { normalizeQuad } from './pipeline';
import { it, expect } from 'vitest';
import { postprocessDetection } from './det';
import { preprocessRecognition } from './rec';
for (const degrees of [15, 25, 60, 70, 80])
  it(`rectifies a ${degrees} degree component to a horizontal recognition tensor`, () => {
    const width = 200,
      height = 140,
      map = new Float32Array(width * height),
      angle = (degrees * Math.PI) / 180;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const dx = x - 100,
          dy = y - 70,
          u = dx * Math.cos(angle) + dy * Math.sin(angle),
          v = -dx * Math.sin(angle) + dy * Math.cos(angle);
        if (Math.abs(u) < 60 && Math.abs(v) < 5) map[y * width + x]! = 1;
      }
    const box = postprocessDetection(map, width, height, width, height)[0]!;
    expect(box.quad).toHaveLength(4);
    const q = box.quad!;
    const measured = (Math.atan2(q[1]![1]! - q[0]![1]!, q[1]![0]! - q[0]![0]!) * 180) / Math.PI;
    expect(measured).toBeCloseTo(degrees, 0);
    const image = { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) };
    const crop = preprocessRecognition(image, box.pixelRect, 48, q);
    expect(crop.dims[2]!).toBe(48);
    expect(crop.resizedWidth).toBeGreaterThan(200);
  });

it('normalized 25 degree quad contains every synthetic line pixel', () => {
  const width = 200,
    height = 140,
    map = new Float32Array(width * height),
    angle = (25 * Math.PI) / 180;
  const points: [number, number][] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const dx = x - 100,
        dy = y - 70,
        u = dx * Math.cos(angle) + dy * Math.sin(angle),
        v = -dx * Math.sin(angle) + dy * Math.cos(angle);
      if (Math.abs(u) < 60 && Math.abs(v) < 5) {
        map[y * width + x]! = 1;
        points.push([x, y]);
      }
    }
  const box = postprocessDetection(map, width, height, width, height)[0]!;
  const q = normalizeQuad(box.quad!, width, height);
  expect(q).toHaveLength(4);
  for (const [x, y] of points)
    for (let i = 0; i < 4; i++) {
      const a = q[i]!,
        b = q[(i + 1) % 4]!;
      expect((b.x - a.x) * (y / height - a.y) - (b.y - a.y) * (x / width - a.x)).toBeGreaterThanOrEqual(
        -1e-8,
      );
    }
});
