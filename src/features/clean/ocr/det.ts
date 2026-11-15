import { clipRect, resizeBgr, validateImage } from './image';
import type { Detection, PixelRect, RgbaImage, TensorData, Profile } from './types';

export function detectorSize(width: number, height: number, limit = 960) {
  if (![width, height, limit].every(Number.isFinite) || width <= 0 || height <= 0 || limit < 32)
    throw new Error('Invalid detector dimensions.');
  const ratio = Math.min(1, limit / Math.max(width, height));
  const round32 = (n: number) =>
    Math.max(32, Math.min(Math.floor(limit / 32) * 32, Math.round((n * ratio) / 32) * 32));
  return { width: round32(width), height: round32(height) };
}

/** Paddle's reference inference uses BGR channel order with ImageNet mean/std. */
export function preprocessDetection(
  image: RgbaImage,
  crop?: PixelRect,
  limit = 960,
  profile?: Profile,
  rotate90 = false,
): TensorData {
  const prepStart = performance.now();
  validateImage(image);
  const region = clipRect(crop ?? { x: 0, y: 0, w: image.width, h: image.height }, image.width, image.height);
  const { width, height } = detectorSize(
    rotate90 ? region.h : region.w,
    rotate90 ? region.w : region.h,
    limit,
  );
  const data = new Float32Array(3 * width * height);
  const area = width * height,
    src = image.data;
  if (
    !rotate90 &&
    region.w === width &&
    region.h === height &&
    Number.isInteger(region.x) &&
    Number.isInteger(region.y)
  ) {
    const blue = new Float32Array(256),
      green = new Float32Array(256),
      red = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      blue[i]! = (i / 255 - 0.485) / 0.229;
      green[i]! = (i / 255 - 0.456) / 0.224;
      red[i]! = (i / 255 - 0.406) / 0.225;
    }
    const stride = image.width | 0,
      left = region.x | 0,
      top = region.y | 0;
    for (let y = 0, row = (top * stride + left) * 4; y < height; y++, row += stride * 4) {
      for (let x = 0, i = row, j = y * width; x < width; x++, i += 4, j++) {
        if (src[i + 3]! === 255) {
          data[j]! = blue[src[i + 2]!]!;
          data[area + j]! = green[src[i + 1]!]!;
          data[2 * area + j]! = red[src[i]!]!;
        } else {
          const a = src[i + 3]! / 255,
            bg = 255 * (1 - a);
          data[j]! = ((src[i + 2]! * a + bg) / 255 - 0.485) / 0.229;
          data[area + j]! = ((src[i + 1]! * a + bg) / 255 - 0.456) / 0.224;
          data[2 * area + j]! = ((src[i]! * a + bg) / 255 - 0.406) / 0.225;
        }
      }
    }
    profile?.('normalize_source_tiles', performance.now() - prepStart);
  } else {
    const resizeStart = performance.now();
    const quad: [number, number][] | undefined = rotate90
      ? [
          [region.x + region.w - 0.5, region.y - 0.5],
          [region.x + region.w - 0.5, region.y + region.h - 0.5],
          [region.x - 0.5, region.y + region.h - 0.5],
          [region.x - 0.5, region.y - 0.5],
        ]
      : undefined;
    const pixels = resizeBgr(image, region, width, height, quad);
    profile?.('det_resize', performance.now() - resizeStart);
    const normStart = performance.now();
    for (let j = 0; j < area; j++) {
      data[j]! = (pixels[j * 3]! / 255 - 0.485) / 0.229;
      data[area + j]! = (pixels[j * 3 + 1]! / 255 - 0.456) / 0.224;
      data[2 * area + j]! = (pixels[j * 3 + 2]! / 255 - 0.406) / 0.225;
    }
    profile?.('det_normalize', performance.now() - normStart);
  }
  return { data, dims: [1, 3, height, width] };
}

interface DbOptions {
  threshold?: number;
  boxThreshold?: number;
  unclipRatio?: number;
  profile?: Profile;
}

/**
 * DB bitmap -> 8-connected components -> axis-aligned contour envelopes.
 * v1 deliberately does not recover rotated quadrilaterals. Rectangle expansion uses
 * DB's distance = area * unclipRatio / perimeter, then maps to source tile pixels.
 */
