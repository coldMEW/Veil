import { useEffect, useRef } from 'react';

/** The photo, as it is. Nothing is drawn on top of it. */
export function PhotoView({ bitmap, label }: { bitmap: ImageBitmap; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    c.width = Math.round(bitmap.width * scale);
    c.height = Math.round(bitmap.height * scale);
    c.getContext('2d')?.drawImage(bitmap, 0, 0, c.width, c.height);
  }, [bitmap]);
  return (
    <div className="photo">
      <canvas ref={ref} role="img" aria-label={label} />
    </div>
  );
}
