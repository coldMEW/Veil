import type { CheckResult, Overlay, Point, Rect } from '../../../../contracts';
import type { Pixels } from '../../../clean/mask';

export interface Highlight {
  /** Pixel-center centroid normalized within the unscaled eye crop. */
  centroid: Point;
  area: number;
  peakLuma: number;
  /** Axis-aligned box in crop PIXELS. */
  bbox: Rect;
}
export interface PixelCrop extends Rect {}
export interface EyePreview {
  pixels: Pixels;
  highlights: Highlight[];
  markers: Point[];
}

function validatePixels(p: Pixels): void {
  if (
    !Number.isInteger(p.width) ||
    !Number.isInteger(p.height) ||
    p.width < 1 ||
    p.height < 1 ||
    p.width * p.height > 24_000_000 ||
    p.data.length !== p.width * p.height * 4
  )
    throw new Error('Invalid RGBA pixel buffer.');
}
function bounds(p: Pixels, r: Rect): PixelCrop | null {
  if (
    ![r.x, r.y, r.w, r.h].every(Number.isFinite) ||
    r.w <= 0 ||
    r.h <= 0 ||
    r.x < 0 ||
    r.y < 0 ||
    r.x + r.w > 1 + 1e-12 ||
    r.y + r.h > 1 + 1e-12
  )
    return null;
  const x = Math.floor(r.x * p.width),
    y = Math.floor(r.y * p.height);
  return {
    x,
    y,
    w: Math.min(p.width, Math.ceil((r.x + r.w) * p.width)) - x,
    h: Math.min(p.height, Math.ceil((r.y + r.h) * p.height)) - y,
  };
}
function cropPixels(p: Pixels, r: PixelCrop): Pixels {
  const data = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) {
    const start = ((r.y + y) * p.width + r.x) * 4;
    data.set(p.data.subarray(start, start + r.w * 4), y * r.w * 4);
  }
  return { width: r.w, height: r.h, data };
}

/** Luma is alpha-composited onto dark; invisible RGB cannot create a visible highlight. */
export function extractHighlights(crop: Pixels): Highlight[] {
  validatePixels(crop);
  const { width, height, data } = crop,
    area = width * height;
  const luma = new Float32Array(area);
  for (let i = 0; i < area; i++) {
    const j = i * 4;
    luma[i] = (0.2126 * data[j]! + 0.7152 * data[j + 1]! + 0.0722 * data[j + 2]!) * (data[j + 3]! / 255);
  }
  // Nearest-rank 99th percentile of the crop's actual (not histogram-quantized) luma.
  const ordered = luma.slice().sort();
  const threshold = Math.max(220, ordered[Math.max(0, Math.ceil(area * 0.99) - 1)]!);
  const seen = new Uint8Array(area),
    queue = new Int32Array(area),
    highlights: Highlight[] = [];
  for (let seed = 0; seed < area; seed++) {
    if (seen[seed] || luma[seed]! < threshold) continue;
    let head = 0,
      tail = 1,
      sumX = 0,
      sumY = 0,
      peak = 0,
      minX = width,
      minY = height,
      maxX = 0,
      maxY = 0;
    seen[seed] = 1;
    queue[0] = seed;
    while (head < tail) {
      const i = queue[head++]!,
        x = i % width,
        y = Math.floor(i / width);
      sumX += x + 0.5;
      sumY += y + 0.5;
      peak = Math.max(peak, luma[i]!);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy++)
        for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) {
          const n = yy * width + xx;
          if (!seen[n] && luma[n]! >= threshold) {
            seen[n] = 1;
            queue[tail++] = n;
          }
        }
    }
    if (tail < 2 || tail > area * 0.15) continue;
    highlights.push({
      centroid: { x: sumX / tail / width, y: sumY / tail / height },
      area: tail,
      peakLuma: peak,
      bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
    });
  }
  return highlights.sort((a, b) => b.area - a.area || a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x).slice(0, 5);
}

function imagePoint(h: Highlight, crop: PixelCrop, p: Pixels): Point {
  return { x: (crop.x + h.centroid.x * crop.w) / p.width, y: (crop.y + h.centroid.y * crop.h) / p.height };
}
function position(p: Point): string {
  const horizontal = p.x < 1 / 3 ? 'left' : p.x > 2 / 3 ? 'right' : 'center';
  const vertical = p.y < 1 / 3 ? 'upper' : p.y > 2 / 3 ? 'lower' : 'middle';
  return `${vertical}-${horizontal}`;
}

