import { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { containFit } from './fit';
import type { Rect } from './Viewfinder';

/** A low-resolution value grid laid over one rectangle of the image (image pixels). */
export interface HeatOverlay {
  rect: { x: number; y: number; width: number; height: number };
  grid: number;
  /** Row-major, 0..1. */
  values: Float32Array;
}

interface ImageCanvasProps {
  bitmap: ImageBitmap;
  label: string;
  /** Reports where the photo is drawn, in CSS pixels relative to this component. */
  onFit?: (rect: Rect) => void;
  overlay?: HeatOverlay | null;
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
  ctx.fillStyle = 'rgba(5, 14, 31, 0.55)';
  ctx.fillRect(photo.x, photo.y, photo.w, photo.h);
  ctx.strokeStyle = 'rgba(232, 237, 245, 0.18)';
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
    for (let i = 0; i < n * n; i++) {
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
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(small, r.x, r.y, r.w, r.h);
    ctx.restore();
  }

  // The model's crop, outlined.
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 199, 44, 0.75)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 5]);
  ctx.strokeRect(r.x + 0.75, r.y + 0.75, r.w - 1.5, r.h - 1.5);
  ctx.restore();
}

/** Draws the orientation-corrected image, contained and centered, sharp on high-DPI screens. */
export function ImageCanvas({ bitmap, label, onFit, overlay = null }: ImageCanvasProps) {
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
      onFitRef.current?.(photo);
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [bitmap, overlay]);

  return (
    <motion.div
      ref={wrapRef}
      className="absolute inset-0 overflow-hidden"
      initial={{ opacity: 0, filter: 'blur(18px)', clipPath: 'inset(46% 0% 46% 0%)', scale: 1.02 }}
      animate={{ opacity: 1, filter: 'blur(0px)', clipPath: 'inset(0% 0% 0% 0%)', scale: 1 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <canvas ref={canvasRef} role="img" aria-label={label} className="absolute inset-0" />
    </motion.div>
  );
}
