import { useEffect, useRef, useState } from 'react';

function draw(c: HTMLCanvasElement | null, b: ImageBitmap) {
  if (!c) return;
  const s = Math.min(1, 2400 / Math.max(b.width, b.height));
  c.width = Math.round(b.width * s);
  c.height = Math.round(b.height * s);
  c.getContext('2d')?.drawImage(b, 0, 0, c.width, c.height);
}

/** Drag to compare. The handle follows the pointer; arrow keys move it too. */
export function BeforeAfter({ before, after, afterLabel = 'Shielded' }: { before: ImageBitmap; after: ImageBitmap; afterLabel?: string }) {
  const a = useRef<HTMLCanvasElement>(null);
  const b = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(50);
  useEffect(() => draw(a.current, before), [before]);
  useEffect(() => draw(b.current, after), [after]);

  const move = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setPos(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)));
  };

  return (
    <div className="photo">
      <div
        ref={box}
        className="ba"
        style={{ aspectRatio: `${before.width} / ${before.height}` }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          move(e.clientX);
        }}
        onPointerMove={(e) => e.buttons && move(e.clientX)}
      >
        <canvas ref={a} aria-hidden="true" />
        <canvas ref={b} style={{ clipPath: `inset(0 0 0 ${pos}%)` }} aria-hidden="true" />
        <div
          className="ba-handle"
          style={{ left: `${pos}%` }}
          role="slider"
          tabIndex={0}
          aria-label="Compare before and after"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pos)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setPos((p) => Math.max(0, p - 5));
            if (e.key === 'ArrowRight') setPos((p) => Math.min(100, p + 5));
          }}
        />
        <span className="ba-tag ba-tag-l">Before</span>
        <span className="ba-tag ba-tag-r">{afterLabel}</span>
      </div>
    </div>
  );
}
