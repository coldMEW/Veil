import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { containFit } from './fit';
import type { Rect } from './Viewfinder';

/** A low-resolution value grid laid over one rectangle of the image (image pixels). */
export interface HeatOverlay {
  rect: { x: number; y: number; width: number; height: number };
  grid: number;
  /** Row-major, 0..1. */
  values: Float32Array;
  /** Optional pre-coloured RGBA grid (grid x grid). When set it is drawn as-is instead of the gold ramp. */
  rgba?: Uint8ClampedArray;
}

/** Object-to-shadow marks, normalized (0..1) to the oriented image. */
export interface MarkOverlay {
  pairs: ReadonlyArray<{ id: string; object: { x: number; y: number }; shadow: { x: number; y: number } }>;
  pending: { x: number; y: number } | null;
  offending: readonly string[];
  /** [x, y, 1] finite light, [dx, dy, 0] direction at infinity, or null. */
  light: readonly [number, number, number] | null;
}

interface ImageCanvasProps {
  bitmap: ImageBitmap;
  label: string;
  /** Reports where the photo is drawn, in CSS pixels relative to this component. */
  onFit?: (rect: Rect) => void;
  overlay?: HeatOverlay | null;
  marks?: MarkOverlay | null;
  /** Normalized boxes, e.g. text found by Clean. Selected boxes are drawn in gold. */
  boxes?: ReadonlyArray<{ id: string; x: number; y: number; w: number; h: number; selected: boolean }> | null;
  /** When set, a tap or click on the photo reports a normalized image point. */
  onImagePoint?: ((p: { x: number; y: number }) => void) | null;
  /** When set, dragging on the photo draws a box and reports it normalized (e.g. a face box). */
  onImageRect?: ((r: NormRect) => void) | null;
  /** A box to outline on the photo, normalized. */
  focusBox?: NormRect | null;
  /** A pre-rendered heat image drawn over `rect` (normalized), e.g. the predicted face warp. */
  heatImage?: { rect: NormRect; image: CanvasImageSource } | null;
}

export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const INSET = 28; // room for the viewfinder brackets and the photo's shadow

function drawHeat(ctx: CanvasRenderingContext2D, overlay: HeatOverlay, photo: Rect, scale: number) {
  const r = {
    x: photo.x + overlay.rect.x * scale,
    y: photo.y + overlay.rect.y * scale,
    w: overlay.rect.width * scale,
    h: overlay.rect.height * scale,
  };

  // Hatch what the model never saw.
  ctx.save();
  ctx.beginPath();
  ctx.rect(photo.x, photo.y, photo.w, photo.h);
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip('evenodd');
  ctx.fillStyle = 'rgba(241, 245, 249, 0.7)';
  ctx.fillRect(photo.x, photo.y, photo.w, photo.h);
  ctx.strokeStyle = 'rgba(71, 85, 105, 0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let d = -photo.h; d < photo.w; d += 10) {
    ctx.moveTo(photo.x + d, photo.y + photo.h);
    ctx.lineTo(photo.x + d + photo.h, photo.y);
  }
  ctx.stroke();
  ctx.restore();

  // Heat: draw the grid small, then let smoothing spread it across the crop.
  const n = overlay.grid;
  const small = document.createElement('canvas');
  small.width = n;
  small.height = n;
  const sctx = small.getContext('2d');
  if (sctx) {
    const img = sctx.createImageData(n, n);
    if (overlay.rgba) img.data.set(overlay.rgba.subarray(0, n * n * 4));
    else for (let i = 0; i < n * n; i++) {
      const v = Math.min(1, Math.max(0, overlay.values[i] ?? 0));
      img.data[i * 4] = 255;
      img.data[i * 4 + 1] = Math.round(199 + 56 * v * v); // gold warming toward pale at the peak
      img.data[i * 4 + 2] = Math.round(44 + 140 * v * v);
      img.data[i * 4 + 3] = Math.round(255 * (0.08 + 0.62 * Math.pow(v, 1.3)));
    }
    sctx.putImageData(img, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalCompositeOperation = overlay.rgba ? 'source-over' : 'screen';
    ctx.drawImage(small, r.x, r.y, r.w, r.h);
    ctx.restore();
  }

  // The model's crop, outlined.
  ctx.save();
  ctx.strokeStyle = 'rgba(29, 78, 216, 0.9)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 5]);
  ctx.strokeRect(r.x + 0.75, r.y + 0.75, r.w - 1.5, r.h - 1.5);
  ctx.restore();
}

