import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { animate, cubicBezier } from 'animejs';

type SnapPoint = 'peek' | 'half' | 'full';

const SNAP_ORDER: readonly SnapPoint[] = ['peek', 'half', 'full'];
const SNAP_VH: Record<SnapPoint, number> = { peek: 35, half: 55, full: 90 };
const DRAG_VELOCITY_PX_PER_MS = 0.45;
const SHEET_EASE = cubicBezier(.2, .8, .2, 1);

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function viewportHeight() {
  return window.visualViewport?.height ?? window.innerHeight;
}

function pointHeight(point: SnapPoint) {
  return Math.round((viewportHeight() * SNAP_VH[point]) / 100);
}

function closestPoint(height: number): SnapPoint {
  return SNAP_ORDER.reduce((closest, point) =>
    Math.abs(pointHeight(point) - height) < Math.abs(pointHeight(closest) - height) ? point : closest,
  );
}

/**
 * The phone evidence rail. It deliberately owns only positioning and drag behaviour;
 * callers supply the same EvidenceRows used by the desktop rail so keyboard and touch
 * users see identical observations.
 */
export function EvidenceSheet({ count, children }: { count: number; children: ReactNode }) {
  const sheetRef = useRef<HTMLElement>(null);
  const dragRef = useRef({ pointerId: -1, startY: 0, startHeight: 0, previousY: 0, previousAt: 0, velocity: 0 });
  const didDragRef = useRef(false);
  const snapRef = useRef<SnapPoint>('peek');
  const [snap, setSnap] = useState<SnapPoint>('peek');

  const setHeight = (height: number) => {
    const sheet = sheetRef.current;
    if (sheet) sheet.style.height = `${height}px`;
  };

  const settle = (next: SnapPoint) => {
    const sheet = sheetRef.current;
    snapRef.current = next;
    setSnap(next);
    if (!sheet) return;

    const target = pointHeight(next);
    if (prefersReducedMotion()) {
      setHeight(target);
      return;
    }
    animate(sheet, { height: target, duration: 240, ease: SHEET_EASE });
  };

  useEffect(() => {
    setHeight(pointHeight('peek'));
    const onResize = () => setHeight(pointHeight(snapRef.current));
    window.visualViewport?.addEventListener('resize', onResize);
    window.addEventListener('resize', onResize);
    return () => {
      window.visualViewport?.removeEventListener('resize', onResize);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const beginDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const sheet = sheetRef.current;
    if (!sheet || event.button !== 0) return;
    const height = sheet.getBoundingClientRect().height;
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: height,
      previousY: event.clientY,
      previousAt: event.timeStamp,
      velocity: 0,
    };
    didDragRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const drag = (event: PointerEvent<HTMLButtonElement>) => {
    const active = dragRef.current;
    if (active.pointerId !== event.pointerId) return;
    const deltaY = event.clientY - active.startY;
    if (Math.abs(deltaY) > 3) didDragRef.current = true;
    const next = Math.max(pointHeight('peek'), Math.min(pointHeight('full'), active.startHeight - deltaY));
    const elapsed = Math.max(1, event.timeStamp - active.previousAt);
    active.velocity = (event.clientY - active.previousY) / elapsed;
    active.previousY = event.clientY;
    active.previousAt = event.timeStamp;
    setHeight(next);
  };

  const endDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const active = dragRef.current;
    if (active.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const height = sheetRef.current?.getBoundingClientRect().height ?? pointHeight(snap);
    let next = closestPoint(height);
    if (Math.abs(active.velocity) >= DRAG_VELOCITY_PX_PER_MS) {
      const current = SNAP_ORDER.indexOf(next);
      // A fast upward drag (negative page Y) opens the next position; a downward one closes it.
      const index = Math.max(0, Math.min(SNAP_ORDER.length - 1, current + (active.velocity < 0 ? 1 : -1)));
      next = SNAP_ORDER[index] ?? next;
    }
    dragRef.current.pointerId = -1;
    settle(next);
  };

  const cycleSnap = () => {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    const index = SNAP_ORDER.indexOf(snap);
    settle(SNAP_ORDER[(index + 1) % SNAP_ORDER.length] ?? 'peek');
  };

  return (
    <aside
      ref={sheetRef}
      data-testid="evidence-sheet"
      aria-label="Evidence"
      className="fixed inset-x-0 bottom-0 z-40 flex min-h-0 flex-col overflow-hidden rounded-t-panel border border-line bg-panel shadow-[0_-8px_24px_rgb(0_0_0/0.12)] md:hidden"
      style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
    >
      <button
        type="button"
        aria-label={`Resize evidence sheet, currently ${snap}`}
        className="flex h-11 w-full shrink-0 touch-none items-center justify-center"
        onClick={cycleSnap}
        onPointerDown={beginDrag}
        onPointerMove={drag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span className="h-1 w-10 rounded-full bg-line-strong" aria-hidden />
      </button>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-1">
        <p className="mb-3 text-sm font-medium tabular">{count} finding{count === 1 ? '' : 's'}</p>
        {children}
      </div>
    </aside>
  );
}
