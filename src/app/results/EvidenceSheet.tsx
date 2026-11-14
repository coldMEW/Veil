import { useRef, useState, type ReactNode } from 'react';
import { animate } from 'animejs';

const SNAP_POINTS = [35, 55, 90] as const;

/** Phone evidence rail: a pointer-captured, snap-point bottom sheet. */
export function EvidenceSheet({ count, children }: { count: number; children: ReactNode }) {
  const [vh, setVh] = useState<number>(35);
  const startY = useRef(0); const startVh = useRef(35); const sheet = useRef<HTMLElement>(null);
  const snap = (value: number) => {
    const next = SNAP_POINTS.reduce((best, candidate) => Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best);
    const previous = vh; setVh(next);
    if (sheet.current && !matchMedia('(prefers-reduced-motion: reduce)').matches) animate(sheet.current, { height: [`${previous}vh`, `${next}vh`], duration: 220, ease: 'outQuad' });
  };
  return <aside ref={sheet} data-testid="evidence-sheet" className="fixed inset-x-0 bottom-0 z-40 overflow-y-auto rounded-t-panel border border-line bg-panel p-4 shadow-lg lg:hidden" style={{ height: `${vh}vh`, paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
    <button type="button" aria-label="Resize evidence sheet" className="mx-auto block h-7 w-full touch-none" onPointerDown={(event) => { startY.current = event.clientY; startVh.current = vh; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerUp={(event) => snap(startVh.current + (startY.current - event.clientY) / innerHeight * 100)}>
      <span className="mx-auto block h-1 w-10 rounded-full bg-control" />
    </button>
    <p className="mb-3 text-sm font-medium">{count} findings</p>
    {children}
  </aside>;
}