const GOLD = 'rgba(37, 99, 235, 0.95)';
const SHADOW_DOT = 'rgba(160, 196, 255, 0.95)';
const MISFIT = 'rgba(255, 178, 122, 0.95)';

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) {
  ctx.beginPath();
  ctx.arc(x, y, r + 1.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(5, 14, 31, 0.85)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawMarks(ctx: CanvasRenderingContext2D, marks: MarkOverlay, photo: Rect, view: { w: number; h: number }) {
  const px = (p: { x: number; y: number }) => ({ x: photo.x + p.x * photo.w, y: photo.y + p.y * photo.h });
  const far = Math.hypot(view.w, view.h) * 2;
  const off = new Set(marks.offending);
  ctx.save();
  ctx.lineCap = 'round';
  for (const pair of marks.pairs) {
    const o = px(pair.object);
    const s = px(pair.shadow);
    const color = off.has(pair.id) ? MISFIT : GOLD;
    const len = Math.hypot(o.x - s.x, o.y - s.y) || 1;
    const ux = (o.x - s.x) / len;
    const uy = (o.y - s.y) / len;
    // Extend the shadow-to-object line both ways, faint, so the meeting point can be seen.
    ctx.strokeStyle = color.replace('0.95', '0.35');
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 6]);
    ctx.beginPath();
    ctx.moveTo(s.x - ux * far, s.y - uy * far);
    ctx.lineTo(o.x + ux * far, o.y + uy * far);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(o.x, o.y);
    ctx.stroke();
    dot(ctx, o.x, o.y, 5, color);
    dot(ctx, s.x, s.y, 4, SHADOW_DOT);
    ctx.font = '600 12px "Outfit Variable", system-ui, sans-serif';
    ctx.fillStyle = color;
    ctx.fillText(pair.id, o.x + 8, o.y - 8);
  }
  if (marks.pending) {
    const p = px(marks.pending);
    dot(ctx, p.x, p.y, 6, GOLD);
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (marks.light && marks.light[2] !== 0) {
    const l = px({ x: marks.light[0], y: marks.light[1] });
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(l.x, l.y, 9, 0, Math.PI * 2);
    ctx.moveTo(l.x - 15, l.y);
    ctx.lineTo(l.x + 15, l.y);
    ctx.moveTo(l.x, l.y - 15);
    ctx.lineTo(l.x, l.y + 15);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBoxes(ctx: CanvasRenderingContext2D, boxes: NonNullable<ImageCanvasProps['boxes']>, photo: Rect) {
  ctx.save();
  for (const b of boxes) {
    const x = photo.x + b.x * photo.w;
    const y = photo.y + b.y * photo.h;
    const w = b.w * photo.w;
    const h = b.h * photo.h;
    ctx.fillStyle = b.selected ? 'rgba(37, 99, 235, 0.18)' : 'rgba(232, 237, 245, 0.06)';
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.strokeStyle = b.selected ? 'rgba(37, 99, 235, 0.95)' : 'rgba(232, 237, 245, 0.55)';
    ctx.lineWidth = b.selected ? 2 : 1;
    ctx.setLineDash(b.selected ? [] : [4, 4]);
    ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
  }
  ctx.restore();
}

function drawFocusBox(ctx: CanvasRenderingContext2D, r: NormRect, photo: Rect) {
  ctx.save();
  ctx.strokeStyle = 'rgba(37, 99, 235, 0.95)';
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 5]);
  ctx.strokeRect(photo.x + r.x * photo.w, photo.y + r.y * photo.h, r.w * photo.w, r.h * photo.h);
  ctx.restore();
}

function drawHeatImage(ctx: CanvasRenderingContext2D, h: { rect: NormRect; image: CanvasImageSource }, photo: Rect) {
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(h.image, photo.x + h.rect.x * photo.w, photo.y + h.rect.y * photo.h, h.rect.w * photo.w, h.rect.h * photo.h);
  ctx.restore();
}

/** Draws the orientation-corrected image, contained and centered, sharp on high-DPI screens. */
export function ImageCanvas({
  bitmap,
  label,
  onFit,
  overlay = null,
  marks = null,
  boxes = null,
  onImagePoint = null,
  onImageRect = null,
  focusBox = null,
  heatImage = null,
}: ImageCanvasProps) {
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const photoRef = useRef<Rect | null>(null);
  const downRef = useRef<{ x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onFitRef = useRef(onFit);
  onFitRef.current = onFit;

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const draw = () => {
      // clientWidth ignores the entrance transform, so geometry stays exact mid-animation.
      const viewW = wrap.clientWidth;
      const viewH = wrap.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(viewW * dpr));
      canvas.height = Math.max(1, Math.round(viewH * dpr));
      canvas.style.width = `${viewW}px`;
      canvas.style.height = `${viewH}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, viewW, viewH);

      const fit = containFit(bitmap.width, bitmap.height, viewW - INSET * 2, viewH - INSET * 2);
      const photo: Rect = { x: fit.offsetX + INSET, y: fit.offsetY + INSET, w: fit.width, h: fit.height };

      // A soft, offset shadow lifts the print off the lightbox.
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
      ctx.shadowBlur = 36;
      ctx.shadowOffsetY = 16;
      ctx.fillStyle = '#111316';
      ctx.fillRect(photo.x, photo.y, photo.w, photo.h);
      ctx.restore();

      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, photo.x, photo.y, photo.w, photo.h);
      if (overlay) drawHeat(ctx, overlay, photo, fit.scale);
      if (marks) drawMarks(ctx, marks, photo, { w: viewW, h: viewH });
      if (boxes) drawBoxes(ctx, boxes, photo);
      if (heatImage) drawHeatImage(ctx, heatImage, photo);
      if (focusBox) drawFocusBox(ctx, focusBox, photo);
      photoRef.current = photo;
      onFitRef.current?.(photo);
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [bitmap, overlay, marks, boxes, heatImage, focusBox]);

  return (
    <motion.div
      ref={wrapRef}
      className="absolute inset-0 overflow-hidden"
      initial={false}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        className={`absolute inset-0 ${onImagePoint || onImageRect ? 'cursor-crosshair touch-none' : ''}`}
        onPointerDown={(e) => {
          downRef.current = { x: e.clientX, y: e.clientY };
          if (onImageRect) {
            e.currentTarget.setPointerCapture(e.pointerId);
            const box = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - box.left;
            const y = e.clientY - box.top;
            setDrag({ x0: x, y0: y, x1: x, y1: y });
          }
        }}
        onPointerMove={(e) => {
          if (!onImageRect || !drag) return;
          const box = e.currentTarget.getBoundingClientRect();
          setDrag({ ...drag, x1: e.clientX - box.left, y1: e.clientY - box.top });
        }}
        onPointerCancel={() => setDrag(null)}
        onPointerUp={(e) => {
          if (onImageRect && drag) {
            const photo = photoRef.current;
            const box = e.currentTarget.getBoundingClientRect();
            const x1 = e.clientX - box.left;
            const y1 = e.clientY - box.top;
            setDrag(null);
            downRef.current = null;
            if (!photo) return;
            const clamp = (v: number) => Math.min(1, Math.max(0, v));
            const ax = clamp((Math.min(drag.x0, x1) - photo.x) / photo.w);
            const ay = clamp((Math.min(drag.y0, y1) - photo.y) / photo.h);
            const bx = clamp((Math.max(drag.x0, x1) - photo.x) / photo.w);
            const by = clamp((Math.max(drag.y0, y1) - photo.y) / photo.h);
            if ((bx - ax) * photo.w < 24 || (by - ay) * photo.h < 24) return; // too small to be a face box
            onImageRect({ x: ax, y: ay, w: bx - ax, h: by - ay });
            return;
          }
          const down = downRef.current;
          downRef.current = null;
          const photo = photoRef.current;
          if (!onImagePoint || !down || !photo) return;
          if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return; // a drag, not a tap
          const box = e.currentTarget.getBoundingClientRect();
          const x = (e.clientX - box.left - photo.x) / photo.w;
          const y = (e.clientY - box.top - photo.y) / photo.h;
          if (x < 0 || x > 1 || y < 0 || y > 1) return;
          onImagePoint({ x, y });
        }}
      />
      {drag && (
        <div
          aria-hidden
          className="pointer-events-none absolute border-2 border-dashed border-gold bg-gold/10"
          style={{
            left: Math.min(drag.x0, drag.x1),
            top: Math.min(drag.y0, drag.y1),
            width: Math.abs(drag.x1 - drag.x0),
            height: Math.abs(drag.y1 - drag.y0),
          }}
        />
      )}
    </motion.div>
  );
}
