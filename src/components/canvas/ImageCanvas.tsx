import { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { containFit } from './fit';
import type { Rect } from './Viewfinder';

interface ImageCanvasProps {
  bitmap: ImageBitmap;
  label: string;
  /** Reports where the photo is drawn, in CSS pixels relative to this component. */
  onFit?: (rect: Rect) => void;
}

const INSET = 28; // room for the viewfinder brackets and the photo's shadow

/** Draws the orientation-corrected image, contained and centered, sharp on high-DPI screens. */
export function ImageCanvas({ bitmap, label, onFit }: ImageCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onFitRef = useRef(onFit);
  onFitRef.current = onFit;

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const draw = () => {
      const { width: viewW, height: viewH } = wrap.getBoundingClientRect();
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
      const x = fit.offsetX + INSET;
      const y = fit.offsetY + INSET;

      // A soft, offset shadow lifts the print off the lightbox.
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
      ctx.shadowBlur = 36;
      ctx.shadowOffsetY = 16;
      ctx.fillStyle = '#111316';
      ctx.fillRect(x, y, fit.width, fit.height);
      ctx.restore();

      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, x, y, fit.width, fit.height);
      onFitRef.current?.({ x, y, w: fit.width, h: fit.height });
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [bitmap]);

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