/** Describe visible bright components in two manual crops without comparing their similarity. */
export function eyeObservation(
  pixels: Pixels,
  assetId: string,
  leftRect: Rect,
  rightRect: Rect,
): CheckResult {
  validatePixels(pixels);
  const left = bounds(pixels, leftRect),
    right = bounds(pixels, rightRect);
  const usable = left && right && Math.min(left.w, left.h, right.w, right.h) >= 12;
  const lh = usable ? extractHighlights(cropPixels(pixels, left)) : [];
  const rh = usable ? extractHighlights(cropPixels(pixels, right)) : [];
  const overlays: Overlay[] = [];
  for (const [name, crop] of [
    ['Left', left],
    ['Right', right],
  ] as const)
    if (crop)
      overlays.push({
        type: 'box',
        label: `${name} eye crop`,
        x: crop.x / pixels.width,
        y: crop.y / pixels.height,
        width: crop.w / pixels.width,
        height: crop.h / pixels.height,
      });
  const points = [
    ...(left ? lh.map((h) => imagePoint(h, left, pixels)) : []),
    ...(right ? rh.map((h) => imagePoint(h, right, pixels)) : []),
  ];
  overlays.push({ type: 'points', label: 'Bright spot centroids', points });
  const applicable = !!usable && lh.length + rh.length > 0;
  const describe = (name: string, hs: Highlight[]) =>
    `${hs.length} bright spot${hs.length === 1 ? '' : 's'} in the ${name} eye crop${hs.length ? ` (${hs.map((h) => position(h.centroid)).join(', ')})` : ''}`;
  return {
    id: 'eyes',
    assetId,
    kind: 'physical',
    execution: 'complete',
    finding: applicable ? 'inconclusive' : 'not_applicable',
    title: 'Eye highlights',
    source: 'live',
    method:
      'Manual eye crops; luma threshold max(220, crop 99th percentile); eight-connected bright components, size filtering and pixel-center centroids.',
    observation: `${describe('left', lh)}; ${describe('right', rh)}.`,
    reason: applicable
      ? 'No validated comparison model; this is an observation for a person to inspect.'
      : !left || !right
        ? 'An eye crop is outside image bounds or invalid.'
        : !usable
          ? 'An eye crop is smaller than 12 pixels on a side.'
          : 'Neither eye crop has a qualifying bright spot.',
    assumptions: [
      'Crops contain the visible eyes of the same person',
      'Bright spots are specular reflections of light sources',
    ],
    limitations: [
      'Glasses and contact lenses can introduce or obscure bright spots.',
      'Occlusion and low resolution can hide bright spots.',
      'Multiple or area lights can produce several reflections.',
      'Camera and eye geometry affect observed positions.',
      'JPEG artefacts can alter bright components.',
      'Matching or non-matching highlights alone do not establish the origin or editing history of an image.',
    ],
    evidence: { left: { highlights: lh }, right: { highlights: rh }, cropsPx: { left, right } },
    overlays,
  };
}

/** Square previews stretch the selected crop; marker coordinates are preview PIXELS. */
export function sideBySide(
  pixels: Pixels,
  leftRect: Rect,
  rightRect: Rect,
  size = 128,
): { left: EyePreview; right: EyePreview } {
  validatePixels(pixels);
  if (!Number.isInteger(size) || size < 1 || size > 2048) throw new Error('Invalid preview size.');
  const make = (rect: Rect): EyePreview => {
    const r = bounds(pixels, rect);
    if (!r) throw new Error('Eye crop is outside image bounds or invalid.');
    const crop = cropPixels(pixels, r),
      highlights = extractHighlights(crop),
      data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const sx = Math.min(crop.width - 1, Math.floor(((x + 0.5) * crop.width) / size)),
          sy = Math.min(crop.height - 1, Math.floor(((y + 0.5) * crop.height) / size));
        const src = (sy * crop.width + sx) * 4,
          dst = (y * size + x) * 4;
        for (let c = 0; c < 4; c++) data[dst + c] = crop.data[src + c]!;
      }
    return {
      pixels: { width: size, height: size, data },
      highlights,
      markers: highlights.map((h) => ({ x: h.centroid.x * size, y: h.centroid.y * size })),
    };
  };
  return { left: make(leftRect), right: make(rightRect) };
}
