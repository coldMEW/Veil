import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { animate } from 'animejs';

type Snap = 'peek' | 'half' | 'full';
const PEEK = 176; // handle, title and the first row

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Phone bottom sheet (Material modal-less standard sheet): peeks above the navigation bar,
 * drags to half or full height, and snaps with the drag's velocity. Content scrolls inside.
 */
export function EvidenceSheet({ title, subtitle, children, testId = 'evidence-sheet', resetKey, bottomInset = 0, accent }: { title: string; subtitle?: string; children: ReactNode; testId?: string; resetKey?: string; bottomInset?: number; accent?: string }) {
  const sheet = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [snap, setSnap] = useState<Snap>('peek');
  const drag = useRef<{ y: number; h: number; t: number; lastY: number; lastT: number } | null>(null);

  const heights = useCallback(() => {
    const avail = (sheet.current?.parentElement?.clientHeight ?? window.innerHeight) - 8;
    return { peek: Math.min(PEEK + bottomInset, avail), half: Math.round(avail * 0.55) + bottomInset / 2, full: avail };
  }, [bottomInset]);

  const goTo = useCallback(
    (next: Snap, from?: number) => {
      const el = sheet.current;
      if (!el) return;
      const target = heights()[next];
      setSnap(next);
      if (reduced() || from === undefined) {
        el.style.height = `${target}px`;
        return;
      }
      animate(el, { height: [from, target], duration: 320, ease: 'outExpo' });
    },
    [heights],
  );

  useEffect(() => {
    goTo('peek');
    scroller.current?.scrollTo({ top: 0 });
  }, [goTo, resetKey]);

  useEffect(() => {
    const onResize = () => goTo(snap);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [goTo, snap]);

  const onPointerDown = (e: React.PointerEvent) => {
    const el = sheet.current;
    if (!el) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const now = performance.now();
    drag.current = { y: e.clientY, h: el.offsetHeight, t: now, lastY: e.clientY, lastT: now };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = sheet.current;
    if (!d || !el) return;
    const { peek, full } = heights();
    const h = Math.min(full, Math.max(peek - 40, d.h + (d.y - e.clientY)));
    el.style.height = `${h}px`;
    d.lastY = e.clientY;
    d.lastT = performance.now();
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = sheet.current;
    drag.current = null;
    if (!d || !el) return;
    const moved = Math.abs(e.clientY - d.y);
    const h = el.offsetHeight;
    const hs = heights();
    if (moved < 6) {
      // A tap on the handle steps through the sizes.
      goTo(snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'peek', h);
      return;
    }
    const velocity = (d.lastY - e.clientY) / Math.max(1, performance.now() - d.lastT + 16); // px/ms, + = up
    const projected = h + velocity * 180;
    const order: Snap[] = ['peek', 'half', 'full'];
    const next = order.reduce((best, s) => (Math.abs(hs[s] - projected) < Math.abs(hs[best] - projected) ? s : best), 'peek' as Snap);
    goTo(next, h);
  };

  return (
    <section
      ref={sheet}
      data-testid={testId}
      data-snap={snap}
      aria-label={title}
      className="absolute inset-x-0 bottom-0 z-30 flex flex-col overflow-hidden rounded-t-sheet bg-night shadow-[var(--shadow-sheet)] lg:hidden"
      style={{ height: PEEK + bottomInset }}
    >
      <div
        role="slider"
        tabIndex={0}
        aria-label={`Resize ${title.toLowerCase()}`}
        aria-valuetext={snap === 'peek' ? 'Collapsed' : snap === 'half' ? 'Half height' : 'Full height'}
        aria-valuemin={0}
        aria-valuemax={2}
        aria-valuenow={snap === 'peek' ? 0 : snap === 'half' ? 1 : 2}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(e) => {
          const h = sheet.current?.offsetHeight;
          if (e.key === 'ArrowUp') goTo(snap === 'peek' ? 'half' : 'full', h);
          if (e.key === 'ArrowDown') goTo(snap === 'full' ? 'half' : 'peek', h);
        }}
        className="shrink-0 cursor-grab touch-none select-none px-5 pb-2 pt-3 active:cursor-grabbing"
      >
        <span className="mx-auto block h-1 w-8 rounded-full bg-control" aria-hidden />
        <div className="mt-3 flex items-baseline justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-[-0.01em]"><span className="size-2.5 rounded-full" style={{ background: accent ?? 'var(--color-gold)' }} aria-hidden />{title}</h2>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3" style={{ paddingBottom: bottomInset + 24 }}>
        {children}
      </div>
    </section>
  );
}