export function postprocessDetection(
  map: Float32Array,
  mapWidth: number,
  mapHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  options: DbOptions = {},
): Detection[] {
  if (
    !Number.isInteger(mapWidth) ||
    !Number.isInteger(mapHeight) ||
    mapWidth < 1 ||
    mapHeight < 1 ||
    map.length !== mapWidth * mapHeight ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  )
    throw new Error('Invalid DB probability map.');
  const { threshold = 0.3, boxThreshold = 0.6, unclipRatio = 1.5 } = options;
  const dbStart = performance.now();
  let pcaMs = 0;
  const visited = new Uint8Array(map.length);
  const queue = new Int32Array(map.length);
  const boxes: Detection[] = [];
  for (let seed = 0; seed < map.length; seed++) {
    if (visited[seed]! || !(map[seed]! > threshold)) continue;
    let head = 0,
      tail = 1;
    queue[0]! = seed;
    visited[seed]! = 1;
    let minX = mapWidth,
      minY = mapHeight,
      maxX = 0,
      maxY = 0;
    while (head < tail) {
      const index = queue[head++]!,
        x = index % mapWidth,
        y = Math.floor(index / mapWidth);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (let yy = Math.max(0, y - 1); yy <= Math.min(mapHeight - 1, y + 1); yy++) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(mapWidth - 1, x + 1); xx++) {
          const next = yy * mapWidth + xx;
          if (!visited[next]! && map[next]! > threshold) {
            visited[next]! = 1;
            queue[tail++]! = next;
          }
        }
      }
    }
    const w = maxX - minX + 1,
      h = maxY - minY + 1;
    if (Math.min(w, h) < 3) continue;
    let sum = 0;
    for (let i = 0; i < tail; i++) sum += map[queue[i]!]!;
    const detScore = sum / tail;
    if (!Number.isFinite(detScore) || detScore < boxThreshold) continue;
    const pcaStart = performance.now();
    // PCA orientation of component pixels; project onto orthogonal axes to form a rotated envelope.
    let cx = 0,
      cy = 0;
    for (let i = 0; i < tail; i++) {
      cx += queue[i]! % mapWidth;
      cy += Math.floor(queue[i]! / mapWidth);
    }
    cx /= tail;
    cy /= tail;
    let xx = 0,
      yy = 0,
      xy = 0;
    for (let i = 0; i < tail; i++) {
      const dx = (queue[i]! % mapWidth) - cx,
        dy = Math.floor(queue[i]! / mapWidth) - cy;
      xx += dx * dx;
      yy += dy * dy;
      xy += dx * dy;
    }
    const angle = 0.5 * Math.atan2(2 * xy, xx - yy),
      co = Math.cos(angle),
      si = Math.sin(angle);
    let loU = Infinity,
      hiU = -Infinity,
      loV = Infinity,
      hiV = -Infinity;
    for (let i = 0; i < tail; i++) {
      const dx = (queue[i]! % mapWidth) - cx,
        dy = Math.floor(queue[i]! / mapWidth) - cy;
      const u = dx * co + dy * si,
        v = -dx * si + dy * co;
      loU = Math.min(loU, u);
      hiU = Math.max(hiU, u);
      loV = Math.min(loV, v);
      hiV = Math.max(hiV, v);
    }
    const rw = hiU - loU + 1,
      rh = hiV - loV + 1;
    const pad = (rw * rh * unclipRatio) / (2 * (rw + rh));
    const quad: [number, number][] = (
      [
        [loU - pad, loV - pad],
        [hiU + 1 + pad, loV - pad],
        [hiU + 1 + pad, hiV + 1 + pad],
        [loU - pad, hiV + 1 + pad],
      ] as [number, number][]
    ).map(([u, v]) => [
      (Math.max(0, Math.min(mapWidth, cx + u * co - v * si)) * sourceWidth) / mapWidth,
      (Math.max(0, Math.min(mapHeight, cy + u * si + v * co)) * sourceHeight) / mapHeight,
    ]);
    const qx = quad.map((p) => p[0]!),
      qy = quad.map((p) => p[1]!);
    pcaMs += performance.now() - pcaStart;
    boxes.push({
      detScore,
      quad,
      pixelRect: {
        x: Math.min(...qx),
        y: Math.min(...qy),
        w: Math.max(...qx) - Math.min(...qx),
        h: Math.max(...qy) - Math.min(...qy),
      },
    });
  }
  options.profile?.('db_components_score', performance.now() - dbStart - pcaMs);
  options.profile?.('pca_quad', pcaMs);
  return boxes;
}
